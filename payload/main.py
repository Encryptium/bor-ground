"""
2025 Mars Rover Payload/Rover Code (Cleaned + GPS kept for Ground Station)

NOTE:
- Competition rules may not require GPS, but ground station expects lat/lon for mapping.
- This version is robust: watchdog + crash-reboot + non-blocking GPS.
"""

from machine import I2C, UART, Pin, WDT, reset
from bmp280 import BMP280
from mpu6050 import MPU6050
from micropyGPS import MicropyGPS
from camera_helper import get_photo_b64
import time
import math
import ujson
import sys

# -------------------------
# USER SETTINGS
# -------------------------
DEBUG = True

XBEE_BAUD = 9600
GPS_BAUD = 9600

TELEMETRY_PERIOD_MS = 1000
IMAGE_PERIOD_MS     = 1000
CHUNK_SIZE          = 90

LAND_ALT_FT_THRESHOLD = 10.0
LAND_STABLE_MS        = 3000

# Watchdog: pick 8–12s so it survives a slow image frame
WDT_TIMEOUT_MS = 8000

# -------------------------
# Watchdog
# -------------------------
time.sleep(5) # grace period before watchdog takes effect
wdt = WDT(timeout=WDT_TIMEOUT_MS)

def kick():
    try:
        wdt.feed()
    except:
        pass

# -------------------------
# Hardware setup
# -------------------------
xbee = UART(1, baudrate=XBEE_BAUD, rx=Pin(5), tx=Pin(4), timeout=3000)

gps_module = UART(0, baudrate=GPS_BAUD, tx=Pin(0), rx=Pin(1))
gps = MicropyGPS(-5)

bus = I2C(1, sda=Pin(6), scl=Pin(7))
bmp = BMP280(bus)
mpu = MPU6050(bus)

motor_left_pwr = Pin(10, Pin.OUT)
motor_left_gnd = Pin(11, Pin.OUT)
motor_left_pwr.low()
motor_left_gnd.low()

motor_right_pwr = Pin(8, Pin.OUT)
motor_right_gnd = Pin(9, Pin.OUT)
motor_right_pwr.low()
motor_right_gnd.low()

def leftMotorForward():
    motor_left_pwr.high()
    motor_left_gnd.low()
    
def rightMotorForward():
    motor_right_pwr.high()
    motor_right_gnd.low()
    
def leftMotorBackward():
    motor_left_pwr.low()
    motor_left_gnd.high()
    
def rightMotorBackward():
    motor_right_pwr.low()
    motor_right_gnd.high()

# -------------------------
# Helpers
# -------------------------
def calcAltitude(press_pa, unit='ft'):
    # Barometric altitude approximation
    a = press_pa / 101325.0
    b = 1 / 5.25588
    c = 1.0 - math.pow(a, b)
    c = c / 0.0000225577
    if unit == 'ft':
        c *= 3.28084
    return c

def convert_coordinates(sections):
    # sections like [deg, minutes, 'N'/'S' or 'E'/'W']
    if (not sections) or sections[0] == 0:
        return None
    deg = sections[0]
    minutes = sections[1]
    hemi = sections[2]
    val = deg + (minutes / 60.0)
    if hemi in ('S', 'W'):
        val = -val
    return float('{0:.6f}'.format(val))

def read_battery_voltage():
    # TODO: replace with ADC reading
    return 7.4

def safe_write_line(s):
    # Always newline-terminated packets
    if isinstance(s, str):
        xbee.write(s.encode('utf-8') + b'\n')
    else:
        xbee.write(s + b'\n')
        
def pump_xbee_rx(cmd_buffer):
    try:
        n = xbee.any()
        if not n:
            return cmd_buffer

        raw = xbee.read(n)  # IMPORTANT: positional only (no keywords)
        if not raw:
            return cmd_buffer

        cmd_buffer += raw.decode('utf-8', 'ignore')

        while '\n' in cmd_buffer:
            line, cmd_buffer = cmd_buffer.split('\n', 1)
            line = line.strip()
            if not line:
                continue

            if DEBUG:
                print("RX:", line)

            handled = handle_command_line(line)
            if (not handled) and DEBUG:
                print("Ignored:", line)

        return cmd_buffer

    except Exception as e:
        # Don't let RX pumping crash the whole flight loop
        if DEBUG:
            print("pump_xbee_rx err:", e)
        return cmd_buffer

def update_gps_nonblocking():
    # Never blocks; just consumes whatever bytes are available right now
    kick()
    n = gps_module.any()
    if n and n > 0:
        data = gps_module.read(n)
        if data:
            for b in data:
                # micropyGPS expects chars
                gps.update(chr(b))

    lat = convert_coordinates(gps.latitude)
    lon = convert_coordinates(gps.longitude)
    if lat is None or lon is None:
        return 0.0, 0.0
    return lat, lon

def send_telemetry(base_alt_ft):
    kick()

    current_alt_ft = calcAltitude(bmp.pressure) - base_alt_ft

    # accel from MPU6050 object (library dependent, so guarded)
    ax = getattr(mpu.accel, "x", 0.0)
    ay = getattr(mpu.accel, "y", 0.0)
    az = getattr(mpu.accel, "z", 0.0)

    lat, lon = update_gps_nonblocking()

    telemetry_obj = {
        "altitude": round(current_alt_ft, 2),
        "latitude": float(lat),
        "longitude": float(lon),
        "acceleration": {
            "x": round(ax, 3),
            "y": round(ay, 3),
            "z": round(az, 3),
        },
        "temperature": round(bmp.temperature, 2),
        "voltage": round(read_battery_voltage(), 2),
    }

    safe_write_line(ujson.dumps(telemetry_obj))

    if DEBUG:
        print("TEL:", telemetry_obj)

    return current_alt_ft

def send_image_frame(cmd_buffer):
    kick()
    img_b64 = get_photo_b64()
    if not img_b64:
        return cmd_buffer

    filename = "frame.jpg"
    size = len(img_b64)

    safe_write_line("IMG|{}|{}".format(filename, size))
    safe_write_line("IMG_START")

    for i in range(0, size, CHUNK_SIZE):
        kick()
        cmd_buffer = pump_xbee_rx(cmd_buffer)  # <-- NEW
        safe_write_line(img_b64[i:i + CHUNK_SIZE])

    safe_write_line("IMG_END")

    if DEBUG:
        print("IMG sent:", size)

    return cmd_buffer
        
def send_ack(msg):
    safe_write_line("ACK|{}".format(msg))

def send_err(msg):
    safe_write_line("ERR|{}".format(msg))

def handle_command_line(line):
    # Expect: CMD|...
    if not line.startswith("CMD|"):
        return False

    cmd = line[4:].strip()
    if not cmd:
        send_err("empty")
        return True

    if cmd.upper() == "STOP":
        stop_motors()
        send_ack("STOP")
        return True

    # Execute command sequence (FORWARD/LEFT/RIGHT/etc)
    try:
        execute_command_sequence(cmd)
        send_ack(cmd)
    except Exception as e:
        send_err("bad_cmd")
    return True

def stop_motors():
    motor_right_pwr.low()
    motor_right_gnd.low()
    motor_left_pwr.low()
    motor_left_gnd.low()

# Movement parameters (tune)
MOVE_SPEED = 0.5  # m/s
TURN_RATE  = 90   # deg/s

def execute_command_sequence(sequence):
    # Example: "FORWARD 2.0, LEFT 90, FORWARD 1.5"
    commands = [c.strip() for c in sequence.split(',') if c.strip()]
    for cmd in commands:
        kick()
        parts = cmd.split()
        if len(parts) < 2:
            if DEBUG: print("Bad cmd:", cmd)
            continue

        action = parts[0].upper()
        try:
            value = float(parts[1])
        except ValueError:
            if DEBUG: print("Bad value:", cmd)
            continue

        if action == "FORWARD":
            duration = value / MOVE_SPEED
            leftMotorForward()
            rightMotorForward()
            time.sleep(duration)
            stop_motors()

        elif action == "BACKWARD":
            duration = value / MOVE_SPEED
            leftMotorBackward()
            rightMotorBackward()
            time.sleep(duration)
            stop_motors()

        elif action == "LEFT":
            duration = value / TURN_RATE
            motor_left.low()
            motor_right.high()
            time.sleep(duration)
            stop_motors()

        elif action == "RIGHT":
            duration = value / TURN_RATE
            motor_left.high()
            motor_right.low()
            time.sleep(duration)
            stop_motors()

        else:
            if DEBUG: print("Unknown action:", action)

        time.sleep(0.2)


### Main
def main():
    kick()

    # Base altitude calibration (quick average)
    time.sleep(0.2)
    base_alt_ft = 0.0
    for _ in range(8):
        kick()
        base_alt_ft += calcAltitude(bmp.pressure)
        time.sleep(0.1)
    base_alt_ft /= 8.0

    if DEBUG:
        print("Base alt(ft):", base_alt_ft)

    last_tel = time.ticks_ms()
    last_img = time.ticks_ms()

    # Command line buffering (in case UART splits packets)
    cmd_buffer = ""

    while True:
        kick()
        now = time.ticks_ms()

        # ---- Read incoming commands continuously ----
        if xbee.any():
            kick()
            raw = xbee.read()
            if raw:
                try:
                    cmd_buffer += raw.decode('utf-8', errors='ignore')
                except:
                    pass

                while '\n' in cmd_buffer:
                    line, cmd_buffer = cmd_buffer.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue

                    if DEBUG:
                        print("RX:", line)

                    handled = handle_command_line(line)

                    # Optional: if you want to *see* unexpected lines
                    if (not handled) and DEBUG:
                        print("Ignored:", line)    

        # ---- Telemetry @ 1 Hz ----
        if time.ticks_diff(now, last_tel) >= TELEMETRY_PERIOD_MS:
            last_tel = now
            alt_ft = send_telemetry(base_alt_ft)

        # ---- Image frames @ 1 Hz ----
        if time.ticks_diff(now, last_img) >= IMAGE_PERIOD_MS:
            last_img = now
            cmd_buffer = send_image_frame(cmd_buffer)

        # Small sleep to yield; keep low but not zero
        time.sleep(0.01)


# reboot if anything goes to shit
while True:
    try:
        main()
    except Exception as e:
        # Print the error if possible (helps debug)
        try:
            sys.print_exception(e)
        except:
            pass

        # Give serial a moment to flush
        try:
            time.sleep(0.3)
        except:
            pass

        reset()

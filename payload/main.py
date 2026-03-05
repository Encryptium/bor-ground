"""
2025 Mars Rover Payload/Rover Code (Camera + WDT Optional)

Toggles:
- CAMERA_ENABLED = False  -> camera is never imported/called
- WDT_ENABLED    = False  -> no watchdog, and NO auto-reset on crash (debug-friendly)

Commands over XBee (newline-terminated):
- CMD|STOP
- CMD|FORWARD 2.0, LEFT 90, FORWARD 1.5
"""

from machine import I2C, UART, Pin, reset
from bmp280 import BMP280
from mpu6050 import MPU6050
from micropyGPS import MicropyGPS
import time
import math
import ujson
import sys

# USER SETTINGS
DEBUG = False

CAMERA_ENABLED = False   # <<< True in flight if camera works
WDT_ENABLED = True      # <<< True in flight, False while debugging

XBEE_BAUD = 9600
GPS_BAUD = 9600

TELEMETRY_PERIOD_MS = 1000

# only used if CAMERA_ENABLED
IMAGE_PERIOD_MS = 1000
CHUNK_SIZE = 90

# only used if WDT_ENABLED
WDT_TIMEOUT_MS = 8000

# watchdog
wdt = None
if WDT_ENABLED:
    from machine import WDT
    time.sleep(5)  # grace period before watchdog starts
    wdt = WDT(timeout=WDT_TIMEOUT_MS)

def kick():
    if WDT_ENABLED and wdt is not None:
        try:
            wdt.feed()
        except:
            pass

# hardware setup
xbee = UART(1, baudrate=XBEE_BAUD, rx=Pin(5), tx=Pin(4), timeout=3000)

gps_module = UART(0, baudrate=GPS_BAUD, tx=Pin(0), rx=Pin(1))
gps = MicropyGPS(-5)

bus = I2C(1, sda=Pin(6), scl=Pin(7), freq=100000)
time.sleep(0.5)  # power stabilization delay
bmp = BMP280(bus)
mpu = MPU6050(bus)

motor_left_pwr  = Pin(10, Pin.OUT)
motor_left_gnd  = Pin(11, Pin.OUT)
motor_right_pwr = Pin(8,  Pin.OUT)
motor_right_gnd = Pin(9,  Pin.OUT)

def stop_motors():
    motor_right_pwr.low()
    motor_right_gnd.low()
    motor_left_pwr.low()
    motor_left_gnd.low()

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

# movement parameters (tune)
MOVE_SPEED = 0.005  # m/s
TURN_RATE  = 55   # deg/s

# camera import (optional)
get_photo_b64 = None
if CAMERA_ENABLED:
    try:
        from camera_helper import get_photo_b64
    except Exception as e:
        CAMERA_ENABLED = False
        get_photo_b64 = None
        if DEBUG:
            print("[CAM] disabled (import fail):", e)

# helpers
def calcAltitude(press_pa, unit='ft'):
    a = press_pa / 101325.0
    b = 1 / 5.25588
    c = 1.0 - math.pow(a, b)
    c = c / 0.0000225577
    if unit == 'ft':
        c *= 3.28084
    return c

def convert_coordinates(sections):
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
    return 7.4

def safe_write_line(s):
    if isinstance(s, str):
        xbee.write(s.encode('utf-8') + b'\n')
    else:
        xbee.write(s + b'\n')

def send_ack(msg):
    safe_write_line("ACK|{}".format(msg))

def send_err(msg):
    safe_write_line("ERR|{}".format(msg))

# STOP flag (set by CMD|STOP; checked during motion)
stop_requested = False

# XBee RX + command handling
def handle_command_line(line):
    # Expect: CMD|...
    if not line.startswith("CMD|"):
        return False

    cmd = line[4:].strip()
    if not cmd:
        send_err("empty")
        return True

    if cmd.upper() == "STOP":
        global stop_requested
        stop_requested = True
        stop_motors()
        send_ack("STOP")
        return True

    try:
        global _cmd_buffer_for_exec
        _cmd_buffer_for_exec = execute_command_sequence(cmd, _cmd_buffer_for_exec)
        send_ack(cmd)
    except Exception:
        send_err("bad_cmd")
    return True

def pump_xbee_rx(cmd_buffer):
    """
    Non-blocking RX pump; keeps cmd_buffer for partial lines.
    """
    try:
        n = xbee.any()
        if not n:
            return cmd_buffer

        raw = xbee.read(n)
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
        if DEBUG:
            print("pump_xbee_rx err:", e)
        return cmd_buffer

# GPS (non-blocking)
def update_gps_nonblocking():
    kick()
    n = gps_module.any()
    if n and n > 0:
        data = gps_module.read(n)
        if data:
            for b in data:
                gps.update(chr(b))

    lat = convert_coordinates(gps.latitude)
    lon = convert_coordinates(gps.longitude)
    if lat is None or lon is None:
        return 0.0, 0.0
    return lat, lon

# telemetry
def send_telemetry(base_alt_ft):
    kick()

    current_alt_ft = calcAltitude(bmp.pressure) - base_alt_ft

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

def send_image_frame(cmd_buffer):
    """
    Sends a base64 image over XBee in chunked lines.
    Pumps RX between chunks so STOP can interrupt.
    """
    if (not CAMERA_ENABLED) or (get_photo_b64 is None):
        return cmd_buffer

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
        cmd_buffer = pump_xbee_rx(cmd_buffer)
        safe_write_line(img_b64[i:i + CHUNK_SIZE])

    safe_write_line("IMG_END")

    if DEBUG:
        print("IMG sent:", size)

    return cmd_buffer

def sleep_with_wdt_and_rx(seconds, cmd_buffer):
    """Sleep for up to `seconds` while feeding WDT and pumping RX.
    Returns updated cmd_buffer. Exits early if STOP was requested.
    """
    global stop_requested
    t0 = time.ticks_ms()
    total_ms = int(max(0, seconds) * 1000)

    # 20ms granularity keeps STOP responsive without burning CPU
    while time.ticks_diff(time.ticks_ms(), t0) < total_ms:
        if stop_requested:
            break
        kick()
        cmd_buffer = pump_xbee_rx(cmd_buffer)
        time.sleep(0.02)

    return cmd_buffer

# motion commands
def execute_command_sequence(sequence, cmd_buffer=""):
    """Execute a comma-separated command sequence.

    Distances are in meters for FORWARD/BACKWARD.
    Angles are in degrees for LEFT/RIGHT.

    Returns updated cmd_buffer.
    """
    global stop_requested

    # clear any previous STOP
    stop_requested = False

    commands = [c.strip() for c in sequence.split(',') if c.strip()]
    for cmd in commands:
        kick()

        # allow STOP between sub-commands
        if stop_requested:
            break

        parts = cmd.split()
        if len(parts) < 2:
            continue

        action = parts[0].upper()
        try:
            value = float(parts[1])
        except ValueError:
            continue

        if action == "FORWARD":
            duration = value / MOVE_SPEED
            leftMotorForward(); rightMotorForward()
            cmd_buffer = sleep_with_wdt_and_rx(duration, cmd_buffer)
            stop_motors()

        elif action == "BACKWARD":
            duration = value / MOVE_SPEED
            leftMotorBackward(); rightMotorBackward()
            cmd_buffer = sleep_with_wdt_and_rx(duration, cmd_buffer)
            stop_motors()

        elif action == "LEFT":
            duration = value / TURN_RATE
            leftMotorBackward(); rightMotorForward()
            cmd_buffer = sleep_with_wdt_and_rx(duration, cmd_buffer)
            stop_motors()

        elif action == "RIGHT":
            duration = value / TURN_RATE
            leftMotorForward(); rightMotorBackward()
            cmd_buffer = sleep_with_wdt_and_rx(duration, cmd_buffer)
            stop_motors()

        # brief pause between commands, still STOP/WDT safe
        cmd_buffer = sleep_with_wdt_and_rx(0.2, cmd_buffer)

    return cmd_buffer

# main
def calibrate_base_alt_ft():
    time.sleep(0.2)
    base_alt_ft = 0.0
    for _ in range(8):
        kick()
        base_alt_ft += calcAltitude(bmp.pressure)
        time.sleep(0.1)
    return base_alt_ft / 8.0

def main():
    kick()
    stop_motors()

    base_alt_ft = calibrate_base_alt_ft()

    if DEBUG:
        print("Base alt(ft):", base_alt_ft)
        print("Camera enabled:", CAMERA_ENABLED)
        print("WDT enabled:", WDT_ENABLED)

    last_tel = time.ticks_ms()
    last_img = time.ticks_ms()
    cmd_buffer = ""
    # shared buffer so motion routines can pump RX too
    global _cmd_buffer_for_exec
    _cmd_buffer_for_exec = ""

    while True:
        kick()
        now = time.ticks_ms()

        # always pump RX (keeps STOP responsive)
        cmd_buffer = pump_xbee_rx(cmd_buffer)
        # keep command-exec buffer synced too
        _cmd_buffer_for_exec = cmd_buffer

        # telemetry @ 1 Hz
        if time.ticks_diff(now, last_tel) >= TELEMETRY_PERIOD_MS:
            last_tel = now
            send_telemetry(base_alt_ft)

        # camera frames @ 1 Hz (optional)
        if CAMERA_ENABLED and time.ticks_diff(now, last_img) >= IMAGE_PERIOD_MS:
            last_img = now
            cmd_buffer = send_image_frame(cmd_buffer)
            _cmd_buffer_for_exec = cmd_buffer

        time.sleep(0.01)

# boot behavior
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.print_exception(e)
        stop_motors()
        if WDT_ENABLED:
            time.sleep(0.2)
            reset()
        else:
            print("Program halted (WDT disabled).")

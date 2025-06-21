"""
This runs on the Raspberry Pi Pico

Needs Work:
 * Driving servos using release_instrument() function
 * Receiving command to move arm
 * Implement camera operation
   - b64 encoding
 * Testing for radio connection and compatability with GS

Already Done:
 * Send telemetry data via radio
 * Phase implementation
 * Halt telemetry
 * is_landed() method for reliability
 
Important info:
 ! For other pins clarification, refer to the paper schematic
 ! Open pins = 2, 3, 6, 7
 ! REQUIRES connection to battery to run properly
"""

from machine import I2C, UART,Pin, PWM
from bmp280 import BMP280
from adxl345 import ADXL345
from mpu6050 import MPU6050
from micropyGPS import MicropyGPS
from camera_test import *
import sys
import time
import math

ARM_NEUTRAL_NS = 1500000
ARM_TARGET_NS = 2500000
LATCH_NEUTRAL_NS = 2500000
LATCH_TARGET_NS = 2000000

# define all radio(radio), gps, and latch and parachute servos
radio = UART(1,baudrate=9600,rx=Pin(5),tx=Pin(4),timeout=3000)
gps_module = UART(0, baudrate=9600, tx=Pin(0), rx=Pin(1))
latch = PWM(Pin(2)) # available pwms: 2, 3, 6, 7
parachute = PWM(Pin(7))
arm = PWM(Pin(3))

#radio.write("+++")  # Enter command mode
#time.sleep(1)
#radio.write("ATID049C\r")
##radio.write("ATWR")
#radio.write("ATCN")


# Set the frequency of the PWM signal (50 Hz for servos)
latch.freq(50)
arm.freq(50)
parachute.freq(50)


# 0 degrees using 500000
# 90 degrees using 1500000
# 180 degrees using 2500000

#t = Pin(10,Pin.OUT)
#t.low()
#time.sleep(.001)
#t = Pin(10,Pin.IN)
#bus = I2C(0,sda=Pin(20),scl=Pin(21)) # old bus doesn't work anymore for some reason (probably issue with pi pico)
bus = I2C(0,sda=Pin(8),scl=Pin(9))

def reset_servos():
    latch.duty_ns(LATCH_NEUTRAL_NS)
    arm.duty_ns(ARM_NEUTRAL_NS)
    
    parachute.duty_ns(1000000) # reset chute
    time.sleep(2.5) # wait for release
    parachute.duty_ns(1500000)
    time.sleep(2) # allow time to reset before yielding to any other action

def calcAltitude(press, unit='ft'):
    a = press / 101325.0
    b = 1/5.25588
    c = math.pow(a,b)
    c = 1.0 - c
    c = c / 0.0000225577
    if unit == 'ft':
        c = c * 3.28084
    return c

def convert_coordinates(sections):
        if sections[0] == 0:  # sections[0] contains the degrees
            return None

        # sections[1] contains the minutes
        data = sections[0] + (sections[1] / 60.0)

        # sections[2] contains 'E', 'W', 'N', 'S'
        if sections[2] == 'S':
            data = -data
        if sections[2] == 'W':
            data = -data

        data = '{0:.6f}'.format(data)  # 6 decimal places
        return str(data)






# bmp barometer for pressure and altitude
bmp = BMP280(bus)
for i in range(5):
    base = calcAltitude(bmp.pressure)
    time.sleep(0.2)
#accel = ADXL345(bus) # accelerometer
mpu = MPU6050(bus) # rotation sensor mpu

gps = MicropyGPS(-5)
samples = 0

reset_servos() # set servos to default position
start = time.time()

# status variables
state = {
    "reboot": False,
    "launched": False,
    "target_altitude_reached": False,
    "instrument_released": False,
    "latch_ready": False,
    "latch_released": False,
    "arm_active": False,
    "arm_released": False,
    "prev_alt": 0,
    "parachute_ready": False,
    "parachute_released": False,
}

TARGET_ALTITUDE = 1000 # target altitude in meters
parachute_alt = 300
latch_alt = 15 # latch releases at 15ft



def send_message(msg):
    data = "S" + msg
    radio.write(data.encode())


def force_phase(target_phase):
    if target_phase == "launch":
        state["launched"] = True
        send_message("[OK] Forced phase: launch")
    elif target_phase == "reach_target_altitude":
        state["target_altitude_reached"] = True
        state["parachute_ready"] = True
        state["latch_ready"] = True
        send_message("[OK] Forced phase: reach_target_altitude")
    elif target_phase == "deploy":
        deploy()
        send_message("[OK] Forced phase: deploy")
    elif target_phase == "release_instrument":
        release_instrument()
        send_message("[OK] Forced phase: release_instrument")
    else:
        send_message("[ERR] Phase not defined")


def read_system_commands():
    command = radio.read()
    command_str = command.decode("utf-8").strip()

    if command_str == "system -r":                  # check reboot status
        state["reboot"] = True
    elif "system -p " in command_str:               # check for forced phase
        target_phase = command_str.split('-p')[1].strip()
        force_phase(target_phase)
    else:
        msg = "[ERROR] Command not defined"
        send_message(msg)


def capture():
    save_photo()
    while True:
        command = radio.readline()
        if command:
            command_str = command.decode("utf-8").strip()
            if command_str.strip() == "camera -c":
                save_photo()
                
                break  # Exit after handling the command


# releases latch to the payload
def release_latch():
        time.sleep(15)          # wait for payload to reach the ground
        latch.duty_ns(LATCH_TARGET_NS) # release latch
        time.sleep(2)          # wait for release
        state["latch_released"] = True  # report released

# moves the rover forward after command received
def release_instrument():
    arm.duty_ns(ARM_TARGET_NS)
    state["arm_active"] = False  # disable after movement complete
    state["arm_released"] = True  # report released
    time.sleep(5)  # give ample time from task end to reset position
    reset_servos()
    state["instrument_released"] = True
    send_message("[OK] Instrument released. Starting capture.")
    capture()
    while True:  # Keep checking for the command
        command = radio.readline()
        if command:
            command_str = command.decode("utf-8").strip()
            if command_str.strip() == "arm -r":
                arm.duty_ns(ARM_TARGET_NS)
                state["arm_active"] = False  # disable after movement complete
                state["arm_released"] = True  # report released
                time.sleep(5)  # give ample time from task end to reset position
                reset_servos()
                state["instrument_released"] = True
                send_message("[OK] Instrument released. Starting capture.")
                capture()

def is_landed(current_alt):
    if abs(current_alt - state["prev_alt"]) < 5: # to account for systemic fluctuations
        return True
    else: 
        return False





while True:
    if state["reboot"]:
        break

    # get altitude data in ft
    alt = calcAltitude(bmp.pressure)-base

    # get units in meters per second squared
    #x = accel.xValue * 9.81
    #y = accel.yValue * 9.81
    #z = accel.zValue * 9.81
    x = 0
    y = 0
    z = 0


    # imu data
    rotx = mpu.gyro.x
    roty = mpu.gyro.y
    rotz = mpu.gyro.z

    mpu_temp = mpu.temperature


    # read gnss data
    length = gps_module.any()
    if length > 0:
        data = gps_module.read(length)
        for byte in data:
            message = gps.update(chr(byte))

    latitude = convert_coordinates(gps.latitude)
    longitude = convert_coordinates(gps.longitude)

    if latitude is None or longitude is None:
        latitude = 0    
        longitude = 0

    #pressure = round(bmp.pressure*9.8692*0.000001, 2) #for atm conversion
    pressure = bmp.pressure
    temperature = bmp.temperature
    current_time = time.time()


    if alt > TARGET_ALTITUDE:
        state["target_altitude_reached"] = True
        state["parachute_ready"] = True


    # listen for alt below 50 ft
    if alt > latch_alt:
        state["latch_ready"] = True

    if is_landed(alt) and state["latch_ready"] and not state["latch_released"]:
        release_latch()
        
        
    if state["parachute_ready"] and alt < parachute_alt and not state["parachute_released"]:
        parachute.duty_ns(2000000) # release chute
        time.sleep(2.5) # wait for release
        parachute.duty_ns(1500000) # stop servo
        state["parachute_released"] = True # report released


    # after everything has released
    if state["latch_released"] and not state["arm_released"]:
        time.sleep(2)      # wait for payload to stabilize
        state["arm_active"] = True


    if state["arm_active"]:
        release_instrument() 


    state["prev_alt"] = alt # save alt for ref
        
    # format telemetry data
    data = 'S%0.4f,%0.4f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%i,%i,%i,%i\n' % (
        float(latitude),
        float(longitude),
        alt,
        pressure,
        x,
        y,
        z,
        rotx,
        roty,
        rotz,
        temperature,
        int(state["launched"]),
        int(state["target_altitude_reached"]),
        int(state["latch_released"]),
        int(state["instrument_released"]),
    )


    sys.stdout.write(data)
    radio.write(data.encode()) # send data over radio


    time.sleep(0.5)








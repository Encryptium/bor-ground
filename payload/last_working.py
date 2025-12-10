"""
The code has been updated to reflect the event rule changes.

Rule Changes for 2025:

1. The telemetry only needs to include: altitude, acceleration, payload temperature, and battery voltage (NO GPS/pressure/rotation).
2. The rover must have commands sent in one string
3. The rover must pick up TBD grams of sand
4. Rover must have REALTIME video feed
5. The container is to be opened by hand (gloved)

"""

from machine import I2C, UART,Pin, PWM
from bmp280 import BMP280
from adxl345 import ADXL345
from mpu6050 import MPU6050
from micropyGPS import MicropyGPS
import sys
import time
import math


xbee = UART(1,baudrate=9600,rx=Pin(5),tx=Pin(4),timeout=3000)
gps_module = UART(0, baudrate=9600, tx=Pin(0), rx=Pin(1))
# available pwms: 2, 3, 6, 7
bus = I2C(1,sda=Pin(6),scl=Pin(7))

motor_left = Pin(10)
motor_right = Pin(11)
motor_left.low()
motor_right.low()

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





# Constants
LANDING_ALT_THRESH = 50.0   # ft (max height for landing detection)
LANDING_RATE_THRESH = 0.5   # ft/s (max descent rate to trigger landing)
LANDING_ACCEL_THRESH = 2.0  # g (minimum impact acceleration spike)
STABLE_COUNT_TARGET = 3     # consecutive stable readings required

# States
state = "DESCENT"           # Start in descent after deployment
stable_count = 0            # Count of stable descent rate readings
prev_alt = calcAltitude(bmp.pressure) - base  # Initial altitude





while True:
    # get data from all sensors
    current_alt = calcAltitude(bmp.pressure)-base
    #x = accel.xValue
    #y = accel.yValue
    #z = accel.zValue
    x = 0
    y = 0
    z = 0
    total_g = math.sqrt(x*x + y*y + z*z)
    rotx = mpu.gyro.x
    roty = mpu.gyro.y
    rotz = mpu.gyro.z
    # mpu_temp = mpu.temperature
    #voltage = sys.voltage()

    # read gnss data
    length = gps_module.any()
    if length > 0:
        data = gps_module.read(length)
        for byte in data:
            message = gps.update(chr(byte))

    latitude = convert_coordinates(gps.latitude)
    longitude = convert_coordinates(gps.longitude)

    if latitude is None or longitude is None:
        latitude = 0.0
        longitude = 0.0

    pressure = bmp.pressure # in Pa
    temperature = bmp.temperature
    current_time = time.time()




    # descent rate (ft/s)
    descent_rate = prev_alt - current_alt  # pos means des
    
    # landing detection
    #if state == "DESCENT":
        # case 1: below altitude threshold AND stable descent rate
     #   low_altitude = abs(current_alt) <= LANDING_ALT_THRESH
     #   stable_descent = abs(descent_rate) < LANDING_RATE_THRESH
        
        # case 2: significant impact acceleration
      #  impact_spike = total_g > LANDING_ACCEL_THRESH
        
     #   if low_altitude and stable_descent:
     #       stable_count += 1
     #   else:
     #       stable_count = 0  # Reset if conditions break
            
     #   if stable_count >= STABLE_COUNT_TARGET or impact_spike:
     #       state = "LANDED"
     #       break  # we exit!




	
    # Req 5: "The telemetry shall consist of altitude, acceleration, payload temperature, and battery voltage.""
    #telemetry = """
	 #   {
	#	    {
    #            "altitude": {:.2f}, 
   #             "acceleration": {
    #                {
     #                   "x": {:.2f}, 
      #                  "y": {:.2f}, 
       #                 "z": {:.2f}
        #            }
         #       }, 
          #      "temperature": {:.2f},
           #     "voltage": {:.2f}
			#}
	#	}""".format(current_alt, x, y, z, temperature, 0.0)
    

    
    telemetry = f"{current_alt}, {x}, {y}, {temperature}, {rotx}, {roty}, {rotz}, {latitude}, {longitude}"
    xbee.write(telemetry)
    print(telemetry)
	
    time.sleep(1) # Req 4: "During ascent and descent, the payload shall transmit telemetry once per second.""
	


# mvmt parameters -- NEEDS TESTING
MOVE_SPEED = 0.5  # m/s
TURN_RATE = 90    # deg/s

def execute_command_sequence(sequence):
    commands = sequence.split(',')
    for cmd in commands:
        parts = cmd.strip().split()

        # all commands consist of two parts: action and value
        if len(parts) < 2:
            print("Invalid command format:", cmd)
            continue
            
        action = parts[0].upper()
        try:
            value = float(parts[1])
        except ValueError:
            # if value is NaN, skip this command
            print("Invalid value in command:", cmd)
            continue 
        
        if action == "FORWARD":
            # Move forward for specified distance
            duration = value / MOVE_SPEED
            motor_left.high()
            motor_right.high()
            time.sleep(duration)
            motor_left.low()
            motor_right.low()
            
        elif action == "BACKWARD":
            # Move backward for specified distance
            duration = value / MOVE_SPEED
            motor_left.low()  # Reverse polarity
            motor_right.low()
            time.sleep(duration)
            motor_left.low()  # Stop
            motor_right.low()
            
        elif action == "LEFT":
            # Turn left for specified angle
            duration = value / TURN_RATE
            motor_left.low()
            motor_right.high()
            time.sleep(duration)
            motor_left.low()
            motor_right.low()
            
        elif action == "RIGHT":
            # Turn right for specified angle
            duration = value / TURN_RATE
            motor_left.high()
            motor_right.low()
            time.sleep(duration)
            motor_left.low()
            motor_right.low()
            
        else:
            print("Unknown command:", action)
        
        # pause between commands
        time.sleep(0.2)


# runs AFTER landing  detected
while True:
    if xbee.any():
        # recv + decode
        raw_data = xbee.read()
        try:
            command_sequence = raw_data.decode('utf-8').strip()
            print("Received sequence:", command_sequence)
            
            # exec sequence
            execute_command_sequence(command_sequence)
            
        except UnicodeError:
            print("Invalid command encoding")
    
    time.sleep(0.1)


# example cmd: "FORWARD 2.0, LEFT 90, FORWARD 1.5"


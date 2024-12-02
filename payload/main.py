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
import sys
import time
import math

#rx = Pin(5,Pin.IN)
#radio = UART(0,baudrate=9600,rx=Pin(1),tx=Pin(0),timeout=1000)

# define all radio(xbee), gps, and latch and parachute servos
xbee = UART(1,baudrate=9600,rx=Pin(5),tx=Pin(4),timeout=3000)
gps_module = UART(0, baudrate=9600, tx=Pin(0), rx=Pin(1))
latch = PWM(Pin(2)) # available pwms: 2, 3, 6, 7
parachute = PWM(Pin(3))
arm = PWM(Pin(6))


# Set the frequency of the PWM signal (usually around 50Hz for servos)
latch.freq(50)
#latch.duty_ns(2000000) # reverse latch
time.sleep(2) # offset
latch.duty_ns(1500000)

time.sleep(1)

t = Pin(10,Pin.OUT)
t.low()
time.sleep(.001)
t = Pin(10,Pin.IN)
bus = I2C(0,sda=Pin(20),scl=Pin(21))

def reset_servos():
		latch.duty_ns(1000000) # move latch in opposite direction
		time.sleep(2) # wait for release
		latch.duty_ns(1500000) ## stop movement

		parachute.duty_ns(1000000) # move parachute release in opposite direction
		time.sleep(2.5) # wait for release
		parachute.duty_ns(1500000) ## stop movement

		arm.duty_ns(1000000)
		time.sleep(2)
		arm.duty_ns(1500000)

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
accel = ADXL345(bus) # accelerometer
mpu = MPU6050(bus) # rotation sensor mpu



gps = MicropyGPS(-5)
samples = 0
fd = open('samples.dat','w') # log all data locally

start = time.time()

# status variables
reboot = False
launched = False
target_altitude_reached = False
instrument_released = False

TARGET_ALTITUDE = 1000 # target altitude in meters

prev_alt = 0

parachute_alt = 100 # parachute releases at 100m
parachute_ready = False
parachute_released = False

latch_alt = 15 # latch releases at 15m
latch_ready = False
latch_released = False

# set to true after landing
arm_active = False
arm_released = False

def send_message(msg):
	data = "S" + msg
	xbee.write(data.encode())

# FOR DEBUGGING ONLY
# Don't use for launch
def force_phase(target_phase):
	if target_phase == "launch":
		launched = True
		send_message("[OK] Forced phase: launch")
	elif target_phase == "reach_target_altitude":
		target_altitude_reached = True
		parachute_ready = True
		latch_ready = True
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
	command = xbee.read()
	command_str = command.decode("utf-8").strip()

	if command_str == "system -r":                  # check reboot status
		reboot = True
	elif "system -p " in command_str:               # check for forced phase
		target_phase = command_str.split('-p')[1].strip()
		force_phase(target_phase)
	else:
		msg = "[ERROR] Command not defined"
		send_message(msg)


def capture():
	command = xbee.read()
	command_str = command.decode("utf-8").strip()

	if command_str == "camera -c":
		# camera capture to be implemented
		print("camera capture waiting on implementation")
		send_message("[ERR] Camera pending implementation")
		pass
	else:
		capture()  # wait until command is called

# moves the rover forward after command received
def release_instrument():
		command = xbee.read()
		command_str = command.decode("utf-8").strip()

		if command_str == "arm -r":
			arm.duty_ns(2000000)
			arm_active = False # disable after movement complete
			arm_released = True # report released
			time.sleep(2.5)
			arm.duty_ns(1500000)
			reset_servos()
			instrument_released = True
			send_message("[OK] Instrument released. Starting capture.")
			capture()
		else:
			release_instrument()   # wait until command received


# releases the parachute latch
def deploy():
		parachute.duty_ns(2000000) # release chute
		time.sleep(2.5) # wait for release
		parachute.duty_ns(1500000) # stop servo
		parachute_released = True # report released

def is_landed(current_alt):
	if abs(current_alt - prev_alt) < 1:
		return True
	else: 
		return False

while True:
		if reboot:
			break

		# get data from all sensors
		alt = calcAltitude(bmp.pressure)-base
		x = accel.xValue
		y = accel.yValue
		z = accel.zValue
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
				latitude = 38.9072    # realistic placeholder values instead of 0, 0
				longitude = -77.0369

		#pressure = round(bmp.pressure*9.8692*0.000001, 2) #for atm conversion
		pressure = bmp.pressure
		temperature = bmp.temperature
		current_time = time.time()


		if alt > TARGET_ALTITUDE:
				target_altitude_reached = True


		# when rocket goes above parachute_alt
		# the parachute is ready to deploy
		if alt > parachute_alt:
				launched = True
				parachute_ready = True # parachute ready

		# if parachute altitude goes below parachute_alt
		if parachute_ready and alt < parachute_alt and not parachute_released:
				deploy()
				


		# listen for alt below 50 ft
		if alt > latch_alt:
				latch_ready = True

		if is_landed(alt) and latch_ready and parachute_released and not latch_released:
				time.sleep(5)          # wait for payload to reach the ground
				latch.duty_ns(2000000) # release latch
				time.sleep(2)          # wait for release
				latch.duty_ns(1500000) # stop servo
				latch_released = True  # report released


		# after everything has released
		if latch_released and parachute_released and not arm_released:
				time.sleep(2)      # wait for payload to stabilize
				arm_active = True 


		if arm_active:
				release_instrument() # requires implementation


		prev_alt = alt # save alt for ref
		
		# format telemetry data
		data = 'S%0.4f,%0.4f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%0.1f,%i,%i,%i,%i\n' % (float(latitude), float(longitude), alt, pressure, x, y, z, rotx, roty, rotz, temperature, int(launched), int(target_altitude_reached), int(parachute_released), int(instrument_released)) #altitude & pressure

		# print(data)

		# Send data to the USB serial port for local debugging
		sys.stdout.write(data)


		xbee.write(data.encode()) # send data over radio

		# fd.write(data) # log data locally


		time.sleep(0.5)






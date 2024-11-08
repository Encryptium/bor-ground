"""
This runs on the Raspberry Pi Pico

Needs Work:
 * Driving motors using release_instrument() function
 * Receiving command to move arm
 * Implement camera operation
   - b64
   - halt telemetry
 *

Already Done:
 * Send telemetry data via radio
 
Important info:
 ! For other pins clarification, refer to the paper schematic
 ! REQUIRES connection to battery to run properly
"""

from machine import I2C, UART,Pin, PWM
from bmp280 import BMP280
from adxl345 import ADXL345
from mpu6050 import MPU6050
from micropyGPS import MicropyGPS
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

def calcAltitude(press):
		a = press / 101325.0
		b = 1/5.25588
		c = math.pow(a,b)
		c = 1.0 - c
		c = c / 0.0000225577
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

parachute_alt = 100 # parachute releases at 100m
parachute_ready = False
parachute_released = False

latch_alt = 15 # latch releases at 15m
latch_ready = False
latch_released = False

# set to true after landing
arm_active = False


# moves the rover forward after command received
def release_instrument():
		# command = xbee.read()
		# command_str = command.decode(utf-8).strip()
		arm.duty_ns(2000000)
    

# releases the parachute latch
def deploy():
    parachute.duty_ns(2000000) # release chute
		time.sleep(2.5) # wait for release
		parachute.duty_ns(1500000) # stop servo
		parachute_released = True # report released



while 1:
		# get data from all sensors
		alt = calcAltitude(bmp.pressure)-base
		x = accel.xValue
		y = accel.yValue
		z = accel.zValue
		rotx = mpu.gyro.x
		roty = mpu.gyro.y
		rotz = mpu.gyro.z
		mpu_temp = mpu.temperature
		length = gps_module.any()
		if length > 0:
				data = gps_module.read(length)
				for byte in data:
						message = gps.update(chr(byte))

		latitude = convert_coordinates(gps.latitude)
		longitude = convert_coordinates(gps.longitude)

		if latitude is None or longitude is None:
				latitude=0.0
				longitude=0.0
				pass

		#pressure = round(bmp.pressure*9.8692*0.000001, 2) #for atm conversion
		pressure = bmp.pressure
		temperature = bmp.temperature
		current_time = time.time()

		# when rocket goes above parachute_alt
		if alt > parachute_alt:
				parachute_ready = True # parachute ready

		# if parachute altitude goes below parachute_alt
		if parachute_ready and alt < parachute_alt and not parachute_released:
        deploy()
				


		# listen for alt below 50 ft
		if alt > latch_alt:
				latch_ready = True

		if latch_ready and alt < latch_alt and not latch_released and parachute_released:
				latch.duty_ns(2000000) # release latch
				time.sleep(2) # wait for release
				latch.duty_ns(1500000) # stop servo
				latch_released = True # report released

				time.sleep(0.1) # wait
				reset_servos() # then reset servos for reuse when retrieved

		# after everything has released
		if latch_released and parachute_released:
				time.sleep(1)
				arm_active = True # activate rover


		if arm_active:
				release_instrument() # requires implementation


		# format telemetry data
		data = 'S%0.5f,%0.5f,%0.2f,%0.1f,%0.2f,%0.2f,%0.2f,%0.2f,%i,%i\n' % (float(latitude), float(longitude), alt, pressure, x, y, z, temperature, int(parachute_released), int(latch_released)) #altitude & pressure

		print(data)
		xbee.write(data.encode()) # send data over radio

		# fd.write(data) # log data locally


		time.sleep(0.5)






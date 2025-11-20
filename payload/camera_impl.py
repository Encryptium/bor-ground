from machine import Pin, UART, SPI
from camera import *
from time import sleep_ms
import ubinascii
import random
import time

# camera initialization is required to have radio object available
def initialize_camera():
    # Initialize with lower baudrate for stability
    radio = UART(1,baudrate=9600,rx=Pin(5),tx=Pin(4),timeout=3000)
    spi = SPI(0, sck=Pin(18), miso=Pin(16), mosi=Pin(19), baudrate=4000000)
    cs = Pin(17, Pin.OUT)
    filemanager = FileManager()

    # Initialize camera with debug off
    cam = Camera(spi, cs, debug_text_enabled=False)



# Add this flag at the top of your payload code
DEBUG_MODE = False  # Set to False when using actual radio

def send_image_over_radio(filename):
    try:
        with open(filename, 'rb') as f:
            img_data = f.read()
            
        # Encode to base64 and remove newlines
        b64_data = ubinascii.b2a_base64(img_data).decode('utf-8').replace('\n', '')
        
        # ----------------------------
        # Send metadata (both radio and debug)
        # ----------------------------
        header = f"IMG|{filename}|{len(b64_data)}"
        
        # For radio (bytes)
        radio.write(header.encode() + b'\n')  # Actual radio transmission
        
        # For debug (clean string)
        if DEBUG_MODE:
            print(header)  # No "b'" prefix
    
        # ----------------------------
        # Send start marker
        # ----------------------------
        radio.write(b'IMG_START\n')
        if DEBUG_MODE:
            print("IMG_START")  # Clean string
    
        # ----------------------------
        # Send data chunks
        # ----------------------------
        for i in range(0, len(b64_data), 64):
            chunk = b64_data[i:i+64]
            
            # For radio (bytes with newline)
            radio.write(chunk.encode() + b'\n')
            
            # For debug (clean string without extra newline)
            if DEBUG_MODE:
                print(chunk, end='')  # end='' prevents automatic newline
        
        # ----------------------------
        # Send end marker
        # ----------------------------
        radio.write(b'IMG_END\n')
        if DEBUG_MODE:
            print("\nIMG_END")  # Newline before marker to separate from data
        
        return True
        
    except Exception as e:
        print("ERROR:", e)
        return False

def save_photo():
    # Set resolution first before capture
    cam.resolution = '320x240'  # Start with lowest resolution
    cam.set_brightness_level(cam.BRIGHTNESS_DEFAULT)
    
    image_id = str(random.choice(range(1111111, 9999999)))

    # Capture sequence
    cam.capture_jpg()
    sleep_ms(100)  # Increased delay
    cam.save_JPG(filemanager.new_jpg_filename(image_id))  # Use correct method name
    
    send_image_over_radio(image_id + ".jpg")
    
    
if __name__ == "__main__":
    initialize_camera()
    save_photo()


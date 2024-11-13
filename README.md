# CHS Aerospace Ground Station + Payload
An intuitive UI for managing telemetry data received via radio from remotely controlled payloads.


## Detailed Description

![ground_station_interface](https://github.com/user-attachments/assets/eb9b3a17-8eed-40ad-b934-dfc0b48964a6)

### Technology Used
#### Web Serial API
This interface uses the Web Serial API to communicate with an attached radio. The code processes this data as formatted:
```py
data = 'S%0.5f,%0.5f,%0.2f,%0.1f,%0.2f,%0.2f,%0.2f,%0.2f,%i,%i\n'
        % (float(latitude), float(longitude), alt, pressure, x, y, z,
        temperature, int(parachute_released), int(latch_released))
```
*where x, y, z, are the rotation values collected by an onboard IMU.*

Every line of telemetry data will be printed in the console module.

#### Flask Backend
The backend is programmed in Python using Flask. For each line of data processed, the frontend sends the translated JSON to an API endpoint `/api/telemetry`. The data is stored on server as files in the '/telemetry' directory.
```js
// Data is received as the following in JSON/dict
{
        latitude: parseFloat(values[0]),
        longitude: parseFloat(values[1]),
        altitude: parseFloat(values[2]),
        pressure: parseFloat(values[3]),
        x_rotation: parseFloat(values[4]),
        y_rotation: parseFloat(values[5]),
        z_rotation: parseFloat(values[6]),
        temperature: parseFloat(values[7]),
        launched: parseInt(values[8], 10),
        target_altitude_reached: parseInt(values[9], 10),
        parachute_released: parseInt(values[10], 10),
        instrument_released: parseInt(values[11], 10),
}
```
##### Telemetry Replay
The saved log of the telemetry data also allows quick recovery if connection is lost or closed. Further, it enables the feature to replay a launch in real time as time codes are assigned to each entry.

#### Matplotlib Plotting
In addition to storing the telemetry data, Matplotlib is used to graph any chosen value from the JSON data. An image of the resulting plot is then sent back to the frontend as a response after receipt of telemetry data. The plot is displayed on the top left graphics module.

The following graph shows the example data, which is preloaded in `/static/js/script.js`. Remember to remove or comment this prior to an actual launch.
![altitude_plot](https://github.com/user-attachments/assets/954f0701-038b-4365-94ab-21305cc750be)
*image may be difficult to view if your background is white*
#### Live Camera Feed
Alongside the plotting software, the graphics module can also display frames serving as a low framerate live video feed if the payload supports camera functionality.
##### Base64 Image Encoding
To display the live camera feed, the interface is capable of receiving a base64 encoded image. However, to receive this feed, a command must be received from the payload via serial interface to shutdown plotting; only then, will the ground station UI be ready to receive a base64 image as both are transmitted through the same interface.
*Note: Currently, there is no method of saving any frames of the camera feed into the logs for simplicity. May be implemented in the future.*

### Commands
#### Release Instrument
The first command required to be sent to the payload, as per the BoR `2025 Competition Guide Rev 1.0a`, is to activate arm movement to release the instrument. Please note that this command is only available after the payload has stopped transmission of telemetry data.This action can be performed with the following:
```
arm -r
```

#### Capture Frame on Payload
The functionality to capture the current frame and save it onto the payload is available as a command via the console input. This command is only available when the `arm -r` command has been issued and executed. The command is as follows:
```
camera -c
```
*Note: This is the only frame that is saved in the log and is appended as a separate line at the end of the file.*

#### Reboot Payload
If an issue with unstable connection, corrupted transmission, no camera feed, or inaccurate sensor values ever occurs, it may be an issue with the payload program. This is impossible to fix when in flight or carrying out an assigned task. In the case of an unstable connection, the payload will continuously broadcast data, and may recover a stable connection. However, all data not received will be lost or inaccurate.

To restart the payload program from the ground station UI, the following command should be issued:
```
system -r
``` 
This will reinitialize all sensors, and may resolve the issue.

#### Force Phase
In the event of a restart to the program, the payload will reset all variables. This has the consequence of returning to the first "phase" of the mission. If a reboot was issued during a later stage or you're just debugging, forcing the payload into another phase may be convenient/necessary.

To force the mission into a later phase, such a command is used:
```
system -p [phase_name]
```

`[phase_name]` is whatever predefined identifier sets the payload configuration to enter a certain phase.

##### Implemented Phases
- `launch`
- `reach_target_altitude`
- `deploy`
- `release_instrument`

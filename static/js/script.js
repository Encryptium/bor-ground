let portButton;
let telemetryReadings;
let webserial;
let payloadStatus;
let statusItems;
let commandInput;

function setup() {
    // Assign elements and initialize WebSerialPort
    telemetryReadings = document.getElementById("console");
    portButton = document.getElementById("port-button");
    payloadStatus = document.querySelector(".status-header");
    statusItems = document.querySelectorAll(".checklist-item");
    commandInput = document.getElementById("command-input");
    
    webserial = new WebSerialPort();
    if (webserial) {
        // Set up callback for data reception
        webserial.on("data", serialRead);
        
        // Set up the open/close button
        portButton.addEventListener("click", openClosePort);
    }

    commandInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            const command = commandInput.value;
            webserial.sendSerial("S" + command);
            telemetryReadings.innerHTML += "<p>Command Sent: " + command + "</p>";
            commandInput.value = "";
        }
    });
}

async function openClosePort() {
    if (webserial.port) {
        await webserial.closePort();
        portButton.innerHTML = "Connect";
        payloadStatus.innerHTML = "Payload Disconnected";

        for (let item of statusItems) {
            item.querySelector(".status-indicator").classList.remove("waiting");
            item.querySelector(".status-indicator").classList.remove("active");
        }
    } else {
        const success = await webserial.openPort();
        if (success) {
            portButton.innerHTML = "Disconnect";
            payloadStatus.innerHTML = "Payload Connected";

            for (let item of statusItems) {
                item.querySelector(".status-indicator").classList.add("waiting");
            }
        }

    }
}

function serialRead(data) {
    // Parse the incoming data string into JSON
    const telemetryData = parseTelemetryData(data);

    // Log or display the parsed JSON data
    console.log("Parsed Telemetry Data:", telemetryData);
    telemetryReadings.innerHTML += "<p>" + JSON.stringify(telemetryData, null, 2) + "</p><br>"; // Display in the `readings` div
    telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

    // upload data to server at /api/telemetry
    fetch('/api/telemetry', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(telemetryData),
    }).then(response => response.json())
        .then(data => {
            console.log('Success:', data);
            document.querySelector("#graphics img").src = `${data.url}?t=${new Date().getTime()}`;
        })
        .catch((error) => {
            console.error('Error:', error);
        });

    if (telemetryData.launched) {
        statusItems[0].querySelector(".status-indicator").classList.add("active");
        playStageCompleteSound();
    }
    if (telemetryData.target_altitude_reached) {
        statusItems[1].querySelector(".status-indicator").classList.add("active");
    }
    if (telemetryData.parachute_released) {
        statusItems[2].querySelector(".status-indicator").classList.add("active");
    }
    if (telemetryData.instrument_released) {
        statusItems[3].querySelector(".status-indicator").classList.add("active");
        document.querySelector("#payload-container .status-box img").src = "/static/img/payload-open.svg";
    }

    // Apply rotation to the payload box based on XYZ rotation values
}


// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", setup);


function parseTelemetryData(data) {
    // Remove the initial "S" character and any trailing newline
    data = data.trim().substring(1);

    // Split the data by commas
    const values = data.split(',');

    // Create a JSON object with the expected keys and values
    const jsonData = {
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
    };

    return jsonData;
}


function playStageCompleteSound() {
    const audio = new Audio("/static/audio/stage_complete.aac");
    audio.play();
}



// TEST CODE, REMOVE BEFORE FLIGHT
document.addEventListener("DOMContentLoaded", () => {
    setup();

    // Test the serialRead function
    const testData1 = "S37.7749,-122.4194,0.0,1013.2,10.5,20.6,30.7,25.3,0,0,0,0";
    const testData2 = "S37.7749,-122.4194,1000.0,1013.2,10.5,20.6,30.7,25.3,1,0,0,0";
    const testData3 = "S37.7749,-122.4194,990.0,1013.2,10.5,20.6,30.7,25.3,1,1,0,0";
    const testData4 = "S37.7749,-122.4194,850.5,1013.2,10.5,20.6,30.7,25.3,1,1,1,0";
    const testData5 = "S37.7749,-122.4194,10.5,1013.2,10.5,20.6,30.7,25.3,1,1,1,1";
    
    
    serialRead(testData1);
    
    setTimeout(() => {
        serialRead(testData2);
        setTimeout(() => {
            serialRead(testData3);
            setTimeout(() => {
                serialRead(testData4);
                setTimeout(() => {
                    serialRead(testData5);
                }, 3000);
            }, 3000);
        }, 3000);
    }, 3000);
});
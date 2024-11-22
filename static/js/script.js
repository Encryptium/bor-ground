let map;
let portButton;
let telemetryReadings;
let webserial;
let payloadStatus;
let statusItems;
let commandInput;
let port;
let isConnected = false;

function setup() {
    // Assign elements
    telemetryReadings = document.getElementById("console");
    portButton = document.getElementById("port-button");
    payloadStatus = document.querySelector(".status-header");
    statusItems = document.querySelectorAll(".checklist-item");
    commandInput = document.getElementById("command-input");
    
    // Set up the open/close button
    portButton.addEventListener("click", openClosePort);

    commandInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            const command = commandInput.value;
            if (isConnected) {
                sendSerialCommand("S" + command);
                telemetryReadings.innerHTML += "<p>Command Sent: " + command + "</p>";
            } else {
                telemetryReadings.innerHTML += "<p>Not connected. Command not sent.</p>";
            }
            commandInput.value = "";
        }
    });

    // Add disconnect event listener to handle unexpected disconnections
    navigator.serial.addEventListener('disconnect', handleDisconnect);
}

// Handle unexpected disconnection
function handleDisconnect(event) {
    if (port && event.target === port) {
        console.log("Serial device disconnected unexpectedly.");
        isConnected = false;
        payloadStatus.innerHTML = "Payload Disconnected";
        portButton.innerHTML = "Connect";

        for (let item of statusItems) {
            item.querySelector(".status-indicator").classList.remove("waiting");
            item.querySelector(".status-indicator").classList.remove("active");
        }

        telemetryReadings.innerHTML += "<p>Serial device disconnected unexpectedly.</p>";
        const disconnect = new Audio("/static/audio/warning.aac");
        disconnect.play();
    }
}

async function openClosePort() {
    if (isConnected) {
        await closePort();
    } else {
        const success = await openPort();
        if (success) {
            portButton.innerHTML = "Disconnect";
            payloadStatus.innerHTML = "Payload Connected";
            for (let item of statusItems) {
                item.querySelector(".status-indicator").classList.add("waiting");
            }
        }
    }
}

async function openPort() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        isConnected = true;
        console.log("Serial port opened.");

        // Handle incoming data
        const reader = port.readable.getReader();
        while (isConnected) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("Reader closed");
                break;
            }
            serialRead(new TextDecoder().decode(value));
        }
        reader.releaseLock();
        return true;
    } catch (error) {
        console.error("Failed to open serial port:", error);
        return false;
    }
}

async function closePort() {
    if (port && port.readable) {
        await port.readable.cancel();
    }
    if (port) {
        await port.close();
        isConnected = false;
        console.log("Serial port closed.");
    }
    portButton.innerHTML = "Connect";
    payloadStatus.innerHTML = "Payload Disconnected";

    for (let item of statusItems) {
        item.querySelector(".status-indicator").classList.remove("waiting");
        item.querySelector(".status-indicator").classList.remove("active");
    }
}

function sendSerialCommand(command) {
    if (isConnected && port.writable) {
        const writer = port.writable.getWriter();
        writer.write(new TextEncoder().encode(command));
        writer.releaseLock();
    } else {
        console.log("Cannot send command: Not connected.");
    }
}

function serialRead(data) {
    // Parse the incoming data string into JSON

    if (!data.startsWith("S")) {
        console.log("Invalid data:", data);
        return;
    }
    
    const telemetryData = parseTelemetryData(data);

    // Log or display the parsed JSON data
    console.log("Parsed Telemetry Data:", telemetryData);
    telemetryReadings.innerHTML += "<p>" + JSON.stringify(telemetryData, null, 2) + "</p><br>";
    telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

    // Upload data to server at /api/telemetry
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

    // Update status indicators
    
    if (telemetryData.instrument_released) {
        if (!statusItems[3].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[3].querySelector(".status-indicator").classList.add("active");
        document.querySelector("#payload-container .status-box img").src = "/static/img/payload-open.svg";
    }
    else if (telemetryData.parachute_released) {
        if (!statusItems[2].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[2].querySelector(".status-indicator").classList.add("active");
    }  
    else if (telemetryData.target_altitude_reached) {
        if (!statusItems[1].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[1].querySelector(".status-indicator").classList.add("active");
    }
    else if (telemetryData.launched) {
        if (!statusItems[0].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[0].querySelector(".status-indicator").classList.add("active");
    }

    addMarker(telemetryData);
}

// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", () => {
    setup();
    initMap();
});

function parseTelemetryData(data) {
    data = data.trim().substring(1);
    const values = data.split(',');
    return {
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
}

function playStageCompleteSound() {
    const complete = new Audio("/static/audio/stage_complete.aac");
    complete.play();
}


// TEST CODE, REMOVE BEFORE FLIGHT
// document.addEventListener("DOMContentLoaded", () => {
//     setup();

//     // Test the serialRead function
//     const testData1 = "S37.7749,-122.4194,0.0,1013.2,10.5,20.6,30.7,25.3,0,0,0,0";
//     const testData2 = "S37.7749,-122.4194,1000.0,1013.2,10.5,20.6,30.7,25.3,1,0,0,0";
//     const testData3 = "S37.7749,-122.4194,990.0,1013.2,10.5,20.6,30.7,25.3,1,1,0,0";
//     const testData4 = "S37.7749,-122.4194,850.5,1013.2,10.5,20.6,30.7,25.3,1,1,1,0";
//     const testData5 = "S37.7749,-122.4194,10.5,1013.2,10.5,20.6,30.7,25.3,1,1,1,1";
    
    
//     serialRead(testData1);
    
//     setTimeout(() => {
//         serialRead(testData2);
//         setTimeout(() => {
//             serialRead(testData3);
//             setTimeout(() => {
//                 serialRead(testData4);
//                 setTimeout(() => {
//                     serialRead(testData5);
//                 }, 3000);
//             }, 3000);
//         }, 3000);
//     }, 3000);
// });


// Initialize the map
function initMap() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 38.9072, lng: -77.0369 }, // Los Angeles coordinates
        zoom: 16,
        mapId: "c53e775cd5e6be62",
        mapTypeId: "roadmap",
        disableDefaultUI: true, // Disables all default UI controls
    });
}

// Color gradient function based on altitude
function getColorByAltitude(altitude) {
    const minAltitude = 0;
    const maxAltitude = 2000; // Adjust this range based on your data
    const normalizedAltitude = Math.min(Math.max((altitude - minAltitude) / (maxAltitude - minAltitude), 0), 1);

    const startColor = [0, 0, 255]; // Blue (low altitude)
    const endColor = [255, 0, 0]; // Red (high altitude)

    const r = Math.round(startColor[0] + (endColor[0] - startColor[0]) * normalizedAltitude);
    const g = Math.round(startColor[1] + (endColor[1] - startColor[1]) * normalizedAltitude);
    const b = Math.round(startColor[2] + (endColor[2] - startColor[2]) * normalizedAltitude);

    return `rgb(${r},${g},${b})`;
}

// Add marker to map based on telemetry data
function addMarker(telemetryData) {
    const { latitude, longitude, altitude } = telemetryData;

    new google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8, // Size of the dot
            fillColor: getColorByAltitude(altitude), // Gradient color based on altitude
            fillOpacity: 1,
            strokeWeight: 0,
        },
    });

    // Optionally pan the map to the new marker
    map.panTo({ lat: latitude, lng: longitude });
}

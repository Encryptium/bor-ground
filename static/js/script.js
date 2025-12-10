let map;
let portButton;
let telemetryReadings;
let webserial;
let statusItems;
let commandInput;
let port;
let reader;
let isConnected = false;
let imageBuffer = '';
let isReceivingImage = false;
let imageCounter = 0;
// Add a line buffer at the top with other variables
let lineBuffer = '';

// Add this in your setup function or at the bottom of the script
const imageContainer = document.createElement('div');
imageContainer.id = 'image-container'
document.body.appendChild(imageContainer);


function setup() {
    // Assign elements
    telemetryReadings = document.getElementById("console");
    portButton = document.getElementById("port-button");
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
        isConnected = false;
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

        reader = port.readable.getReader();
        readData(reader); // Start handling data asynchronously
        return true;
    } catch (error) {
        console.error("Failed to open serial port:", error);
        return false;
    }
}

async function readData(reader) {
    try {
        while (isConnected) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("Reader closed");
                break;
            }
            serialRead(new TextDecoder().decode(value)); // Handle the data
        }
    } catch (error) {
        console.error("Error reading data:", error);
    } finally {
        reader.releaseLock(); // Ensure the reader is properly released
    }
}


async function closePort() {
    if (port && port.readable) {
        reader.releaseLock();
        await port.readable.cancel();
    }
    if (port) {
        reader.releaseLock();
        await port.close();
        isConnected = false;
        console.log("Serial port closed.");
    }
    portButton.innerHTML = "Connect";

    for (let item of statusItems) {
        item.querySelector(".status-indicator").classList.remove("waiting");
        item.querySelector(".status-indicator").classList.remove("active");
    }
}

async function readData(reader) {
    try {
        const decoder = new TextDecoder('utf-8', { stream: true });
        let buffer = '';
        while (isConnected) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            
            // Split buffer into lines
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || ''; // Save incomplete line
            
            // Process each complete line
            for (const line of lines) {
                processLine(line);
            }
        }
        // Process any remaining data after disconnecting
        if (buffer) processLine(buffer);
    } catch (error) {
        console.error("Error reading data:", error);
    } finally {
        reader.releaseLock();
    }
}

function serialRead(data) {
    lineBuffer += data; // Append incoming data to the buffer
    const lines = lineBuffer.split(/\r?\n/); // Split into lines on any newline
    lineBuffer = lines.pop(); // Save incomplete line for next chunk
    
    // Process each complete line
    for (const line of lines) {
        processLine(line);
    }
}

function processLine(line) {
    // Clean up carriage returns and whitespace
    const cleanLine = line.trim().replace(/\r/g, '');

    // Handle image header
    if (cleanLine.startsWith("IMG|")) {
        handleImageHeader(cleanLine);
        return;
    }

    // Handle image start/end markers
    if (cleanLine === "IMG_START") {
        isReceivingImage = true;
        imageBuffer = '';
        telemetryReadings.innerHTML += "<p>Image transmission started.</p>";
        return;
    }

    if (cleanLine === "IMG_END") {
        isReceivingImage = false;
        processImageBuffer();
        telemetryReadings.innerHTML += "<p>Image transmission ended.</p>";
        return;
    }

    // Handle image data chunks
    if (isReceivingImage) {
        imageBuffer += cleanLine; // Append cleaned line
        return;
    }
    
    // Handle JSON telemetry
    if (cleanLine.startsWith("{") && cleanLine.endsWith("}")) {
        let telemetryData;
        try {
            telemetryData = JSON.parse(cleanLine);
        } catch (err) {
            console.error("Invalid JSON:", cleanLine);
            return;
        }

        // Display formatted JSON
        telemetryReadings.innerHTML += "<p>" + JSON.stringify(telemetryData, null, 2) + "</p><br>";
        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

        // Upload telemetry to server
        fetch('/api/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(telemetryData),
        })
        .then(response => response.json())
        .then(data => {
            console.log('Success:', data);
            document.querySelector("#graphics img").src = `${data.url}?t=${new Date().getTime()}`;
        })
        .catch((error) => console.error('Error:', error));

        // Update status indicators
        updateStatusIndicators(telemetryData);

        // Add map marker
        addMarker(telemetryData);

        return;
    }
}

function handleImageHeader(line) {
    const [_, filename, size] = line.split('|');
    if (filename && size) {
        telemetryReadings.innerHTML += `<p>Receiving image: ${filename} (${size} bytes)</p>`;
    } else {
        console.error("Invalid image header:", line);
    }
}

function processImageBuffer() {
    try {
        // Convert base64 string to binary
        const binaryString = atob(imageBuffer);
        const bytes = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Create Blob and URL
        const blob = new Blob([bytes], {type: 'image/jpeg'});
        const url = URL.createObjectURL(blob);

        // Create image element
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '100%';
        img.style.margin = '10px';
        img.alt = `Received image ${++imageCounter}`;

        // Add to container
        imageContainer.appendChild(img);
        // Auto-scroll to show the latest image
        imageContainer.scrollTop = imageContainer.scrollHeight - imageContainer.clientHeight;
        telemetryReadings.innerHTML += `<p>Image received and displayed (${imageBuffer.length} bytes)</p>`;

    } catch (error) {
        console.error('Error processing image:', error);
        telemetryReadings.innerHTML += `<p class="error">Error decoding image: ${error.message}</p>`;
    }
}

function updateStatusIndicators(t) {
    if (t.instrument_released) {
        if (!statusItems[3].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[3].querySelector(".status-indicator").classList.add("active");
    }
    else if (t.parachute_released) {
        if (!statusItems[2].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[2].querySelector(".status-indicator").classList.add("active");
    }
    else if (t.target_altitude_reached) {
        if (!statusItems[1].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[1].querySelector(".status-indicator").classList.add("active");
    }
    else if (t.launched) {
        if (!statusItems[0].querySelector(".status-indicator").classList.contains("active")) {
            playStageCompleteSound();
        }
        statusItems[0].querySelector(".status-indicator").classList.add("active");
    }
}

// Add CSS for image container
const style = document.createElement('style');
style.textContent = `
#image-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    padding: 10px;
    border-radius: 5px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    max-width: 300px;
    height: 260px; /* approx one image height incl. padding */
    max-height: 260px;
    overflow-y: auto;
}
#image-container img {
    display: block;
    width: 100%;
    height: auto;
    margin-bottom: 10px;
    border: 1px solid #ddd;
}
.error {
    color: red;
}`;
document.head.appendChild(style);


// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", () => {
    setup();
    initMap();
});


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

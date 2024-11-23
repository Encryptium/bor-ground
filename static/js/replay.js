let map;
let telemetryReadings;
let payloadStatus;
let statusItems;
let speedInput;
let pauseButton;
let replaySpeed = 500;
let isPaused = false; 
let currentIdx = 0; // Track the current index
let bufferedData = []; // Buffer to store preloaded data

function setup() {
    // Assign elements
    telemetryReadings = document.getElementById("console");
    payloadStatus = document.querySelector(".status-header");
    statusItems = document.querySelectorAll(".checklist-item");
    speedInput = document.getElementById("replay-speed");
    pauseButton = document.getElementById("pause-button");

    bufferedData = structuredClone(preloadedData); // Load all data at start
    handlePreloadedData(currentIdx); // Start replay from the beginning

    speedInput.addEventListener("change", function (event) {
        // Limit the replay speed to a minimum of 200ms
        if (event.target.value < 200) {
            event.target.value = 200;
        } else if (event.target.value > 999) {
            event.target.value = 999;
        }
        replaySpeed = event.target.value;
    });

    pauseButton.addEventListener("click", function (event) {
        const img = event.target.querySelector("img");
        if (isPaused) {
            img.src = "http://localhost:8080/static/img/pause.svg";
            isPaused = false;
            handlePreloadedData(currentIdx); // Resume from last position
        } else {
            img.src = "http://localhost:8080/static/img/play.svg";
            isPaused = true;
        }
    });
}

function handlePreloadedData(idx) {
    if (isPaused || idx >= bufferedData.length) return; // Exit if paused or no more data

    setTimeout(() => {
        serialRead(bufferedData[idx]);
        currentIdx = idx + 1; // Update the current index to the next point
        handlePreloadedData(currentIdx); // Move to the next data point
    }, replaySpeed);
}

function serialRead(data) {
    // Parse the incoming data string into JSON
    const unmodifiedTelemetryData = structuredClone(data);
    delete unmodifiedTelemetryData.timestamp;
    const telemetryData = data;
    telemetryData.replay_id = replayID;
    telemetryData.final_timestamp = bufferedData[bufferedData.length - 1].timestamp.replace(/\[/g, "").replace(/\]/g, "");

    // Log or display the parsed JSON data
    telemetryReadings.innerHTML += "<p>" + JSON.stringify(unmodifiedTelemetryData, null, 2) + "</p><br>";
    telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

    // Upload data to server at /api/telemetry
    fetch('/api/replay', {
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
    updateStatusIndicators(telemetryData);
    addMarker(telemetryData);
}

function updateStatusIndicators(telemetryData) {
    if (telemetryData.instrument_released) {
        activateStatusIndicator(3);
    } else if (telemetryData.parachute_released) {
        activateStatusIndicator(2);
    } else if (telemetryData.target_altitude_reached) {
        activateStatusIndicator(1);
    } else if (telemetryData.launched) {
        activateStatusIndicator(0);
    }
}

function activateStatusIndicator(index, imgSrc = null) {
    const indicator = statusItems[index].querySelector(".status-indicator");
    if (!indicator.classList.contains("active")) {
        playStageCompleteSound();
    }
    indicator.classList.add("active");
}

// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", () => {
    setup();
    initMap();
});

function playStageCompleteSound() {
    const complete = new Audio("/static/audio/stage_complete.aac");
    complete.play();
}





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

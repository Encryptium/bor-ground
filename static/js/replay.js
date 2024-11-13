let portButton;
let telemetryReadings;
let payloadStatus;
let statusItems;
let speedInput;
let pauseButton;
let replayID;
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
    replayID = Math.floor(Math.random() * 1000);

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
    telemetryData.replay_id = replayID.toString();
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
}

function updateStatusIndicators(telemetryData) {
    if (telemetryData.instrument_released) {
        activateStatusIndicator(3, "/static/img/payload-open.svg");
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
    if (imgSrc) {
        document.querySelector("#payload-container .status-box img").src = imgSrc;
    }
}

// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", setup);

function playStageCompleteSound() {
    const complete = new Audio("/static/audio/stage_complete.aac");
    complete.play();
}

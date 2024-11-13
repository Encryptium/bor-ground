let portButton;
let telemetryReadings;
let payloadStatus;
let statusItems;
let speedInput;
let replayID;
let replaySpeed = 500;

function setup() {
    // Assign elements
    telemetryReadings = document.getElementById("console");
    payloadStatus = document.querySelector(".status-header");
    statusItems = document.querySelectorAll(".checklist-item");
    speedInput = document.getElementById("replay-speed");
    commandInput = document.getElementById("command-input");
    replayID = Math.floor(Math.random() * 1000);
    
    handlePreloadedData(preloadedData);

    speedInput.addEventListener("change", function (event) {
        replaySpeed = event.target.value;
    });
    
}

function handlePreloadedData(data, idx = 0) {
    setTimeout(() => {
        if (idx < data.length) {
            serialRead(data[idx]);
            handlePreloadedData(data, idx + 1);
        }
    }, replaySpeed);
}


function serialRead(data) {
    // Parse the incoming data string into JSON
    const unmodifiedTelemetryData = structuredClone(data);
    delete unmodifiedTelemetryData.timestamp;
    const telemetryData = data;
    telemetryData.replay_id = replayID.toString();

    // Log or display the parsed JSON data
    // console.log("Parsed Telemetry Data:", telemetryData);
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
}

// Run setup after the page has loaded
document.addEventListener("DOMContentLoaded", setup);


function playStageCompleteSound() {
    const complete = new Audio("/static/audio/stage_complete.aac");
    complete.play();
}



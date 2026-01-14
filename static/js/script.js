let map;
let portButton;
let telemetryReadings;
let statusItems;
let commandInput;

let uiLink;
let uiAlt;
let uiTemp;
let uiGps;

let port;
let reader;
let isConnected = false;

let lineBuffer = '';
let imageBuffer = '';
let isReceivingImage = false;
let imageCounter = 0;
let lastImageUrl = null;

// TTS
let ttsEnabled = false; // start OFF until the user clicks (browser gesture requirement)
let lastSpokenAt = 0;
const TTS_MIN_INTERVAL_MS = 700;
let lastAltSpoken = null;
const TTS_MIN_ALT_DELTA_FT = 0.5;
let ttsUnlocked = false;
let ttsButton;

// Prefer Google US English if available (no UI)
let ttsVoice = null;
const TTS_DEFAULT_LANG = 'en-US';
const TTS_PREFERRED_VOICE_NAME = 'Google US English';

function pickDefaultTtsVoice() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices?.() || [];
    if (!voices.length) return;

    // 1) Exact name match
    let v = voices.find((x) => x.name === TTS_PREFERRED_VOICE_NAME);

    // 2) Google + en-US
    if (!v) {
        v = voices.find((x) => (x.lang || '').toLowerCase().startsWith('en-us') && /google/i.test(x.name));
    }

    // 3) Any en-US
    if (!v) {
        v = voices.find((x) => (x.lang || '').toLowerCase().startsWith('en-us'));
    }

    // 4) Fallback: whatever the browser chooses
    ttsVoice = v || null;
}

function setTtsButtonUI() {
    if (!ttsButton) return;
    ttsButton.textContent = ttsEnabled ? 'Voice: ON' : 'Voice: OFF';
    ttsButton.classList.toggle('active', ttsEnabled);
}

function unlockTtsOnce() {
    if (!window.speechSynthesis || ttsUnlocked) return;
    ttsUnlocked = true;

    try {
        // Some browsers start speech synthesis in a paused state
        window.speechSynthesis.resume();
        window.speechSynthesis.cancel();

        // Tiny warm-up utterance to "unlock" audio
        const u = new SpeechSynthesisUtterance('');
        u.lang = TTS_DEFAULT_LANG;
        if (ttsVoice) u.voice = ttsVoice;
        u.volume = 0; // silent
        window.speechSynthesis.speak(u);

        // Restore volume for real speech
        // (SpeechSynthesisUtterance is per-utterance; nothing global to reset)
    } catch (e) {
        console.warn('TTS unlock failed:', e);
    }
}

function ensureTtsReady() {
    if (!window.speechSynthesis) return;
    try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (e) {}
}

function formatAltitudeForSpeech(altitudeFt) {
    // Speak quickly:
    // - negative: "sub 5"
    // - 100–999: "one 12" (112) instead of "one hundred twelve"
    const n = Math.round(Number(altitudeFt) || 0);
    const absN = Math.abs(n);

    const prefix = n < 0 ? 'sub ' : '';

    if (absN >= 100 && absN <= 999) {
        const hundreds = Math.floor(absN / 100);
        const rest = absN % 100;

        // Keep rest as 2 digits so 105 becomes "1 05" (usually spoken "one zero five")
        const rest2 = rest.toString().padStart(2, '0');
        return `${prefix}${hundreds} ${rest2}`;
    }

    return `${prefix}${absN}`;
}

function speakAltitude(altitude) {
    if (!ttsEnabled) return;
    if (!window.speechSynthesis) return;

    ensureTtsReady();

    const now = Date.now();
    if (now - lastSpokenAt < TTS_MIN_INTERVAL_MS) return;
    if (lastAltSpoken !== null && Math.abs(altitude - lastAltSpoken) < TTS_MIN_ALT_DELTA_FT) return;

    lastSpokenAt = now;
    lastAltSpoken = altitude;

    // Keep it realtime: clear any backlog
    try { window.speechSynthesis.cancel(); } catch (e) {}

    const phrase = `${formatAltitudeForSpeech(altitude)} feet`;
    const u = new SpeechSynthesisUtterance(phrase);
    u.lang = TTS_DEFAULT_LANG;
    if (ttsVoice) u.voice = ttsVoice;

    u.rate = 1.08;
    u.pitch = 1.0;
    u.volume = 1.0;

    try {
        window.speechSynthesis.speak(u);
    } catch (e) {
        console.warn('TTS speak failed:', e);
    }
}

// Live image viewer
const imageContainer = document.createElement('div');
imageContainer.id = 'image-container';

const liveImage = document.createElement('img');
liveImage.id = 'live-image';
liveImage.alt = 'Live received image';

const imagePlaceholder = document.createElement('div');
imagePlaceholder.id = 'image-placeholder';
imagePlaceholder.textContent = 'No image received';

liveImage.style.display = 'block';
liveImage.style.width = '100%';
liveImage.style.height = '100%';

imageContainer.appendChild(liveImage);
imageContainer.appendChild(imagePlaceholder);
document.body.appendChild(imageContainer);

function showImagePlaceholder(msg) {
    imagePlaceholder.textContent = msg || 'No image received';
    imagePlaceholder.style.display = 'flex';
}

function hideImagePlaceholder() {
    imagePlaceholder.style.display = 'none';
}

showImagePlaceholder('No image received');

function setConnectedUI(connected) {
    isConnected = connected;
    portButton.innerHTML = connected ? 'Disconnect' : 'Connect';

    // update status panel
    if (uiLink) uiLink.textContent = connected ? 'Connected' : 'Disconnected';

    // keep legacy checklist behavior for JS (even though hidden)
    for (const item of statusItems) {
        const dot = item.querySelector('.status-indicator');
        dot.classList.remove('waiting', 'active');
        if (connected) dot.classList.add('waiting');
    }
}

function updateStatusPanelFromTelemetry(t) {
    if (!t || typeof t !== 'object') return;

    if (uiLink) uiLink.textContent = isConnected ? 'Connected' : 'Disconnected';

    if (uiAlt && typeof t.altitude === 'number') {
        uiAlt.textContent = `${t.altitude.toFixed(2)} ft`;
    }

    if (uiTemp && typeof t.temperature === 'number') {
        uiTemp.textContent = `${t.temperature.toFixed(2)} °C`;
    }

    if (uiGps && typeof t.latitude === 'number' && typeof t.longitude === 'number') {
        // Treat 0,0 as "no fix" for your RC code
        if (t.latitude === 0 && t.longitude === 0) {
            uiGps.textContent = 'No fix';
        } else {
            uiGps.textContent = `${t.latitude.toFixed(5)}, ${t.longitude.toFixed(5)}`;
        }
    }
}

// Draggable image window
let isDraggingImageWindow = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startDragImageWindow(e) {
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = imageContainer.getBoundingClientRect();
    isDraggingImageWindow = true;

    imageContainer.style.left = rect.left + 'px';
    imageContainer.style.top = rect.top + 'px';
    imageContainer.style.right = 'auto';
    imageContainer.style.bottom = 'auto';

    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    document.addEventListener('mousemove', onDragImageWindow);
    document.addEventListener('mouseup', endDragImageWindow);
}

function onDragImageWindow(e) {
    if (!isDraggingImageWindow) return;

    const maxLeft = window.innerWidth - imageContainer.offsetWidth;
    const maxTop = window.innerHeight - imageContainer.offsetHeight;

    let newLeft = e.clientX - dragOffsetX;
    let newTop = e.clientY - dragOffsetY;

    newLeft = Math.max(0, Math.min(maxLeft, newLeft));
    newTop = Math.max(0, Math.min(maxTop, newTop));

    imageContainer.style.left = newLeft + 'px';
    imageContainer.style.top = newTop + 'px';
}

function endDragImageWindow() {
    isDraggingImageWindow = false;
    document.removeEventListener('mousemove', onDragImageWindow);
    document.removeEventListener('mouseup', endDragImageWindow);
}

imageContainer.addEventListener('mousedown', startDragImageWindow);

// ---------------------------------------------------
// Serial Command Sending
// ---------------------------------------------------
async function sendSerialCommand(text) {
    if (!port || !isConnected) {
        console.warn("Serial write attempted while not connected:", text);
        return;
    }

    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(text + "\r\n");
        const writer = port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();

        console.log("Serial command sent:", text);
    } catch (error) {
        console.error("Failed to send serial command:", error);
    }
}

function setup() {
    telemetryReadings = document.getElementById('console');
    portButton = document.getElementById('port-button');
    statusItems = document.querySelectorAll('.checklist-item');
    commandInput = document.getElementById('command-input');

    uiLink = document.getElementById('ui-link');
    uiAlt = document.getElementById('ui-alt');
    uiTemp = document.getElementById('ui-temp');
    uiGps = document.getElementById('ui-gps');

    // initialize UI
    if (uiLink) uiLink.textContent = 'Disconnected';

    // Bind TTS button from HTML
    ttsButton = document.getElementById('tts-button');
    if (ttsButton) {
        setTtsButtonUI();

        ttsButton.addEventListener('click', () => {
            unlockTtsOnce();
            ttsEnabled = !ttsEnabled;
            setTtsButtonUI();

            telemetryReadings.innerHTML += `<p>TTS: ${ttsEnabled ? 'ON' : 'OFF'}</p>`;
            telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

            if (ttsEnabled) {
                try {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance('voice on');
                    u.lang = TTS_DEFAULT_LANG;
                    if (ttsVoice) u.voice = ttsVoice;
                    u.rate = 1.1;
                    window.speechSynthesis.speak(u);
                } catch (e) {}
            }
        });
    }

    portButton.addEventListener('click', openClosePort);

    // Also unlock TTS on any first user gesture (click/tap)
    document.addEventListener('pointerdown', unlockTtsOnce, { once: true });

    // Init preferred voice (Chrome often loads voices async)
    try { pickDefaultTtsVoice(); } catch (e) {}
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
            try { pickDefaultTtsVoice(); } catch (e) {}
        };
    }

    commandInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        if (event.repeat) return; // prevents key repeat spam

        const command = commandInput.value.trim();
        if (!command) return;

        if (isConnected) {
            sendSerialCommand(`CMD|${command}`); // <-- IMPORTANT
            telemetryReadings.innerHTML += `<p>TX: CMD|${command}</p>`;
        } else {
            telemetryReadings.innerHTML += `<p>Not connected. Command not sent.</p>`;
        }

        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
        commandInput.value = '';
    });

    navigator.serial.addEventListener('disconnect', handleDisconnect);
}

function handleDisconnect(event) {
    if (port && event.target === port) {
        setConnectedUI(false);
        if (uiLink) uiLink.textContent = 'Disconnected';
        telemetryReadings.innerHTML += '<p>Serial device disconnected unexpectedly.</p>';

        if (liveImage) liveImage.removeAttribute('src');
        showImagePlaceholder('No image received');

        if (lastImageUrl) {
            try { URL.revokeObjectURL(lastImageUrl); } catch (e) {}
            lastImageUrl = null;
        }

        const disconnect = new Audio('/static/audio/warning.aac');
        disconnect.play();
    }
}

async function openClosePort() {
    if (isConnected) {
        await closePort();
        return;
    }

    const success = await openPort();
    if (success) setConnectedUI(true);
}

async function openPort() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });

        console.log('Serial port opened.');
        setConnectedUI(true);

        reader = port.readable.getReader();
        readData(reader);
        return true;
    } catch (error) {
        console.error('Failed to open serial port:', error);
        setConnectedUI(false);
        return false;
    }
}

async function closePort() {
    try {
        if (reader) {
            try { await port.readable.cancel(); } catch (e) {}
            try { reader.releaseLock(); } catch (e) {}
            reader = null;
        }

        if (port) {
            try { await port.close(); } catch (e) {}
            port = null;
        }
    } finally {
        setConnectedUI(false);
        if (uiLink) uiLink.textContent = 'Disconnected';
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

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) processLine(line);
        }

        if (buffer) processLine(buffer);
    } catch (error) {
        console.error('Error reading data:', error);
    } finally {
        try { reader.releaseLock(); } catch (e) {}
    }
}

function processLine(line) {
    const cleanLine = line.trim().replace(/\r/g, '');
    if (!cleanLine) return;

    if (cleanLine.startsWith('ACK|')) {
        telemetryReadings.innerHTML += `<p class="ok">${cleanLine}</p>`;
        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
        return;
    }
    if (cleanLine.startsWith('ERR|')) {
        telemetryReadings.innerHTML += `<p class="error">${cleanLine}</p>`;
        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
        return;
    }

    // need to include shutdown of image transmission
    // need to include transmission of hardware info

    if (cleanLine.startsWith('IMG|')) {
        handleImageHeader(cleanLine);
        return;
    }

    if (cleanLine === 'IMG_START') {
        isReceivingImage = true;
        imageBuffer = '';
        telemetryReadings.innerHTML += '<p>Image transmission started.</p>';
        return;
    }

    if (cleanLine === 'IMG_END') {
        isReceivingImage = false;
        processImageBuffer();
        telemetryReadings.innerHTML += '<p>Image transmission ended.</p>';
        return;
    }

    // might need to fix this because IMG_END may not be received for some reason

    if (isReceivingImage) {
        // Only accept actual base64 lines while receiving an image
        // (prevents ACK/ERR/JSON from corrupting imageBuffer)
        const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(cleanLine);
        if (looksBase64) {
            imageBuffer += cleanLine;
        } else {
            // If something else shows up mid-image, ignore it (or log it)
            telemetryReadings.innerHTML += `<p class="warn">Skipped non-image line during IMG: ${cleanLine}</p>`;
            telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
        }
        return;
    }

    if (cleanLine.startsWith('{') && cleanLine.endsWith('}')) {
        let telemetryData;
        try {
            telemetryData = JSON.parse(cleanLine);
        } catch (err) {
            console.error('Invalid JSON:', cleanLine);
            return;
        }

        if (typeof telemetryData.altitude === 'number' && ttsEnabled) {
            speakAltitude(telemetryData.altitude);
        }

        telemetryReadings.innerHTML += `<p>${JSON.stringify(telemetryData, null, 2)}</p><br>`;
        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

        fetch('/api/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(telemetryData),
        })
            .then((response) => response.json())
            .then((data) => {
                console.log('Success:', data);
                document.querySelector('#graphics img').src = `${data.url}?t=${new Date().getTime()}`;
            })
            .catch((error) => console.error('Error:', error));

        updateStatusPanelFromTelemetry(telemetryData);
        updateStatusIndicators(telemetryData);
        addMarker(telemetryData);
    }
}

function handleImageHeader(line) {
    const [_, filename, size] = line.split('|');
    if (filename && size) {
        telemetryReadings.innerHTML += `<p>Receiving image: ${filename} (${size} bytes)</p>`;
    } else {
        console.error('Invalid image header:', line);
    }
}

function processImageBuffer() {
    try {
        const binaryString = atob(imageBuffer);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        if (lastImageUrl) {
            try { URL.revokeObjectURL(lastImageUrl); } catch (e) {}
        }
        lastImageUrl = url;

        liveImage.onload = () => hideImagePlaceholder();
        liveImage.onerror = () => showImagePlaceholder('Image unavailable');

        imageCounter += 1;
        liveImage.src = url;
        liveImage.alt = `Received image ${imageCounter}`;

        telemetryReadings.innerHTML += `<p>Image received and updated (${imageBuffer.length} chars)</p>`;
    } catch (error) {
        console.error('Error processing image:', error);
        telemetryReadings.innerHTML += `<p class="error">Error decoding image: ${error.message}</p>`;
        showImagePlaceholder('Image unavailable');
    }
}

function updateStatusIndicators(t) {
    const steps = [
        ['launched', 0],
        ['target_altitude_reached', 1],
        ['parachute_released', 2],
        ['instrument_released', 3],
    ];

    for (const [key, idx] of steps) {
        if (!t[key]) continue;

        const dot = statusItems[idx].querySelector('.status-indicator');
        if (!dot.classList.contains('active')) playStageCompleteSound();
        dot.classList.add('active');
        break;
    }
}

function playStageCompleteSound() {
    const complete = new Audio('/static/audio/stage_complete.aac');
    complete.play();
}

// Viewer CSS
const style = document.createElement('style');
style.textContent = `
#image-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #000;
    border-radius: 6px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    width: 350px;
    height: 350px;
    padding: 0;
    overflow: hidden;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    cursor: move;
    user-select: none;
    z-index: 9999;
}
#live-image {
    width: 100%;
    height: 100%;
    object-fit: fill;
    background: #000;
    image-rendering: pixelated;
    pointer-events: none;
}
#image-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size: 14px;
    color: rgba(255,255,255,0.75);
    background: #000;
    pointer-events: none;
}
.error { 
    color: red; 
}
#tts-button {
    z-index: 9999;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    cursor: pointer;
}
#tts-button.active {
    border-color: rgba(0,255,150,0.35);
}
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
    setup();
    initMap();
});

// Map
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 38.9072, lng: -77.0369 },
        zoom: 16,
        mapId: 'c53e775cd5e6be62',
        mapTypeId: 'roadmap',
        disableDefaultUI: true,
    });
}

function getColorByAltitude(altitude) {
    const minAltitude = 0;
    const maxAltitude = 2000;
    const normalized = Math.min(Math.max((altitude - minAltitude) / (maxAltitude - minAltitude), 0), 1);

    const start = [0, 0, 255];
    const end = [255, 0, 0];

    const r = Math.round(start[0] + (end[0] - start[0]) * normalized);
    const g = Math.round(start[1] + (end[1] - start[1]) * normalized);
    const b = Math.round(start[2] + (end[2] - start[2]) * normalized);

    return `rgb(${r},${g},${b})`;
}

function addMarker(telemetryData) {
    const { latitude, longitude, altitude } = telemetryData;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

    new google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: getColorByAltitude(altitude),
            fillOpacity: 1,
            strokeWeight: 0,
        },
    });

    map.panTo({ lat: latitude, lng: longitude });
}
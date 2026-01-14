let map;
let telemetryReadings;
let statusItems;
let speedInput;
let pauseButton;

let replaySpeed = 500;
let isPaused = false;
let currentIdx = 0;
let bufferedData = [];

// -----------------
// TTS (browser)
// -----------------
let ttsEnabled = false; // user must enable once
let ttsUnlocked = false;
let voicesReady = false;

let selectedVoiceURI = null;

// TTS throttle (prevents spam + avoids crashes)
const TTS_MIN_INTERVAL_MS = 700;
const TTS_MIN_ALT_DELTA_FT = 0.25;
let lastSpokenAt = 0;
let lastAltSpoken = null;

function getVoicesList() {
  if (!window.speechSynthesis) return [];
  const v = window.speechSynthesis.getVoices();
  return Array.isArray(v) ? v : [];
}

function pickDefaultVoice() {
  const voices = getVoicesList();
  if (!voices.length) return null;

  // Prefer Chrome/Google voice if available
  const googleUSEnglish = voices.find(vo => {
    const name = (vo.name || '').toLowerCase();
    const lang = (vo.lang || '').toLowerCase();
    return name.includes('google') && name.includes('us english') && lang.startsWith('en-us');
  });
  if (googleUSEnglish) return googleUSEnglish.voiceURI;

  const googleEnUS = voices.find(vo => {
    const name = (vo.name || '').toLowerCase();
    const lang = (vo.lang || '').toLowerCase();
    return name.includes('google') && lang.startsWith('en-us');
  });
  if (googleEnUS) return googleEnUS.voiceURI;

  const enUS = voices.find(vo => (vo.lang || '').toLowerCase().startsWith('en-us'));
  if (enUS) return enUS.voiceURI;

  const en = voices.find(vo => (vo.lang || '').toLowerCase().startsWith('en'));
  if (en) return en.voiceURI;

  return voices[0].voiceURI;
}

function resolveSelectedVoice() {
  const voices = getVoicesList();
  if (!voices.length) return null;
  if (!selectedVoiceURI) selectedVoiceURI = pickDefaultVoice();
  return voices.find(v => v.voiceURI === selectedVoiceURI) || null;
}

function formatAltitudeForSpeech(altitudeFt) {
  // Goal:
  // - 112 -> "one twelve" (shorter than "one hundred twelve")
  // - -1 -> "down one" (shorter than "minus one")
  // - keep it quick and clear

  const n = Math.round(Number(altitudeFt) || 0);
  const abs = Math.abs(n);

  let prefix = '';
  if (n < 0) prefix = 'down ';

  // 0..99: say normally
  if (abs < 100) {
    return `${prefix}${abs}`;
  }

  // 100..999: "one twelve", "one oh one", "nine ninety"
  if (abs < 1000) {
    const hundreds = Math.floor(abs / 100);
    const lastTwo = abs % 100;

    if (lastTwo === 0) {
      return `${prefix}${hundreds} hundred`;
    }

    if (lastTwo < 10) {
      return `${prefix}${hundreds} oh ${lastTwo}`;
    }

    return `${prefix}${hundreds} ${lastTwo}`;
  }

  // 1000+: keep it short (rounded)
  return `${prefix}${abs}`;
}

function loadVoices() {
  if (!window.speechSynthesis) return;
  const v = window.speechSynthesis.getVoices();
  if (v && v.length) {
    voicesReady = true;
    if (!selectedVoiceURI) selectedVoiceURI = pickDefaultVoice();
    // No voice selector UI to populate.
  }
}

if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
}

function unlockTTS() {
  if (!window.speechSynthesis) return;
  // iOS/Safari sometimes needs resume()
  try {
    if (typeof window.speechSynthesis.resume === 'function') {
      window.speechSynthesis.resume();
    }
  } catch (_) {}

  // Don’t keep spamming primer once it worked.
  if (ttsUnlocked) return;

  try {
    loadVoices();

    // This MUST happen from a user gesture to be reliable.
    const primer = new SpeechSynthesisUtterance('Voice enabled');
    primer.rate = 1.0;
    primer.pitch = 1.0;
    primer.volume = 1.0;
    primer.lang = 'en-US';

    const voice = resolveSelectedVoice();
    if (voice) primer.voice = voice;

    primer.onstart = () => {
      ttsUnlocked = true;
      ttsEnabled = true;
      const btn = document.getElementById('tts-enable-button');
      if (btn) btn.style.display = 'none';
      if (telemetryReadings) {
        telemetryReadings.innerHTML += `<p>TTS: ON</p>`;
        telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
      }
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(primer);
  } catch (e) {
    console.warn('TTS unlock failed:', e);
  }
}

function speakAltitude(altitude) {
  if (!ttsEnabled) return;
  if (!window.speechSynthesis) return;
  if (!ttsUnlocked) return;

  const now = Date.now();
  if (now - lastSpokenAt < TTS_MIN_INTERVAL_MS) return;
  if (lastAltSpoken !== null && Math.abs(Number(altitude) - Number(lastAltSpoken)) < TTS_MIN_ALT_DELTA_FT) return;

  lastSpokenAt = now;
  lastAltSpoken = altitude;

  try {
    if (typeof window.speechSynthesis.resume === 'function') {
      window.speechSynthesis.resume();
    }
  } catch (_) {}

  window.speechSynthesis.cancel();

  const phrase = `${formatAltitudeForSpeech(altitude)}`;
  const u = new SpeechSynthesisUtterance(phrase);
  u.rate = 1.05;
  u.pitch = 1.0;
  u.volume = 1.0;
  u.lang = 'en-US';

  const voice = resolveSelectedVoice();
  if (voice) u.voice = voice;

  window.speechSynthesis.speak(u);
}

// -----------------
// UI bits
// -----------------
let lastImageUrl = null;
let imageContainer;
let liveImage;
let imagePlaceholder;

function showImagePlaceholder(msg) {
  if (!imagePlaceholder) return;
  imagePlaceholder.textContent = msg || 'No image in replay';
  imagePlaceholder.style.display = 'flex';
}

function hideImagePlaceholder() {
  if (!imagePlaceholder) return;
  imagePlaceholder.style.display = 'none';
}

// Drag
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

function initOverlayUI() {
  // TTS enable button (required by browser autoplay rules)
  const existingBtn = document.getElementById('tts-enable-button');
  const ttsButton = existingBtn || document.createElement('button');
  ttsButton.id = 'tts-enable-button';
  if (!existingBtn) ttsButton.textContent = 'Enable voice';
  ttsButton.addEventListener('click', () => {
    unlockTTS();
  });
  if (!existingBtn) document.body.appendChild(ttsButton);

  // No voice dropdown (default is Google US English when available)

  // Draggable image window
  imageContainer = document.createElement('div');
  imageContainer.id = 'image-container';

  liveImage = document.createElement('img');
  liveImage.id = 'live-image';
  liveImage.alt = 'Replay image';

  imagePlaceholder = document.createElement('div');
  imagePlaceholder.id = 'image-placeholder';
  imagePlaceholder.textContent = 'No image in replay';

  imageContainer.appendChild(liveImage);
  imageContainer.appendChild(imagePlaceholder);
  document.body.appendChild(imageContainer);

  imageContainer.addEventListener('mousedown', startDragImageWindow);
  showImagePlaceholder('No image in replay');

  // Unlock attempts on gestures (helps after reloads)
  document.addEventListener('pointerdown', () => {
    if (ttsEnabled && !ttsUnlocked) unlockTTS();
  });
  document.addEventListener('keydown', () => {
    if (ttsEnabled && !ttsUnlocked) unlockTTS();
  });

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #image-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #000;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.35);
      width: 420px;
      height: 420px;
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
      object-fit: cover; /* fill window, no borders */
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
      font-size: 16px;
      color: rgba(255,255,255,0.75);
      background: #000;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function setup() {
  telemetryReadings = document.getElementById('console');
  statusItems = document.querySelectorAll('.checklist-item');
  speedInput = document.getElementById('replay-speed');
  pauseButton = document.getElementById('pause-button');

  bufferedData = structuredClone(preloadedData);
  handlePreloadedData(currentIdx);

  speedInput.addEventListener('change', (event) => {
    if (event.target.value < 200) event.target.value = 200;
    if (event.target.value > 999) event.target.value = 999;
    replaySpeed = event.target.value;
  });

  pauseButton.addEventListener('click', (event) => {
    const img = event.target.querySelector('#pause-button img');
    if (isPaused) {
      img.src = '/static/img/pause.svg';
      isPaused = false;
      handlePreloadedData(currentIdx);
    } else {
      img.src = '/static/img/play.svg';
      isPaused = true;
    }
  });

  // Press T to toggle voice
  document.addEventListener('keydown', (e) => {
    if (!e.key) return;
    if (e.key.toLowerCase() !== 't') return;

    // T enables/disables, but you still need the button click once to unlock.
    ttsEnabled = !ttsEnabled;

    if (telemetryReadings) {
      telemetryReadings.innerHTML += `<p>TTS: ${ttsEnabled ? 'ON' : 'OFF'}${ttsEnabled && !ttsUnlocked ? ' (click Enable voice)' : ''}</p>`;
      telemetryReadings.scrollTop = telemetryReadings.scrollHeight;
    }

    if (ttsEnabled && !ttsUnlocked) {
      // If user toggled ON with keyboard, that counts as a gesture.
      unlockTTS();
    }
  });
}

function handlePreloadedData(idx) {
  if (isPaused || idx >= bufferedData.length) return;

  setTimeout(() => {
    serialRead(bufferedData[idx]);
    currentIdx = idx + 1;
    handlePreloadedData(currentIdx);
  }, replaySpeed);
}

function serialRead(data) {
  const unmodifiedTelemetryData = structuredClone(data);
  delete unmodifiedTelemetryData.timestamp;

  const telemetryData = data;
  telemetryData.replay_id = replayID;
  telemetryData.final_timestamp = bufferedData[bufferedData.length - 1].timestamp
    .replace(/\[/g, '')
    .replace(/\]/g, '');

  const alt = Number(telemetryData.altitude);
  if (Number.isFinite(alt)) {
    try {
      speakAltitude(alt);
    } catch (e) {
      console.warn('TTS error:', e);
    }
  }

  telemetryReadings.innerHTML += `<p>${JSON.stringify(unmodifiedTelemetryData, null, 2)}</p><br>`;
  telemetryReadings.scrollTop = telemetryReadings.scrollHeight;

  fetch('/api/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(telemetryData),
  })
    .then((response) => response.json())
    .then((resp) => {
      const url = `${resp.url}?t=${new Date().getTime()}`;

      const graphicsImg = document.querySelector('#graphics img');
      if (graphicsImg) graphicsImg.src = url;

      // Mirror into draggable window
      if (lastImageUrl) {
        try { URL.revokeObjectURL(lastImageUrl); } catch (_) {}
        lastImageUrl = null;
      }

      liveImage.onload = () => hideImagePlaceholder();
      liveImage.onerror = () => showImagePlaceholder('Image unavailable');
      liveImage.src = url;
    })
    .catch((error) => {
      console.error('Error:', error);
      showImagePlaceholder('Image unavailable');
    });

  addMarker(telemetryData);
}

function playStageCompleteSound() {
  const complete = new Audio('/static/audio/stage_complete.aac');
  complete.play();
}

document.addEventListener('DOMContentLoaded', () => {
  initOverlayUI();
  setup();
  initMap();
});

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

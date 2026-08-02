const systemSourceEl = document.getElementById('systemSource');
const micSourceEl = document.getElementById('micSource');
const systemVolumeEl = document.getElementById('systemVolume');
const micVolumeEl = document.getElementById('micVolume');
const systemVolumeLabel = document.getElementById('systemVolumeLabel');
const micVolumeLabel = document.getElementById('micVolumeLabel');
const includeMicEl = document.getElementById('includeMic');
const micSourceField = document.getElementById('micSourceField');
const micVolumeField = document.getElementById('micVolumeField');
const destinationEl = document.getElementById('destination');
const toggleBtn = document.getElementById('toggleBtn');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const ffmpegWarning = document.getElementById('ffmpegWarning');
const refreshBtn = document.getElementById('refreshDevices');

let isRunning = false;

function pct(v) {
  return `${Math.round(v * 100)}%`;
}

function updateMicFieldsVisibility() {
  const show = includeMicEl.checked;
  micSourceField.classList.toggle('hidden', !show);
  micVolumeField.classList.toggle('hidden', !show);
}

function setControlsDisabled(disabled) {
  [systemSourceEl, micSourceEl, systemVolumeEl, micVolumeEl, includeMicEl, destinationEl, refreshBtn].forEach(
    (el) => (el.disabled = disabled)
  );
}

async function checkFfmpeg() {
  const res = await fetch('/api/ffmpeg-check');
  const data = await res.json();
  ffmpegWarning.classList.toggle('hidden', data.available);
}

async function loadDevices() {
  try {
    const [inputRes, outputRes] = await Promise.all([fetch('/api/input-devices'), fetch('/api/output-devices')]);
    if (!inputRes.ok) throw new Error((await inputRes.json()).error || 'Failed to load input devices');
    if (!outputRes.ok) throw new Error((await outputRes.json()).error || 'Failed to load output devices');
    const inputData = await inputRes.json();
    const outputData = await outputRes.json();

    const previousSystem = systemSourceEl.value;
    const previousMic = micSourceEl.value;
    const previousDestination = destinationEl.value;

    systemSourceEl.innerHTML = '';
    micSourceEl.innerHTML = '';
    destinationEl.innerHTML = '';

    for (const name of inputData.audio) {
      const opt1 = document.createElement('option');
      opt1.value = name;
      opt1.textContent = name;
      systemSourceEl.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = name;
      opt2.textContent = name;
      micSourceEl.appendChild(opt2);
    }

    for (const device of outputData.devices) {
      const opt = document.createElement('option');
      opt.value = device.id;
      opt.textContent = `${device.name} (${device.hostAPIName})`;
      destinationEl.appendChild(opt);
    }

    // Prefer "Stereo Mix" as the default system source if present.
    const stereoMix = inputData.audio.find((n) => /stereo mix|what u hear|loopback/i.test(n));
    if (previousSystem && inputData.audio.includes(previousSystem)) {
      systemSourceEl.value = previousSystem;
    } else if (stereoMix) {
      systemSourceEl.value = stereoMix;
    }

    const mic = inputData.audio.find((n) => /^(?!.*stereo mix).*mic/i.test(n));
    if (previousMic && inputData.audio.includes(previousMic)) {
      micSourceEl.value = previousMic;
    } else if (mic) {
      micSourceEl.value = mic;
    }

    // Prefer a "CABLE Input" device, favoring WASAPI, then DirectSound, then whatever's available.
    const byPreference = (apiName) =>
      outputData.devices.find((d) => /cable input/i.test(d.name) && d.hostAPIName === apiName);
    const preferredDestination =
      byPreference('Windows WASAPI') ||
      byPreference('Windows DirectSound') ||
      outputData.devices.find((d) => /cable input/i.test(d.name));
    if (previousDestination && outputData.devices.some((d) => String(d.id) === previousDestination)) {
      destinationEl.value = previousDestination;
    } else if (preferredDestination) {
      destinationEl.value = String(preferredDestination.id);
    }
  } catch (err) {
    errorText.textContent = err.message;
    errorText.classList.remove('hidden');
  }
}

function applyStatus(status) {
  isRunning = status.running;
  toggleBtn.textContent = isRunning ? 'Stop' : 'Start';
  toggleBtn.classList.toggle('running', isRunning);
  statusText.textContent = isRunning ? 'Running \u2014 sending audio to your virtual mic' : 'Stopped';
  statusText.classList.toggle('running', isRunning);
  setControlsDisabled(isRunning);

  if (status.error) {
    errorText.textContent = status.error;
    errorText.classList.remove('hidden');
  } else {
    errorText.classList.add('hidden');
  }
}

async function refreshStatus() {
  const res = await fetch('/api/status');
  const status = await res.json();
  applyStatus(status);
}

async function start() {
  errorText.classList.add('hidden');
  const body = {
    systemSource: systemSourceEl.value,
    micSource: micSourceEl.value,
    destination: Number(destinationEl.value),
    systemVolume: parseFloat(systemVolumeEl.value),
    micVolume: parseFloat(micVolumeEl.value),
    includeMic: includeMicEl.checked,
  };
  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const status = await res.json();
  if (!res.ok) {
    errorText.textContent = status.error || 'Failed to start';
    errorText.classList.remove('hidden');
    return;
  }
  applyStatus(status);
}

async function stop() {
  const res = await fetch('/api/stop', { method: 'POST' });
  const status = await res.json();
  applyStatus(status);
}

toggleBtn.addEventListener('click', () => {
  if (isRunning) stop();
  else start();
});

systemVolumeEl.addEventListener('input', () => {
  systemVolumeLabel.textContent = pct(parseFloat(systemVolumeEl.value));
});
micVolumeEl.addEventListener('input', () => {
  micVolumeLabel.textContent = pct(parseFloat(micVolumeEl.value));
});
includeMicEl.addEventListener('change', updateMicFieldsVisibility);
refreshBtn.addEventListener('click', loadDevices);

(async function init() {
  updateMicFieldsVisibility();
  await checkFfmpeg();
  await loadDevices();
  await refreshStatus();
  setInterval(refreshStatus, 3000);
})();

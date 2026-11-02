/**
 * AudioMonitor — app.js
 * Real-time audio pass-through: soundcard input → speaker output
 * Uses Web Audio API with circular visualizer, waveform, VU meters & spectrum
 */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  audioCtx: null,
  stream: null,
  sourceNode: null,
  gainNode: null,
  outputGainNode: null,
  analyserNode: null,
  analyserStereoL: null,
  analyserStereoR: null,
  splitterNode: null,
  destination: null,
  isRunning: false,
  inputMuted: false,
  outputMuted: false,
  peakL: -Infinity,
  peakR: -Infinity,
  animFrameId: null,
};

// ─── DOM References ───────────────────────────────────────────────────────────
const els = {
  deviceSelect:    document.getElementById('deviceSelect'),
  btnRefresh:      document.getElementById('btnRefreshDevices'),
  diagBanner:      document.getElementById('diagBanner'),
  diagIcon:        document.getElementById('diagIcon'),
  diagTitle:       document.getElementById('diagTitle'),
  diagDesc:        document.getElementById('diagDesc'),
  inputVolume:     document.getElementById('inputVolume'),
  outputVolume:    document.getElementById('outputVolume'),
  inputGainVal:    document.getElementById('inputGainVal'),
  outputVolVal:    document.getElementById('outputVolVal'),
  echoCancelToggle: document.getElementById('echoCancelToggle'),
  noiseSuppToggle:  document.getElementById('noiseSuppToggle'),
  btnToggle:       document.getElementById('btnToggle'),
  btnLabel:        document.getElementById('btnLabel'),
  iconPlay:        document.querySelector('.icon-play'),
  iconStop:        document.querySelector('.icon-stop'),
  btnMuteInput:    document.getElementById('btnMuteInput'),
  btnMuteOutput:   document.getElementById('btnMuteOutput'),
  btnResetPeak:    document.getElementById('btnResetPeak'),
  statusPill:      document.getElementById('statusPill'),
  statusText:      document.getElementById('statusText'),
  centerDb:        document.getElementById('centerDb'),
  vuLeft:          document.getElementById('vuLeft'),
  vuRight:         document.getElementById('vuRight'),
  dbLeft:          document.getElementById('dbLeft'),
  dbRight:         document.getElementById('dbRight'),
  peakL:           document.getElementById('peakL'),
  peakR:           document.getElementById('peakR'),
  sampleRateVal:   document.getElementById('sampleRateVal'),
  channelsVal:     document.getElementById('channelsVal'),
  latencyVal:      document.getElementById('latencyVal'),
  bufferVal:       document.getElementById('bufferVal'),
  toast:           document.getElementById('toast'),
};

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
const vizCanvas  = document.getElementById('visualizerCanvas');
const waveCanvas = document.getElementById('waveformCanvas');
const specCanvas = document.getElementById('spectrumCanvas');
const vizCtx     = vizCanvas.getContext('2d');
const waveCtx    = waveCanvas.getContext('2d');
const specCtx    = specCanvas.getContext('2d');

function resizeCanvases() {
  const vw = vizCanvas.parentElement.offsetWidth;
  const vh = vizCanvas.parentElement.offsetHeight;
  vizCanvas.width  = vw; vizCanvas.height = vh;

  waveCanvas.width  = waveCanvas.offsetWidth  * devicePixelRatio;
  waveCanvas.height = waveCanvas.offsetHeight * devicePixelRatio;
  waveCtx.scale(devicePixelRatio, devicePixelRatio);

  specCanvas.width  = specCanvas.offsetWidth  * devicePixelRatio;
  specCanvas.height = specCanvas.offsetHeight * devicePixelRatio;
  specCtx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener('resize', resizeCanvases);
setTimeout(resizeCanvases, 50);

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 3000) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), duration);
}

// ─── Diagnostic Banner Helper ─────────────────────────────────────────────────
function showDiag(type, icon, title, desc) {
  // type: 'warn' | 'success' | 'error'
  els.diagBanner.style.display = 'flex';
  els.diagBanner.className = 'diag-banner' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
  els.diagIcon.textContent  = icon;
  els.diagTitle.textContent = title;
  els.diagDesc.textContent  = desc;
}
function hideDiag() { els.diagBanner.style.display = 'none'; }

// ─── Device Enumeration ───────────────────────────────────────────────────────
async function enumerateDevices(isRefresh = false) {
  if (isRefresh) {
    els.btnRefresh.classList.add('spinning');
  }
  showDiag('warn', '⏳', 'Meminta izin mikrofon…', 'Browser akan menampilkan popup — klik Allow / Izinkan');

  // Step 1: Request mic permission (needed so labels are populated)
  let permStream = null;
  try {
    permStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    els.btnRefresh.classList.remove('spinning');
    const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
    const isNotFound = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError';

    if (isDenied) {
      showDiag('error', '🚫', 'Izin ditolak',
        'Buka Settings browser → Privacy & Security → Microphone → izinkan localhost, lalu klik Refresh ↻');
      showToast('❌ Izin mikrofon ditolak — ubah di settings browser', 5000);
    } else if (isNotFound) {
      showDiag('error', '🔌', 'Tidak ada perangkat audio input',
        'Aktifkan Stereo Mix di Windows Sound → Recording (lihat panduan 💡 di bawah)');
      showToast('❌ Tidak ada audio input terdeteksi', 4000);
    } else {
      showDiag('error', '⚠', 'Error: ' + err.name, err.message);
      showToast('❌ ' + err.message, 4000);
    }
    console.error('[AudioMonitor] getUserMedia error:', err.name, err.message);
    return;
  }

  // Step 2: Enumerate all devices now that permission is granted
  let devices;
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    showDiag('error', '⚠', 'Gagal enumerasi perangkat', err.message);
    if (permStream) permStream.getTracks().forEach(t => t.stop());
    els.btnRefresh.classList.remove('spinning');
    return;
  }

  // Stop the temp permission stream immediately
  if (permStream) permStream.getTracks().forEach(t => t.stop());

  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const prevVal = els.deviceSelect.value;

  // Log all detected devices to console for debugging
  console.group('[AudioMonitor] Detected devices:');
  devices.forEach(d => console.log(`  [${d.kind}] ${d.label || '(no label)'} | id: ${d.deviceId.slice(0,12)}…`));
  console.groupEnd();

  // Rebuild dropdown
  els.deviceSelect.innerHTML = '<option value="">-- Pilih perangkat --</option>';

  if (audioInputs.length === 0) {
    showDiag('error', '🔌', 'Tidak ada audio input terdeteksi',
      'Aktifkan Stereo Mix / Line In di Windows Sound Settings → Recording, lalu klik Refresh ↻');
    showToast('⚠ Tidak ada perangkat audio input ditemukan', 5000);
    els.btnRefresh.classList.remove('spinning');
    return;
  }

  audioInputs.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    // Show label; flag Stereo Mix / default
    const rawLabel = d.label || `Audio Input ${i + 1}`;
    const isDefault = d.deviceId === 'default';
    const isStereoMix = /stereo|mix|loopback|wave out|what u hear/i.test(rawLabel);
    const badge = isDefault ? ' ⭐' : isStereoMix ? ' 🎛' : '';
    opt.textContent = rawLabel + badge;
    if (isStereoMix) opt.style.color = '#00e5ff';  // highlight stereo mix
    els.deviceSelect.appendChild(opt);
  });

  // Restore previous selection if still available, else pick first
  const ids = audioInputs.map(d => d.deviceId);
  if (prevVal && ids.includes(prevVal)) {
    els.deviceSelect.value = prevVal;
  } else {
    // Prefer stereo mix, otherwise default, otherwise first
    const stereoMix = audioInputs.find(d => /stereo|mix|loopback|wave out/i.test(d.label));
    const def       = audioInputs.find(d => d.deviceId === 'default');
    const pick      = stereoMix || def || audioInputs[0];
    els.deviceSelect.value = pick.deviceId;
  }

  const count = audioInputs.length;
  showDiag('success', '✅', `${count} perangkat audio ditemukan`,
    audioInputs.map(d => d.label || 'Audio Input').join(' · '));
  showToast(`✓ ${count} perangkat ditemukan — pilih dan tekan START`, 4000);

  els.btnRefresh.classList.remove('spinning');
}

// ─── Audio Engine ─────────────────────────────────────────────────────────────
async function startMonitoring() {
  const deviceId = els.deviceSelect.value;
  const latencyMode = document.querySelector('input[name=latency]:checked').value;
  const echoCancel  = els.echoCancelToggle.checked;
  const noiseSupp   = els.noiseSuppToggle.checked;

  const constraints = {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation:  echoCancel,
      noiseSuppression:  noiseSupp,
      autoGainControl:   false,
      latency:           latencyMode === 'low' ? 0 : 0.1,
      sampleRate:        48000,
    }
  };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    showToast('❌ Gagal akses audio: ' + err.message);
    return;
  }

  // Create AudioContext
  const ctxOptions = latencyMode === 'low'
    ? { latencyHint: 'interactive', sampleRate: 48000 }
    : { latencyHint: 'playback',    sampleRate: 48000 };

  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(ctxOptions);

  // Resume context if suspended
  if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

  // Source node from media stream
  state.sourceNode = state.audioCtx.createMediaStreamSource(state.stream);

  // Gain node for input volume
  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = parseFloat(els.inputVolume.value) / 100;

  // Output gain for master volume
  state.outputGainNode = state.audioCtx.createGain();
  state.outputGainNode.gain.value = parseFloat(els.outputVolume.value) / 100;

  // Analyser for circular visualizer (combined)
  state.analyserNode = state.audioCtx.createAnalyser();
  state.analyserNode.fftSize = 2048;
  state.analyserNode.smoothingTimeConstant = 0.8;

  // Stereo splitter for L/R VU
  state.splitterNode = state.audioCtx.createChannelSplitter(2);
  state.analyserStereoL = state.audioCtx.createAnalyser();
  state.analyserStereoL.fftSize = 512;
  state.analyserStereoL.smoothingTimeConstant = 0.6;
  state.analyserStereoR = state.audioCtx.createAnalyser();
  state.analyserStereoR.fftSize = 512;
  state.analyserStereoR.smoothingTimeConstant = 0.6;

  // Graph: source → gain → analyser → splitter → L/R analysers
  //                       analyser → outputGain → destination
  state.sourceNode.connect(state.gainNode);
  state.gainNode.connect(state.analyserNode);
  state.analyserNode.connect(state.splitterNode);
  state.splitterNode.connect(state.analyserStereoL, 0);
  state.splitterNode.connect(state.analyserStereoR, 1);
  state.analyserNode.connect(state.outputGainNode);
  state.outputGainNode.connect(state.audioCtx.destination);

  state.isRunning = true;

  // Update info stats
  const track = state.stream.getAudioTracks()[0];
  const settings = track.getSettings();
  els.sampleRateVal.textContent = (settings.sampleRate || state.audioCtx.sampleRate / 1000).toFixed(0) + ' kHz';
  els.channelsVal.textContent   = settings.channelCount || '1-2';
  els.latencyVal.textContent    = (state.audioCtx.baseLatency * 1000).toFixed(1) + ' ms';
  els.bufferVal.textContent     = state.analyserNode.fftSize;

  updateUI(true);
  startDrawLoop();
  showToast('▶ Monitoring aktif — audio langsung diputar ke speaker');
}

async function stopMonitoring() {
  cancelAnimationFrame(state.animFrameId);

  if (state.sourceNode)     { state.sourceNode.disconnect(); state.sourceNode = null; }
  if (state.gainNode)       { state.gainNode.disconnect(); state.gainNode = null; }
  if (state.outputGainNode) { state.outputGainNode.disconnect(); state.outputGainNode = null; }
  if (state.analyserNode)   { state.analyserNode.disconnect(); state.analyserNode = null; }
  if (state.splitterNode)   { state.splitterNode.disconnect(); state.splitterNode = null; }

  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  if (state.audioCtx) {
    await state.audioCtx.close();
    state.audioCtx = null;
  }

  state.isRunning = false;
  updateUI(false);
  clearVisuals();
  showToast('⏹ Monitoring dihentikan');
}

// ─── UI State ─────────────────────────────────────────────────────────────────
function updateUI(running) {
  els.btnToggle.classList.toggle('running', running);
  els.iconPlay.classList.toggle('hidden', running);
  els.iconStop.classList.toggle('hidden', !running);
  els.btnLabel.textContent = running ? 'STOP' : 'START';
  els.statusPill.classList.toggle('active', running);
  els.statusText.textContent = running ? 'Live' : 'Standby';
  if (!running) {
    els.centerDb.textContent = '— dB';
    els.vuLeft.style.height  = '0%';
    els.vuRight.style.height = '0%';
    els.dbLeft.textContent   = '-∞';
    els.dbRight.textContent  = '-∞';
  }
}

function clearVisuals() {
  vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  waveCtx.clearRect(0, 0, waveCanvas.offsetWidth, waveCanvas.offsetHeight);
  specCtx.clearRect(0, 0, specCanvas.offsetWidth, specCanvas.offsetHeight);
}

// ─── Draw Loop ────────────────────────────────────────────────────────────────
function startDrawLoop() {
  const bufLen   = state.analyserNode.frequencyBinCount;
  const timeBuf  = new Uint8Array(bufLen);
  const freqBuf  = new Uint8Array(bufLen);
  const lBuf     = new Uint8Array(state.analyserStereoL.frequencyBinCount);
  const rBuf     = new Uint8Array(state.analyserStereoR.frequencyBinCount);
  const lTimeBuf = new Uint8Array(state.analyserStereoL.fftSize);
  const rTimeBuf = new Uint8Array(state.analyserStereoR.fftSize);

  function draw() {
    if (!state.isRunning) return;
    state.animFrameId = requestAnimationFrame(draw);

    state.analyserNode.getByteTimeDomainData(timeBuf);
    state.analyserNode.getByteFrequencyData(freqBuf);
    state.analyserStereoL.getByteTimeDomainData(lTimeBuf);
    state.analyserStereoR.getByteTimeDomainData(rTimeBuf);
    state.analyserStereoL.getByteFrequencyData(lBuf);
    state.analyserStereoR.getByteFrequencyData(rBuf);

    drawCircularVisualizer(timeBuf, freqBuf);
    drawWaveform(timeBuf);
    drawSpectrum(freqBuf);
    updateVUMeters(lTimeBuf, rTimeBuf);
  }
  draw();
}

// ─── Circular Visualizer ─────────────────────────────────────────────────────
function drawCircularVisualizer(timeBuf, freqBuf) {
  const w = vizCanvas.width;
  const h = vizCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.33;

  // Background
  vizCtx.clearRect(0, 0, w, h);

  // Glow background circle
  const grad = vizCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, 'rgba(0,229,255,0.06)');
  grad.addColorStop(0.7, 'rgba(0,229,255,0.02)');
  grad.addColorStop(1, 'transparent');
  vizCtx.fillStyle = grad;
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  vizCtx.fill();

  // Frequency bars around circle
  const barCount = 128;
  const step = Math.floor(freqBuf.length / barCount);
  const maxBarH = radius * 0.55;

  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const val   = freqBuf[i * step] / 255;
    const barH  = val * maxBarH;

    const x1 = cx + Math.cos(angle) * radius;
    const y1 = cy + Math.sin(angle) * radius;
    const x2 = cx + Math.cos(angle) * (radius + barH);
    const y2 = cy + Math.sin(angle) * (radius + barH);

    // Color based on frequency energy
    const hue = 180 + val * 80; // cyan to purple range
    const alpha = 0.5 + val * 0.5;
    vizCtx.strokeStyle = `hsla(${hue},100%,65%,${alpha})`;
    vizCtx.lineWidth = 2.5;
    vizCtx.shadowColor = `hsla(${hue},100%,65%,0.8)`;
    vizCtx.shadowBlur  = 6 + val * 10;

    vizCtx.beginPath();
    vizCtx.moveTo(x1, y1);
    vizCtx.lineTo(x2, y2);
    vizCtx.stroke();
  }
  vizCtx.shadowBlur = 0;

  // Inner waveform ring
  vizCtx.beginPath();
  vizCtx.strokeStyle = 'rgba(0,229,255,0.4)';
  vizCtx.lineWidth = 1.5;
  const waveRad = radius * 0.72;
  for (let i = 0; i < timeBuf.length; i += 4) {
    const angle = (i / timeBuf.length) * Math.PI * 2 - Math.PI / 2;
    const norm  = (timeBuf[i] - 128) / 128;
    const r     = waveRad + norm * waveRad * 0.25;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) vizCtx.moveTo(x, y);
    else vizCtx.lineTo(x, y);
  }
  vizCtx.closePath();
  vizCtx.stroke();

  // Peak dB display
  let peak = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = Math.abs(timeBuf[i] - 128);
    if (v > peak) peak = v;
  }
  const dBval = peak > 0 ? 20 * Math.log10(peak / 128) : -Infinity;
  els.centerDb.textContent = isFinite(dBval) ? dBval.toFixed(1) + ' dB' : '— dB';
}

// ─── Waveform ─────────────────────────────────────────────────────────────────
function drawWaveform(buf) {
  const W = waveCanvas.offsetWidth;
  const H = waveCanvas.offsetHeight;
  waveCtx.clearRect(0, 0, W, H);

  // Grid line
  waveCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  waveCtx.lineWidth = 1;
  waveCtx.beginPath();
  waveCtx.moveTo(0, H / 2);
  waveCtx.lineTo(W, H / 2);
  waveCtx.stroke();

  // Waveform
  const grad = waveCtx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   'rgba(0,229,255,0.8)');
  grad.addColorStop(0.5, 'rgba(199,125,255,0.9)');
  grad.addColorStop(1,   'rgba(0,229,255,0.8)');
  waveCtx.strokeStyle = grad;
  waveCtx.lineWidth = 1.8;
  waveCtx.shadowColor = 'rgba(0,229,255,0.4)';
  waveCtx.shadowBlur = 4;

  waveCtx.beginPath();
  const sliceW = W / buf.length;
  let x = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] / 255;
    const y = v * H;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
    x += sliceW;
  }
  waveCtx.stroke();
  waveCtx.shadowBlur = 0;
}

// ─── Spectrum Analyzer ────────────────────────────────────────────────────────
function drawSpectrum(buf) {
  const W = specCanvas.offsetWidth;
  const H = specCanvas.offsetHeight;
  specCtx.clearRect(0, 0, W, H);

  const barW  = W / (buf.length / 2);
  const bands = Math.floor(buf.length / 2);

  for (let i = 0; i < bands; i++) {
    const val = buf[i] / 255;
    const barH = val * H;
    const x = i * barW;

    const hue = 180 + (i / bands) * 80;
    const alpha = 0.6 + val * 0.4;
    specCtx.fillStyle = `hsla(${hue},90%,60%,${alpha})`;
    specCtx.shadowColor = `hsla(${hue},100%,70%,0.5)`;
    specCtx.shadowBlur  = val > 0.5 ? 4 : 0;
    specCtx.fillRect(x, H - barH, Math.max(barW - 0.5, 1), barH);
  }
  specCtx.shadowBlur = 0;
}

// ─── VU Meters ────────────────────────────────────────────────────────────────
function updateVUMeters(lBuf, rBuf) {
  function rms(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  const rmsL = rms(lBuf);
  const rmsR = rms(rBuf);
  const dbL  = rmsL > 0 ? 20 * Math.log10(rmsL) : -Infinity;
  const dbR  = rmsR > 0 ? 20 * Math.log10(rmsR) : -Infinity;

  // Map dB (-60 to 0) to percentage
  const pct = db => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

  els.vuLeft.style.height  = pct(dbL)  + '%';
  els.vuRight.style.height = pct(dbR)  + '%';
  els.dbLeft.textContent   = isFinite(dbL) ? dbL.toFixed(1) + ' dB' : '-∞';
  els.dbRight.textContent  = isFinite(dbR) ? dbR.toFixed(1) + ' dB' : '-∞';

  // Peak hold
  if (dbL > state.peakL) { state.peakL = dbL; els.peakL.textContent = dbL.toFixed(1) + ' dB'; }
  if (dbR > state.peakR) { state.peakR = dbR; els.peakR.textContent = dbR.toFixed(1) + ' dB'; }
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
els.btnToggle.addEventListener('click', async () => {
  if (state.isRunning) await stopMonitoring();
  else await startMonitoring();
});

els.inputVolume.addEventListener('input', e => {
  const v = parseInt(e.target.value);
  els.inputGainVal.textContent = v + '%';
  if (state.gainNode) state.gainNode.gain.setTargetAtTime(v / 100, state.audioCtx.currentTime, 0.01);
});

els.outputVolume.addEventListener('input', e => {
  const v = parseInt(e.target.value);
  els.outputVolVal.textContent = v + '%';
  if (state.outputGainNode) state.outputGainNode.gain.setTargetAtTime(v / 100, state.audioCtx.currentTime, 0.01);
});

els.btnMuteInput.addEventListener('click', () => {
  state.inputMuted = !state.inputMuted;
  if (state.gainNode) {
    state.gainNode.gain.setTargetAtTime(
      state.inputMuted ? 0 : parseFloat(els.inputVolume.value) / 100,
      state.audioCtx.currentTime, 0.01
    );
  }
  els.btnMuteInput.classList.toggle('muted', state.inputMuted);
  showToast(state.inputMuted ? '🔇 Input dimute' : '🎙 Input aktif');
});

els.btnMuteOutput.addEventListener('click', () => {
  state.outputMuted = !state.outputMuted;
  if (state.outputGainNode) {
    state.outputGainNode.gain.setTargetAtTime(
      state.outputMuted ? 0 : parseFloat(els.outputVolume.value) / 100,
      state.audioCtx.currentTime, 0.01
    );
  }
  els.btnMuteOutput.classList.toggle('muted', state.outputMuted);
  showToast(state.outputMuted ? '🔇 Output dimute' : '🔊 Output aktif');
});

els.btnResetPeak.addEventListener('click', () => {
  state.peakL = -Infinity;
  state.peakR = -Infinity;
  els.peakL.textContent = '—';
  els.peakR.textContent = '—';
  showToast('↺ Peak direset');
});

els.echoCancelToggle.addEventListener('change', e => {
  e.target.parentElement.querySelector('.toggle-label').textContent = e.target.checked ? 'On' : 'Off';
});
els.noiseSuppToggle.addEventListener('change', e => {
  e.target.parentElement.querySelector('.toggle-label').textContent = e.target.checked ? 'On' : 'Off';
});

// Refresh button
els.btnRefresh.addEventListener('click', () => enumerateDevices(true));

// Auto-update device list when user plugs/unplugs hardware
if (navigator.mediaDevices.ondevicechange !== undefined) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    console.log('[AudioMonitor] Device change detected — refreshing list');
    showToast('🔄 Perangkat audio berubah — memperbarui daftar…');
    enumerateDevices(true);
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────
enumerateDevices();

# AudioMonitor 🎧

**Aplikasi monitoring audio real-time** — dengarkan soundcard input langsung ke speaker, lengkap dengan visualizer, VU meter stereo, dan spectrum analyzer.

## 🌐 Live Demo
> [audiomonitor.github.io](https://USERNAME.github.io/audio-monitor/)

## ✨ Fitur
- 🎙 **Pass-through Real-time** — audio dari soundcard/mikrofon langsung ke speaker
- 📡 **Multi Device** — dropdown pilih semua audio input (Stereo Mix, Mic, Line In)
- 🎚 **Input Gain & Output Volume** — kontrol terpisah 0–200%
- 🔵 **Circular Visualizer** — frekuensi bar + waveform melingkar real-time
- 📊 **Spectrum Analyzer** — analisis 20Hz – 20kHz
- 📏 **VU Meter Stereo L/R** — dengan Peak Hold
- ⚡ **Low Latency Mode** — dioptimalkan untuk latency minimum
- 🎛 **Echo Cancel & Noise Suppression** — toggle on/off

## 🚀 Cara Pakai
1. Buka web → izinkan akses mikrofon di browser
2. Pilih sumber audio (Stereo Mix / Mic / Line In)
3. Klik **START** — audio langsung keluar ke speaker

## 🔧 Windows — Aktifkan Stereo Mix
1. Klik kanan 🔊 di taskbar → Sound settings
2. Buka Control Panel Sound → tab Recording
3. Klik kanan area kosong → Show Disabled Devices
4. Klik kanan **Stereo Mix** → Enable
5. Klik Refresh di aplikasi

## 🛠 Tech Stack
- Pure HTML + CSS + JavaScript
- Web Audio API (tanpa library eksternal)
- Dark glassmorphism UI dengan animasi real-time

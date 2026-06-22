# Voice Recorder

A local-first browser voice recorder. No cloud, no account, no `npm install`. Recordings save directly to disk.

> Single-file Node.js server + full UI — just `node recorder-server.js` and you're recording.

---

## Features

- **Record, pause, resume, stop** with live animated waveform
- **Markers** — drop a timestamp mid-recording with `Ctrl+M`; markers appear as dots on the seek bar during playback
- **Recording library** — browse, search, and play back past recordings from the sidebar
- **Playback controls** — seek bar, speed selector (0.25× – 4×), per-recording markers
- **Microphone selector** — switch input device without reloading
- **Rename / Delete** — inline rename (`F2`) and delete (`Del`) from the sidebar
- **Settings panel** — configure save folder, filename prefix, and port from inside the app (`Ctrl+,`)
- **Show in folder** — opens the recordings directory in your file manager
- **Collapsible sidebar** — auto-collapses while recording, re-opens on save
- **Zero dependencies** — uses only Node.js built-ins
- **Cross-platform** — Windows, macOS, Linux

---

## Quick Start

**Requirements:** [Node.js](https://nodejs.org) 14 or later (no other dependencies).

```bash
# clone or download the repo, then:
node recorder-server.js
```

Open [http://localhost:3131](http://localhost:3131) in your browser and hit the red button.

### Windows launcher

Double-click **`Run Recorder.cmd`** — starts the server and opens the browser automatically.

---

## Settings

Click the **gear icon** (top-right of the recorder) or press `Ctrl+,` to open Settings.

| Setting | Default | Description |
|---|---|---|
| Save folder | `./recordings` | Where audio files are saved. Relative to `recorder-server.js`, or an absolute path. |
| Filename prefix | `Recording` | Files are named `Prefix (1).webm`, `Prefix (2).webm`, … |
| Port | `3131` | HTTP port. Restart the server after changing. |

Settings are persisted to `settings.json` next to the server file (gitignored by default).

You can also set these via environment variables at startup, which takes precedence over `settings.json`:

```bash
RECORDINGS_DIR="/home/user/audio" PORT=8080 node recorder-server.js
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+R` | Start recording |
| `Space` | Pause / Resume recording (or play/pause in playback) |
| `Esc` | Stop recording |
| `Ctrl+M` | Drop a marker at the current timestamp |
| `Ctrl+,` | Open Settings |
| `F2` | Rename selected recording |
| `Del` | Delete selected recording |
| `← / →` | Seek ±1 s during playback |

---

## File Layout

```
recorder-server.js    — Node server + full UI (single file, zero dependencies)
recorder.py           — Optional standalone desktop recorder (Python + tkinter)
package.json          — npm metadata (start script only; no dependencies)
Run Recorder.cmd      — Windows one-click launcher
recordings/           — Saved .webm files land here (gitignored)
settings.json         — Your local settings (auto-created, gitignored)
```

Each recording also gets a `.meta.json` sidecar (duration + markers) stored alongside the audio file.

### Audio format

Recordings are saved as `.webm` (WebM/Opus) — the format browsers record natively, so no conversion or extra tools are needed. WebM is playable in all modern browsers, VLC, ffmpeg, and most media players. To convert to MP3/WAV, run:

```bash
ffmpeg -i "Recording (1).webm" "Recording (1).mp3"
```

---

## Desktop recorder (Python)

`recorder.py` is a lightweight alternative that uses Python's `sounddevice` and `tkinter` to record directly from the OS microphone and save as WAV — no browser needed.

```bash
pip install sounddevice numpy
python recorder.py
```

Recordings are saved to a `recordings/` folder next to the script.

---

## Contributing

Pull requests welcome. The entire web UI lives inside `recorder-server.js` as a template literal — no build step, no bundler. Keep it that way.

- Bug fixes and usability improvements are always welcome
- New features should be opt-in or behind settings; don't increase complexity by default

---

## License

MIT

# Voice Recorder

A clean, local-first voice recorder that runs entirely in your browser. **No account, no install, no cloud** — your audio never leaves your device. Record, play back, mark, rename, and download, all from a single page.

### ▶ [**Open the app →**](https://nsoxbekdn.github.io/voice-recorder/)

> Hosted on GitHub Pages. It's just one `index.html` file — nothing is uploaded anywhere, and recordings are stored locally in your browser.

---

## What it does

Hit the red button and talk. Recordings are saved **in your browser** (IndexedDB) so they're still there when you come back, and you can download any of them as a file whenever you want. Great for study notes, voice memos, practice takes, and quick audio capture.

| | |
|---|---|
| 🎙️ **Record / pause / resume / stop** | with a live animated waveform |
| 📚 **Recording library** | browse, search, and replay everything you've recorded, from the sidebar |
| 📍 **Markers** | drop a timestamp mid-recording (`Ctrl+M`); markers show as dots on the seek bar |
| ⏯️ **Playback controls** | scrubbable seek bar + speed selector (0.5× – 4×) |
| 🎚️ **Microphone picker** | choose any connected input — list updates live when you plug/unplug a device |
| ✏️ **Rename / delete** | inline rename (`F2`) and delete (`Del`) from the sidebar |
| ⬇️ **Download** | export any recording as **WebM** or **WAV** (converted in-browser, no tools needed) |
| 🌙 **Auto-stop on silence** | optionally end the recording after 10 / 30 / 60 s of quiet |
| 🎨 **Custom accent color** | pick any hex color and the whole app re-themes to match |
| 💾 **Persistent & private** | everything stays in your browser — nothing is sent to a server |

---

## Settings

Open the **gear icon** (top-right) to configure:

| Setting | Options | What it does |
|---|---|---|
| **Accent color** | any hex / color picker | Re-skins the entire app to your color |
| **Download format** | WebM · WAV | Format used when you download. WAV is lossless but larger (converted in-browser) |
| **Recording quality** | High 192 kbps · Medium 96 kbps · Low 32 kbps | Bitrate of the captured audio |
| **Channels** | Mono · Stereo | Mono is recommended for voice — half the size, no quality loss |
| **Default playback speed** | 0.5× – 2× | Speed new playbacks start at |
| **Auto-stop on silence** | Off · 10 / 30 / 60 s | Automatically stop recording after a period of quiet |
| **Filename prefix** | text | Prefix for downloaded files, e.g. `Recording (1).webm` |

Settings persist locally in your browser.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+R` | Start recording |
| `Space` | Pause / resume (or play / pause during playback) |
| `Esc` | Stop recording |
| `Ctrl+M` | Drop a marker at the current timestamp |
| `F2` | Rename selected recording |
| `Del` | Delete selected recording |
| `← / →` | Seek ±1 s during playback |

---

## Run it yourself

It's a single static file. Any of these work:

- **Easiest:** use the [hosted version](https://nsoxbekdn.github.io/voice-recorder/).
- **Local:** download `index.html` and open it in your browser (or serve the folder with any static server, e.g. `python -m http.server`).
- **Your own GitHub Pages:** fork this repo and enable Pages on the `master` branch — your copy lives at `https://<you>.github.io/voice-recorder/`.

> Microphone access requires a secure context. `https://` (GitHub Pages) and `http://localhost` both qualify; opening the file directly as `file://` works in most browsers too.

---

## Optional: save-to-disk versions

The browser app keeps recordings in the browser. If you'd rather have audio written **straight to a folder on disk**, the repo also ships two zero-/low-dependency alternatives:

- **`recorder-server.js`** — a single-file Node.js server (no `npm install`) with the same UI that saves `.webm` files to a `recordings/` folder. Run `node recorder-server.js` and open `http://localhost:3131`. Windows users can double-click **`Run Recorder.cmd`**.
- **`recorder.py`** — a lightweight Python + `tkinter` desktop recorder that captures from the OS mic and saves WAV. `pip install sounddevice numpy && python recorder.py`.

Both are optional — the browser app needs neither.

---

## Contributing

PRs welcome. The browser app is one self-contained `index.html` — no build step, no bundler, no dependencies. Keep it that way.

- Bug fixes and usability improvements are always welcome.
- New features should be opt-in or behind a setting; don't add complexity to the default path.

---

## License

[MIT](LICENSE)

# Voice Recorder

A local-first browser-based voice recorder. No cloud, no account, no install beyond Node.js. Recordings save directly to disk as `.webm` files.

![recorder ui](https://i.imgur.com/placeholder.png)

## Features

- Record, pause, resume, stop
- Live waveform visualisation
- **Recording library** — browse, search, and play back past recordings
- **Playback controls** — seek bar, speed control (0.25× – 4×), per-recording markers
- **Markers** — press `Ctrl+M` during recording to drop a timestamp; markers appear as dots on the seek bar during playback
- **Microphone selector** — switch input device without reloading
- **Rename / Delete** — inline rename (F2) and delete (Del) from the sidebar
- **Show in folder** — opens the recordings directory in Explorer
- Collapsible sidebar — auto-collapses during recording, re-opens on save
- Keyboard shortcuts: `Ctrl+R` record, `Space` pause/resume, `Esc` stop, `Ctrl+M` mark, `←/→` seek, `F2` rename, `Del` delete

## Requirements

- [Node.js](https://nodejs.org) (any modern version)

No npm install needed. The server uses only Node built-ins.

## Usage

### Windows

Double-click **`Run Recorder.cmd`**. It starts the server and opens `http://localhost:3131` in your browser.

### Any platform

```bash
node recorder-server.js
```

Then open [http://localhost:3131](http://localhost:3131).

### Custom recordings directory

By default recordings save to a `recordings/` folder next to `recorder-server.js`. Override with an environment variable:

```bash
RECORDINGS_DIR="D:\My Recordings" node recorder-server.js
```

## File layout

```
recorder-server.js    — Node server + full UI (single file, no dependencies)
Run Recorder.cmd      — Windows launcher shortcut
recordings/           — saved .webm files land here (gitignored)
```

Each recording also gets a `.meta.json` sidecar (duration + markers), stored alongside the audio file.

## Study notes pipeline (optional)

`study-notes.ps1` and `Run Study Notes.cmd` are a separate personal pipeline that transcribes recordings via [Buzz CLI](https://github.com/chidiwilliams/buzz) (faster-whisper) and feeds transcripts to Claude for note-writing. They are included for reference but require additional setup (Buzz, Claude CLI, a configured vault path).

## License

MIT

import tkinter as tk
import threading
import wave
import time
import collections
import datetime
import os
import sounddevice as sd
import numpy as np

SAVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recordings')
SAMPLE_RATE = 44100
CHANNELS = 1
CHUNK = 1024
WAVE_COLS = 126   # bars visible in waveform area

os.makedirs(SAVE_DIR, exist_ok=True)

# ── palette (Windows 11 Sound Recorder dark) ──────────────────────────────
BG          = "#202020"
WAVE_ACCENT = "#60cdff"   # Windows system blue
WAVE_IDLE   = "#3a3a3a"
REC_FILL    = "#c42b1c"
REC_HOVER   = "#d74133"
BTN_FILL    = "#363636"
BTN_HOVER   = "#484848"
BTN_PRESS   = "#2a2a2a"
TXT_PRI     = "#ffffff"
TXT_SEC     = "#9d9d9d"


# ── Audio backend ──────────────────────────────────────────────────────────
class Recorder:
    def __init__(self):
        self._frames = []
        self._lock = threading.Lock()
        self._stream = None
        self.is_recording = False
        self.is_paused = False
        self.latest_chunk = np.zeros(CHUNK, dtype=np.float32)

    def _callback(self, indata, frames, time_info, status):
        data = indata[:, 0].copy()
        self.latest_chunk = data
        if self.is_recording and not self.is_paused:
            with self._lock:
                self._frames.append((data * 32767).astype(np.int16).tobytes())

    def start(self):
        self._frames = []
        self.is_recording = True
        self.is_paused = False
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=CHANNELS,
            dtype="float32", blocksize=CHUNK, callback=self._callback,
        )
        self._stream.start()

    def pause(self):
        self.is_paused = True

    def resume(self):
        self.is_paused = False

    def stop(self):
        self.is_recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def save(self, filepath):
        with self._lock:
            frames = list(self._frames)
        with wave.open(filepath, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(b"".join(frames))


# ── Circular canvas button ─────────────────────────────────────────────────
class CircleBtn:
    def __init__(self, canvas, cx, cy, r, fill, hover, label, font, cmd):
        self._c = canvas
        self._cx, self._cy, self._r = cx, cy, r
        self._fill, self._hover = fill, hover
        self._cmd = cmd
        self._enabled = True

        self._oval = canvas.create_oval(
            cx - r, cy - r, cx + r, cy + r, fill=fill, outline="", state="hidden"
        )
        self._txt = canvas.create_text(
            cx, cy, text=label, font=font, fill=TXT_PRI, state="hidden"
        )
        for tag in (self._oval, self._txt):
            canvas.tag_bind(tag, "<Enter>", self._enter)
            canvas.tag_bind(tag, "<Leave>", self._leave)
            canvas.tag_bind(tag, "<ButtonPress-1>", self._press)
            canvas.tag_bind(tag, "<ButtonRelease-1>", self._release)

    def show(self):
        self._c.itemconfig(self._oval, state="normal")
        self._c.itemconfig(self._txt, state="normal")

    def hide(self):
        self._c.itemconfig(self._oval, state="hidden")
        self._c.itemconfig(self._txt, state="hidden")

    def set_label(self, text):
        self._c.itemconfig(self._txt, text=text)

    def set_enabled(self, on):
        self._enabled = on
        dim = "#2c2c2c" if not on else self._fill
        self._c.itemconfig(self._oval, fill=dim)
        self._c.itemconfig(self._txt, fill=TXT_SEC if not on else TXT_PRI)

    def _enter(self, _):
        if self._enabled:
            self._c.itemconfig(self._oval, fill=self._hover)
            self._c.config(cursor="hand2")

    def _leave(self, _):
        if self._enabled:
            self._c.itemconfig(self._oval, fill=self._fill)
        self._c.config(cursor="")

    def _press(self, _):
        if self._enabled:
            self._c.itemconfig(self._oval, fill=BTN_PRESS)

    def _release(self, _):
        if self._enabled:
            self._c.itemconfig(self._oval, fill=self._hover)
            self._cmd()


# ── Main window ────────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Sound Recorder")
        self.resizable(False, False)
        self.configure(bg=BG)
        self.geometry("400x490")

        self._recorder = Recorder()
        self._start_time = None
        self._elapsed_at_pause = 0.0
        self._timer_running = False
        self._wave_buf = collections.deque([0.0] * WAVE_COLS, maxlen=WAVE_COLS)
        self._blink_on = True

        self._build_ui()
        self._update_waveform()
        self._blink()

    # ── Layout ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header row
        hdr = tk.Frame(self, bg=BG)
        hdr.pack(fill="x", padx=22, pady=(18, 0))
        tk.Label(hdr, text="Sound Recorder", font=("Segoe UI", 10),
                 bg=BG, fg=TXT_SEC).pack(side="left")
        self._rec_dot = tk.Label(hdr, text="⬤  REC", font=("Segoe UI", 9, "bold"),
                                 bg=BG, fg=REC_FILL)
        # packed dynamically when recording starts

        # Waveform
        self._wave_cv = tk.Canvas(self, width=380, height=110, bg=BG, highlightthickness=0)
        self._wave_cv.pack(padx=10, pady=(14, 0))
        self._draw_idle_wave()

        # Timer  (hidden until recording)
        self._timer_var = tk.StringVar(value="")
        self._timer_lbl = tk.Label(
            self, textvariable=self._timer_var,
            font=("Segoe UI", 54, "bold"), bg=BG, fg=TXT_PRI,
        )
        self._timer_lbl.pack(pady=(6, 0))

        # Status line
        self._status_var = tk.StringVar(value="New recording")
        tk.Label(self, textvariable=self._status_var,
                 font=("Segoe UI", 10), bg=BG, fg=TXT_SEC).pack(pady=(2, 0))

        # Button canvas  (record + pause + stop live here)
        self._btn_cv = tk.Canvas(self, width=400, height=150, bg=BG, highlightthickness=0)
        self._btn_cv.pack(pady=(4, 0))

        # Record button — large red circle, center
        self._btn_rec = CircleBtn(
            self._btn_cv, 200, 75, 48,
            fill=REC_FILL, hover=REC_HOVER,
            label="⬤", font=("Segoe UI", 26), cmd=self._on_record,
        )
        self._btn_rec.show()

        # Pause button — left, appears during recording
        self._btn_pause = CircleBtn(
            self._btn_cv, 130, 75, 34,
            fill=BTN_FILL, hover=BTN_HOVER,
            label="⏸", font=("Segoe UI", 17), cmd=self._on_pause,
        )

        # Stop button — right, appears during recording
        self._btn_stop = CircleBtn(
            self._btn_cv, 270, 75, 34,
            fill=BTN_FILL, hover=BTN_HOVER,
            label="⬛", font=("Segoe UI", 14), cmd=self._on_stop,
        )

        # Saved notification
        self._saved_var = tk.StringVar(value="")
        tk.Label(self, textvariable=self._saved_var,
                 font=("Segoe UI", 9), bg=BG, fg=TXT_SEC).pack(pady=(0, 6))

    # ── Button actions ───────────────────────────────────────────────────────
    def _on_record(self):
        self._recorder.start()
        self._start_time = time.monotonic()
        self._elapsed_at_pause = 0.0
        self._timer_running = True
        self._tick()

        self._btn_rec.hide()
        self._btn_pause.show()
        self._btn_stop.show()
        self._rec_dot.pack(side="right")
        self._status_var.set("Recording")
        self._saved_var.set("")

    def _on_pause(self):
        if not self._recorder.is_paused:
            self._recorder.pause()
            self._elapsed_at_pause += time.monotonic() - self._start_time
            self._timer_running = False
            self._btn_pause.set_label("▶")
            self._status_var.set("Paused")
        else:
            self._recorder.resume()
            self._start_time = time.monotonic()
            self._timer_running = True
            self._tick()
            self._btn_pause.set_label("⏸")
            self._status_var.set("Recording")

    def _on_stop(self):
        self._recorder.stop()
        self._timer_running = False
        fname = datetime.datetime.now().strftime("Recording %Y-%m-%d %H-%M-%S.wav")
        fpath = os.path.join(SAVE_DIR, fname)
        threading.Thread(target=self._save_async, args=(fpath, fname), daemon=True).start()

        self._btn_pause.hide()
        self._btn_stop.hide()
        self._btn_rec.show()
        self._btn_pause.set_label("⏸")   # reset for next use
        self._rec_dot.pack_forget()
        self._timer_var.set("")
        self._status_var.set("Saving…")
        self._wave_buf = collections.deque([0.0] * WAVE_COLS, maxlen=WAVE_COLS)

    def _save_async(self, fpath, fname):
        self._recorder.save(fpath)
        self.after(0, lambda: self._status_var.set("New recording"))
        self.after(0, lambda: self._saved_var.set(f"Saved  ·  {fname}"))

    # ── Timer ────────────────────────────────────────────────────────────────
    def _tick(self):
        if not self._timer_running:
            return
        elapsed = self._elapsed_at_pause + (time.monotonic() - self._start_time)
        h = int(elapsed) // 3600
        m = (int(elapsed) % 3600) // 60
        s = int(elapsed) % 60
        self._timer_var.set(f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}")
        self.after(500, self._tick)

    # ── REC dot blink ────────────────────────────────────────────────────────
    def _blink(self):
        if self._recorder.is_recording and not self._recorder.is_paused:
            self._blink_on = not self._blink_on
            self._rec_dot.config(fg=REC_FILL if self._blink_on else BG)
        else:
            self._blink_on = True
            self._rec_dot.config(fg=REC_FILL)
        self.after(700, self._blink)

    # ── Waveform ─────────────────────────────────────────────────────────────
    def _update_waveform(self):
        if self._recorder.is_recording and not self._recorder.is_paused:
            chunk = self._recorder.latest_chunk
            rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
            amp = min(rms * 9.0, 1.0)
        else:
            amp = 0.0
        self._wave_buf.append(amp)
        self._draw_waveform()
        self.after(33, self._update_waveform)

    def _draw_idle_wave(self):
        c = self._wave_cv
        c.delete("all")
        c.create_line(20, 55, 360, 55, fill=WAVE_IDLE, width=1)

    def _draw_waveform(self):
        c = self._wave_cv
        c.delete("all")
        W, H = 380, 110
        mid = H / 2
        active = self._recorder.is_recording and not self._recorder.is_paused

        if not active and max(self._wave_buf) < 0.01:
            c.create_line(20, mid, W - 20, mid, fill=WAVE_IDLE, width=1)
            return

        BAR_W = 2
        GAP   = 1
        STEP  = BAR_W + GAP
        x_start = (W - WAVE_COLS * STEP) / 2
        color = WAVE_ACCENT if active else WAVE_IDLE

        for i, amp in enumerate(self._wave_buf):
            x = x_start + i * STEP
            bh = max(1.5, amp * (mid - 8))
            # body
            c.create_rectangle(x, mid - bh, x + BAR_W, mid + bh, fill=color, outline="")
            # rounded caps (small ovals at top and bottom)
            if bh > 3:
                c.create_oval(x, mid - bh - 1, x + BAR_W, mid - bh + 1, fill=color, outline="")
                c.create_oval(x, mid + bh - 1, x + BAR_W, mid + bh + 1, fill=color, outline="")


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

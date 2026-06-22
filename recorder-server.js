'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

// ── settings ──────────────────────────────────────────────────────────────────
const SETTINGS_FILE    = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = { recordingsDir: './recordings', filenamePrefix: 'Recording', port: 3131 };

function loadSettings() {
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); }
  catch (_) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }

var settings = loadSettings();

function resolveDir(d) { return path.isAbsolute(d) ? d : path.resolve(__dirname, d); }

var RECORDINGS_DIR = resolveDir(process.env.RECORDINGS_DIR || settings.recordingsDir);
var PORT           = parseInt(process.env.PORT || settings.port || DEFAULT_SETTINGS.port, 10);

// ── helpers ───────────────────────────────────────────────────────────────────
function readBody(req, cb) {
  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end',  function()  { cb(Buffer.concat(chunks)); });
}
function jsonBody(req, cb) {
  readBody(req, function(buf) {
    try { cb(null, JSON.parse(buf.toString())); } catch(e) { cb(e); }
  });
}
function safeName(n) { return path.basename(String(n || '')); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── recordings list ───────────────────────────────────────────────────────────
function getRecordings() {
  try {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    return fs.readdirSync(RECORDINGS_DIR)
      .filter(function(f) { return /\.(webm|wav|mp3|m4a|ogg)$/i.test(f); })
      .map(function(f) {
        var fp   = path.join(RECORDINGS_DIR, f);
        var stat = fs.statSync(fp);
        var meta = {};
        try { meta = JSON.parse(fs.readFileSync(fp + '.meta.json', 'utf8')); } catch (_) {}
        return { name: f, size: stat.size, mtime: stat.mtimeMs,
                 duration: meta.duration || null, markers: meta.markers || [] };
      })
      .sort(function(a, b) { return b.mtime - a.mtime; });
  } catch (_) { return []; }
}

// ── svg assets ────────────────────────────────────────────────────────────────
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 1C9.239 1 7 3.239 7 6v7a5 5 0 0 0 10 0V6c0-2.761-2.239-5-5-5z" fill="white"/>
  <path d="M3.5 12a8.5 8.5 0 0 0 17 0"
        stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <path d="M12 20.5v3"  stroke="white" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M8.5 23.5h7" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

// ── HTML ──────────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recorder</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --wave:    #c4b5fd;
  --text:    #f0eeff;
  --muted:   #5c577a;
  --muted2:  #8a84b0;
  --red:     #e5383b;
  --green:   #34d399;
  --btn:     #12112a;
  --btn-h:   #1e1c3a;
  --border:  rgba(255,255,255,0.08);
  --panel:   rgba(255,255,255,0.022);
  --pborder: rgba(255,255,255,0.08);
}

html, body { width:100%; height:100%; overflow:hidden; }
body {
  background: radial-gradient(ellipse 85% 55% at 50% 28%, #1a1142 0%, #07060d 68%);
  color: var(--text);
  font-family: 'Segoe UI Variable','Segoe UI',system-ui,sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column;
}

/* ── two-column layout ── */
.app { display:flex; flex:1; overflow:hidden; min-height:0; }

/* ── library panel ── */
.library {
  width: 252px; flex-shrink:0;
  border-right: 1px solid var(--pborder);
  background: var(--panel);
  display: flex; flex-direction:column; overflow:hidden;
  transition: width .26s var(--ease-out), border-color .26s;
}
.library.collapsed { width: 0; border-right-color: transparent; }
.library.collapsed > * { opacity: 0; pointer-events: none; transition: opacity .08s; }
.library > * { transition: opacity .2s .08s; }

.lib-hdr {
  padding: 18px 14px 8px;
  font-size: 9px; font-weight:700;
  letter-spacing:.2em; text-transform:uppercase;
  color: rgba(196,181,253,0.55);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.lib-hdr-count {
  font-size: 9px; font-weight: 400; letter-spacing: 0;
  text-transform: none; color: var(--muted); margin-left: 6px;
}
.lib-toggle {
  width: 22px; height: 22px; flex-shrink: 0;
  border: 1px solid rgba(196,181,253,0.2);
  background: rgba(196,181,253,0.08);
  color: rgba(196,181,253,0.7);
  cursor: pointer; border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s, color .15s;
}
.lib-toggle:hover {
  background: rgba(196,181,253,0.16);
  border-color: rgba(196,181,253,0.4);
  color: #c4b5fd;
}
.lib-toggle:focus-visible { outline: 2px solid rgba(196,181,253,0.55); outline-offset: 2px; }

/* expand tab */
.lib-show-btn {
  position: absolute; top: 50%; left: 0;
  transform: translateY(-50%);
  width: 20px; height: 48px;
  border: none; border-radius: 0 7px 7px 0;
  background: #13112b;
  border-top: 1px solid rgba(196,181,253,0.24);
  border-right: 1px solid rgba(196,181,253,0.24);
  border-bottom: 1px solid rgba(196,181,253,0.24);
  color: rgba(196,181,253,0.65);
  cursor: pointer;
  display: none; align-items: center; justify-content: center;
  transition: background .18s, color .18s, box-shadow .18s;
  box-shadow: 2px 0 14px rgba(196,181,253,0.07);
  z-index: 10;
}
.lib-show-btn:hover { background: #1c1940; color: #c4b5fd; box-shadow: 2px 0 20px rgba(196,181,253,0.15); }
.lib-show-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.55); outline-offset: 2px; }
.lib-show-btn.visible { display: flex; }

/* ── search ── */
.search-wrap { padding: 0 10px 8px; flex-shrink: 0; }
.search-input {
  width: 100%;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--pborder);
  border-radius: 8px;
  color: var(--text); font-size: 12px;
  padding: 6px 10px; outline: none;
  transition: border-color .18s, box-shadow .18s;
}
.search-input::placeholder { color: var(--muted); }
.search-input:focus { border-color: rgba(196,181,253,.4); box-shadow: 0 0 0 3px rgba(196,181,253,.07); }

/* ── recording list ── */
.rec-list { flex: 1; overflow-y: auto; list-style: none; padding: 0 5px 60px; }
.rec-list::-webkit-scrollbar { width: 3px; }
.rec-list::-webkit-scrollbar-thumb { background: rgba(196,181,253,0.2); border-radius: 2px; }

.rec-item {
  padding: 8px 9px; border-radius: 8px;
  cursor: pointer; position: relative;
  display: flex; flex-direction: column; gap: 3px;
  transition: background .15s, transform .15s var(--ease-out);
  transform: translateX(0);
}
.rec-item:hover  { background: rgba(255,255,255,.06); transform: translateX(2px); }
.rec-item.active { background: rgba(196,181,253,.1);  transform: translateX(2px); }
.rec-item:focus-visible { outline: 2px solid rgba(196,181,253,0.45); outline-offset: -2px; }

.rec-name {
  font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 175px; transition: color .15s;
}
.rec-item.active .rec-name { color: var(--wave); }

.rec-name-input {
  font-size: 12px; font-weight: 500;
  background: rgba(255,255,255,.1);
  border: 1px solid rgba(196,181,253,.45);
  border-radius: 4px; color: var(--text);
  outline: none; padding: 1px 5px; width: 100%;
}
.rec-name-input:focus { border-color: rgba(196,181,253,.7); box-shadow: 0 0 0 2px rgba(196,181,253,.1); }

.rec-meta { font-size: 10px; color: var(--muted2); display: flex; gap: 8px; }
.rec-meta span + span::before { content: '·'; margin-right: 8px; opacity: 0.4; }

.rec-actions {
  position: absolute; right: 7px; top: 50%;
  transform: translateY(-50%);
  display: none; gap: 3px; align-items: center;
}
.rec-item:hover  .rec-actions,
.rec-item.active .rec-actions { display: flex; }

.ic-btn {
  width: 24px; height: 24px;
  border: none; background: rgba(255,255,255,.07);
  border-radius: 5px; color: var(--muted2);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .13s, color .13s;
}
.ic-btn:hover      { background: rgba(255,255,255,.15); color: var(--text); }
.ic-btn.del:hover  { background: rgba(229,56,59,.2);    color: var(--red); }
.ic-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.5); outline-offset: 1px; }

.rec-empty { text-align: center; padding: 40px 16px; font-size: 12px; color: var(--muted); line-height: 1.7; }
.rec-empty-icon { display: block; margin: 0 auto 10px; opacity: 0.25; }

/* ── recorder panel ── */
.recorder-panel {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  overflow: hidden; position: relative;
}

.header {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 18px 22px;
  display: flex; align-items: center; gap: 9px;
}
.rec-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--red); flex-shrink: 0;
  opacity: 0; transition: opacity .35s;
}
.rec-dot.on { opacity: 1; animation: blink 1.5s ease-in-out infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.15} }

.app-name {
  font-size: 9px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase;
  color: var(--muted);
}
.mic-wrap { margin-left: auto; display: flex; align-items: center; gap: 5px; }
.mic-wrap svg { color: var(--muted2); flex-shrink: 0; }
.mic-sel {
  background: transparent;
  border: 1px solid var(--pborder); border-radius: 6px;
  color: var(--muted2); font-size: 10px;
  padding: 3px 6px; outline: none; cursor: pointer;
  max-width: 145px; transition: border-color .15s, color .15s;
}
.mic-sel:hover  { color: var(--text); border-color: rgba(196,181,253,.25); }
.mic-sel:focus  { border-color: rgba(196,181,253,.4); color: var(--text); }
.mic-sel option { background: #0f0e1a; }

/* ── settings button ── */
.settings-btn {
  width: 28px; height: 28px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.04);
  color: var(--muted2);
  cursor: pointer; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, color .15s, border-color .15s;
  flex-shrink: 0;
}
.settings-btn:hover { background: rgba(255,255,255,0.1); color: var(--text); border-color: rgba(196,181,253,.3); }
.settings-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.55); outline-offset: 2px; }

/* ── waveform ── */
.wave-section {
  width: 100%;
  border-top: 1px solid rgba(255,255,255,.04);
  border-bottom: 1px solid rgba(255,255,255,.04);
  position: relative;
}
.wave-section::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 80% at 50% 50%, rgba(167,139,250,.05) 0%, transparent 70%);
  pointer-events: none;
}
#waveform { display: block; width: 100%; }

/* ── timer ── */
#timer {
  font-size: 82px; font-weight: 100;
  letter-spacing: -.05em; font-variant-numeric: tabular-nums;
  line-height: 1; margin-top: 22px;
  color: var(--text); transition: color .5s;
}
#timer.saved { color: var(--green); }

#status {
  margin-top: 8px; font-size: 10px; font-weight: 600;
  letter-spacing: .18em; text-transform: uppercase;
  color: var(--muted2); min-height: 14px;
  transition: color .25s;
}
#status.rec  { color: var(--red); }
#status.done { color: var(--green); }

/* ── controls ── */
.controls {
  margin-top: 30px;
  display: flex; align-items: center; justify-content: center;
  gap: 18px; min-height: 80px;
}
.btn {
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; outline: none;
  transition: transform .15s var(--ease-out), box-shadow .2s, background .15s;
  -webkit-tap-highlight-color: transparent; position: relative;
}
.btn:hover  { transform: scale(1.07); }
.btn:active { transform: scale(0.92); }
.btn[hidden]{ display: none !important; }
.btn:focus-visible { outline: 2px solid rgba(196,181,253,0.6); outline-offset: 4px; }

#btn-record {
  width: 80px; height: 80px; background: var(--red);
  box-shadow: 0 0 0 1px rgba(229,56,59,.3), 0 8px 32px rgba(229,56,59,.2);
}
#btn-record:hover {
  background: #f04346;
  box-shadow: 0 0 0 1px rgba(229,56,59,.45), 0 10px 44px rgba(229,56,59,.3);
}
#btn-record img { pointer-events: none; }
#btn-record.recording::after {
  content: ''; position: absolute; inset: -10px; border-radius: 50%;
  border: 2px solid rgba(229,56,59,.35);
  animation: ring-pulse 1.8s ease-out infinite;
}
@keyframes ring-pulse {
  0%   { inset: -4px;  opacity: .7; }
  100% { inset: -18px; opacity: 0;  }
}

.btn-sec {
  width: 58px; height: 58px; background: var(--btn);
  color: var(--text); border: 1px solid var(--border);
  box-shadow: 0 2px 12px rgba(0,0,0,.35);
}
.btn-sec:hover { background: var(--btn-h); }
.btn-sec svg   { display: block; }

/* ── markers row ── */
.markers-row {
  margin-top: 12px; display: flex; flex-wrap: wrap;
  gap: 5px; justify-content: center;
  min-height: 18px; max-width: 420px; padding: 0 16px;
}
.marker-chip {
  font-size: 10px; padding: 2px 9px; border-radius: 99px;
  background: rgba(196,181,253,.08);
  border: 1px solid rgba(196,181,253,.2);
  color: var(--wave); font-variant-numeric: tabular-nums;
  cursor: default; letter-spacing: .02em;
}

#filename {
  margin-top: 10px; font-size: 10px;
  font-family: 'Cascadia Code','Consolas',monospace;
  color: var(--muted2); min-height: 13px;
  opacity: 0; transition: opacity .4s;
}
#filename.show { opacity: 1; }

/* ── keyboard hint ── */
.kb-hint {
  position: absolute; bottom: 14px; left: 0; right: 0;
  text-align: center; font-size: 10px;
  color: var(--muted); display: flex;
  align-items: center; justify-content: center; gap: 10px;
  flex-wrap: wrap; padding: 0 16px;
}
kbd {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  border-bottom-width: 2px;
  border-radius: 5px; padding: 1px 6px;
  font-size: 9px; font-family: inherit;
  color: var(--muted2);
}

/* ── player bar ── */
.player-bar {
  display: flex; align-items: center; gap: 11px;
  padding: 0 18px;
  background: rgba(10,9,22,0.7);
  border-top: 1px solid rgba(196,181,253,0.09);
  flex-shrink: 0;
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height .28s var(--ease-out), opacity .22s, padding .28s var(--ease-out);
}
.player-bar.visible { max-height: 58px; padding: 10px 18px; opacity: 1; }

.player-title {
  font-size: 11px; font-weight: 500; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 150px; flex-shrink: 0;
}
.pp-btn {
  width: 30px; height: 30px; border: none; border-radius: 50%;
  background: rgba(196,181,253,.14); color: var(--text);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background .15s, transform .12s var(--ease-out);
}
.pp-btn:hover  { background: rgba(196,181,253,.26); transform: scale(1.08); }
.pp-btn:active { transform: scale(0.94); }
.pp-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.55); outline-offset: 3px; }

.seek-wrap { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.seek-bar {
  width: 100%; height: 3px; appearance: none;
  background: rgba(255,255,255,.1); border-radius: 2px;
  cursor: pointer; outline: none;
  transition: height .15s;
}
.seek-bar:hover { height: 4px; }
.seek-bar::-webkit-slider-thumb {
  appearance: none; width: 13px; height: 13px;
  border-radius: 50%; background: var(--wave);
  cursor: pointer; transition: transform .12s var(--ease-out);
}
.seek-bar:hover::-webkit-slider-thumb { transform: scale(1.2); }
.seek-bar:focus-visible { outline: 2px solid rgba(196,181,253,0.5); outline-offset: 3px; }

.seek-times {
  display: flex; justify-content: space-between;
  font-size: 9px; font-variant-numeric: tabular-nums;
  color: var(--muted2);
}
.seek-markers-row { position: relative; height: 5px; }
.seek-mark-dot {
  position: absolute; width: 5px; height: 5px;
  border-radius: 50%; background: var(--wave);
  top: 0; transform: translateX(-50%); cursor: pointer;
  opacity: .6; transition: opacity .13s, transform .13s;
}
.seek-mark-dot:hover { opacity: 1; transform: translateX(-50%) scale(1.4); }

.speed-sel {
  background: transparent; border: 1px solid var(--pborder);
  border-radius: 6px; color: var(--muted2);
  font-size: 10px; padding: 3px 6px;
  cursor: pointer; outline: none; flex-shrink: 0;
  transition: border-color .15s, color .15s;
}
.speed-sel:hover { color: var(--text); border-color: rgba(196,181,253,.3); }
.speed-sel:focus { color: var(--text); border-color: rgba(196,181,253,.45); }
.speed-sel option { background: #0f0e1a; }

.close-btn {
  width: 24px; height: 24px; border: none;
  background: transparent; color: var(--muted2);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  border-radius: 5px; flex-shrink: 0;
  transition: color .15s, background .15s;
}
.close-btn:hover { color: var(--text); background: rgba(255,255,255,.08); }
.close-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.5); outline-offset: 1px; }

/* ── settings modal ── */
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity .2s;
}
.modal-overlay.open { opacity: 1; pointer-events: all; }

.modal {
  background: #100f22;
  border: 1px solid rgba(196,181,253,.18);
  border-radius: 14px;
  padding: 24px 26px 22px;
  width: 380px; max-width: calc(100vw - 32px);
  box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(196,181,253,.06);
  transform: translateY(10px) scale(0.98);
  transition: transform .24s var(--ease-out);
}
.modal-overlay.open .modal { transform: translateY(0) scale(1); }

.modal-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 22px;
}
.modal-title { font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: .01em; }

.form-row { margin-bottom: 16px; }
.form-label {
  display: block;
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted2); margin-bottom: 6px;
}
.cfg-input {
  width: 100%;
  background: rgba(255,255,255,.05);
  border: 1px solid var(--pborder);
  border-radius: 8px;
  color: var(--text); font-size: 12px;
  padding: 8px 11px; outline: none;
  font-family: 'Cascadia Code','Consolas',monospace;
  transition: border-color .18s, box-shadow .18s;
}
.cfg-input:focus { border-color: rgba(196,181,253,.4); box-shadow: 0 0 0 3px rgba(196,181,253,.07); }
.cfg-input::placeholder { color: var(--muted); }
.form-hint { margin-top: 5px; font-size: 10px; color: var(--muted); line-height: 1.55; }
.form-hint em { color: var(--muted2); font-style: normal; }

.modal-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 22px; padding-top: 18px;
  border-top: 1px solid rgba(255,255,255,.06);
}
.modal-btn {
  border: none; cursor: pointer; border-radius: 7px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em;
  padding: 8px 18px;
  transition: background .15s, color .15s;
  font-family: inherit;
}
.modal-btn.cancel {
  background: rgba(255,255,255,.07); color: var(--muted2);
  border: 1px solid var(--border);
}
.modal-btn.cancel:hover { background: rgba(255,255,255,.12); color: var(--text); }
.modal-btn.save-cfg {
  background: rgba(196,181,253,.18); color: var(--wave);
  border: 1px solid rgba(196,181,253,.28);
}
.modal-btn.save-cfg:hover { background: rgba(196,181,253,.28); }
.modal-btn:focus-visible { outline: 2px solid rgba(196,181,253,0.55); outline-offset: 2px; }

/* ── toast ── */
.toast {
  position: fixed; bottom: 22px; left: 50%;
  transform: translateX(-50%) translateY(6px);
  background: rgba(15,14,30,.9);
  border: 1px solid rgba(196,181,253,.22);
  color: var(--wave);
  border-radius: 8px; padding: 8px 18px;
  font-size: 11px; font-weight: 600;
  white-space: nowrap;
  opacity: 0; pointer-events: none;
  transition: opacity .22s, transform .22s var(--ease-out);
  z-index: 200;
  backdrop-filter: blur(6px);
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast.error { border-color: rgba(229,56,59,.3); color: var(--red); }
.toast.warn  { border-color: rgba(251,191,36,.3); color: #fbbf24; }

/* ── reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
</style>
</head>
<body>

<div class="app">

  <!-- ── Library ── -->
  <aside class="library" id="library">
    <div class="lib-hdr">
      <span>Recordings<span class="lib-hdr-count" id="lib-count"></span></span>
      <button class="lib-toggle" id="lib-toggle" title="Collapse panel">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>
    <div class="search-wrap">
      <input class="search-input" id="search" type="search" placeholder="Search…" autocomplete="off">
    </div>
    <ul class="rec-list" id="rec-list">
      <li class="rec-empty">
        <svg class="rec-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M12 1C9.24 1 7 3.24 7 6v7a5 5 0 0 0 10 0V6c0-2.76-2.24-5-5-5z"/>
          <path d="M3.5 12a8.5 8.5 0 0 0 17 0"/>
          <line x1="12" y1="20.5" x2="12" y2="23"/>
        </svg>
        No recordings yet.<br>Press the red button to start.
      </li>
    </ul>
  </aside>

  <!-- ── Recorder ── -->
  <div class="recorder-panel">
    <button class="lib-show-btn" id="lib-show-btn" title="Show recordings">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
    <header class="header">
      <div class="rec-dot" id="dot"></div>
      <span class="app-name">Recorder</span>
      <div class="mic-wrap">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1C9.24 1 7 3.24 7 6v7a5 5 0 0 0 10 0V6c0-2.76-2.24-5-5-5z"/>
          <path d="M3.5 12a8.5 8.5 0 0 0 17 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        </svg>
        <select class="mic-sel" id="mic-sel"></select>
        <button class="settings-btn" id="settings-btn" title="Settings (Ctrl+,)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="wave-section" id="wave-section">
      <canvas id="waveform"></canvas>
    </div>

    <div id="timer">00:00</div>
    <div id="status">Ready</div>

    <div class="controls">
      <button class="btn btn-sec" id="btn-pause" hidden title="Pause (Space)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6"  y="4" width="4" height="16" rx="1.5"/>
          <rect x="14" y="4" width="4" height="16" rx="1.5"/>
        </svg>
      </button>

      <button class="btn" id="btn-record" title="Record (Ctrl+R)">
        <img src="/mic.svg" width="30" height="30" alt="Record">
      </button>

      <button class="btn btn-sec" id="btn-resume" hidden title="Resume (Space)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="7 3 21 12 7 21"/>
        </svg>
      </button>

      <button class="btn btn-sec" id="btn-stop" hidden title="Stop (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2.5"/>
        </svg>
      </button>
    </div>

    <div class="markers-row" id="markers-row"></div>
    <div id="filename"></div>

    <div class="kb-hint">
      <span><kbd>Ctrl+R</kbd> record</span>
      <span><kbd>Space</kbd> pause</span>
      <span><kbd>Esc</kbd> stop</span>
      <span><kbd>Ctrl+M</kbd> mark</span>
      <span><kbd>Ctrl+,</kbd> settings</span>
    </div>
  </div>
</div>

<!-- ── Player bar ── -->
<div class="player-bar" id="player-bar">
  <button class="pp-btn" id="pp-btn" title="Play / Pause (Space)">
    <svg id="pp-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="7 3 21 12 7 21"/>
    </svg>
  </button>
  <span class="player-title" id="player-title"></span>
  <div class="seek-wrap">
    <input class="seek-bar" id="seek-bar" type="range" min="0" max="100" step="0.05" value="0">
    <div class="seek-markers-row" id="seek-marks"></div>
    <div class="seek-times">
      <span id="cur-time">0:00</span>
      <span id="dur-time">0:00</span>
    </div>
  </div>
  <select class="speed-sel" id="speed-sel">
    <option value="0.25">0.25×</option>
    <option value="0.5">0.5×</option>
    <option value="0.75">0.75×</option>
    <option value="1" selected>1×</option>
    <option value="1.25">1.25×</option>
    <option value="1.5">1.5×</option>
    <option value="2">2×</option>
    <option value="4">4×</option>
  </select>
  <button class="close-btn" id="close-player" title="Close">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6"  y1="6" x2="18" y2="18"/>
    </svg>
  </button>
  <audio id="audio-el" preload="metadata"></audio>
</div>

<!-- ── Settings modal ── -->
<div class="modal-overlay" id="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title-el">
  <div class="modal">
    <div class="modal-hdr">
      <span class="modal-title" id="modal-title-el">Settings</span>
      <button class="close-btn" id="modal-close" title="Close (Esc)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="form-row">
      <label class="form-label" for="cfg-dir">Save folder</label>
      <input class="cfg-input" id="cfg-dir" type="text" placeholder="./recordings" autocomplete="off" spellcheck="false">
      <p class="form-hint">Where recordings are saved. Relative to the server file, or an absolute path.</p>
    </div>

    <div class="form-row">
      <label class="form-label" for="cfg-prefix">Filename prefix</label>
      <input class="cfg-input" id="cfg-prefix" type="text" placeholder="Recording" autocomplete="off">
      <p class="form-hint">Files are named <em>"Prefix (1).webm"</em>, <em>"Prefix (2).webm"</em>, …</p>
    </div>

    <div class="form-row">
      <label class="form-label" for="cfg-port">Port</label>
      <input class="cfg-input" id="cfg-port" type="number" min="1024" max="65535" placeholder="3131">
      <p class="form-hint">Restart the server after changing the port.</p>
    </div>

    <div class="modal-actions">
      <button class="modal-btn cancel" id="modal-cancel">Cancel</button>
      <button class="modal-btn save-cfg" id="modal-save">Save</button>
    </div>
  </div>
</div>

<!-- ── Toast notification ── -->
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
// ── canvas ────────────────────────────────────────────────────────────────────
var canvas = document.getElementById('waveform');
var ctx    = canvas.getContext('2d');
var W = 0, H = 0;

function initCanvas() {
  var dpr  = window.devicePixelRatio || 1;
  var wrap = document.getElementById('wave-section');
  W = wrap.clientWidth;
  H = Math.round(window.innerHeight * 0.26);
  wrap.style.height   = H + 'px';
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', function() {
  initCanvas();
  if (appState !== 'recording') drawFlat();
});
initCanvas();

// ── state ─────────────────────────────────────────────────────────────────────
var appState    = 'idle';
var mediaRec    = null;
var audioChunks = [];
var audioStream = null;
var audioCtx    = null;
var analyser    = null;
var animId      = null;
var idleAnimId  = null;
var startTime   = 0;
var pausedMs    = 0;
var pauseStart  = 0;
var timerIv     = null;
var idlePhase   = 0;
var markers     = [];
var allRecs     = [];
var activeRec   = null;

// ── refs ──────────────────────────────────────────────────────────────────────
var dot          = document.getElementById('dot');
var timerEl      = document.getElementById('timer');
var statusEl     = document.getElementById('status');
var filenameEl   = document.getElementById('filename');
var btnRecord    = document.getElementById('btn-record');
var btnPause     = document.getElementById('btn-pause');
var btnResume    = document.getElementById('btn-resume');
var btnStop      = document.getElementById('btn-stop');
var markersRow   = document.getElementById('markers-row');
var micSel       = document.getElementById('mic-sel');
var recList      = document.getElementById('rec-list');
var searchEl     = document.getElementById('search');
var playerBar    = document.getElementById('player-bar');
var ppBtn        = document.getElementById('pp-btn');
var ppIcon       = document.getElementById('pp-icon');
var playerTitle  = document.getElementById('player-title');
var seekBar      = document.getElementById('seek-bar');
var seekMarks    = document.getElementById('seek-marks');
var curTimeEl    = document.getElementById('cur-time');
var durTimeEl    = document.getElementById('dur-time');
var speedSel     = document.getElementById('speed-sel');
var closePlayer  = document.getElementById('close-player');
var audioEl      = document.getElementById('audio-el');

// ── time formatting ───────────────────────────────────────────────────────────
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtMs(ms) {
  var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  s %= 60; m %= 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
}
function fmtS(sec) {
  sec = Math.floor(sec);
  var m = Math.floor(sec / 60), h = Math.floor(m / 60);
  sec %= 60; m %= 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
}

// ── timer ─────────────────────────────────────────────────────────────────────
function tickTimer() {
  if (startTime) timerEl.textContent = fmtMs(Math.max(0, Date.now() - startTime - pausedMs));
}
function startTimer() { timerIv = setInterval(tickTimer, 200); }
function stopTimer()  { clearInterval(timerIv); timerIv = null; }
function resetTimer() { timerEl.textContent = '00:00'; }

// ── waveform ──────────────────────────────────────────────────────────────────
function drawFlat() {
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2);
  ctx.strokeStyle = 'rgba(62,58,92,0.55)'; ctx.lineWidth = 1; ctx.stroke();
}

function stopIdleAnim() { if (idleAnimId) { cancelAnimationFrame(idleAnimId); idleAnimId = null; } }
function runIdleAnim() {
  ctx.clearRect(0, 0, W, H);
  var cy = H / 2;
  ctx.beginPath();
  for (var x = 0; x <= W; x++) {
    var y = cy + Math.sin(x / W * Math.PI * 5 + idlePhase) * 3;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(62,58,92,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
  idlePhase += 0.013;
  idleAnimId = requestAnimationFrame(runIdleAnim);
}

function stopWaveAnim() { if (animId) { cancelAnimationFrame(animId); animId = null; } }
function drawWave(data) {
  ctx.clearRect(0, 0, W, H);
  var cy = H/2, len = data.length, sw = W/len, amp = cy * 0.8;
  var pts = [];
  for (var i = 0; i < len; i++) pts[i] = (data[i] / 128.0) - 1.0;

  ctx.beginPath();
  for (var i = 0; i < len; i++) {
    var x = i*sw, y = cy + pts[i]*amp;
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  for (var i = len-1; i >= 0; i--) ctx.lineTo(i*sw, cy - pts[i]*amp);
  ctx.closePath();
  var g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,   'rgba(196,181,253,0.00)');
  g.addColorStop(.25, 'rgba(196,181,253,0.09)');
  g.addColorStop(.5,  'rgba(196,181,253,0.18)');
  g.addColorStop(.75, 'rgba(196,181,253,0.09)');
  g.addColorStop(1,   'rgba(196,181,253,0.00)');
  ctx.fillStyle = g; ctx.fill();

  ctx.beginPath();
  for (var i = 0; i < len; i++) {
    var x = i*sw, y = cy + pts[i]*amp;
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();

  ctx.beginPath();
  for (var i = 0; i < len; i++) {
    var x = i*sw, y = cy - pts[i]*amp;
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.strokeStyle = 'rgba(196,181,253,0.25)'; ctx.lineWidth = 1; ctx.stroke();
}
function runWaveAnim() {
  var buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  drawWave(buf);
  animId = requestAnimationFrame(runWaveAnim);
}

// ── markers ───────────────────────────────────────────────────────────────────
function addMarker() {
  if (appState !== 'recording') return;
  var t = Math.max(0, Date.now() - startTime - pausedMs) / 1000;
  markers.push({ time: t, label: 'Mark ' + (markers.length + 1) });
  renderMarkerChips();
}
function renderMarkerChips() {
  markersRow.innerHTML = '';
  markers.forEach(function(m) {
    var c = document.createElement('span');
    c.className = 'marker-chip';
    c.textContent = fmtS(m.time) + ' · ' + m.label;
    markersRow.appendChild(c);
  });
}

// ── UI state machine ──────────────────────────────────────────────────────────
function setState(s, extra) {
  appState = s;
  btnRecord.hidden = btnPause.hidden = btnResume.hidden = btnStop.hidden = true;
  dot.classList.remove('on');
  btnRecord.classList.remove('recording');
  timerEl.classList.remove('saved');
  statusEl.className = '';
  filenameEl.classList.remove('show');

  if (s === 'idle') {
    btnRecord.hidden = false;
    statusEl.textContent = 'Ready';
    markersRow.innerHTML = '';
  } else if (s === 'recording') {
    btnPause.hidden = btnStop.hidden = false;
    dot.classList.add('on');
    btnRecord.classList.add('recording');
    statusEl.textContent = 'Recording';
    statusEl.classList.add('rec');
  } else if (s === 'paused') {
    btnResume.hidden = btnStop.hidden = false;
    statusEl.textContent = 'Paused';
  } else if (s === 'saving') {
    statusEl.textContent = 'Saving…';
  } else if (s === 'saved') {
    timerEl.classList.add('saved');
    statusEl.textContent = 'Saved';
    statusEl.classList.add('done');
    if (extra) { filenameEl.textContent = extra; filenameEl.classList.add('show'); }
  } else if (s === 'error') {
    statusEl.textContent = 'Error — open console';
    btnRecord.hidden = false;
    console.error('[Recorder]', extra);
  }
}

// ── microphone ────────────────────────────────────────────────────────────────
async function loadMics() {
  try {
    var s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(function(t) { t.stop(); });
    var devs = await navigator.mediaDevices.enumerateDevices();
    var mics = devs.filter(function(d) { return d.kind === 'audioinput'; });
    micSel.innerHTML = '';
    if (!mics.length) { micSel.innerHTML = '<option value="">Default</option>'; return; }
    mics.forEach(function(d, i) {
      var o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || ('Microphone ' + (i + 1));
      micSel.appendChild(o);
    });
  } catch (_) {
    micSel.innerHTML = '<option value="">Default</option>';
  }
}

// ── recording logic ───────────────────────────────────────────────────────────
async function startRecording() {
  if (appState !== 'idle') return;
  var devId = micSel.value;
  var constraints = { audio: devId ? { deviceId: { exact: devId } } : true, video: false };
  try {
    audioStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) { setState('error', err.message); return; }

  audioCtx = new AudioContext();
  var src = audioCtx.createMediaStreamSource(audioStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.84;
  src.connect(analyser);

  var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  mediaRec    = new MediaRecorder(audioStream, { mimeType: mime });
  audioChunks = [];
  markers     = [];
  mediaRec.ondataavailable = function(e) { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
  mediaRec.start(500);

  startTime = Date.now(); pausedMs = 0;
  stopIdleAnim();
  setLibCollapsed(true);
  setState('recording');
  startTimer();
  runWaveAnim();
}

function pauseRecording() {
  if (!mediaRec || mediaRec.state !== 'recording') return;
  mediaRec.pause();
  pauseStart = Date.now();
  stopWaveAnim(); stopTimer(); drawFlat();
  setState('paused');
}

function resumeRecording() {
  if (!mediaRec || mediaRec.state !== 'paused') return;
  pausedMs += Date.now() - pauseStart;
  mediaRec.resume();
  setState('recording'); startTimer(); runWaveAnim();
}

async function stopRecording() {
  stopWaveAnim(); stopTimer();
  var totalMs = Math.max(0, Date.now() - startTime - pausedMs);
  var savedMarkers = markers.slice();
  setState('saving');

  await new Promise(function(resolve) {
    mediaRec.onstop = resolve;
    if (mediaRec.state !== 'inactive') mediaRec.stop(); else resolve();
  });

  audioStream.getTracks().forEach(function(t) { t.stop(); });
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;

  var blob = new Blob(audioChunks, { type: 'audio/webm' });
  try {
    var res  = await fetch('/save', { method:'POST', headers:{'Content-Type':'audio/webm'}, body:blob });
    var data = await res.json();
    if (data.filename) {
      await fetch('/save-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.filename, duration: totalMs / 1000, markers: savedMarkers })
      });
      setState('saved', data.filename);
      loadRecordings();
      setTimeout(function() {
        setState('idle'); resetTimer(); drawFlat(); setLibCollapsed(false);
        idlePhase = 0; runIdleAnim();
        audioChunks = []; startTime = 0; pausedMs = 0;
      }, 2800);
    } else { setState('error', data.error || 'save failed'); }
  } catch (err) { setState('error', err.message); }
}

// ── recording list ────────────────────────────────────────────────────────────
async function loadRecordings() {
  try {
    var r = await fetch('/recordings');
    allRecs = await r.json();
    renderList();
  } catch (_) {}
}

function renderList() {
  var q = searchEl.value.trim().toLowerCase();
  var list = q ? allRecs.filter(function(r) { return r.name.toLowerCase().indexOf(q) !== -1; }) : allRecs;

  var countEl = document.getElementById('lib-count');
  if (countEl) {
    var n = allRecs.length;
    countEl.textContent = n ? ' \xb7 ' + n : '';
  }

  if (!list.length) {
    if (q) {
      recList.innerHTML = '<li class="rec-empty">No results for “' + escH(q) + '”</li>';
    } else {
      recList.innerHTML =
        '<li class="rec-empty">' +
        '<svg class="rec-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
        '<path d="M12 1C9.24 1 7 3.24 7 6v7a5 5 0 0 0 10 0V6c0-2.76-2.24-5-5-5z"/>' +
        '<path d="M3.5 12a8.5 8.5 0 0 0 17 0"/><line x1="12" y1="20.5" x2="12" y2="23"/>' +
        '</svg>No recordings yet.<br>Press the red button to start.</li>';
    }
    return;
  }

  recList.innerHTML = '';
  list.forEach(function(rec) {
    var li = document.createElement('li');
    li.className = 'rec-item' + (activeRec && activeRec.name === rec.name ? ' active' : '');
    li.dataset.name = rec.name;
    li.tabIndex = 0;

    var d   = new Date(rec.mtime);
    var ds  = d.toLocaleDateString(undefined, { month:'short', day:'numeric' })
            + ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
    var dur = rec.duration ? fmtS(rec.duration) : ((rec.size/1024).toFixed(0) + ' KB');
    var baseName = rec.name.replace(/\.[^.]+$/, '');

    li.innerHTML =
      '<span class="rec-name" title="' + escH(rec.name) + '">' + escH(baseName) + '</span>' +
      '<span class="rec-meta"><span>' + escH(ds) + '</span><span>' + escH(dur) + '</span></span>' +
      '<div class="rec-actions">' +
        '<button class="ic-btn rn-btn" title="Rename (F2)">' + svgEdit() + '</button>' +
        '<button class="ic-btn del dl-btn" title="Delete (Del)">' + svgTrash() + '</button>' +
        '<button class="ic-btn fo-btn" title="Show in folder">' + svgFolder() + '</button>' +
      '</div>';

    li.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(li, rec); playRec(rec); }
    });
    li.addEventListener('click', function(e) {
      if (e.target.closest('.rec-actions')) return;
      setActive(li, rec); playRec(rec);
    });
    li.querySelector('.rn-btn').addEventListener('click', function(e) { e.stopPropagation(); startRename(li, rec); });
    li.querySelector('.dl-btn').addEventListener('click', function(e) { e.stopPropagation(); deleteRec(rec.name); });
    li.querySelector('.fo-btn').addEventListener('click', function(e) { e.stopPropagation(); fetch('/open-folder', {method:'POST'}); });

    recList.appendChild(li);
  });
}

function escH(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function setActive(li, rec) {
  activeRec = rec;
  document.querySelectorAll('.rec-item').forEach(function(el) { el.classList.remove('active'); });
  if (li) li.classList.add('active');
}

searchEl.addEventListener('input', renderList);

// ── rename ────────────────────────────────────────────────────────────────────
function startRename(li, rec) {
  var nameEl   = li.querySelector('.rec-name');
  var baseName = rec.name.replace(/(\.[^.]+)$/, '');
  var ext      = rec.name.slice(baseName.length);
  var input    = document.createElement('input');
  input.className = 'rec-name-input';
  input.value = baseName;
  nameEl.replaceWith(input);
  input.focus(); input.select();

  function commit() {
    var nb = input.value.trim();
    if (!nb || nb === baseName) { input.replaceWith(nameEl); return; }
    fetch('/rename', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ old: rec.name, 'new': nb + ext })
    }).then(function() {
      if (activeRec && activeRec.name === rec.name) {
        activeRec = Object.assign({}, activeRec, { name: nb + ext });
        playerTitle.textContent = nb;
      }
      loadRecordings();
    });
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.replaceWith(nameEl); }
  });
}

// ── delete ────────────────────────────────────────────────────────────────────
async function deleteRec(name) {
  var base = name.replace(/\.[^.]+$/, '');
  if (!confirm('Delete “' + base + '”?')) return;
  await fetch('/delete', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name: name })
  });
  if (activeRec && activeRec.name === name) closePlayerFn();
  loadRecordings();
}

// ── player ────────────────────────────────────────────────────────────────────
function playRec(rec) {
  audioEl.src = '/play/' + encodeURIComponent(rec.name);
  playerTitle.textContent = rec.name.replace(/\.[^.]+$/, '');
  playerBar.classList.add('visible');
  speedSel.value = '1'; audioEl.playbackRate = 1;
  audioEl.load(); audioEl.play();

  seekMarks.innerHTML = '';
  if (rec.markers && rec.markers.length && rec.duration) {
    rec.markers.forEach(function(m) {
      var dot = document.createElement('div');
      dot.className = 'seek-mark-dot';
      dot.style.left = (m.time / rec.duration * 100) + '%';
      dot.title = m.label + ' \xb7 ' + fmtS(m.time);
      dot.addEventListener('click', function() { audioEl.currentTime = m.time; });
      seekMarks.appendChild(dot);
    });
  }
}

audioEl.addEventListener('play',  syncPPIcon);
audioEl.addEventListener('pause', syncPPIcon);
audioEl.addEventListener('ended', syncPPIcon);
function syncPPIcon() {
  var playing = !audioEl.paused && !audioEl.ended;
  ppIcon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/>'
    : '<polygon points="7 3 21 12 7 21"/>';
}

audioEl.addEventListener('timeupdate', function() {
  if (!audioEl.duration) return;
  seekBar.value = (audioEl.currentTime / audioEl.duration) * 100;
  curTimeEl.textContent = fmtS(audioEl.currentTime);
  durTimeEl.textContent = fmtS(audioEl.duration);
});
audioEl.addEventListener('loadedmetadata', function() {
  durTimeEl.textContent = fmtS(audioEl.duration);
});

seekBar.addEventListener('input', function() {
  if (audioEl.duration) audioEl.currentTime = (seekBar.value / 100) * audioEl.duration;
});
ppBtn.addEventListener('click', function() { audioEl.paused ? audioEl.play() : audioEl.pause(); });
speedSel.addEventListener('change', function() { audioEl.playbackRate = parseFloat(speedSel.value); });

closePlayer.addEventListener('click', closePlayerFn);
function closePlayerFn() {
  audioEl.pause(); audioEl.src = '';
  playerBar.classList.remove('visible');
  activeRec = null;
  document.querySelectorAll('.rec-item').forEach(function(el) { el.classList.remove('active'); });
}

// ── settings panel ────────────────────────────────────────────────────────────
var settingsOverlay = document.getElementById('settings-overlay');
var cfgDir          = document.getElementById('cfg-dir');
var cfgPrefix       = document.getElementById('cfg-prefix');
var cfgPort         = document.getElementById('cfg-port');
var settingsBtn     = document.getElementById('settings-btn');
var modalClose      = document.getElementById('modal-close');
var modalCancel     = document.getElementById('modal-cancel');
var modalSave       = document.getElementById('modal-save');
var toastEl         = document.getElementById('toast');
var serverSettings  = { recordingsDir: './recordings', filenamePrefix: 'Recording', port: 3131 };
var toastTimer      = null;

async function loadServerSettings() {
  try {
    var r = await fetch('/settings');
    serverSettings = await r.json();
  } catch (_) {}
}

function openSettings() {
  cfgDir.value    = serverSettings.recordingsDir  || './recordings';
  cfgPrefix.value = serverSettings.filenamePrefix || 'Recording';
  cfgPort.value   = serverSettings.port           || 3131;
  settingsOverlay.classList.add('open');
  setTimeout(function() { cfgDir.focus(); }, 50);
}

function closeSettings() {
  settingsOverlay.classList.remove('open');
}

function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toastEl.classList.remove('show', 'error', 'warn'); }, 3400);
}

async function saveServerSettings() {
  var dir    = cfgDir.value.trim()    || './recordings';
  var prefix = cfgPrefix.value.trim() || 'Recording';
  var port   = parseInt(cfgPort.value, 10) || 3131;
  if (port < 1024 || port > 65535) { showToast('Port must be between 1024 and 65535', 'error'); return; }
  var portChanged = port !== serverSettings.port;

  try {
    var r = await fetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingsDir: dir, filenamePrefix: prefix, port: port })
    });
    var data = await r.json();
    if (data.ok) {
      serverSettings = { recordingsDir: dir, filenamePrefix: prefix, port: port };
      closeSettings();
      if (portChanged) {
        showToast('Saved — restart the server for the port change to take effect.', 'warn');
      } else {
        showToast('Settings saved.', '');
        loadRecordings();
      }
    } else {
      showToast('Error: ' + (data.error || 'save failed'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

settingsBtn.addEventListener('click', openSettings);
modalClose .addEventListener('click', closeSettings);
modalCancel.addEventListener('click', closeSettings);
modalSave  .addEventListener('click', saveServerSettings);
settingsOverlay.addEventListener('click', function(e) { if (e.target === settingsOverlay) closeSettings(); });
modalSave.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); saveServerSettings(); } });

// ── keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (settingsOverlay.classList.contains('open')) {
    if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
    return;
  }
  var tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (e.ctrlKey && e.key === 'r') { e.preventDefault(); if (appState === 'idle') startRecording(); return; }
  if (e.ctrlKey && e.key === 'm') { e.preventDefault(); addMarker(); return; }
  if (e.key === 'Escape') {
    if (appState === 'recording' || appState === 'paused') stopRecording();
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    if      (appState === 'recording') pauseRecording();
    else if (appState === 'paused')    resumeRecording();
    else if (playerBar.classList.contains('visible')) { audioEl.paused ? audioEl.play() : audioEl.pause(); }
    return;
  }
  if (playerBar.classList.contains('visible')) {
    if (e.key === 'ArrowLeft')  { audioEl.currentTime = Math.max(0, audioEl.currentTime - 1); return; }
    if (e.key === 'ArrowRight') { audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 1); return; }
  }
  if (e.key === 'F2' && activeRec) {
    recList.querySelectorAll('.rec-item').forEach(function(el) {
      if (el.dataset.name === activeRec.name) startRename(el, activeRec);
    });
    return;
  }
  if (e.key === 'Delete' && activeRec && appState === 'idle') { deleteRec(activeRec.name); return; }
});

// ── svg helpers ───────────────────────────────────────────────────────────────
function svgEdit() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
}
function svgTrash() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
}
function svgFolder() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}

// ── sidebar collapse ──────────────────────────────────────────────────────────
var libraryEl  = document.getElementById('library');
var libToggle  = document.getElementById('lib-toggle');
var libShowBtn = document.getElementById('lib-show-btn');
var libCollapsed = false;

function setLibCollapsed(on) {
  libCollapsed = on;
  libraryEl.classList.toggle('collapsed', on);
  libShowBtn.classList.toggle('visible', on);
}

libToggle.addEventListener('click', function() { setLibCollapsed(true); });
libShowBtn.addEventListener('click', function() { setLibCollapsed(false); });

// ── boot ──────────────────────────────────────────────────────────────────────
btnRecord.addEventListener('click', startRecording);
btnPause .addEventListener('click', pauseRecording);
btnResume.addEventListener('click', resumeRecording);
btnStop  .addEventListener('click', stopRecording);

setState('idle');
runIdleAnim();
loadMics();
loadRecordings();
loadServerSettings();
</script>
</body>
</html>`;

// ── server ────────────────────────────────────────────────────────────────────
const server = http.createServer(function(req, res) {
  var url = req.url, method = req.method;

  // ── static ──
  if (method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (method === 'GET' && url === '/mic.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(MIC_SVG);
  }

  // ── settings ──
  if (method === 'GET' && url === '/settings') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(settings));
  }

  if (method === 'POST' && url === '/settings') {
    jsonBody(req, function(err, data) {
      if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
      var dir    = String(data.recordingsDir  || DEFAULT_SETTINGS.recordingsDir).trim();
      var prefix = String(data.filenamePrefix || DEFAULT_SETTINGS.filenamePrefix).trim() || DEFAULT_SETTINGS.filenamePrefix;
      var port   = parseInt(data.port, 10) || DEFAULT_SETTINGS.port;
      if (port < 1024 || port > 65535) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid port' })); }
      settings.recordingsDir  = dir;
      settings.filenamePrefix = prefix;
      settings.port           = port;
      RECORDINGS_DIR = resolveDir(dir);
      try { saveSettings(settings); } catch (e) { /* ignore write errors */ }
      console.log('Settings updated: dir=' + RECORDINGS_DIR + '  prefix=' + prefix + '  port=' + port);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── list recordings ──
  if (method === 'GET' && url === '/recordings') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getRecordings()));
  }

  // ── stream audio file ──
  if (method === 'GET' && url.startsWith('/play/')) {
    var fname = safeName(decodeURIComponent(url.slice(6)));
    var fpath = path.join(RECORDINGS_DIR, fname);
    fs.stat(fpath, function(err, stat) {
      if (err) { res.writeHead(404); return res.end(); }
      var extMime = { '.webm':'audio/webm', '.wav':'audio/wav', '.mp3':'audio/mpeg',
                      '.m4a':'audio/mp4',   '.ogg':'audio/ogg' };
      var mime = extMime[path.extname(fname).toLowerCase()] || 'application/octet-stream';
      var range = req.headers['range'];
      if (range) {
        var m = range.match(/bytes=(\d*)-(\d*)/);
        var start = m[1] ? parseInt(m[1]) : 0;
        var end   = m[2] ? parseInt(m[2]) : stat.size - 1;
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1
        });
        fs.createReadStream(fpath, { start: start, end: end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(fpath).pipe(res);
      }
    });
    return;
  }

  // ── save recording ──
  if (method === 'POST' && url === '/save') {
    readBody(req, function(buf) {
      fs.mkdir(RECORDINGS_DIR, { recursive:true }, function(mkErr) {
        if (mkErr) { res.writeHead(500); return res.end(JSON.stringify({ error: mkErr.message })); }
        var existing = [];
        try { existing = fs.readdirSync(RECORDINGS_DIR); } catch (_) {}
        var prefix = settings.filenamePrefix || 'Recording';
        var re = new RegExp('^' + escapeRegex(prefix) + ' \\((\\d+)\\)\\.webm$', 'i');
        var max = 0;
        existing.forEach(function(f) {
          var m = f.match(re);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        var filename = prefix + ' (' + (max + 1) + ').webm';
        var filepath = path.join(RECORDINGS_DIR, filename);
        fs.writeFile(filepath, buf, function(err) {
          if (err) {
            console.error('Save failed:', err.message);
            res.writeHead(500, { 'Content-Type':'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
          }
          console.log('Saved  ' + filename + '  (' + (buf.length/1024).toFixed(0) + ' KB)');
          res.writeHead(200, { 'Content-Type':'application/json' });
          res.end(JSON.stringify({ filename: filename, size: buf.length }));
        });
      });
    });
    return;
  }

  // ── save metadata ──
  if (method === 'POST' && url === '/save-meta') {
    jsonBody(req, function(err, data) {
      if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
      var name = safeName(data.name);
      var mp   = path.join(RECORDINGS_DIR, name + '.meta.json');
      fs.writeFile(mp, JSON.stringify({ duration: data.duration, markers: data.markers }), function() {
        res.writeHead(200, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    return;
  }

  // ── delete recording ──
  if (method === 'POST' && url === '/delete') {
    jsonBody(req, function(err, data) {
      if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
      var name = safeName(data.name);
      var fp   = path.join(RECORDINGS_DIR, name);
      fs.unlink(fp, function() {});
      fs.unlink(fp + '.meta.json', function() {});
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── rename recording ──
  if (method === 'POST' && url === '/rename') {
    jsonBody(req, function(err, data) {
      if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: err.message })); }
      var oldName = safeName(data['old']);
      var newName = safeName(data['new']);
      var oldPath = path.join(RECORDINGS_DIR, oldName);
      var newPath = path.join(RECORDINGS_DIR, newName);
      fs.rename(oldPath, newPath, function(e) {
        if (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
        fs.rename(oldPath + '.meta.json', newPath + '.meta.json', function() {});
        res.writeHead(200, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    return;
  }

  // ── open recordings folder (cross-platform) ──
  if (method === 'POST' && url === '/open-folder') {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    var cmd = process.platform === 'win32'  ? 'explorer'
            : process.platform === 'darwin' ? 'open'
            : 'xdg-open';
    exec(cmd + ' "' + RECORDINGS_DIR.replace(/"/g, '\\"') + '"');
    res.writeHead(200, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404); res.end();
});

server.on('error', function(err) {
  if (err.code === 'EADDRINUSE') console.log('Already running  →  http://localhost:' + PORT);
  else console.error('Server error:', err.message);
});

server.listen(PORT, '127.0.0.1', function() {
  console.log('\n  Recorder  →  http://localhost:' + PORT);
  console.log('  Saving to: ' + RECORDINGS_DIR);
  console.log('\n  Close this window to stop.\n');
});

<#
  study-notes.ps1
  Daily pipeline: voice recordings -> transcripts (Buzz/faster-whisper) -> vault notes (claude).
  Idempotent: only processes recordings it hasn't seen before, so it can run at 12 AM
  AND on demand without double-noting. Safe to run as many times as you like.

  Drop recordings in:  C:\Users\chint\desktop\StudyRecordings\recordings
  Note-writing rules come from the /brain command (C:\Users\chint\.claude\commands\brain.md)
  + the vault's own rules. Edit /brain (or run `/brain improve`) to change note behaviour.
#>

$ErrorActionPreference = 'Stop'

# ---- config ----
$Root        = 'C:\Users\chint\desktop\StudyRecordings'              # engine room: script, prompt, transcripts, logs, manifest
$SourceDir   = 'C:\Users\chint\desktop\StudyRecordings\recordings'   # drop zone: clips live here. Sound Recorder saves to Documents\Sound recordings, which is junctioned to this folder.
$Vault       = 'C:\Users\chint\desktop\MnC-Economics'
$BuzzExe     = 'C:\Users\chint\AppData\Local\Programs\Buzz\Buzz.exe'
$Llt         = 'C:\Users\chint\AppData\Local\Programs\LenovoLegionToolkit\llt.exe'  # to wake dGPU for transcription
$GpuWaitSec  = 30                                 # how long to wait for RTX to become CUDA-usable after switching
$DesktopDir  = 'C:\Users\chint\desktop'          # run claude from here so vault rules (memory) load
$ProConfig   = 'C:\Users\chint\.claude'          # Pro account (tried first)
$MaxConfig   = 'C:\Users\chint\.claude-max'      # Max account (fallback when Pro is rate-limited)
$ModelType   = 'fasterwhisper'
$ModelSize   = 'large-v3'                         # best for Hindi/Hinglish; already cached
$AudioExt    = @('.m4a','.mp3','.wav','.ogg','.opus','.flac','.aac','.wma','.webm','.mp4')

$TranscriptDir = Join-Path $Root '_transcripts'
$LogDir        = Join-Path $Root '_logs'
$Manifest      = Join-Path $Root '.processed.json'
$BrainCmd      = 'C:\Users\chint\.claude\commands\brain.md'   # /brain = single source of truth for note-writing rules

foreach ($d in @($TranscriptDir, $LogDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory $d | Out-Null } }

$stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$LogFile = Join-Path $LogDir "run_$stamp.log"
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  # Add-Content + Write-Host (NOT Tee-Object): Tee writes to the success/output stream,
  # which pollutes the return value of any function that calls Log. Keep Log side-effect-only.
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

# ---- dGPU control via Lenovo Legion Toolkit (best-effort; falls back to CPU silently) ----
# Laptop normally sits in hybrid 'onigpuonly' so the RTX stays parked at 0W. Switching to
# 'on' makes it CUDA-usable WITHOUT a reboot (verified); we revert in a finally so it always
# goes back to parked. LLT must be running with CLI enabled, in the logged-on session.
function Get-RtxStatus { (Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Where-Object FriendlyName -like '*NVIDIA*').Status }
function Get-HybridMode { try { (& $Llt feature get hybrid-mode 2>$null | Out-String).Trim() } catch { $null } }
function Set-HybridMode($v) { try { & $Llt feature set hybrid-mode $v 2>$null | Out-Null; return $true } catch { return $false } }
function Wait-RtxOk($timeoutSec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
    if ((Get-RtxStatus) -eq 'OK') { return $true }
    Start-Sleep -Seconds 2
  }
  return ((Get-RtxStatus) -eq 'OK')
}

Log "=== study-notes run started ==="

# ---- load manifest of already-processed audio ----
$done = @{}
if (Test-Path $Manifest) {
  try {
    (Get-Content $Manifest -Raw | ConvertFrom-Json) | ForEach-Object { $done[$_.key] = $true }
  } catch { Log "WARN: could not read manifest, starting fresh." }
}
function KeyOf($f) { "{0}|{1}" -f $f.Name, $f.Length }

# ---- find new recordings ----
$audio = Get-ChildItem $SourceDir -File -ErrorAction SilentlyContinue | Where-Object { $AudioExt -contains $_.Extension.ToLower() }
$new   = $audio | Where-Object { -not $done.ContainsKey((KeyOf $_)) }

if (-not $new -or $new.Count -eq 0) {
  Log "No new recordings. Nothing to do."
  Log "=== done ==="
  exit 0
}
Log ("Found {0} new recording(s): {1}" -f $new.Count, (($new | ForEach-Object Name) -join ', '))

# ---- transcribe each new recording ----
$newTranscripts = New-Object System.Collections.Generic.List[string]
$manifestRows   = if (Test-Path $Manifest) { @(Get-Content $Manifest -Raw | ConvertFrom-Json) } else { @() }
$manifestList   = New-Object System.Collections.Generic.List[object]
$manifestRows | ForEach-Object { $manifestList.Add($_) }

# ---- wake the dGPU just for transcription (best-effort) ----
$savedMode  = $null
$gpuEnabled = $false
if (Test-Path $Llt) {
  $savedMode = Get-HybridMode
  if (-not $savedMode) {
    Log "GPU: LLT CLI not reachable (LLT not running / CLI off). Transcribing on CPU."
  } elseif ($savedMode -eq 'on') {
    Log "GPU: already in hybrid 'on' mode; using dGPU as-is."
  } else {
    Log "GPU: hybrid-mode is '$savedMode' -> switching to 'on' to wake the RTX..."
    if (Set-HybridMode 'on') {
      if (Wait-RtxOk $GpuWaitSec) { $gpuEnabled = $true; Log "GPU: RTX is OK (CUDA available)." }
      else { Log "GPU: RTX did not come up within $GpuWaitSec s; falling back to CPU." }
    } else {
      Log "GPU: failed to switch hybrid-mode; falling back to CPU."
    }
  }
} else {
  Log "GPU: llt.exe not found; transcribing on CPU."
}

try {
foreach ($f in $new) {
  Log "Transcribing: $($f.Name)"
  $before = Get-ChildItem $TranscriptDir -Filter '*.txt' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
  # NOTE: --language omitted on purpose -> auto-detect, correct for mixed Hindi/English.
  # Pass args as one quoted STRING: Start-Process -ArgumentList arrays don't reliably
  # quote paths containing spaces, which silently breaks Buzz.
  $argStr = 'add --task transcribe --model-type {0} --model-size {1} --txt --output-directory "{2}" "{3}"' -f $ModelType, $ModelSize, $TranscriptDir, $f.FullName
  $outF = Join-Path $LogDir "buzz_$($f.BaseName)_$stamp.out"
  $errF = Join-Path $LogDir "buzz_$($f.BaseName)_$stamp.err"
  $p = Start-Process $BuzzExe -ArgumentList $argStr -NoNewWindow -PassThru `
        -RedirectStandardOutput $outF -RedirectStandardError $errF
  if (-not $p.WaitForExit(1800000)) { $p.Kill(); Log "  ERROR: Buzz timed out (30 min) on $($f.Name) - skipping."; continue }

  # Buzz writes "<base> (transcribed on ...).txt" -> grab whatever new .txt appeared.
  $after = Get-ChildItem $TranscriptDir -Filter '*.txt' -ErrorAction SilentlyContinue
  $produced = $after | Where-Object { $before -notcontains $_.Name } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($produced) {
    Log "  -> transcript: $($produced.Name)"
    $newTranscripts.Add($produced.FullName)
  } else {
    Log "  -> no transcript produced (likely no speech detected). Marking processed anyway."
  }
  $manifestList.Add([pscustomobject]@{ key = (KeyOf $f); name = $f.Name; date = (Get-Date -Format s); transcript = $(if($produced){$produced.Name}else{$null}) })
}
}
finally {
  # always put the GPU back to where we found it, even if transcription threw.
  if ($gpuEnabled -and $savedMode) {
    Log "GPU: reverting hybrid-mode to '$savedMode' (RTX will re-park)..."
    if (Set-HybridMode $savedMode) { Log "GPU: reverted to '$savedMode'." }
    else { Log "GPU: WARN - revert command failed; check LLT (may still be in 'on')." }
  }
}

# persist manifest immediately (so transcription work is never repeated even if notes step fails)
$manifestList | ConvertTo-Json -Depth 4 | Set-Content $Manifest -Encoding utf8
Log "Manifest updated ($($manifestList.Count) total entries)."

if ($newTranscripts.Count -eq 0) {
  Log "No transcripts with speech. Skipping notes step."
  Log "=== done ==="
  exit 0
}

# ---- build the prompt and hand off to claude (writes notes into the vault) ----
# Single source of truth = the /brain command. We feed its body straight in (deterministic;
# no slash-command lookup, so it works under either the Pro or Max config dir), then add the
# batch-run framing + transcript paths. Editing /brain automatically changes note behaviour here.
if (-not (Test-Path $BrainCmd)) { Log "ERROR: /brain command not found at $BrainCmd"; exit 1 }
$brainRaw  = Get-Content $BrainCmd -Raw
$brainBody = $brainRaw -replace '(?s)^\s*---.*?---\s*', ''   # strip the YAML frontmatter header
$paths = ($newTranscripts | ForEach-Object { "  $_" }) -join "`r`n"
$fullPrompt = @"
$brainBody

---
RUN MODE: automated batch (NOT an interactive chat). The files below are transcripts of my
spoken study sessions (Hinglish). Process them end to end in ONE pass, then stop — I'm asleep,
so never ask me anything; make the sensible call and log what you did to Meta/Audit.md as usual.
For each transcript: read it, infer the working context from what I actually say, and
create/update notes following every rule above plus the vault's own rules — Concept mode, the
India jurisdiction check, source stamping, hub-and-spoke linking — and route asides into Open
Questions / Checkout / Problems / Bridges as appropriate.

Transcripts to process:
$paths
"@
$tmpPrompt = Join-Path $LogDir "prompt_$stamp.txt"
$fullPrompt | Set-Content $tmpPrompt -Encoding utf8

# Run the notes step against one account (by config dir). Returns $true on success.
# A non-zero exit from `claude -p` is how a usage/rate limit surfaces -> that's our
# signal to fall back to the other account. The CLAUDE_CONFIG_DIR override is scoped
# to this call only and always restored, so it never leaks to the rest of the run.
function Invoke-ClaudeNotes($configDir, $label) {
  Log "Notes: trying $label account ($configDir)..."
  $prev = $env:CLAUDE_CONFIG_DIR
  $env:CLAUDE_CONFIG_DIR = $configDir
  try {
    # acceptEdits = auto-approve file writes (no prompt to hang at midnight); tools limited to file ops.
    # Capture output into a variable (don't let it flow to the pipeline) so the function's
    # ONLY return value is the $true/$false below. Then append the captured output to the log.
    $out = Get-Content $tmpPrompt -Raw | & claude -p `
        --model sonnet `
        --permission-mode acceptEdits `
        --allowedTools Read Write Edit Glob Grep `
        --add-dir $Vault 2>&1
    $code = $LASTEXITCODE
    if ($out) { Add-Content -Path $LogFile -Value ($out | Out-String) -Encoding utf8 }
    if ($code -eq 0) { Log "Notes: $label succeeded (exit 0)."; return $true }
    Log "Notes: $label failed (exit $code) - likely rate-limited or errored."
    return $false
  } catch {
    Log "Notes: $label threw: $_"
    return $false
  } finally {
    if ($null -ne $prev) { $env:CLAUDE_CONFIG_DIR = $prev }
    else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
  }
}

Log "Invoking claude on $($newTranscripts.Count) transcript(s) -> writing notes into vault..."
Push-Location $DesktopDir
try {
  $ok = Invoke-ClaudeNotes $ProConfig 'Pro'
  if (-not $ok) {
    Log "Notes: Pro unavailable -> falling back to Max."
    $ok = Invoke-ClaudeNotes $MaxConfig 'Max'
  }
  if (-not $ok) { Log "ERROR: both Pro and Max failed. Transcripts are saved; re-run after a reset to retry notes." }
} catch {
  Log "ERROR during claude step: $_"
} finally {
  Pop-Location
}

Log "=== done ==="

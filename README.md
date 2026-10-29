# AlignPulse - Ultra-Precise Audio Transcription & Forced-Alignment Tool

AlignPulse is a high-precision audio transcription and millisecond-accurate forced-alignment engine for voice-overs, subtitles, and karaoke syncing.

## Features
- **100% Exact Script Alignment**: Eliminates AI hallucinations, repetitions, and dropped words when given a reference script.
- **Natural Acoustic Pause Preservation**: Guarantees authentic speech silence gaps (20ms – 80ms) between spoken words. Consecutive words never touch wall-to-wall (`word[i].end != word[i+1].start`).
- **Devanagari & Indic Script Locking**: Strict native script consistency without unwanted Latin/Hinglish drift.
- **Word-by-Word Millisecond Fine-Tuning Grid**: Nudge start & end times by ±10ms / ±50ms.
- **Interactive Multi-Format Exports**: SRT, VTT, ASS (Karaoke), JSON, CSV, and Strict Timestamped Text.

## Termux (Android) Setup Guide

### Why did `tsx: Permission denied` happen?
In Android, the phone's internal storage (`/sdcard` or `~/downloads` if symlinked to internal phone storage) is mounted with the `noexec` permission flag. Android does not allow running executable binaries from `/sdcard`.

### How to fix and run in Termux (Step-by-Step):
1. **Extract/Move the folder to Termux's Home directory (`~`)**:
   ```bash
   cd ~
   cp /sdcard/Download/alignpulse_final.zip ~/
   unzip alignpulse_final.zip -d ~/alignpulse
   cd ~/alignpulse
   ```

2. **Make sure Node.js is installed in Termux**:
   ```bash
   pkg update -y
   pkg install nodejs -y
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Add your Gemini API Key in `.env`**:
   ```bash
   cp .env.example .env
   nano .env
   ```

5. **Start the server**:
   ```bash
   npm run dev:termux
   # OR:
   node --import tsx server.ts
   ```

6. **Open in Browser**:
   Open Chrome / browser on your phone and visit:
   ```
   http://localhost:3000
   ```

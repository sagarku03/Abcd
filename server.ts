import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import {
  formatMs,
  calculatePhoneticWeight,
  interpolateMultiWordSpan,
  enforceMonotonicTimeline,
  separateAcousticPauses,
  stitchChunkTokens,
  detectDominantScript,
} from './src/utils/boundaryStitcher.ts';
import { alignScriptWithAcousticTokens } from './src/utils/scriptAligner.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Runtime environment constraint: Dev server must listen on port 3000 (nginx is on 8080 and proxies to 3000)
const PORT = 3000;

// Support audio payloads up to 100MB
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

function getAvailableApiKeys(): string[] {
  const keys: string[] = [];

  // 1. GEMINI_API_KEY (supports multiple comma/semicolon/newline-delimited keys if user pastes multiple)
  if (process.env.GEMINI_API_KEY) {
    const parts = process.env.GEMINI_API_KEY.split(/[\r\n,;]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    keys.push(...parts);
  }

  // 2. Numbered keys GEMINI_API_KEY_2 through GEMINI_API_KEY_10
  for (let i = 2; i <= 10; i++) {
    const val = process.env[`GEMINI_API_KEY_${i}`];
    if (val && val.trim()) {
      keys.push(val.trim());
    }
  }

  // 3. Alternate/backup variable names
  if (process.env.GEMINI_API_KEY_BACKUP?.trim()) {
    keys.push(process.env.GEMINI_API_KEY_BACKUP.trim());
  }
  if (process.env.SECONDARY_GEMINI_API_KEY?.trim()) {
    keys.push(process.env.SECONDARY_GEMINI_API_KEY.trim());
  }

  return Array.from(new Set(keys));
}

function createGenAIClient(apiKey?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey || process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ParsedWord {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
  startFormatted: string;
  endFormatted: string;
  durationMs: number;
}

function parseFormattedTime(hStr?: string, minStr?: string, secStr?: string, msStr?: string): number {
  const hours = hStr ? parseInt(hStr.replace(':', ''), 10) : 0;
  const mins = minStr ? parseInt(minStr, 10) : 0;
  const secs = secStr ? parseInt(secStr, 10) : 0;
  const ms = parseInt((msStr || '000').padEnd(3, '0').slice(0, 3), 10);
  return hours * 3600000 + mins * 60000 + secs * 1000 + ms;
}

function parseEngineOutput(rawText: string, audioDurationMs?: number): { words: ParsedWord[]; rawCleaned: string } {
  const lines = rawText.split('\n');
  const rawWords: ParsedWord[] = [];

  // Robust universal regex matching [HH:MM:SS.mmm - HH:MM:SS.mmm] or [MM:SS.mmm - MM:SS.mmm]
  const rangeRegex = /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\s*[- to–—\rightarrow\>]+\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]?\s*:?\s*(.+)/i;
  // Single timestamp fallback [HH:MM:SS.mmm] Word or [MM:SS.mmm] Word
  const singleRegex = /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]?\s*:?\s*(.+)/i;

  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Strip leading list bullet, number, or markdown symbols (e.g. "* [00:01]", "1. [00:01]", "23. ")
    rawLine = rawLine.replace(/^(?:[\*\-]\s+|\d+[\.\)\:\-]\s+)/, '').trim();
    // Strip bold wrapper symbols (e.g. "**[00:01.100 - 00:01.400]**")
    rawLine = rawLine.replace(/^\*\*|\*\*$/g, '').trim();

    const rangeMatch = rawLine.match(rangeRegex);
    if (rangeMatch) {
      const sH = rangeMatch[1];
      const sM = rangeMatch[2];
      const sS = rangeMatch[3];
      const sMs = rangeMatch[4] || '000';
      const eH = rangeMatch[5];
      const eM = rangeMatch[6];
      const eS = rangeMatch[7];
      const eMs = rangeMatch[8] || '000';
      let wordText = rangeMatch[9].trim().replace(/^\*\*|\*\*$/g, '');

      let startMs = parseFormattedTime(sH, sM, sS, sMs);
      let endMs = parseFormattedTime(eH, eM, eS, eMs);

      if (endMs <= startMs) {
        endMs = startMs + 100;
      }

      const tokens = wordText.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        // Syllable- and character-weighted interpolation (replaces flat equal-duration fallback)
        const interpolated = interpolateMultiWordSpan(tokens, startMs, endMs);
        interpolated.forEach((item, tIdx) => {
          rawWords.push({
            id: `word-${rawWords.length}-${Date.now()}-${tIdx}`,
            word: item.word,
            startMs: item.startMs,
            endMs: item.endMs,
            startFormatted: formatMs(item.startMs),
            endFormatted: formatMs(item.endMs),
            durationMs: item.endMs - item.startMs,
          });
        });
      } else if (tokens.length === 1) {
        rawWords.push({
          id: `word-${rawWords.length}-${Date.now()}`,
          word: tokens[0],
          startMs,
          endMs,
          startFormatted: formatMs(startMs),
          endFormatted: formatMs(endMs),
          durationMs: endMs - startMs,
        });
      }
    } else {
      const singleMatch = rawLine.match(singleRegex);
      if (singleMatch) {
        const sH = singleMatch[1];
        const sM = singleMatch[2];
        const sS = singleMatch[3];
        const sMs = singleMatch[4] || '000';
        let wordText = singleMatch[5].trim().replace(/^\*\*|\*\*$/g, '');

        const startMs = parseFormattedTime(sH, sM, sS, sMs);
        const tokens = wordText.split(/\s+/).filter(Boolean);
        const interpolated = interpolateMultiWordSpan(tokens, startMs, startMs + tokens.length * 200);
        interpolated.forEach((item, tIdx) => {
          rawWords.push({
            id: `word-${rawWords.length}-${Date.now()}-${tIdx}`,
            word: item.word,
            startMs: item.startMs,
            endMs: item.endMs,
            startFormatted: formatMs(item.startMs),
            endFormatted: formatMs(item.endMs),
            durationMs: item.endMs - item.startMs,
          });
        });
      }
    }
  }

  // Enforce monotonic timeline and clamp to audio duration if specified
  const words = enforceMonotonicTimeline(rawWords, audioDurationMs);

  // Generate standardized line-by-line format
  const rawCleaned = words
    .map((w) => `[${w.startFormatted} - ${w.endFormatted}] ${w.word}`)
    .join('\n');

  return { words, rawCleaned };
}

// Endpoint to stitch sequential chunks with boundary deduplication and monotonic timeline
app.post('/api/stitch-chunks', (req, res) => {
  const { previousWords = [], incomingWords = [], overlapWindowMs = 1800 } = req.body;
  const stitched = stitchChunkTokens(previousWords, incomingWords, overlapWindowMs);
  return res.json({ success: true, words: stitched });
});

// Endpoint to align exact script against acoustic tokens (100% exact words & hallucination filter)
app.post('/api/align-script', (req, res) => {
  try {
    const { scriptText, words = [], audioDurationMs } = req.body;
    if (!scriptText || typeof scriptText !== 'string') {
      return res.status(400).json({ error: 'scriptText is required' });
    }
    const result = alignScriptWithAcousticTokens(scriptText, words, audioDurationMs);
    return res.json({
      success: true,
      words: result.words,
      stats: result.stats,
      rawOutput: result.words.map((w) => `[${w.startFormatted} - ${w.endFormatted}] ${w.word}`).join('\n'),
    });
  } catch (err: any) {
    console.error('Script alignment error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to align script with audio' });
  }
});

// API endpoint for Audio Transcription and Forced Alignment
app.post('/api/transcribe', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = 'audio/mp3',
      durationSec,
      referenceTranscript,
      languageHint,
      modelChoice = 'gemini-3.8-flash',
      timeOffsetMs = 0,
      lockedScript,
      previousContextWords,
      chunkIndex = 0,
      totalChunks = 1,
    } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 data is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    const durationInfo = durationSec
      ? `The audio buffer duration is ${durationSec.toFixed(3)} seconds. This segment concludes in an acoustic pause or silence. Capture every spoken word with its natural, uncompressed acoustic duration; do not artificially compress, squash, or clamp trailing words into micro-slices.`
      : 'Cover the entire audio file from 00:00.000 to the very last millisecond with natural spoken durations.';

    const scriptLockSection = lockedScript && lockedScript !== 'Auto'
      ? `\nCRITICAL SCRIPT CONSISTENCY LOCK: The transcription script for this audio stream is locked to: ${lockedScript}.
- You MUST transcribe all spoken words strictly using the ${lockedScript} script.
- NEVER drift or switch between native script and Romanized/Latin transliteration (e.g., if Devanagari is locked, write strictly in Devanagari script, do NOT output Latin Hinglish).
- Preceding chunk transcript context: "${previousContextWords || ''}".
- Ensure seamless continuity with this preceding context.`
      : '';

    const alignmentSection = referenceTranscript
      ? `\nCRITICAL FORCED-ALIGNMENT REQUIREMENT: You are provided with the exact reference transcript below. Align every spoken word from this text with the exact millisecond timestamps in the audio:
REFERENCE TRANSCRIPT:
${referenceTranscript}
Ensure every word in the reference is mapped chronologically to its spoken location. If the speaker modified, added filler words, or repeated words, transcribe the verbatim spoken reality.`
      : '';

    const languageSection = languageHint && languageHint !== 'Auto-detect'
      ? `PRIMARY LANGUAGE CONTEXT: The spoken audio is expected to be ${languageHint} (or code-switched / multilingual including Hindi, English, Hinglish). Use authentic script and spelling.`
      : 'LANGUAGE FIDELITY: Maintain the exact spoken language (English, Hindi in Devanagari script or Hinglish, Spanish, etc.) exactly as spoken.';

    const systemInstruction = `You are an ultra-precise Audio Transcription and Forced-Alignment Engine. Your task is to analyze the entire uploaded audio file from start to finish and produce a 100% accurate, verbatim, word-by-word transcript with millisecond-precision timestamps.

CORE OBJECTIVES & RULES:
1. COMPLETE AUDIO COVERAGE (ZERO OMISSIONS):
   - Analyze the full length of the audio file from 00:00.000 to the very last millisecond.
   - Do not skip, summarize, truncate, or hallucinate any content.
   - NEVER stop generating halfway or early. You MUST transcribe continuously through the entire duration.
   - ${durationInfo}

2. WORD-BY-WORD (VERBATIM) GRANULARITY:
   - Transcribe every single spoken word individually.
   - Include filler words (um, uh, ah, like, ya, hmm, etc.), pauses, stutters, and interjections exactly as spoken.
   - ${languageSection}
   ${scriptLockSection}

3. TIMESTAMP FORMATTING & VOICE ACTIVITY DETECTION (VAD):
   - Format: [MM:SS.mmm - MM:SS.mmm]
     - MM = Minutes (2 digits)
     - SS = Seconds (2 digits)
     - mmm = Milliseconds (exactly 3 digits, e.g., 00:01.100)
   - Every word must have an exact Start Time and End Time:
     - Start Time: The exact millisecond the vocal sound of that word BEGINS phonating.
     - End Time: The exact millisecond the vocal sound of that word ENDS phonating.

4. TRUE ACOUSTIC VOICE BOUNDARIES & ZERO WORDS IN NATURAL SILENCE PAUSES:
   - Synchronize strictly to the acoustic voice sound waves in the audio:
     - Start Time: Anchored to the exact millisecond vocal sound of that word begins phonating.
     - End Time: Anchored to the exact millisecond vocal sound of that word ceases phonating.
   - ZERO WORDS IN SILENCE: Whenever there is a natural acoustic pause, breathing gap, or silence where the audio wave is 0 or quiet (e.g. 0.5s to 2s between sentences), NO word timestamps may cover, touch, or start inside that silence!
   - NEVER START WORDS EARLY IN SILENCE: After an acoustic pause, the first word of the next sentence/phrase MUST NOT start until vocal phonation actually begins on the waveform. Do NOT place words inside the preceding silence.
   - Spoken audio bursts (where speech sound wave is active) must have their exact spoken words mapped directly to them; silence gaps between words must remain completely empty on the timeline.
   - Every single word MUST be output on its own line: [MM:SS.mmm - MM:SS.mmm] SingleWord. NEVER group multiple words into a single line.

5. SCRIPT CONSISTENCY & ZERO LANGUAGE DRIFT:
   - Maintain 100% consistent writing script across all segments.
   - If spoken in Hindi/Indic, write in authentic script (Devanagari) consistently; never drift into Romanized transliteration.
   - Always preserve native punctuation marks (such as Devanagari danda ।, commas, periods, question marks) attached to their corresponding words.

6. AI-GENERATED & SYNTHETIC TTS VOICES:
   - If the audio features an AI-generated or synthetic voice (e.g. ElevenLabs, OpenAI TTS, Google TTS, Edge TTS), recognize that pacing may be fast and uniform with shorter pauses.
   - Transcribe continuously through the very last millisecond of speech; NEVER cut off or omit trailing words before the audio concludes.
   - Maintain authentic individual word acoustic durations (natural spoken words take 140ms-350ms each); never bunch or skip words.

${alignmentSection}

OUTPUT FORMAT:
Output the result strictly line-by-line in this structure without conversational preamble or closing notes:
[MM:SS.mmm - MM:SS.mmm] Word

Example:
[00:00.120 - 00:00.380] नमस्ते
[00:00.420 - 00:00.720] दोस्तों
[00:00.780 - 00:01.150] आज`;

    const promptText = `Analyze this audio file with millisecond acoustic precision from start to finish. Produce the exact verbatim word-by-word forced-alignment transcript with millisecond timestamps [MM:SS.mmm - MM:SS.mmm] Word. Align each word tightly to its spoken audio phonation sound wave, leaving natural pauses (where audio wave is 0) completely empty. Output only the lines.`;

    const cleanMimeType = (() => {
      let m = (mimeType || 'audio/mp3').split(';')[0].trim().toLowerCase();
      if (m === 'audio/m4a' || m === 'audio/x-m4a') return 'audio/mp4';
      if (m === 'audio/x-wav') return 'audio/wav';
      if (m === 'audio/wave') return 'audio/wav';
      return m;
    })();

    const audioPart = {
      inlineData: {
        mimeType: cleanMimeType,
        data: audioBase64,
      },
    };

    const requestedModel = modelChoice || 'gemini-3.1-flash-lite';
    // Order candidate models smartly based on user choice, prioritizing active quota models
    const candidateModels: string[] = [];
    if (requestedModel) candidateModels.push(requestedModel);
    if (!candidateModels.includes('gemini-3.1-flash-lite')) candidateModels.push('gemini-3.1-flash-lite');
    if (!candidateModels.includes('gemini-3.5-transcribe')) candidateModels.push('gemini-3.5-transcribe');
    if (!candidateModels.includes('gemini-3.8-flash')) candidateModels.push('gemini-3.8-flash');

    const availableKeys = getAvailableApiKeys();
    const effectiveKeys = availableKeys.length > 0 ? availableKeys : [process.env.GEMINI_API_KEY || ''];

    let response: any = null;
    let successfulModel = '';
    let lastError: any = null;

    keySearchLoop: for (let keyIdx = 0; keyIdx < effectiveKeys.length; keyIdx++) {
      const currentKey = effectiveKeys[keyIdx];
      const currentAi = createGenAIClient(currentKey);
      const keyLabel = effectiveKeys.length > 1 ? `Key #${keyIdx + 1}` : 'Primary Key';

      let keyEncountered429 = false;

      for (const modelName of candidateModels) {
        if (keyEncountered429) {
          break; // Switch to the next key immediately
        }

        try {
          console.log(`[AlignEngine] Attempting transcription with ${keyLabel} using model: ${modelName}`);
          const isTranscribeOnly = modelName.includes('transcribe');
          const config: any = {
            temperature: 0.1,
            maxOutputTokens: 32768,
          };
          if (!isTranscribeOnly) {
            config.systemInstruction = systemInstruction;
          }

          const contentParts = isTranscribeOnly
            ? [audioPart, { text: `${systemInstruction}\n\n${promptText}` }]
            : [audioPart, { text: promptText }];

          response = await currentAi.models.generateContent({
            model: modelName,
            contents: {
              parts: contentParts,
            },
            config,
          });

          if (response && response.text) {
            successfulModel = modelName;
            console.log(`[AlignEngine] Successfully transcribed with ${keyLabel} using ${modelName}`);
            break keySearchLoop;
          }
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || err?.toString() || '';
          const isQuota429 =
            err?.status === 429 ||
            errMsg.includes('429') ||
            errMsg.includes('quota') ||
            errMsg.includes('RESOURCE_EXHAUSTED');

          if (isQuota429) {
            console.warn(`[AlignEngine] ${keyLabel} quota exhausted (429) on model ${modelName}.`);
            if (keyIdx + 1 < effectiveKeys.length) {
              console.warn(
                `[AlignEngine] Multi-key failover: Auto-switching to next Gemini API Key (#${keyIdx + 2})...`
              );
              keyEncountered429 = true;
              break;
            }
          } else {
            console.warn(`[AlignEngine] Model ${modelName} on ${keyLabel} failed:`, err?.status || '', errMsg);
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }

    if (!response || !response.text) {
      const errMsg = lastError?.message || lastError?.toString() || 'Failed to analyze and transcribe audio with available models.';
      const isQuota429 = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
      if (isQuota429) {
        throw new Error(
          `Gemini API Quota Exceeded (429). You can add or replace your Gemini API key (or set GEMINI_API_KEY_2) in AI Studio Settings > Secrets panel. (${errMsg})`
        );
      }
      throw new Error(errMsg);
    }

    const rawOutput = response.text || '';
    const audioDurationMs = durationSec ? Math.round(durationSec * 1000) : undefined;
    const { words } = parseEngineOutput(rawOutput, audioDurationMs);

    const offsetWords = timeOffsetMs > 0
      ? words.map((w) => ({
          ...w,
          startMs: w.startMs + timeOffsetMs,
          endMs: w.endMs + timeOffsetMs,
          startFormatted: formatMs(w.startMs + timeOffsetMs),
          endFormatted: formatMs(w.endMs + timeOffsetMs),
          durationMs: w.endMs - w.startMs,
        }))
      : words;

    let wordsToReturn = offsetWords;
    if (referenceTranscript && referenceTranscript.trim() && totalChunks === 1) {
      const aligned = alignScriptWithAcousticTokens(
        referenceTranscript.trim(),
        offsetWords,
        audioDurationMs ? audioDurationMs + timeOffsetMs : undefined
      );
      wordsToReturn = aligned.words;
    }

    const finalWords = enforceMonotonicTimeline(
      wordsToReturn,
      audioDurationMs ? audioDurationMs + timeOffsetMs : undefined
    );

    const finalRaw = finalWords.map((w) => `[${w.startFormatted} - ${w.endFormatted}] ${w.word}`).join('\n');
    const detectedScript = detectDominantScript(finalWords);

    return res.json({
      success: true,
      modelUsed: successfulModel || requestedModel,
      rawOutput: finalRaw,
      words: finalWords,
      metadata: {
        totalWords: finalWords.length,
        audioDurationMs: (audioDurationMs ? audioDurationMs + timeOffsetMs : undefined) || (finalWords.length > 0 ? finalWords[finalWords.length - 1].endMs : 0),
        firstTimestamp: finalWords.length > 0 ? finalWords[0].startFormatted : '00:00.000',
        lastTimestamp: finalWords.length > 0 ? finalWords[finalWords.length - 1].endFormatted : '00:00.000',
        detectedScript: lockedScript || detectedScript,
      },
    });
  } catch (error: any) {
    console.error('Transcription error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to analyze and transcribe audio',
    });
  }
});

// Dedicated Whisper API endpoint (Groq whisper-large-v3 / OpenAI whisper-1) with native word timestamps
app.post('/api/transcribe-whisper', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = 'audio/wav',
      durationSec,
      provider = 'groq',
      apiKey,
      model,
      languageHint,
      referenceTranscript,
      timeOffsetMs = 0,
      chunkIndex = 0,
      totalChunks = 1,
    } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 data is required for Whisper' });
    }

    // Determine effective API key
    let effectiveKey = (apiKey || '').trim();
    let effectiveProvider = provider.toLowerCase();

    // Auto-detect provider if key prefix matches
    if (effectiveKey.startsWith('gsk_')) {
      effectiveProvider = 'groq';
    } else if (effectiveKey.startsWith('sk-')) {
      effectiveProvider = 'openai';
    }

    if (!effectiveKey) {
      if (effectiveProvider === 'openai' && process.env.OPENAI_API_KEY) {
        effectiveKey = process.env.OPENAI_API_KEY.trim();
      } else if (process.env.GROQ_API_KEY) {
        effectiveKey = process.env.GROQ_API_KEY.trim();
        effectiveProvider = 'groq';
      } else if (process.env.WHISPER_API_KEY) {
        effectiveKey = process.env.WHISPER_API_KEY.trim();
      }
    }

    if (!effectiveKey) {
      return res.status(400).json({
        error:
          'Whisper API Key nahi mila! Kripya apna Groq API Key (console.groq.com se bilkul FREE) ya OpenAI API Key enter karein.',
        needsApiKey: true,
      });
    }

    const defaultModel = effectiveProvider === 'openai' ? 'whisper-1' : 'whisper-large-v3';
    const effectiveModel = model || defaultModel;
    const endpoint =
      effectiveProvider === 'openai'
        ? 'https://api.openai.com/v1/audio/transcriptions'
        : 'https://api.groq.com/openai/v1/audio/transcriptions';

    // Map language
    let langCode: string | undefined = undefined;
    if (languageHint && languageHint !== 'Auto-detect') {
      const lower = languageHint.toLowerCase();
      if (lower.includes('hindi') || lower.includes('hinglish')) langCode = 'hi';
      else if (lower.includes('english')) langCode = 'en';
      else if (lower.includes('spanish')) langCode = 'es';
      else if (lower.includes('french')) langCode = 'fr';
      else if (lower.includes('german')) langCode = 'de';
      else if (lower.includes('japanese')) langCode = 'ja';
    }

    // Prepare multipart form data
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const fileBlob = new Blob([audioBuffer], { type: mimeType || 'audio/wav' });

    const formData = new FormData();
    formData.append('file', fileBlob, 'audio.wav');
    formData.append('model', effectiveModel);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('temperature', '0');

    if (langCode) {
      formData.append('language', langCode);
    }
    if (referenceTranscript && referenceTranscript.trim()) {
      formData.append('prompt', referenceTranscript.trim().slice(0, 800));
    }

    console.log(`[WhisperEngine] Requesting ${effectiveProvider.toUpperCase()} (${effectiveModel}) for chunk ${chunkIndex + 1}/${totalChunks}...`);

    const whisperResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
      },
      body: formData,
    });

    const data: any = await whisperResp.json();

    if (!whisperResp.ok) {
      const errorMsg = data?.error?.message || data?.error || `Whisper API failed with status ${whisperResp.status}`;
      console.error('[WhisperEngine Error]:', errorMsg);
      return res.status(whisperResp.status).json({
        error: `${effectiveProvider.toUpperCase()} Whisper Error: ${errorMsg}`,
      });
    }

    // Extract word-level timestamps
    let parsedWords: ParsedWord[] = [];
    const audioDurationMs = durationSec ? Math.round(durationSec * 1000) : undefined;

    if (Array.isArray(data.words) && data.words.length > 0) {
      parsedWords = data.words
        .map((w: any, idx: number) => {
          const rawWord = (w.word || '').trim();
          if (!rawWord) return null;
          const startMs = Math.round((w.start || 0) * 1000);
          const endMs = Math.max(startMs + 60, Math.round((w.end || 0) * 1000));
          return {
            id: `whisper-${chunkIndex}-${idx}-${Date.now()}`,
            word: rawWord,
            startMs,
            endMs,
            startFormatted: formatMs(startMs),
            endFormatted: formatMs(endMs),
            durationMs: endMs - startMs,
          };
        })
        .filter(Boolean) as ParsedWord[];
    } else if (Array.isArray(data.segments) && data.segments.length > 0) {
      // Fallback: segments with words or interpolated text
      for (let sIdx = 0; sIdx < data.segments.length; sIdx++) {
        const seg = data.segments[sIdx];
        if (Array.isArray(seg.words) && seg.words.length > 0) {
          for (let wIdx = 0; wIdx < seg.words.length; wIdx++) {
            const w = seg.words[wIdx];
            const rawWord = (w.word || '').trim();
            if (!rawWord) continue;
            const startMs = Math.round((w.start || 0) * 1000);
            const endMs = Math.max(startMs + 60, Math.round((w.end || 0) * 1000));
            parsedWords.push({
              id: `whisper-${chunkIndex}-${sIdx}-${wIdx}-${Date.now()}`,
              word: rawWord,
              startMs,
              endMs,
              startFormatted: formatMs(startMs),
              endFormatted: formatMs(endMs),
              durationMs: endMs - startMs,
            });
          }
        } else {
          const segText = (seg.text || '').trim();
          if (segText) {
            const tokens = segText.split(/\s+/).filter(Boolean);
            const segStart = Math.round((seg.start || 0) * 1000);
            const segEnd = Math.max(segStart + tokens.length * 120, Math.round((seg.end || 0) * 1000));
            const interpolated = interpolateMultiWordSpan(tokens, segStart, segEnd);
            interpolated.forEach((item, tIdx) => {
              parsedWords.push({
                id: `whisper-seg-${chunkIndex}-${sIdx}-${tIdx}-${Date.now()}`,
                word: item.word,
                startMs: item.startMs,
                endMs: item.endMs,
                startFormatted: formatMs(item.startMs),
                endFormatted: formatMs(item.endMs),
                durationMs: item.endMs - item.startMs,
              });
            });
          }
        }
      }
    } else if (typeof data.text === 'string' && data.text.trim()) {
      // Last-resort fallback for plain text response
      const tokens = data.text.trim().split(/\s+/).filter(Boolean);
      const endLimit = audioDurationMs || (tokens.length * 280);
      const interpolated = interpolateMultiWordSpan(tokens, 0, endLimit);
      parsedWords = interpolated.map((item, tIdx) => ({
        id: `whisper-text-${tIdx}-${Date.now()}`,
        word: item.word,
        startMs: item.startMs,
        endMs: item.endMs,
        startFormatted: formatMs(item.startMs),
        endFormatted: formatMs(item.endMs),
        durationMs: item.endMs - item.startMs,
      }));
    }

    // Apply time offset if audio was chunked
    const offsetWords =
      timeOffsetMs > 0
        ? parsedWords.map((w) => ({
            ...w,
            startMs: w.startMs + timeOffsetMs,
            endMs: w.endMs + timeOffsetMs,
            startFormatted: formatMs(w.startMs + timeOffsetMs),
            endFormatted: formatMs(w.endMs + timeOffsetMs),
            durationMs: w.endMs - w.startMs,
          }))
        : parsedWords;

    let wordsToReturn = offsetWords;
    if (referenceTranscript && referenceTranscript.trim() && totalChunks === 1) {
      const aligned = alignScriptWithAcousticTokens(
        referenceTranscript.trim(),
        offsetWords,
        audioDurationMs ? audioDurationMs + timeOffsetMs : undefined
      );
      wordsToReturn = aligned.words;
    }

    const finalWords = enforceMonotonicTimeline(
      wordsToReturn,
      audioDurationMs ? audioDurationMs + timeOffsetMs : undefined
    );

    const finalRaw = finalWords.map((w) => `[${w.startFormatted} - ${w.endFormatted}] ${w.word}`).join('\n');
    const detectedScript = detectDominantScript(finalWords);

    console.log(`[WhisperEngine] Successfully extracted ${finalWords.length} words with word timestamps.`);

    return res.json({
      success: true,
      modelUsed: `Whisper (${effectiveModel})`,
      rawOutput: finalRaw,
      words: finalWords,
      metadata: {
        totalWords: finalWords.length,
        audioDurationMs:
          (audioDurationMs ? audioDurationMs + timeOffsetMs : undefined) ||
          (finalWords.length > 0 ? finalWords[finalWords.length - 1].endMs : 0),
        firstTimestamp: finalWords.length > 0 ? finalWords[0].startFormatted : '00:00.000',
        lastTimestamp: finalWords.length > 0 ? finalWords[finalWords.length - 1].endFormatted : '00:00.000',
        detectedScript,
      },
    });
  } catch (err: any) {
    console.error('Whisper transcription error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to transcribe audio with Whisper',
    });
  }
});

// Engine configuration & health status endpoint
app.get('/api/engine-status', (req, res) => {
  const keys = getAvailableApiKeys();
  const hasGroqKey = !!process.env.GROQ_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasWhisperKey = hasGroqKey || hasOpenAIKey || !!process.env.WHISPER_API_KEY;

  res.json({
    activeKeysCount: keys.length,
    hasSecondaryKey: keys.length > 1,
    models: ['gemini-3.1-flash-lite', 'gemini-3.5-transcribe', 'gemini-3.8-flash'],
    whisper: {
      available: true,
      hasGroqKey,
      hasOpenAIKey,
      hasServerKey: hasWhisperKey,
      defaultModel: 'whisper-large-v3',
    },
  });
});

// Endpoint to format or re-align existing words or text
app.post('/api/validate-alignment', (req, res) => {
  const { rawText, audioDurationMs } = req.body;
  if (!rawText) {
    return res.status(400).json({ error: 'rawText is required' });
  }
  const result = parseEngineOutput(rawText, audioDurationMs);
  return res.json(result);
});

// Catch-all for undefined /api routes so they never fall through to HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Dedicated API error handler
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Error]:', err);
  res.status(err.status || 500).json({ error: err.message || 'API request error' });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        const template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AlignPulse Audio Transcription Engine running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

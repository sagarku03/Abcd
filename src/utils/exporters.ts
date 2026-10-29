import { WordToken } from '../types.ts';
import { formatMsToStandard, formatMsToSRT, formatMsToVTT, formatMsToASS } from './timeFormat.ts';

/**
 * Defensive sanitizer guaranteeing 100% positive duration and monotonic validity
 * Ensures no negative durations or inverted timestamps (startMs >= endMs) can ever exist in exports.
 */
function sanitizeExportWords(words: WordToken[]): WordToken[] {
  let runningFloor = 0;
  return words.map((w) => {
    let s = Math.max(0, w.startMs);
    if (s < runningFloor) s = runningFloor;
    let e = w.endMs;
    if (e < s + 65) {
      e = s + Math.max(65, w.durationMs || 100);
    }
    runningFloor = e + 10;
    return {
      ...w,
      startMs: s,
      endMs: e,
      durationMs: e - s,
      startFormatted: formatMsToStandard(s),
      endFormatted: formatMsToStandard(e),
    };
  });
}

export function exportToStrictText(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  return safe
    .map((w) => `[${formatMsToStandard(w.startMs)} - ${formatMsToStandard(w.endMs)}] ${w.word}`)
    .join('\n');
}

export function exportToWordSRT(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  let srt = '';
  safe.forEach((w, idx) => {
    srt += `${idx + 1}\n`;
    srt += `${formatMsToSRT(w.startMs)} --> ${formatMsToSRT(w.endMs)}\n`;
    srt += `${w.word}\n\n`;
  });
  return srt.trim();
}

export function exportToSentenceSRT(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  if (safe.length === 0) return '';
  const sentences: { startMs: number; endMs: number; text: string }[] = [];
  let currentWords: WordToken[] = [];

  for (let i = 0; i < safe.length; i++) {
    const word = safe[i];
    currentWords.push(word);
    const isPunctuationEnd = /[.!?| ]["' \)]*$/.test(word.word);
    const hasLongPause = i < safe.length - 1 && safe[i + 1].startMs - word.endMs > 600;
    const isMaxWords = currentWords.length >= 8;

    if (isPunctuationEnd || hasLongPause || isMaxWords || i === safe.length - 1) {
      sentences.push({
        startMs: currentWords[0].startMs,
        endMs: currentWords[currentWords.length - 1].endMs,
        text: currentWords.map((w) => w.word).join(' '),
      });
      currentWords = [];
    }
  }

  let srt = '';
  sentences.forEach((s, idx) => {
    srt += `${idx + 1}\n`;
    srt += `${formatMsToSRT(s.startMs)} --> ${formatMsToSRT(s.endMs)}\n`;
    srt += `${s.text}\n\n`;
  });
  return srt.trim();
}

export function exportToVTT(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  let vtt = 'WEBVTT - Millisecond Word Alignment\n\n';
  safe.forEach((w, idx) => {
    vtt += `${idx + 1}\n`;
    vtt += `${formatMsToVTT(w.startMs)} --> ${formatMsToVTT(w.endMs)}\n`;
    vtt += `<c.word>${w.word}</c>\n\n`;
  });
  return vtt.trim();
}

export function exportToJSON(words: WordToken[], audioDurationMs?: number): string {
  const safe = sanitizeExportWords(words);
  const data = {
    schemaVersion: '1.0',
    generator: 'AlignPulse Ultra-Precise Forced-Alignment Engine',
    timestamp: new Date().toISOString(),
    totalWords: safe.length,
    audioDurationMs: audioDurationMs || (safe.length > 0 ? safe[safe.length - 1].endMs : 0),
    words: safe.map((w, idx) => ({
      index: idx + 1,
      word: w.word,
      startMs: w.startMs,
      endMs: w.endMs,
      durationMs: w.durationMs,
      startFormatted: formatMsToStandard(w.startMs),
      endFormatted: formatMsToStandard(w.endMs),
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function exportToCSV(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  const headers = ['Index', 'Word', 'StartTime', 'EndTime', 'StartMs', 'EndMs', 'DurationMs'];
  const rows = safe.map((w, idx) => [
    idx + 1,
    `"${w.word.replace(/"/g, '""')}"`,
    formatMsToStandard(w.startMs),
    formatMsToStandard(w.endMs),
    w.startMs,
    w.endMs,
    w.durationMs,
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportToASS(words: WordToken[]): string {
  const safe = sanitizeExportWords(words);
  let ass = `[Script Info]\nTitle: Word-by-Word Forced Alignment Karaoke\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,60,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  let currentGroup: WordToken[] = [];
  for (let i = 0; i < safe.length; i++) {
    const word = safe[i];
    currentGroup.push(word);
    const isGroupEnd =
      currentGroup.length >= 6 ||
      /[.!?| ]["' \)]*$/.test(word.word) ||
      (i < safe.length - 1 && safe[i + 1].startMs - word.endMs > 500) ||
      i === safe.length - 1;

    if (isGroupEnd) {
      const lineStart = currentGroup[0].startMs;
      const lineEnd = currentGroup[currentGroup.length - 1].endMs;
      let lineText = '';
      currentGroup.forEach((w) => {
        const centisecs = Math.max(1, Math.round(w.durationMs / 10));
        lineText += `{\\k${centisecs}}${w.word} `;
      });
      ass += `Dialogue: 0,${formatMsToASS(lineStart)},${formatMsToASS(lineEnd)},Default,,0,0,0,,${lineText.trim()}\n`;
      currentGroup = [];
    }
  }

  return ass;
}

export function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

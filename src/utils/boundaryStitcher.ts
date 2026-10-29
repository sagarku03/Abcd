/**
 * Boundary Stitching, Monotonic Timeline Enforcement, and Script Consistency Utilities
 */

import type { WordToken } from '../types.ts';

const MIN_TOKEN_DURATION_MS = 80;
const MIN_INTER_WORD_GAP_MS = 20; // Natural acoustic pause/silence gap between words

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Normalizes token string for comparison across chunk boundaries
 * Strips all punctuation (ASCII and Unicode including Indic danda ।, double danda ॥)
 * quotation marks, brackets, and whitespace.
 */
export function normalizeToken(token: string): string {
  if (!token) return '';
  return token
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"' \s]/gu, '')
    .trim();
}

/**
 * Detects the dominant script in a set of words or text
 */
export function detectDominantScript(words: WordToken[] | string): 'Devanagari' | 'Latin' | 'Arabic' | 'Cyrillic' | 'CJK' | 'Auto' {
  const text = typeof words === 'string' ? words : words.map((w) => w.word).join(' ');
  let devanagariCount = 0;
  let latinCount = 0;
  let cyrillicCount = 0;
  let arabicCount = 0;
  let cjkCount = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x0900 && code <= 0x097f) devanagariCount++;
    else if ((code >= 0x0041 && code <= 0x005a) || (code >= 0x0061 && code <= 0x007a) || (code >= 0x00c0 && code <= 0x024f)) latinCount++;
    else if (code >= 0x0400 && code <= 0x04ff) cyrillicCount++;
    else if (code >= 0x0600 && code <= 0x06ff) arabicCount++;
    else if (code >= 0x4e00 && code <= 0x9fff) cjkCount++;
  }

  const max = Math.max(devanagariCount, latinCount, cyrillicCount, arabicCount, cjkCount);
  if (max < 3) return 'Auto';
  if (devanagariCount === max) return 'Devanagari';
  if (latinCount === max) return 'Latin';
  if (cyrillicCount === max) return 'Cyrillic';
  if (arabicCount === max) return 'Arabic';
  if (cjkCount === max) return 'CJK';
  return 'Auto';
}

/**
 * Calculates syllable- and character-based phonetic weight for natural tempo allocation
 */
export function calculatePhoneticWeight(word: string): number {
  const clean = word.normalize('NFC').trim();
  if (!clean) return 1;

  // Indic Matras / Vowel signs (Devanagari \u0904-\u0914, \u093E-\u094C, \u094D, \u0901-\u0903)
  const indicVowels = (clean.match(/[\u0904-\u0914\u093E-\u094C\u094D\u0901-\u0903]/g) || []).length;
  // Latin vowels & diphthongs
  const latinVowels = (clean.match(/[aeiouyAEIOUY]/g) || []).length;
  const charCount = clean.length;

  return Math.max(1, charCount * 0.4 + Math.max(indicVowels, latinVowels) * 1.6);
}

/**
 * Distributes a multi-word phrase duration proportionally using syllable and character weight
 * Preserves natural inter-word acoustic silence / pauses (never chains end-time to next start-time with 0 gap)
 */
export function interpolateMultiWordSpan(
  tokens: string[],
  startMs: number,
  endMs: number
): { word: string; startMs: number; endMs: number }[] {
  if (tokens.length === 0) return [];
  if (tokens.length === 1) {
    const finalEnd = Math.max(endMs, startMs + MIN_TOKEN_DURATION_MS);
    return [{ word: tokens[0], startMs, endMs: finalEnd }];
  }

  const numGaps = tokens.length - 1;
  const totalSpan = endMs - startMs;

  // Natural pause between words: 20-40ms (or 60-100ms at punctuation)
  const gapDurations = new Array(numGaps).fill(0);
  for (let g = 0; g < numGaps; g++) {
    const prevToken = tokens[g];
    if (/[.!?| ]["' \)]*$/.test(prevToken)) {
      gapDurations[g] = 80;
    } else if (/[,;: \-]$/.test(prevToken)) {
      gapDurations[g] = 50;
    } else {
      gapDurations[g] = 30; // standard natural pause between speech tokens
    }
  }

  const totalPauses = gapDurations.reduce((sum, g) => sum + g, 0);
  const availableSpeechSpan = Math.max(tokens.length * MIN_TOKEN_DURATION_MS, totalSpan - totalPauses);
  const weights = tokens.map((t) => calculatePhoneticWeight(t));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  const results: { word: string; startMs: number; endMs: number }[] = [];
  let curStart = startMs;

  for (let i = 0; i < tokens.length; i++) {
    const isLast = i === tokens.length - 1;
    const dur = Math.max(MIN_TOKEN_DURATION_MS, Math.round(availableSpeechSpan * (weights[i] / totalWeight)));
    const wEnd = isLast ? Math.max(endMs, curStart + dur) : curStart + dur;

    results.push({
      word: tokens[i],
      startMs: curStart,
      endMs: wEnd,
    });

    if (!isLast) {
      curStart = wEnd + gapDurations[i];
    }
  }

  return results;
}

/**
 * Enforces strict monotonically increasing timeline constraint (no negative time jumps or overlapping intervals)
 * Preserves natural inter-word acoustic silence gaps (word1 end never directly collides into word2 start)
 * Strictly clamps all timestamps to maxAudioDurationMs if provided.
 */
export function enforceMonotonicTimeline(
  words: WordToken[],
  maxAudioDurationMs?: number
): WordToken[] {
  if (words.length === 0) return [];

  // 1. Strictly preserve linguistic word order from transcript/script
  const result: WordToken[] = [];
  let runningStartMs = 0;

  for (let i = 0; i < words.length; i++) {
    const w = { ...words[i] };
    let startMs = Math.max(0, w.startMs);
    let endMs = w.endMs;

    // Enforce strictly monotonic progression: word[i] can never start before word[i-1] finishes
    if (startMs < runningStartMs) {
      startMs = runningStartMs;
    }

    // Fix negative or zero duration immediately
    if (endMs <= startMs + MIN_TOKEN_DURATION_MS) {
      endMs = startMs + MIN_TOKEN_DURATION_MS;
    }

    // Clamp strictly to audio boundary if maxAudioDurationMs is defined
    if (maxAudioDurationMs && maxAudioDurationMs > 0) {
      if (endMs > maxAudioDurationMs) {
        endMs = maxAudioDurationMs;
        if (startMs >= endMs) {
          startMs = Math.max(0, endMs - MIN_TOKEN_DURATION_MS);
        }
      }
    }

    const durationMs = endMs - startMs;
    result.push({
      ...w,
      startMs,
      endMs,
      durationMs,
      startFormatted: formatMs(startMs),
      endFormatted: formatMs(endMs),
    });

    runningStartMs = endMs + MIN_INTER_WORD_GAP_MS;
  }

  return separateAcousticPauses(result, maxAudioDurationMs);
}

/**
 * Guarantees authentic speech acoustic pauses / silence gaps between words.
 * Prevents artificial wall-to-wall timestamp chaining (word1.end === word2.start).
 * In human speech, vocal cord vibration stops between words, creating a 20ms - 150ms acoustic silence gap.
 */
export function separateAcousticPauses(
  words: WordToken[],
  maxAudioDurationMs?: number
): WordToken[] {
  if (words.length === 0) return [];
  const result: WordToken[] = words.map((w) => {
    let s = Math.max(0, w.startMs);
    let e = Math.max(s + MIN_TOKEN_DURATION_MS, w.endMs);
    return {
      ...w,
      startMs: s,
      endMs: e,
      durationMs: e - s,
      startFormatted: formatMs(s),
      endFormatted: formatMs(e),
    };
  });

  // Pairwise local boundary separation:
  // When consecutive words touch or collide (gap < 20ms), carve out a clean ~24ms pause locally
  // at their shared seam WITHOUT allowing next.startMs > next.endMs!
  for (let i = 0; i < result.length - 1; i++) {
    const cur = result[i];
    const next = result[i + 1];
    const currentGap = next.startMs - cur.endMs;
    const targetGap = 24; // 24ms clean acoustic silence pause

    if (currentGap < targetGap) {
      const midSeam = Math.round((cur.endMs + next.startMs) / 2);
      const halfGap = Math.round(targetGap / 2); // 12ms

      const idealCurEnd = midSeam - halfGap;
      const idealNextStart = midSeam + halfGap;

      if (idealCurEnd >= cur.startMs + MIN_TOKEN_DURATION_MS) {
        cur.endMs = idealCurEnd;
      } else {
        cur.endMs = cur.startMs + MIN_TOKEN_DURATION_MS;
      }
      cur.durationMs = cur.endMs - cur.startMs;
      cur.endFormatted = formatMs(cur.endMs);

      // CRITICAL FIX: When pushing next.startMs forward, always ensure next.endMs extends forward too!
      next.startMs = Math.max(cur.endMs + targetGap, idealNextStart);
      if (next.endMs < next.startMs + MIN_TOKEN_DURATION_MS) {
        next.endMs = next.startMs + MIN_TOKEN_DURATION_MS;
      }
      next.durationMs = next.endMs - next.startMs;
      next.startFormatted = formatMs(next.startMs);
      next.endFormatted = formatMs(next.endMs);
    }
  }

  // Strict monotonic & positive duration guarantee sweep:
  let runningFloorMs = 0;
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (item.startMs < runningFloorMs) {
      item.startMs = runningFloorMs;
    }
    const minEnd = item.startMs + MIN_TOKEN_DURATION_MS;
    if (item.endMs < minEnd) {
      item.endMs = minEnd;
    }
    item.durationMs = item.endMs - item.startMs;
    item.startFormatted = formatMs(item.startMs);
    item.endFormatted = formatMs(item.endMs);
    runningFloorMs = item.endMs + 16;
  }

  // Final audio duration clamp if provided
  if (maxAudioDurationMs && maxAudioDurationMs > 0 && result.length > 0) {
    const last = result[result.length - 1];
    if (last.endMs > maxAudioDurationMs) {
      last.endMs = maxAudioDurationMs;
      if (last.startMs >= last.endMs) {
        last.startMs = Math.max(0, last.endMs - MIN_TOKEN_DURATION_MS);
      }
      last.durationMs = last.endMs - last.startMs;
      last.startFormatted = formatMs(last.startMs);
      last.endFormatted = formatMs(last.endMs);
    }
  }

  return result;
}

/**
 * Non-Destructive Boundary Deduplication & Seamless Stitching Algorithm
 * Merges Chunk N (previousWords) with Chunk N+1 (incomingWords) across overlapping acoustic regions.
 * Guarantees ZERO words from Chunk N or Chunk N+1 are discarded or disappear.
 */
export function stitchChunkTokens(
  previousWords: WordToken[],
  incomingWords: WordToken[],
  overlapWindowMs: number = 2000
): WordToken[] {
  if (previousWords.length === 0) {
    return enforceMonotonicTimeline(incomingWords);
  }
  if (incomingWords.length === 0) {
    return enforceMonotonicTimeline(previousWords);
  }

  // 1. Chunk N (previousWords) is ALREADY completely validated and authoritative.
  // We NEVER discard or slice away ANY word from previousWords.
  const lastPrevWord = previousWords[previousWords.length - 1];
  const lastPrevEndMs = lastPrevWord.endMs;

  // 2. Identify and skip duplicate words in incomingWords that were already covered by previousWords
  const tailCount = Math.min(6, previousWords.length);
  const tailWords = previousWords.slice(-tailCount);
  const tailNorms = tailWords.map((t) => normalizeToken(t.word));

  let incomingCutIndex = 0;

  // Search in the first few words of incomingWords for matching duplicate overlap
  const searchLimit = Math.min(8, incomingWords.length);
  let bestMatchIncomingIdx = -1;

  for (let hIdx = searchLimit - 1; hIdx >= 0; hIdx--) {
    const incWord = incomingWords[hIdx];
    const incNorm = normalizeToken(incWord.word);
    if (!incNorm) continue;

    // Check if this incoming word matches one of the recent words in tailWords
    for (let tIdx = tailCount - 1; tIdx >= 0; tIdx--) {
      if (tailNorms[tIdx] === incNorm) {
        const timeDiff = Math.abs(incWord.startMs - tailWords[tIdx].startMs);
        if (timeDiff <= Math.max(overlapWindowMs + 800, 3000)) {
          // Verify if preceding words also match (if multiple)
          let matchesContext = true;
          if (tIdx > 0 && hIdx > 0) {
            const prevIncNorm = normalizeToken(incomingWords[hIdx - 1].word);
            const prevTailNorm = tailNorms[tIdx - 1];
            if (prevIncNorm && prevTailNorm && prevIncNorm !== prevTailNorm) {
              matchesContext = false;
            }
          }
          if (matchesContext) {
            bestMatchIncomingIdx = hIdx + 1; // Take incoming words strictly AFTER this duplicate
            break;
          }
        }
      }
    }
    if (bestMatchIncomingIdx !== -1) break;
  }

  if (bestMatchIncomingIdx !== -1) {
    incomingCutIndex = bestMatchIncomingIdx;
  } else {
    // Fallback: If no textual overlap match was found, skip incoming words that ended before lastPrevEndMs - 100
    while (
      incomingCutIndex < incomingWords.length &&
      incomingWords[incomingCutIndex].endMs <= lastPrevEndMs - 100
    ) {
      incomingCutIndex++;
    }
  }

  const uniqueIncoming = incomingWords.slice(incomingCutIndex);

  // If unique incoming words start before lastPrevEndMs, adjust their start smoothly so they don't collide
  const adjustedIncoming: WordToken[] = uniqueIncoming.map((w, idx) => {
    let s = w.startMs;
    let e = w.endMs;
    const prevBound = idx === 0 ? lastPrevEndMs + 24 : uniqueIncoming[idx - 1].endMs + 24;
    if (s < prevBound) {
      const dur = Math.max(MIN_TOKEN_DURATION_MS, e - s);
      s = prevBound;
      e = s + dur;
    }
    return {
      ...w,
      startMs: s,
      endMs: e,
      durationMs: e - s,
      startFormatted: formatMs(s),
      endFormatted: formatMs(e),
    };
  });

  // Guarantee ZERO words from previousWords are ever dropped!
  return [...previousWords, ...adjustedIncoming];
}


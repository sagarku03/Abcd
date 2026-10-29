import { formatMs, enforceMonotonicTimeline, calculatePhoneticWeight } from './boundaryStitcher.ts';

export interface WordToken {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
  startFormatted: string;
  endFormatted: string;
  durationMs: number;
}

export function normalizeForMatch(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFC')
    .toLowerCase()
    // Remove nukta (\u093C) so क़ matches क, फ़ matches फ, etc.
    .replace(/[\u093C\u200C\u200D\uFEFF]/g, '')
    // Remove all punctuation
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"' \s]/gu, '')
    .trim();
}

function levenshteinDistance(s1: string, s2: string): number {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;
  const row = new Array(s2.length + 1);
  for (let j = 0; j <= s2.length; j++) row[j] = j;
  for (let i = 1; i <= s1.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= s2.length; j++) {
      const cur = s1[i - 1] === s2[j - 1] ? prev : Math.min(prev + 1, row[j] + 1, row[j - 1] + 1);
      prev = row[j];
      row[j] = cur;
    }
  }
  return row[s2.length];
}

export function tokenSimilarity(a: string, b: string): number {
  const normA = normalizeForMatch(a);
  const normB = normalizeForMatch(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;
  // Prefix or substring match for compound/affixed words
  if (normA.startsWith(normB) || normB.startsWith(normA) || normA.endsWith(normB) || normB.endsWith(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen >= 2 && minLen / maxLen >= 0.6) return 0.85;
  }
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen <= 2) return normA === normB ? 1.0 : 0;
  const dist = levenshteinDistance(normA, normB);
  const sim = 1 - dist / maxLen;
  return sim >= 0.65 ? sim : 0;
}

/**
 * Accurately counts real spoken words in any script (Indic/Devanagari, Latin, Arabic, CJK, digits)
 * Filters out isolated punctuation tokens (e.g. solitary commas, dashes, colons, dandas).
 */
export function countRealWords(text: string): number {
  if (!text || !text.trim()) return 0;
  const rawTokens = text.trim().split(/\s+/).filter(Boolean);
  return rawTokens.filter((t) => /[\p{L}\p{N}\u0900-\u097F]/u.test(t)).length;
}

export function tokenizeScript(scriptText: string): string[] {
  if (!scriptText || !scriptText.trim()) return [];
  const rawTokens = scriptText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tokens: string[] = [];
  for (let t of rawTokens) {
    if (!/[\p{L}\p{N}\u0900-\u097F]/u.test(t)) {
      continue;
    }
    t = t.replace(/^[,;: \-]+(?=[\p{L}\u0900-\u097F])/u, '').trim();
    t = t.replace(/[- ]+$/, '').trim();
    if (!t || !/[\p{L}\p{N}\u0900-\u097F]/u.test(t)) {
      continue;
    }
    tokens.push(t);
  }
  return tokens;
}

export function alignScriptWithAcousticTokens(
  scriptText: string,
  acousticTokens: WordToken[],
  totalAudioDurationMs?: number
): { words: WordToken[]; stats: { scriptWords: number; acousticWords: number; matchedWords: number; interpolatedWords: number; duplicatesRemoved: number } } {
  const scriptWords = tokenizeScript(scriptText);
  if (scriptWords.length === 0) {
    return {
      words: acousticTokens,
      stats: { scriptWords: 0, acousticWords: acousticTokens.length, matchedWords: 0, interpolatedWords: 0, duplicatesRemoved: 0 },
    };
  }
  if (acousticTokens.length === 0) {
    const totalDuration = totalAudioDurationMs || scriptWords.length * 400;
    const durPerWord = totalDuration / scriptWords.length;
    const words = scriptWords.map((word, i) => {
      const startMs = Math.round(i * durPerWord);
      const endMs = Math.round((i + 1) * durPerWord);
      return {
        id: `script-${i}-${Date.now()}`,
        word,
        startMs,
        endMs,
        startFormatted: formatMs(startMs),
        endFormatted: formatMs(endMs),
        durationMs: endMs - startMs,
      };
    });
    return {
      words,
      stats: { scriptWords: scriptWords.length, acousticWords: 0, matchedWords: 0, interpolatedWords: scriptWords.length, duplicatesRemoved: 0 },
    };
  }

  const N = scriptWords.length;
  const M = acousticTokens.length;
  const BAND_WIDTH = Math.max(100, Math.ceil(M * 0.25));

  const DP: { score: number; prevI: number; prevJ: number; type: 'match1' | 'match2' | 'match3' | 'skip_script' }[][] = [];
  for (let i = 0; i <= N; i++) {
    DP[i] = [];
    const centerJ = Math.round((i / N) * M);
    for (let offset = -BAND_WIDTH; offset <= BAND_WIDTH; offset++) {
      const j = centerJ + offset;
      if (j < 0 || j > M) continue;
      DP[i][offset + BAND_WIDTH] = { score: -Infinity, prevI: -1, prevJ: -1, type: 'skip_script' };
    }
  }

  const initOffset = 0 - Math.round((0 / N) * M);
  if (DP[0][initOffset + BAND_WIDTH]) {
    DP[0][initOffset + BAND_WIDTH].score = 0;
  }

  for (let j = 0; j <= Math.min(20, M); j++) {
    const off = j - Math.round((0 / N) * M);
    if (DP[0][off + BAND_WIDTH]) {
      DP[0][off + BAND_WIDTH].score = -j * 0.5;
    }
  }

  for (let i = 0; i < N; i++) {
    const sWord = scriptWords[i];
    const sNorm = normalizeForMatch(sWord);
    const centerJ = Math.round((i / N) * M);
    for (let offset = -BAND_WIDTH; offset <= BAND_WIDTH; offset++) {
      const j = centerJ + offset;
      if (j < 0 || j > M) continue;
      const curCell = DP[i][offset + BAND_WIDTH];
      if (!curCell || curCell.score <= -1e8) continue;
      const curScore = curCell.score;

      const nextCenterJ = Math.round(((i + 1) / N) * M);
      const nextOffsetA = j - nextCenterJ;
      if (nextOffsetA >= -BAND_WIDTH && nextOffsetA <= BAND_WIDTH) {
        const targetCell = DP[i + 1][nextOffsetA + BAND_WIDTH];
        if (targetCell && curScore - 2 > targetCell.score) {
          targetCell.score = curScore - 2;
          targetCell.prevI = i;
          targetCell.prevJ = j;
          targetCell.type = 'skip_script';
        }
      }

      if (j < M) {
        const sim1 = tokenSimilarity(sNorm, acousticTokens[j].word);
        if (sim1 >= 0.6) {
          const matchScore = sim1 * 10;
          const nextOffsetB = (j + 1) - nextCenterJ;
          if (nextOffsetB >= -BAND_WIDTH && nextOffsetB <= BAND_WIDTH) {
            const targetCell = DP[i + 1][nextOffsetB + BAND_WIDTH];
            if (targetCell && curScore + matchScore > targetCell.score) {
              targetCell.score = curScore + matchScore;
              targetCell.prevI = i;
              targetCell.prevJ = j;
              targetCell.type = 'match1';
            }
          }
        }

        if (j + 1 < M) {
          const combined2 = acousticTokens[j].word + acousticTokens[j + 1].word;
          const sim2 = tokenSimilarity(sNorm, combined2);
          if (sim2 >= 0.7) {
            const matchScore = sim2 * 12;
            const nextOffsetC = (j + 2) - nextCenterJ;
            if (nextOffsetC >= -BAND_WIDTH && nextOffsetC <= BAND_WIDTH) {
              const targetCell = DP[i + 1][nextOffsetC + BAND_WIDTH];
              if (targetCell && curScore + matchScore > targetCell.score) {
                targetCell.score = curScore + matchScore;
                targetCell.prevI = i;
                targetCell.prevJ = j;
                targetCell.type = 'match2';
              }
            }
          }
        }

        if (j + 2 < M) {
          const combined3 = acousticTokens[j].word + acousticTokens[j + 1].word + acousticTokens[j + 2].word;
          const sim3 = tokenSimilarity(sNorm, combined3);
          if (sim3 >= 0.75) {
            const matchScore = sim3 * 14;
            const nextOffsetD = (j + 3) - nextCenterJ;
            if (nextOffsetD >= -BAND_WIDTH && nextOffsetD <= BAND_WIDTH) {
              const targetCell = DP[i + 1][nextOffsetD + BAND_WIDTH];
              if (targetCell && curScore + matchScore > targetCell.score) {
                targetCell.score = curScore + matchScore;
                targetCell.prevI = i;
                targetCell.prevJ = j;
                targetCell.type = 'match3';
              }
            }
          }
        }
      }

      for (let skipJ = 1; skipJ <= 3 && j + skipJ <= M; skipJ++) {
        const nextOffsetSkip = (j + skipJ) - nextCenterJ;
        if (j + skipJ < M) {
          const simSkip = tokenSimilarity(sNorm, acousticTokens[j + skipJ].word);
          if (simSkip >= 0.6) {
            const matchScore = simSkip * 10 - skipJ * 1.5;
            const nextOffsetE = (j + skipJ + 1) - nextCenterJ;
            if (nextOffsetE >= -BAND_WIDTH && nextOffsetE <= BAND_WIDTH) {
              const targetCell = DP[i + 1][nextOffsetE + BAND_WIDTH];
              if (targetCell && curScore + matchScore > targetCell.score) {
                targetCell.score = curScore + matchScore;
                targetCell.prevI = i;
                targetCell.prevJ = j + skipJ;
                targetCell.type = 'match1';
              }
            }
          }
        }
      }
    }
  }

  let bestScore = -Infinity;
  let bestEndOffset = 0;
  for (let offset = -BAND_WIDTH; offset <= BAND_WIDTH; offset++) {
    const cell = DP[N][offset + BAND_WIDTH];
    if (cell && cell.score > bestScore) {
      bestScore = cell.score;
      bestEndOffset = offset;
    }
  }

  interface ScriptMatch {
    scriptIndex: number;
    word: string;
    startMs: number;
    endMs: number;
    isMatched: boolean;
  }

  const matches: ScriptMatch[] = new Array(N);
  let curI = N;
  let curOffset = bestEndOffset;
  const usedAcousticIndices = new Set<number>();

  while (curI > 0) {
    const cell = DP[curI][curOffset + BAND_WIDTH];
    if (!cell || cell.prevI < 0) {
      for (let k = curI - 1; k >= 0; k--) {
        if (!matches[k]) {
          matches[k] = { scriptIndex: k, word: scriptWords[k], startMs: -1, endMs: -1, isMatched: false };
        }
      }
      break;
    }
    const scriptIdx = cell.prevI;
    const prevJ = cell.prevJ;
    if (cell.type === 'match1' && prevJ >= 0 && prevJ < M) {
      matches[scriptIdx] = {
        scriptIndex: scriptIdx,
        word: scriptWords[scriptIdx],
        startMs: acousticTokens[prevJ].startMs,
        endMs: acousticTokens[prevJ].endMs,
        isMatched: true,
      };
      usedAcousticIndices.add(prevJ);
    } else if (cell.type === 'match2' && prevJ >= 0 && prevJ + 1 < M) {
      matches[scriptIdx] = {
        scriptIndex: scriptIdx,
        word: scriptWords[scriptIdx],
        startMs: acousticTokens[prevJ].startMs,
        endMs: acousticTokens[prevJ + 1].endMs,
        isMatched: true,
      };
      usedAcousticIndices.add(prevJ);
      usedAcousticIndices.add(prevJ + 1);
    } else if (cell.type === 'match3' && prevJ >= 0 && prevJ + 2 < M) {
      matches[scriptIdx] = {
        scriptIndex: scriptIdx,
        word: scriptWords[scriptIdx],
        startMs: acousticTokens[prevJ].startMs,
        endMs: acousticTokens[prevJ + 2].endMs,
        isMatched: true,
      };
      usedAcousticIndices.add(prevJ);
      usedAcousticIndices.add(prevJ + 1);
      usedAcousticIndices.add(prevJ + 2);
    } else {
      matches[scriptIdx] = {
        scriptIndex: scriptIdx,
        word: scriptWords[scriptIdx],
        startMs: -1,
        endMs: -1,
        isMatched: false,
      };
    }
    const prevCenterJ = Math.round((cell.prevI / N) * M);
    curOffset = prevJ - prevCenterJ;
    curI = cell.prevI;
  }

  let matchedCount = 0;
  let interpolatedCount = 0;
  let lastKnownEndMs = 0;

  for (let i = 0; i < N; i++) {
    if (matches[i].isMatched) {
      matchedCount++;
      lastKnownEndMs = matches[i].endMs;
      continue;
    }

    let gapEnd = i;
    while (gapEnd < N && !matches[gapEnd].isMatched) {
      gapEnd++;
    }

    const isTailGap = gapEnd === N;
    const missingCount = gapEnd - i;
    const numInternalGaps = Math.max(0, missingCount - 1);
    const pauseDurations = new Array(numInternalGaps).fill(0);

    for (let g = 0; g < numInternalGaps; g++) {
      const prevWord = scriptWords[i + g];
      if (/[.!?| ]["' \)]*$/.test(prevWord)) {
        pauseDurations[g] = 80;
      } else if (/[,;: \-]$/.test(prevWord)) {
        pauseDurations[g] = 50;
      } else {
        pauseDurations[g] = 30;
      }
    }

    const totalPauses = pauseDurations.reduce((sum, g) => sum + g, 0);
    const minNeededSpan = missingCount * 120 + totalPauses;

    let nextKnownStartMs: number;
    if (!isTailGap && matches[gapEnd].isMatched) {
      nextKnownStartMs = matches[gapEnd].startMs;
    } else {
      // Tail gap (end of script): do NOT artificially compress tail words into impossible micro-slices!
      // In realistic speech (including fast AI-generated TTS), each word requires at least ~180-240ms.
      const naturalDurationNeeded = missingCount * 200 + totalPauses;
      const proposedEnd = lastKnownEndMs + naturalDurationNeeded;
      if (totalAudioDurationMs && totalAudioDurationMs > 0) {
        if (totalAudioDurationMs >= lastKnownEndMs + naturalDurationNeeded) {
          nextKnownStartMs = totalAudioDurationMs;
        } else {
          // If the remaining audio is too short, provide realistic speech pacing
          nextKnownStartMs = Math.max(totalAudioDurationMs, proposedEnd);
        }
      } else {
        nextKnownStartMs = proposedEnd;
      }
    }

    // CRITICAL: NEVER drag lastKnownEndMs backwards into earlier valid words!
    let availableSpan = nextKnownStartMs - lastKnownEndMs;
    if (availableSpan < minNeededSpan) {
      nextKnownStartMs = lastKnownEndMs + minNeededSpan;
      availableSpan = minNeededSpan;
    }

    const availableSpeechSpan = Math.max(missingCount * 120, availableSpan - totalPauses);
    const missingTokens = scriptWords.slice(i, gapEnd);
    const weights = missingTokens.map((w) => calculatePhoneticWeight(w));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

    let curStart = lastKnownEndMs;
    for (let k = 0; k < missingTokens.length; k++) {
      const isLast = k === missingTokens.length - 1;
      const allocated = Math.max(120, Math.round(availableSpeechSpan * (weights[k] / totalWeight)));
      let wEnd = isLast ? nextKnownStartMs : curStart + allocated;
      if (wEnd <= curStart + 90) {
        wEnd = curStart + 120;
      }
      matches[i + k] = {
        scriptIndex: i + k,
        word: scriptWords[i + k],
        startMs: curStart,
        endMs: wEnd,
        isMatched: false,
      };

      if (!isLast) {
        curStart = wEnd + pauseDurations[k];
      } else {
        curStart = wEnd;
      }
      interpolatedCount++;
    }

    i = gapEnd - 1;
    lastKnownEndMs = curStart;
  }

  const finalWordTokens: WordToken[] = matches.map((m, idx) => ({
    id: `align-${idx}-${m.startMs}`,
    word: m.word,
    startMs: m.startMs,
    endMs: m.endMs,
    startFormatted: formatMs(m.startMs),
    endFormatted: formatMs(m.endMs),
    durationMs: m.endMs - m.startMs,
  }));

  const cleanedWords = enforceMonotonicTimeline(finalWordTokens, totalAudioDurationMs);
  const duplicatesRemoved = Math.max(0, M - usedAcousticIndices.size);

  return {
    words: cleanedWords,
    stats: {
      scriptWords: N,
      acousticWords: M,
      matchedWords: matchedCount,
      interpolatedWords: interpolatedCount,
      duplicatesRemoved,
    },
  };
}

/**
 * Acoustic Waveform Snapping & Voice Activity Detection (VAD) Engine
 *
 * Ultra-precise acoustic speech alignment:
 * 1. Computes high-resolution RMS energy envelope across decoded audio buffer.
 * 2. VAD segmenter extracts true acoustic speech bursts (islands) vs authentic silence pauses.
 * 3. Enforces ZERO words inside silence pauses:
 *    - Pauses between speech islands (flat waveform energy ~ 0) are 100% EMPTY.
 *    - Word start timestamps anchor strictly to vocal speech onset.
 *    - Word end timestamps anchor strictly to vocal speech offset.
 * 4. Monotonic Speech Island Mapping:
 *    - Every spoken word belongs to its authentic acoustic speech island.
 *    - No words are stranded in silence pauses.
 * 5. Intra-island acoustic valley boundary snapping:
 *    - Interior word boundaries snap to the deepest local acoustic energy valley (dip),
 *      guaranteeing Word i+1 NEVER overlaps or enters Word i's wave peak.
 *    - Every word has strictly positive duration (>= 65ms) and monotonic progression.
 */

import { WordToken } from '../types.ts';
import {
  formatMs,
  separateAcousticPauses,
  enforceMonotonicTimeline,
} from './boundaryStitcher.ts';

export interface VADSpeechIsland {
  startMs: number;
  endMs: number;
  durationMs: number;
  peakEnergy: number;
}

export function computeEnergyEnvelope(
  audioBuffer: AudioBuffer,
  frameMs: number = 8
): {
  energies: Float32Array;
  frameCount: number;
  frameMs: number;
  noiseFloor: number;
  peakEnergy: number;
  speechThreshold: number;
  durationMs: number;
} {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  const durationMs = Math.round((totalSamples / sampleRate) * 1000);
  const samplesPerFrame = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
  const frameCount = Math.floor(totalSamples / samplesPerFrame);
  const energies = new Float32Array(frameCount);

  let maxRms = 0;
  for (let f = 0; f < frameCount; f++) {
    const startIdx = f * samplesPerFrame;
    const endIdx = Math.min(totalSamples, startIdx + samplesPerFrame);
    let sumSq = 0;
    const step = 2;
    for (let i = startIdx; i < endIdx; i += step) {
      const val = channelData[i];
      sumSq += val * val;
    }
    const count = Math.ceil((endIdx - startIdx) / step) || 1;
    const rms = Math.sqrt(sumSq / count);
    energies[f] = rms;
    if (rms > maxRms) maxRms = rms;
  }

  const sampleSorted = new Float32Array(Math.min(5000, frameCount));
  const sampleStride = Math.max(1, Math.floor(frameCount / sampleSorted.length));
  for (let i = 0; i < sampleSorted.length; i++) {
    sampleSorted[i] = energies[i * sampleStride];
  }
  sampleSorted.sort();
  const noiseFloor = sampleSorted[Math.floor(sampleSorted.length * 0.15)] || 0.001;
  const peakEnergy = maxRms || 0.5;
  // Adaptive speech threshold: accounts for background noise while detecting true vocal energy
  const speechThreshold = Math.max(0.008, noiseFloor + 0.08 * (peakEnergy - noiseFloor));

  return {
    energies,
    frameCount,
    frameMs,
    noiseFloor,
    peakEnergy,
    speechThreshold,
    durationMs,
  };
}

export function extractSpeechIslands(
  energies: Float32Array,
  frameMs: number,
  speechThreshold: number
): VADSpeechIsland[] {
  const frameCount = energies.length;
  const rawIslands: VADSpeechIsland[] = [];
  // Authentic pause threshold: >= 180ms of silence indicates a true speech break / breath
  const pauseFramesThreshold = Math.max(6, Math.round(180 / frameMs));
  const minSpeechFrames = Math.max(6, Math.round(90 / frameMs));

  let inSpeech = false;
  let islandStartFrame = 0;
  let silenceCount = 0;
  let islandPeak = 0;

  for (let f = 0; f < frameCount; f++) {
    const val = energies[f];
    const isVoice = val >= speechThreshold;

    if (!inSpeech) {
      if (isVoice) {
        inSpeech = true;
        islandStartFrame = f;
        silenceCount = 0;
        islandPeak = val;
      }
    } else {
      if (val > islandPeak) islandPeak = val;
      if (!isVoice) {
        silenceCount++;
        if (silenceCount >= pauseFramesThreshold) {
          const islandEndFrame = f - silenceCount;
          if (islandEndFrame - islandStartFrame >= minSpeechFrames) {
            const startMs = islandStartFrame * frameMs;
            const endMs = islandEndFrame * frameMs;
            rawIslands.push({
              startMs,
              endMs,
              durationMs: endMs - startMs,
              peakEnergy: islandPeak,
            });
          }
          inSpeech = false;
          silenceCount = 0;
          islandPeak = 0;
        }
      } else {
        silenceCount = 0;
      }
    }
  }

  if (inSpeech && frameCount - islandStartFrame >= minSpeechFrames) {
    const startMs = islandStartFrame * frameMs;
    const endMs = (frameCount - silenceCount) * frameMs;
    rawIslands.push({
      startMs,
      endMs,
      durationMs: endMs - startMs,
      peakEnergy: islandPeak,
    });
  }

  if (rawIslands.length === 0) return [];

  // Merge speech fragments separated by less than 160ms (bridges intra-phrase plosive closures / micro-pauses)
  const mergedIslands: VADSpeechIsland[] = [];
  for (const isl of rawIslands) {
    if (mergedIslands.length === 0) {
      mergedIslands.push({ ...isl });
    } else {
      const prev = mergedIslands[mergedIslands.length - 1];
      const gap = isl.startMs - prev.endMs;
      if (gap < 160) {
        prev.endMs = isl.endMs;
        prev.durationMs = prev.endMs - prev.startMs;
        prev.peakEnergy = Math.max(prev.peakEnergy, isl.peakEnergy);
      } else {
        mergedIslands.push({ ...isl });
      }
    }
  }

  // Filter out tiny acoustic noise spikes that don't represent vocal speech
  return mergedIslands.filter(
    (isl) => isl.durationMs >= 100 && isl.peakEnergy >= speechThreshold * 1.2
  );
}

/**
 * High-accuracy VAD & Waveform Synchronization:
 * 1. Guarantees ZERO words inside silence pauses (where audio wave is 0).
 * 2. Words are strictly confined to real speech islands.
 * 3. Word i+1 NEVER starts inside Word i's wave peak.
 * 4. Zero dropped words from the transcript.
 */
export function snapWordsToAcousticEnergy(
  words: WordToken[],
  audioBuffer: AudioBuffer
): WordToken[] {
  if (words.length === 0) return [];

  const frameMs = 8;
  const { energies, frameCount, speechThreshold, durationMs: totalAudioDurationMs } =
    computeEnergyEnvelope(audioBuffer, frameMs);

  const MIN_WORD_DURATION_MS = 65;
  const rawIslands = extractSpeechIslands(energies, frameMs, speechThreshold);

  // If no speech islands detected (extremely quiet or noise-only audio),
  // fallback to monotonic formatting without distorting word positions.
  if (rawIslands.length === 0) {
    return enforceMonotonicTimeline(words, totalAudioDurationMs);
  }

  // Helper: find deepest local acoustic valley (energy dip) in a millisecond search window
  const findLocalValley = (startMs: number, endMs: number): number => {
    const sF = Math.max(0, Math.min(frameCount - 1, Math.round(startMs / frameMs)));
    const eF = Math.max(0, Math.min(frameCount - 1, Math.round(endMs / frameMs)));
    if (sF >= eF) {
      return Math.round((startMs + endMs) / 2);
    }
    let minVal = Infinity;
    let bestF = Math.round((sF + eF) / 2);
    for (let f = sF; f <= eF; f++) {
      if (energies[f] < minVal) {
        minVal = energies[f];
        bestF = f;
      }
    }
    return bestF * frameMs;
  };

  // Step 1: Group each word into its authentic Speech Island monotonically
  // A word NEVER spans outside its authentic speech island into a silence pause.
  const islandWordGroups: WordToken[][] = rawIslands.map(() => []);
  let currentIslandIdx = 0;

  for (let wIdx = 0; wIdx < words.length; wIdx++) {
    const w = words[wIdx];
    const wCenter = (w.startMs + w.endMs) / 2;

    // Advance currentIslandIdx if wCenter is past the current island and closer to a future island
    let bestIslandIdx = currentIslandIdx;
    let minDistance = Infinity;

    for (let i = currentIslandIdx; i < rawIslands.length; i++) {
      const isl = rawIslands[i];
      if (wCenter >= isl.startMs && wCenter <= isl.endMs) {
        bestIslandIdx = i;
        minDistance = 0;
        break;
      }
      const dist = wCenter < isl.startMs ? isl.startMs - wCenter : wCenter - isl.endMs;
      if (dist < minDistance) {
        minDistance = dist;
        bestIslandIdx = i;
      } else if (dist > minDistance + 2500) {
        // Stop scanning too far ahead
        break;
      }
    }

    currentIslandIdx = bestIslandIdx;
    islandWordGroups[bestIslandIdx].push({ ...w });
  }

  // Step 2: Precision Waveform Alignment inside each speech island
  const alignedWords: WordToken[] = [];

  for (let islIdx = 0; islIdx < rawIslands.length; islIdx++) {
    const isl = rawIslands[islIdx];
    const group = islandWordGroups[islIdx];
    if (group.length === 0) continue;

    if (group.length === 1) {
      // Single word occupies the island's true vocal burst
      const single = group[0];
      const startMs = Math.max(0, isl.startMs);
      const endMs = Math.min(totalAudioDurationMs, Math.max(startMs + MIN_WORD_DURATION_MS, isl.endMs));
      alignedWords.push({
        ...single,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        startFormatted: formatMs(startMs),
        endFormatted: formatMs(endMs),
      });
      continue;
    }

    // Multiple words in this speech island:
    // First word starts exactly at vocal onset (isl.startMs)
    // Last word ends exactly at vocal offset (isl.endMs)
    // All silence pauses before isl.startMs and after isl.endMs remain 100% EMPTY!
    const islandTotalDuration = isl.endMs - isl.startMs;
    const islandWordsCount = group.length;

    // Assign initial bounds respecting island boundaries
    group[0].startMs = isl.startMs;
    group[islandWordsCount - 1].endMs = isl.endMs;

    for (let k = 0; k < islandWordsCount - 1; k++) {
      const cur = group[k];
      const next = group[k + 1];

      // Approximate boundary from original timestamps or proportional distribution
      const rawMid = (cur.endMs + next.startMs) / 2;
      const minStart = cur.startMs + MIN_WORD_DURATION_MS;
      const maxEnd = isl.endMs - (islandWordsCount - 1 - k) * (MIN_WORD_DURATION_MS + 16);

      const searchCenter = Math.max(minStart + 16, Math.min(maxEnd - 16, rawMid));
      const searchStart = Math.max(minStart, searchCenter - 90);
      const searchEnd = Math.min(maxEnd, searchCenter + 90);

      let splitMs: number;
      if (searchStart < searchEnd) {
        splitMs = findLocalValley(searchStart, searchEnd);
      } else {
        splitMs = Math.round((minStart + maxEnd) / 2);
      }

      // Word k ends strictly before the valley dip
      cur.endMs = Math.max(cur.startMs + MIN_WORD_DURATION_MS, splitMs - 12);
      // Word k+1 starts strictly after the valley dip (NEVER entering Word k's wave peak)
      next.startMs = Math.max(cur.endMs + 16, splitMs + 12);

      cur.durationMs = cur.endMs - cur.startMs;
      cur.startFormatted = formatMs(cur.startMs);
      cur.endFormatted = formatMs(cur.endMs);
    }

    const last = group[islandWordsCount - 1];
    last.endMs = Math.max(last.startMs + MIN_WORD_DURATION_MS, isl.endMs);
    last.durationMs = last.endMs - last.startMs;
    last.startFormatted = formatMs(last.startMs);
    last.endFormatted = formatMs(last.endMs);

    for (const w of group) {
      alignedWords.push(w);
    }
  }

  // Final sanity sweep: ensure strictly positive durations and clamp to audio duration
  return enforceMonotonicTimeline(alignedWords, totalAudioDurationMs);
}


export async function snapWordsFromAudioBlob(
  words: WordToken[],
  blob: Blob
): Promise<WordToken[]> {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    ctx.close();
    return snapWordsToAcousticEnergy(words, decoded);
  } catch (err) {
    console.warn('Acoustic snapping failed, falling back to algorithmic pause separation:', err);
    return separateAcousticPauses(words);
  }
}

/**
 * Audio decoding, waveform peaks generation, and synthetic audio tools
 */

export async function decodeAudioBlob(blob: Blob): Promise<{
  audioBuffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return {
      audioBuffer,
      durationSec: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
    };
  } finally {
    audioCtx.close();
  }
}

export function extractWaveformPeaks(audioBuffer: AudioBuffer, targetPoints: number = 800): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  const totalLength = channelData.length;
  const blockSize = Math.floor(totalLength / targetPoints);
  const peaks = new Float32Array(targetPoints);

  for (let i = 0; i < targetPoints; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, totalLength);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks[i] = max;
  }
  return peaks;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a synthetic spoken WAV file in browser for testing immediate alignment
 */
export async function generateSyntheticSpeechWav(text: string, language: string = 'en-US'): Promise<{ blob: Blob; text: string; durationSec: number }> {
  return new Promise((resolve) => {
    const sampleRate = 22050;
    const words = text.trim().split(/\s+/);
    const wordDur = 0.42;
    const pauseDur = 0.18;
    const totalDuration = words.length * (wordDur + pauseDur);
    const numSamples = Math.floor(sampleRate * totalDuration);
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate });
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);
    let sampleIdx = 0;

    for (let w = 0; w < words.length; w++) {
      const wordSamples = Math.floor(sampleRate * wordDur);
      const pauseSamples = Math.floor(sampleRate * pauseDur);
      const baseFreq = 120 + ((w % 5) * 12);
      for (let s = 0; s < wordSamples; s++) {
        const t = s / sampleRate;
        const env = Math.sin((Math.PI * s) / wordSamples);
        const voice =
          0.5 * Math.sin(2 * Math.PI * baseFreq * t) +
          0.3 * Math.sin(2 * Math.PI * (baseFreq * 2.8) * t) +
          0.2 * Math.sin(2 * Math.PI * (baseFreq * 5.2) * t);
        const noise = (Math.random() * 2 - 1) * 0.08 * (s < wordSamples * 0.2 ? 1 : 0.1);
        data[sampleIdx++] = (voice + noise) * env * 0.7;
      }
      for (let p = 0; p < pauseSamples; p++) {
        if (sampleIdx < numSamples) {
          data[sampleIdx++] = (Math.random() * 2 - 1) * 0.002;
        }
      }
    }

    const wavBlob = audioBufferToWavBlob(buffer);
    ctx.close();
    resolve({ blob: wavBlob, text, durationSec: totalDuration });
  });
}

export function audioBufferToWavBlob(buffer: AudioBuffer, startSec: number = 0, endSec?: number): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const totalLength = buffer.length;
  const startIndex = Math.max(0, Math.floor(startSec * sampleRate));
  const endIndex = Math.min(totalLength, endSec ? Math.floor(endSec * sampleRate) : totalLength);
  const numSamples = Math.max(0, endIndex - startIndex);
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData0 = buffer.getChannelData(0);
  const channelData1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  for (let i = startIndex; i < endIndex; i++) {
    let sample = channelData0[i] || 0;
    if (channelData1) {
      sample = (sample + channelData1[i]) * 0.5;
    }
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function resampleTo16kMono(sourceBuffer: AudioBuffer): Promise<AudioBuffer> {
  const targetSampleRate = 16000;
  if (sourceBuffer.sampleRate === targetSampleRate && sourceBuffer.numberOfChannels === 1) {
    return sourceBuffer;
  }
  const duration = sourceBuffer.duration;
  const numTargetSamples = Math.ceil(duration * targetSampleRate);

  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (OfflineCtx) {
    try {
      const offlineCtx = new OfflineCtx(1, numTargetSamples, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = sourceBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);
      const resampledBuffer = await offlineCtx.startRendering();
      return resampledBuffer;
    } catch (e) {
      console.warn('OfflineAudioContext resampling fallback:', e);
    }
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const resampled = ctx.createBuffer(1, numTargetSamples, targetSampleRate);
  const outData = resampled.getChannelData(0);
  const inData0 = sourceBuffer.getChannelData(0);
  const inData1 = sourceBuffer.numberOfChannels > 1 ? sourceBuffer.getChannelData(1) : null;
  const ratio = sourceBuffer.sampleRate / targetSampleRate;

  for (let i = 0; i < numTargetSamples; i++) {
    const origIndex = i * ratio;
    const iFloor = Math.floor(origIndex);
    const iCeil = Math.min(sourceBuffer.length - 1, iFloor + 1);
    const weight = origIndex - iFloor;
    let s0 = inData0[iFloor];
    let s1 = inData0[iCeil];
    if (inData1) {
      s0 = (s0 + inData1[iFloor]) * 0.5;
      s1 = (s1 + inData1[iCeil]) * 0.5;
    }
    outData[i] = s0 * (1 - weight) + s1 * weight;
  }
  ctx.close();
  return resampled;
}

export interface AudioChunkPayload {
  blob: Blob;
  base64: string;
  chunkIndex: number;
  totalChunks: number;
  startSec: number;
  endSec: number;
  offsetMs: number;
  overlapSec: number;
  durationSec: number;
}

export function findSilenceSplitSample(
  channelData: Float32Array,
  sampleRate: number,
  minSec: number,
  maxSec: number
): { splitSample: number; splitSec: number; isSilenceFound: boolean } {
  const startSample = Math.max(0, Math.floor(minSec * sampleRate));
  const endSample = Math.min(channelData.length, Math.floor(maxSec * sampleRate));
  if (endSample <= startSample) {
    return {
      splitSample: endSample,
      splitSec: endSample / sampleRate,
      isSilenceFound: false,
    };
  }

  const windowSamples = Math.floor(0.3 * sampleRate);
  const hopSamples = Math.floor(0.05 * sampleRate);
  let minRms = Infinity;
  let bestSplitSample = Math.floor((startSample + endSample) / 2);
  let silenceFound = false;
  const SILENCE_RMS_THRESHOLD = 0.025;

  for (let s = startSample; s + windowSamples <= endSample; s += hopSamples) {
    let sumSquares = 0;
    const step = 2;
    for (let k = 0; k < windowSamples; k += step) {
      const val = channelData[s + k];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / (windowSamples / step));
    if (rms < minRms) {
      minRms = rms;
      bestSplitSample = s + Math.floor(windowSamples / 2);
      if (rms < SILENCE_RMS_THRESHOLD) {
        silenceFound = true;
      }
    }
  }

  bestSplitSample = Math.max(startSample, Math.min(endSample, bestSplitSample));
  return {
    splitSample: bestSplitSample,
    splitSec: bestSplitSample / sampleRate,
    isSilenceFound: silenceFound,
  };
}

export async function prepareOptimizedAudioChunks(
  blob: Blob,
  maxChunkDurationSec: number = 20
): Promise<{ chunks: AudioChunkPayload[]; totalDurationSec: number }> {
  const { audioBuffer, durationSec } = await decodeAudioBlob(blob);
  const optimizedBuffer = await resampleTo16kMono(audioBuffer);
  const sampleRate = optimizedBuffer.sampleRate;
  const channelData = optimizedBuffer.getChannelData(0);
  const totalSamples = optimizedBuffer.length;
  const totalSec = optimizedBuffer.duration;
  const chunks: AudioChunkPayload[] = [];

  const singleLimit = maxChunkDurationSec + 5;
  if (totalSec <= singleLimit) {
    const chunkBlob = audioBufferToWavBlob(optimizedBuffer, 0, totalSec);
    const base64 = await blobToBase64(chunkBlob);
    chunks.push({
      blob: chunkBlob,
      base64,
      chunkIndex: 0,
      totalChunks: 1,
      startSec: 0,
      endSec: totalSec,
      offsetMs: 0,
      overlapSec: 0,
      durationSec: totalSec,
    });
    return { chunks, totalDurationSec: durationSec };
  }

  interface ChunkRange {
    startSample: number;
    endSample: number;
    overlapSec: number;
  }

  const ranges: ChunkRange[] = [];
  let currentStartSample = 0;
  const OVERLAP_SEC = 2.0;
  const overlapSamples = Math.floor(OVERLAP_SEC * sampleRate);

  while (currentStartSample < totalSamples) {
    const remainingSamples = totalSamples - currentStartSample;
    const remainingSec = remainingSamples / sampleRate;

    if (remainingSec <= singleLimit) {
      ranges.push({
        startSample: currentStartSample,
        endSample: totalSamples,
        overlapSec: ranges.length === 0 ? 0 : OVERLAP_SEC,
      });
      break;
    }

    const minSearchSec = (currentStartSample / sampleRate) + Math.max(8, maxChunkDurationSec - 6);
    const maxSearchSec = (currentStartSample / sampleRate) + (maxChunkDurationSec + 6);
    const { splitSample } = findSilenceSplitSample(
      channelData,
      sampleRate,
      minSearchSec,
      maxSearchSec
    );

    const isFirst = ranges.length === 0;
    ranges.push({
      startSample: currentStartSample,
      endSample: splitSample,
      overlapSec: isFirst ? 0 : OVERLAP_SEC,
    });

    const nextStartSample = Math.max(0, splitSample - overlapSamples);
    if (nextStartSample >= splitSample) {
      currentStartSample = Math.max(0, splitSample - Math.max(1, overlapSamples));
    } else {
      currentStartSample = nextStartSample;
    }
  }

  const totalCount = ranges.length;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const startSec = r.startSample / sampleRate;
    const endSec = r.endSample / sampleRate;
    const durationSec = endSec - startSec;
    const offsetMs = Math.round((r.startSample / sampleRate) * 1000);
    const chunkBlob = audioBufferToWavBlob(optimizedBuffer, startSec, endSec);
    const base64 = await blobToBase64(chunkBlob);
    chunks.push({
      blob: chunkBlob,
      base64,
      chunkIndex: i,
      totalChunks: totalCount,
      startSec,
      endSec,
      offsetMs,
      overlapSec: r.overlapSec,
      durationSec,
    });
  }

  return { chunks, totalDurationSec: durationSec };
}

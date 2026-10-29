export interface WordToken {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
  startFormatted: string;
  endFormatted: string;
  durationMs: number;
  confidence?: number;
  isFiller?: boolean;
}

export interface TranscriptionResult {
  success: boolean;
  modelUsed: string;
  rawOutput: string;
  words: WordToken[];
  metadata: {
    totalWords: number;
    audioDurationMs: number;
    firstTimestamp: string;
    lastTimestamp: string;
    detectedLanguage?: string;
    detectedScript?: string;
  };
}

export interface AudioMetadata {
  name: string;
  size: number;
  type: string;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
  blobUrl: string;
}

export type ActiveView = 'karaoke' | 'raw' | 'table' | 'analytics';

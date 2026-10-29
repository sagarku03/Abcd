import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { AudioUploader } from './components/AudioUploader.tsx';
import { WaveformTimeline } from './components/WaveformTimeline.tsx';
import { RawTranscriptView } from './components/RawTranscriptView.tsx';
import { KaraokeView } from './components/KaraokeView.tsx';
import { WordEditorTable } from './components/WordEditorTable.tsx';
import { AnalyticsPanel } from './components/AnalyticsPanel.tsx';
import { ExportModal } from './components/ExportModal.tsx';
import { RulesModal } from './components/RulesModal.tsx';
import { ScriptAlignmentModal } from './components/ScriptAlignmentModal.tsx';
import { WordToken } from './types.ts';
import { WhisperConfig } from './components/AudioUploader.tsx';
import { prepareOptimizedAudioChunks } from './utils/audioHelper.ts';
import {
  stitchChunkTokens,
  enforceMonotonicTimeline,
  detectDominantScript,
} from './utils/boundaryStitcher.ts';
import { alignScriptWithAcousticTokens } from './utils/scriptAligner.ts';
import { snapWordsFromAudioBlob } from './utils/acousticAligner.ts';
import {
  FileText,
  Sparkles,
  Sliders,
  BarChart3,
  Download,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  saveSessionToStorage,
  loadSessionFromStorage,
  clearSessionFromStorage,
} from './utils/storage.ts';

export default function App() {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState<number>(0);
  const [fileName, setFileName] = useState<string>('');
  const [words, setWords] = useState<WordToken[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<string>('');
  const [modelUsed, setModelUsed] = useState<string>('gemini-3.8-flash');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionRestored, setSessionRestored] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'strict' | 'karaoke' | 'table' | 'analytics'>('strict');
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isRulesOpen, setIsRulesOpen] = useState<boolean>(false);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState<boolean>(false);
  const [currentScriptText, setCurrentScriptText] = useState<string>('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Screen WakeLock to prevent mobile browser / screen from sleeping during processing
  const requestScreenWakeLock = async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch (err) {
      console.debug('Wake lock error or unsupported:', err);
    }
  };

  const releaseScreenWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (err) {
      console.debug('Wake lock release error:', err);
    }
  };

  // Restore saved session from IndexedDB on initial mount
  useEffect(() => {
    loadSessionFromStorage()
      .then((saved) => {
        if (saved && saved.words && saved.words.length > 0 && saved.audioBlob) {
          setAudioBlob(saved.audioBlob);
          setFileName(saved.fileName || 'Audio');
          setAudioDurationSec(saved.audioDurationSec || 0);
          setWords(enforceMonotonicTimeline(saved.words, (saved.audioDurationSec || 0) * 1000));
          if (saved.modelUsed) setModelUsed(saved.modelUsed);
          if (saved.scriptText) setCurrentScriptText(saved.scriptText);
          setSessionRestored(true);
        }
      })
      .catch((err) => {
        console.warn('Could not restore session from storage:', err);
      });
  }, []);

  // Automatically save session to IndexedDB whenever words or audio change
  useEffect(() => {
    if (audioBlob && words.length > 0 && !isProcessing) {
      saveSessionToStorage({
        fileName,
        audioBlob,
        audioDurationSec,
        mimeType: 'audio/wav',
        words,
        modelUsed,
        scriptText: currentScriptText,
      }).catch((err) => {
        console.warn('Auto-save to storage failed:', err);
      });
    }
  }, [words, audioBlob, fileName, audioDurationSec, modelUsed, currentScriptText, isProcessing]);

  // Warn before accidental reload/exit when processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = 'Transcription process abhi chal raha hai. Refresh karne par process stop ho jayega.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing]);

  // Sync audio URL when blob changes
  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setAudioUrl(null);
    }
  }, [audioBlob]);

  const lastActiveWordIdxRef = useRef<number>(-1);

  // High-frequency playback time synchronizer for millisecond precision
  const updatePlayhead = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      const currentMs = Math.round(audioRef.current.currentTime * 1000);
      setCurrentTimeMs(currentMs);
      const idx = words.findIndex((w) => currentMs >= w.startMs && currentMs <= w.endMs);
      if (idx !== lastActiveWordIdxRef.current) {
        lastActiveWordIdxRef.current = idx;
        setActiveWordIndex(idx);
      }
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    }
  }, [words]);

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, updatePlayhead]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => console.warn(e));
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (targetMs: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = targetMs / 1000;
    setCurrentTimeMs(targetMs);
    const idx = words.findIndex((w) => targetMs >= w.startMs && targetMs <= w.endMs);
    lastActiveWordIdxRef.current = idx;
    setActiveWordIndex(idx);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAudioReady = async ({
    blob,
    fileName,
    durationSec,
    referenceTranscript,
    languageHint,
    modelChoice,
    engineType = 'whisper',
    whisperConfig,
  }: {
    blob: Blob;
    base64?: string;
    mimeType: string;
    fileName: string;
    durationSec: number;
    referenceTranscript?: string;
    languageHint: string;
    modelChoice: string;
    engineType?: 'gemini' | 'whisper';
    whisperConfig?: WhisperConfig;
  }) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSessionRestored(false);
    setAudioBlob(blob);
    setFileName(fileName);
    setAudioDurationSec(durationSec);

    await requestScreenWakeLock();

    try {
      let finalTimelineWords: WordToken[] = [];
      let finalModelUsed = modelChoice;

      if (engineType === 'whisper') {
        // Whisper Engine: single-pass for files under 24MB, or chunked for large files
        const isSinglePass = blob.size < 24 * 1024 * 1024;

        if (isSinglePass) {
          setProcessingProgress('Transcribing audio with Whisper Engine (single-pass word-level timestamps)...');
          document.title = 'Transcribing with Whisper...';
          const audioBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result as string;
              resolve(res.split(',')[1] || '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const resp = await fetch('/api/transcribe-whisper', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: 'audio/wav',
              durationSec,
              provider: whisperConfig?.provider || 'groq',
              apiKey: whisperConfig?.apiKey,
              model: whisperConfig?.model || 'whisper-large-v3',
              languageHint,
              referenceTranscript,
            }),
          });

          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data.error || `Whisper error (status ${resp.status})`);
          }

          finalTimelineWords = data.words || [];
          finalModelUsed = data.modelUsed || 'Whisper';
        } else {
          setProcessingProgress('Optimizing large audio acoustics for Whisper...');
          const { chunks, totalDurationSec } = await prepareOptimizedAudioChunks(blob, 20);
          setAudioDurationSec(totalDurationSec);

          const chunkResults: WordToken[][] = new Array(chunks.length);
          for (let i = 0; i < chunks.length; i++) {
            setProcessingProgress(`Transcribing with Whisper (segment ${i + 1} of ${chunks.length})...`);
            const chunk = chunks[i];
            const resp = await fetch('/api/transcribe-whisper', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: chunk.base64,
                mimeType: 'audio/wav',
                durationSec: chunk.durationSec,
                timeOffsetMs: chunk.offsetMs,
                provider: whisperConfig?.provider || 'groq',
                apiKey: whisperConfig?.apiKey,
                model: whisperConfig?.model || 'whisper-large-v3',
                languageHint,
                chunkIndex: i,
                totalChunks: chunks.length,
              }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || `Chunk ${i + 1} failed`);
            chunkResults[i] = data.words || [];
          }

          let stitched: WordToken[] = enforceMonotonicTimeline(chunkResults[0] || []);
          for (let i = 1; i < chunks.length; i++) {
            const nextWords = chunkResults[i];
            if (nextWords && nextWords.length > 0) {
              stitched = stitchChunkTokens(stitched, nextWords, Math.round((chunks[i].overlapSec || 2.0) * 1000));
            }
          }
          finalTimelineWords = enforceMonotonicTimeline(stitched, totalDurationSec * 1000);
          finalModelUsed = `Whisper (${whisperConfig?.model || 'whisper-large-v3'})`;
        }
      } else {
        // Gemini AI Engine: parallel chunks (CONCURRENCY = 3, ~20s chunks)
        setProcessingProgress('Optimizing audio acoustics & resampling (16kHz mono)...');
        document.title = 'Optimizing audio...';
        const { chunks, totalDurationSec } = await prepareOptimizedAudioChunks(blob, 20);
        setAudioDurationSec(totalDurationSec);

        const transcribeChunk = async (
          chunk: typeof chunks[0],
          activeScript?: string
        ): Promise<{ words: WordToken[]; modelUsed?: string; detectedScript?: string }> => {
          let lastErr: any = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const resp = await fetch('/api/transcribe', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioBase64: chunk.base64,
                  mimeType: 'audio/wav',
                  durationSec: chunk.durationSec,
                  timeOffsetMs: chunk.offsetMs,
                  referenceTranscript: chunks.length === 1 ? referenceTranscript : undefined,
                  languageHint,
                  modelChoice,
                  lockedScript: activeScript,
                  chunkIndex: chunk.chunkIndex,
                  totalChunks: chunks.length,
                }),
              });
              const contentType = resp.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                const data = await resp.json();
                if (resp.ok && data.words && Array.isArray(data.words)) {
                  return {
                    words: data.words,
                    modelUsed: data.modelUsed,
                    detectedScript: data.metadata?.detectedScript,
                  };
                }
                throw new Error(data.error || `HTTP ${resp.status}`);
              } else {
                if (resp.status === 413) {
                  throw new Error('Audio segment exceeded HTTP upload limits.');
                }
                throw new Error(`Server returned status ${resp.status}`);
              }
            } catch (err: any) {
              lastErr = err;
              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
              }
            }
          }
          throw lastErr || new Error(`Failed to transcribe chunk ${chunk.chunkIndex + 1}`);
        };

        const chunkResults: WordToken[][] = new Array(chunks.length);
        let lastModel = modelChoice;
        let lockedScript: string | undefined = undefined;

        setProcessingProgress(
          chunks.length > 1
            ? `Transcribing segment 1 of ${chunks.length} (locking acoustic script)...`
            : 'Analyzing speech and calculating millisecond timestamps...'
        );
        document.title = chunks.length > 1 ? `(1/${chunks.length}) Transcribing...` : 'Transcribing speech...';
        const firstChunkResult = await transcribeChunk(chunks[0]);
        chunkResults[0] = firstChunkResult.words;
        if (firstChunkResult.modelUsed) lastModel = firstChunkResult.modelUsed;
        lockedScript = firstChunkResult.detectedScript || detectDominantScript(firstChunkResult.words);

        if (chunks.length > 1) {
          let completedCount = 1;
          setProcessingProgress(
            `Transcribing speech segments in parallel (1/${chunks.length} complete — ${Math.round((1 / chunks.length) * 100)}%)...`
          );
          const remainingIndices = Array.from({ length: chunks.length - 1 }, (_, idx) => idx + 1);
          const CONCURRENCY = 3;
          let queueIndex = 0;
          const workers = Array.from({ length: Math.min(CONCURRENCY, remainingIndices.length) }, async (_, workerId: number) => {
            if (workerId > 0) {
              await new Promise((r) => setTimeout(r, 300 * workerId));
            }
            while (queueIndex < remainingIndices.length) {
              const currentIdx = remainingIndices[queueIndex++];
              const chunk = chunks[currentIdx];
              const result = await transcribeChunk(chunk, lockedScript);
              chunkResults[currentIdx] = result.words;
              if (result.modelUsed) lastModel = result.modelUsed;
              completedCount++;
              const pct = Math.round((completedCount / chunks.length) * 100);
              setProcessingProgress(
                `Transcribing speech segments in parallel (${completedCount}/${chunks.length} complete — ${pct}%)...`
              );
              document.title = `(${pct}%) Transcribing audio...`;
            }
          });
          await Promise.all(workers);
        }

        setProcessingProgress('Stitching unified timeline and enforcing monotonic alignment...');
        document.title = 'Stitching timeline...';
        let allWords: WordToken[] = enforceMonotonicTimeline(chunkResults[0] || []);
        for (let i = 1; i < chunks.length; i++) {
          const nextWords = chunkResults[i];
          if (!nextWords || nextWords.length === 0) continue;
          const overlapWindowMs = Math.round((chunks[i].overlapSec || 2.0) * 1000);
          allWords = stitchChunkTokens(allWords, nextWords, overlapWindowMs);
        }
        finalTimelineWords = enforceMonotonicTimeline(allWords, totalDurationSec * 1000);
        finalModelUsed = lastModel;
      }

      if (referenceTranscript && referenceTranscript.trim()) {
        setProcessingProgress('Applying 100% exact script alignment & removing duplicate hallucinations...');
        document.title = 'Aligning exact script...';
        setCurrentScriptText(referenceTranscript.trim());
        const alignedResult = alignScriptWithAcousticTokens(
          referenceTranscript.trim(),
          finalTimelineWords,
          durationSec * 1000
        );
        finalTimelineWords = alignedResult.words;
      }

      setProcessingProgress('Performing 100% waveform acoustic alignment & zero-silence snapping (VAD)...');
      document.title = 'Acoustic waveform sync...';
      const finalProcessedWords = await snapWordsFromAudioBlob(finalTimelineWords, blob);
      const sanitizedWords = enforceMonotonicTimeline(finalProcessedWords, durationSec * 1000);
      setWords(sanitizedWords);
      setModelUsed(finalModelUsed);
      document.title = 'AlignPulse - Completed';
    } catch (err: any) {
      console.error('Transcription failed:', err);
      setErrorMessage(err?.message || 'Error occurred during forced alignment analysis.');
      document.title = 'AlignPulse - Error';
    } finally {
      await releaseScreenWakeLock();
      setIsProcessing(false);
      setProcessingProgress('');
    }
  };

  const handleReset = async () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setWords([]);
    setCurrentTimeMs(0);
    setIsPlaying(false);
    setActiveWordIndex(-1);
    setErrorMessage(null);
    setSessionRestored(false);
    setCurrentScriptText('');
    await clearSessionFromStorage();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-zinc-950">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          preload="auto"
        />
      )}

      <Header
        hasAudio={!!audioBlob}
        hasWords={words.length > 0}
        isProcessing={isProcessing}
        modelUsed={modelUsed}
        onReset={handleReset}
        onOpenHelp={() => setIsRulesOpen(true)}
        onOpenScriptModal={() => setIsScriptModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 space-y-6">
        {sessionRestored && words.length > 0 && (
          <div className="p-3.5 rounded-xl bg-cyan-950/60 border border-cyan-700/60 text-cyan-200 text-xs flex items-center justify-between gap-3 shadow-lg shadow-cyan-950/30 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <span className="font-semibold text-white">Previous session auto-restored:</span>{' '}
                <span>"{fileName}" ({words.length} words — {Math.round(audioDurationSec)}s) aapki local memory se wapas load ho gaya!</span>
              </div>
            </div>
            <button
              onClick={() => setSessionRestored(false)}
              className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-200 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Analysis Error</div>
              <div className="text-rose-300 text-xs mt-0.5">{errorMessage}</div>
            </div>
          </div>
        )}

        {words.length === 0 && (
          <AudioUploader
            onAudioReady={handleAudioReady}
            isProcessing={isProcessing}
            processingProgress={processingProgress}
          />
        )}

        {words.length > 0 && audioBlob && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <WaveformTimeline
              audioBlob={audioBlob}
              audioDurationSec={audioDurationSec}
              words={words}
              currentTimeMs={currentTimeMs}
              isPlaying={isPlaying}
              activeWordIndex={activeWordIndex}
              onSeek={handleSeek}
              onTogglePlay={togglePlay}
              onSelectWord={(word, index) => {
                setActiveWordIndex(index);
                handleSeek(word.startMs);
              }}
              onUpdateWords={(newWords) => setWords(newWords)}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold">
                <button
                  onClick={() => setActiveView('strict')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                    activeView === 'strict'
                      ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Strict Engine Output</span>
                </button>
                <button
                  onClick={() => setActiveView('karaoke')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                    activeView === 'karaoke'
                      ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Karaoke Flow</span>
                </button>
                <button
                  onClick={() => setActiveView('table')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                    activeView === 'table'
                      ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Millisecond Fine-Tuning</span>
                </button>
                <button
                  onClick={() => setActiveView('analytics')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                    activeView === 'analytics'
                      ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Continuity & Audit</span>
                </button>
              </div>

              <button
                onClick={() => setIsExportOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:opacity-90 text-white text-xs font-bold shadow-lg shadow-cyan-500/10 transition-all hover:scale-105"
              >
                <Download className="w-4 h-4" />
                <span>Export Formats (SRT, VTT, JSON, TXT)</span>
              </button>
            </div>

            {activeView === 'strict' && (
              <RawTranscriptView
                words={words}
                activeWordIndex={activeWordIndex}
                onSeek={handleSeek}
                onUpdateWords={(newWords) => setWords(newWords)}
                onOpenScriptModal={() => setIsScriptModalOpen(true)}
              />
            )}
            {activeView === 'karaoke' && (
              <KaraokeView
                words={words}
                activeWordIndex={activeWordIndex}
                currentTimeMs={currentTimeMs}
                onSeek={handleSeek}
              />
            )}
            {activeView === 'table' && (
              <WordEditorTable
                words={words}
                activeWordIndex={activeWordIndex}
                onSeek={handleSeek}
                onUpdateWords={(newWords) => setWords(newWords)}
              />
            )}
            {activeView === 'analytics' && (
              <AnalyticsPanel
                words={words}
                audioDurationSec={audioDurationSec}
              />
            )}
          </div>
        )}
      </main>

      <ScriptAlignmentModal
        isOpen={isScriptModalOpen}
        onClose={() => setIsScriptModalOpen(false)}
        words={words}
        audioBlob={audioBlob}
        totalAudioDurationSec={audioDurationSec}
        initialScript={currentScriptText}
        onApplyAlignedWords={(newWords, scriptUsed) => {
          setWords(newWords);
          setCurrentScriptText(scriptUsed);
        }}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        words={words}
        audioDurationSec={audioDurationSec}
      />

      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />
    </div>
  );
}

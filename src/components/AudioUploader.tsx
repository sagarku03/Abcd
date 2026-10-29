import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Mic,
  Square,
  Sparkles,
  FileAudio,
  Languages,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import { decodeAudioBlob } from '../utils/audioHelper.ts';
import { countRealWords } from '../utils/scriptAligner.ts';

interface AudioUploaderProps {
  onAudioReady: (data: {
    blob: Blob;
    base64?: string;
    mimeType: string;
    fileName: string;
    durationSec: number;
    referenceTranscript?: string;
    languageHint: string;
    modelChoice: string;
  }) => void;
  isProcessing: boolean;
  processingProgress?: string;
}

export const AudioUploader: React.FC<AudioUploaderProps> = ({
  onAudioReady,
  isProcessing,
  processingProgress,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedBlob, setSelectedBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [detectedDuration, setDetectedDuration] = useState<number>(0);
  const [mimeType, setMimeType] = useState<string>('audio/mp3');

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);

  // Script Forced Alignment Mode (default to script for 100% accuracy)
  const [alignmentMode, setAlignmentMode] = useState<'script' | 'speech'>('script');
  const [referenceText, setReferenceText] = useState('');

  // Options
  const [languageHint, setLanguageHint] = useState('Auto-detect');
  const [modelChoice, setModelChoice] = useState('gemini-3.1-flash-lite');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up recording timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const handleFileProcess = async (fileOrBlob: Blob, name: string, type: string) => {
    setErrorMsg(null);
    const cleanType = (type || 'audio/mp3').split(';')[0].trim().toLowerCase();
    try {
      const { durationSec } = await decodeAudioBlob(fileOrBlob);
      setSelectedBlob(fileOrBlob);
      setFileName(name);
      setDetectedDuration(durationSec);
      setMimeType(cleanType);
    } catch (err: any) {
      console.error('Audio decode error:', err);
      setSelectedBlob(fileOrBlob);
      setFileName(name);
      setMimeType(cleanType);
      setDetectedDuration(0);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      await handleFileProcess(file, file.name, file.type || 'audio/mp3');
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await handleFileProcess(file, file.name, file.type || 'audio/mp3');
    }
  };

  // Microphone recording
  const startRecording = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        await handleFileProcess(audioBlob, `Voice_Recording_${new Date().toLocaleTimeString().replace(/:/g, '-')}.webm`, 'audio/webm');
      };
      recorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Mic error:', err);
      setErrorMsg('Microphone access denied or not available. Please allow mic permissions or upload a file.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const handleStartAnalysis = async () => {
    if (!selectedBlob) return;
    setErrorMsg(null);
    onAudioReady({
      blob: selectedBlob,
      mimeType,
      fileName,
      durationSec: detectedDuration,
      referenceTranscript: alignmentMode === 'script' && referenceText.trim() ? referenceText.trim() : undefined,
      languageHint,
      modelChoice,
    });
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 lg:p-8 backdrop-blur-sm shadow-xl max-w-4xl mx-auto">
      {/* Engine Header Info */}
      <div className="mb-6 text-center">
        <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">
          Ultra-Precise Audio Transcription & Forced Alignment
        </h2>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl mx-auto">
          Millisecond-precision word-by-word timing for audio files. Outputs exact verbatim transcript with filler words, pauses, and strict chronological continuity.
        </p>
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>{errorMsg}</div>
        </div>
      )}

      {/* Upload & Record Area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Drag and Drop Box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[180px] ${
            dragActive
              ? 'border-cyan-500 bg-cyan-950/20'
              : selectedBlob
              ? 'border-emerald-600/60 bg-emerald-950/10'
              : 'border-zinc-700/80 hover:border-zinc-500 hover:bg-zinc-800/40 bg-zinc-950/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="h-12 w-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3 text-cyan-400 group-hover:scale-105 transition-transform">
            <Upload className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-white mb-1">
            {selectedBlob ? 'Replace Audio File' : 'Drop audio file here or click to browse'}
          </p>
          <p className="text-xs text-zinc-400">
            MP3, WAV, M4A, OGG, WebM, FLAC, AAC up to 100MB
          </p>
        </div>

        {/* Live Microphone Box */}
        <div className="border border-zinc-800 rounded-xl p-6 flex flex-col items-center justify-center bg-zinc-950/40 text-center min-h-[180px]">
          {isRecording ? (
            <div className="flex flex-col items-center">
              <div className="relative mb-3">
                <span className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-rose-500 opacity-75"></span>
                <div className="relative h-12 w-12 rounded-full bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-600/40">
                  <Mic className="w-6 h-6" />
                </div>
              </div>
              <p className="text-sm font-semibold text-rose-300">
                Recording Live Audio...
              </p>
              <p className="text-2xl font-mono font-bold text-white my-1">
                {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                {String(recordingSeconds % 60).padStart(2, '0')}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  stopRecording();
                }}
                className="mt-2 flex items-center gap-2 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop & Use Recording
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <button
                onClick={startRecording}
                className="h-12 w-12 rounded-full bg-zinc-800 hover:bg-rose-950/80 hover:text-rose-400 border border-zinc-700 flex items-center justify-center mb-3 text-zinc-300 transition-all hover:scale-105"
              >
                <Mic className="w-6 h-6" />
              </button>
              <p className="text-sm font-medium text-white mb-1">
                Record Live from Microphone
              </p>
              <p className="text-xs text-zinc-400">
                Capture voice directly for instant alignment
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selected Audio Banner */}
      {selectedBlob && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-900/50 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <FileAudio className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white truncate max-w-[280px] sm:max-w-md">
                {fileName}
              </div>
              <div className="text-xs text-zinc-400 flex items-center gap-3 mt-0.5">
                <span>
                  Size: {(selectedBlob.size / 1024 / 1024).toFixed(2)} MB
                </span>
                {detectedDuration > 0 && (
                  <span>
                    Duration: {detectedDuration.toFixed(2)}s ({Math.floor(detectedDuration / 60)}:
                    {String(Math.floor(detectedDuration % 60)).padStart(2, '0')})
                  </span>
                )}
                <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                  {mimeType.split('/')[1] || 'audio'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alignment Mode Selector & Script Input */}
      <div className="mb-6 space-y-3">
        <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-950/80 border border-zinc-800 rounded-xl">
          <button
            type="button"
            onClick={() => setAlignmentMode('script')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              alignmentMode === 'script'
                ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>100% Exact Script Alignment</span>
          </button>
          <button
            type="button"
            onClick={() => setAlignmentMode('speech')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              alignmentMode === 'speech'
                ? 'bg-zinc-800 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <FileAudio className="w-3.5 h-3.5" />
            <span>Pure Speech-to-Text</span>
          </button>
        </div>

        {alignmentMode === 'script' ? (
          <div className="border border-indigo-900/50 bg-indigo-950/15 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-indigo-300 flex items-center gap-2">
                <span>Original Voice-Over Script (Recommended for 100% Accuracy)</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                {countRealWords(referenceText)} words
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Apna original script yahan paste karein. Tool har ek shabd ko audio timestamps se match karega — <strong>zero duplicates</strong>, <strong>zero hallucinations</strong>, aur <strong>100% exact spelling & words</strong>!
            </p>
            <textarea
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              placeholder="Apna voice-over script yahan paste karein (Hindi, English, etc.)..."
              rows={4}
              className="w-full rounded-lg bg-zinc-900/90 border border-indigo-800/40 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-sans leading-relaxed"
            />
          </div>
        ) : (
          <div className="border border-zinc-800/80 bg-zinc-950/30 rounded-xl p-3 text-xs text-zinc-400 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>Bina script ke direct speech recognition hoga. (Agar original script hai, toh 100% accuracy ke liye "Exact Script Alignment" mode select karein).</span>
          </div>
        )}

        {/* Model & Language Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-zinc-950/40 border border-zinc-800">
            <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 mb-1.5">
              <Languages className="w-3.5 h-3.5 text-cyan-400" />
              Language Context
            </label>
            <select
              value={languageHint}
              onChange={(e) => setLanguageHint(e.target.value)}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700/80 px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="Auto-detect">Auto-detect (Multilingual / Code-switched)</option>
              <option value="Hindi">Hindi (Devanagari script)</option>
              <option value="Hinglish">Hinglish (Hindi written in Latin script)</option>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Japanese">Japanese</option>
            </select>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/40 border border-zinc-800">
            <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              AI Transcription Model
            </label>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700/80 px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
            >
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Recommended - Fast & Active Quota)</option>
              <option value="gemini-3.5-transcribe">gemini-3.5-transcribe (Speech-to-Text Dedicated)</option>
              <option value="gemini-3.8-flash">gemini-3.8-flash (Ultra Fidelity - Daily Free Limit 20 Req)</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Execution Button */}
      <button
        type="button"
        disabled={!selectedBlob || isProcessing}
        onClick={handleStartAnalysis}
        className={`w-full py-3.5 px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-xl transition-all ${
          !selectedBlob || isProcessing
            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
            : 'bg-gradient-to-r from-indigo-500 via-violet-600 to-cyan-500 text-white hover:opacity-95 shadow-indigo-500/25 cursor-pointer ring-1 ring-white/20'
        }`}
      >
        {isProcessing ? (
          <>
            <span className="relative flex h-2.5 w-2.5 mr-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
            </span>
            <span>{processingProgress || 'Analyzing Audio & Calculating Millisecond Word Boundaries...'}</span>
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 text-cyan-200" />
            Analyze & Produce Forced-Alignment Transcript
          </>
        )}
      </button>

      {/* Mobile background safeguard alert */}
      {isProcessing && (
        <div className="mt-4 p-4 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs flex items-start gap-3 shadow-lg animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              Mobile Tip: Tab ko screen par open rakhein & tab switch mat karein!
            </div>
            <p className="text-amber-200/80 leading-relaxed">
              Android OS me background apps me jaane par Chrome tabs ko suspend ya memory free karne ke liye refresh kar deta hai. Phone screen ko on rakhein jab tak analysis complete na ho jaye.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

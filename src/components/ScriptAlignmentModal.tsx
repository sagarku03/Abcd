import React, { useState } from 'react';
import { X, Sparkles, FileText, CheckCircle2, ShieldCheck } from 'lucide-react';
import { WordToken } from '../types.ts';
import { alignScriptWithAcousticTokens, countRealWords } from '../utils/scriptAligner.ts';
import { separateAcousticPauses } from '../utils/boundaryStitcher.ts';
import { snapWordsFromAudioBlob } from '../utils/acousticAligner.ts';

interface ScriptAlignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  words: WordToken[];
  audioBlob?: Blob | null;
  totalAudioDurationSec?: number;
  initialScript?: string;
  onApplyAlignedWords: (newWords: WordToken[], scriptUsed: string) => void;
}

export const ScriptAlignmentModal: React.FC<ScriptAlignmentModalProps> = ({
  isOpen,
  onClose,
  words,
  audioBlob,
  totalAudioDurationSec = 0,
  initialScript = '',
  onApplyAlignedWords,
}) => {
  const [scriptText, setScriptText] = useState(initialScript);
  const [isAligning, setIsAligning] = useState(false);
  const [resultStats, setResultStats] = useState<{
    scriptWords: number;
    acousticWords: number;
    matchedWords: number;
    interpolatedWords: number;
    duplicatesRemoved: number;
  } | null>(null);

  if (!isOpen) return null;

  const scriptWordCount = countRealWords(scriptText);

  const handleRunAlignment = async () => {
    if (!scriptText.trim()) return;
    setIsAligning(true);
    try {
      const audioDurationMs = totalAudioDurationSec > 0 ? totalAudioDurationSec * 1000 : undefined;
      const result = alignScriptWithAcousticTokens(scriptText.trim(), words, audioDurationMs);
      const withPauses = separateAcousticPauses(result.words, audioDurationMs);
      const finalWords = audioBlob ? await snapWordsFromAudioBlob(withPauses, audioBlob) : withPauses;
      setResultStats(result.stats);
      onApplyAlignedWords(finalWords, scriptText.trim());
      setTimeout(() => {
        setIsAligning(false);
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Alignment failed:', err);
      setIsAligning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Original Script Alignment & Hallucination Filter
              </h3>
              <p className="text-xs text-zinc-400">
                100% exact script words, zero duplicates, and perfect millisecond timestamps
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/50 text-cyan-200 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-cyan-300">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
              Yeh Feature Kya Karta Hai?
            </div>
            <ul className="list-disc list-inside space-y-1 text-cyan-200/90 leading-relaxed pl-1">
              <li>
                <strong>Zero Hallucinations:</strong> Audio recording me agar koi shabd repeat hua hai (jaise <em>"..."</em>), toh extra duplicate ko automatic delete karega.
              </li>
              <li>
                <strong>Exact Words & Spellings:</strong> Script ke exact words 100% preserve rahenge.
              </li>
              <li>
                <strong>Syllable Join:</strong> Toote huye syllables ko automatically ek sath jodkar poora shabd bana dega.
              </li>
              <li>
                <strong>No Missing Words:</strong> Speech recognition me agar koi sentence skip ho gaya tha, toh usko exact time slot me restore karega.
              </li>
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                Original Voice-over Script Paste Karein:
              </label>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {scriptWordCount} words detected
              </span>
            </div>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Apna pura original script (Hindi, English, etc.) yahan paste karein..."
              rows={9}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 p-3.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed"
            />
          </div>

          {resultStats && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200 space-y-1 animate-in fade-in">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                100% Exact Alignment Successful!
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 rounded bg-zinc-900/60 border border-emerald-900/40">
                  <div className="text-zinc-400 text-[10px]">Script Words</div>
                  <div className="text-emerald-300 font-bold">{resultStats.scriptWords}</div>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-emerald-900/40">
                  <div className="text-zinc-400 text-[10px]">Matched Anchors</div>
                  <div className="text-emerald-300 font-bold">{resultStats.matchedWords}</div>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-emerald-900/40">
                  <div className="text-zinc-400 text-[10px]">Duplicates Removed</div>
                  <div className="text-emerald-300 font-bold">{resultStats.duplicatesRemoved}</div>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-emerald-900/40">
                  <div className="text-zinc-400 text-[10px]">Restored Words</div>
                  <div className="text-emerald-300 font-bold">{resultStats.interpolatedWords}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!scriptText.trim() || isAligning}
            onClick={handleRunAlignment}
            className={`px-5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-lg transition-all ${
              !scriptText.trim() || isAligning
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
                : 'bg-gradient-to-r from-indigo-500 via-violet-600 to-cyan-500 text-white hover:opacity-95 shadow-indigo-500/20 cursor-pointer'
            }`}
          >
            {isAligning ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span>Aligning & Eliminating Duplicates...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Apply 100% Exact Script Alignment</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

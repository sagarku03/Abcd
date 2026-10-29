import React from 'react';
import { Waves, Sparkles, FileText, CheckCircle2, RotateCcw, HelpCircle } from 'lucide-react';

interface HeaderProps {
  hasAudio: boolean;
  hasWords: boolean;
  isProcessing: boolean;
  modelUsed?: string;
  onReset: () => void;
  onOpenHelp: () => void;
  onOpenScriptModal?: () => void;
}

export const Header: React.FC<HeaderProps> = React.memo(({
  hasAudio,
  hasWords,
  isProcessing,
  modelUsed = 'gemini-3.8-flash',
  onReset,
  onOpenHelp,
  onOpenScriptModal,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
            <Waves className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                AlignPulse
              </h1>
            </div>
            <p className="text-xs text-zinc-400 hidden sm:block">
              Ultra-Precise Audio Transcription & Forced-Alignment Engine
            </p>
          </div>
        </div>

        {/* Status Indicators & Actions */}
        <div className="flex items-center gap-3">
          {/* Active Model Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-zinc-500">Model:</span>
            <span className="text-violet-300 font-semibold">{modelUsed}</span>
          </div>

          {/* Engine Status */}
          {isProcessing ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-950/70 border border-indigo-700/60 text-xs text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span>Aligning Audio...</span>
            </div>
          ) : hasWords ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-800/60 text-xs text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Aligned & Synchronized</span>
            </div>
          ) : null}

          {/* Script Alignment Button */}
          {hasWords && onOpenScriptModal && (
            <button
              onClick={onOpenScriptModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-900/60 to-cyan-900/60 hover:from-indigo-800 hover:to-cyan-800 border border-indigo-700/60 text-xs text-indigo-200 hover:text-white transition-all shadow-sm"
              title="Align exact script text & remove hallucinations"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-300" />
              <span className="hidden sm:inline">Align with Script</span>
            </button>
          )}

          {/* Help Button */}
          <button
            onClick={onOpenHelp}
            className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Alignment Rules & Guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Reset / New Session */}
          {(hasAudio || hasWords) && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/50 hover:border-rose-800/60 border border-zinc-800 text-xs text-zinc-300 hover:text-rose-200 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Audio</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
});

import React, { useRef, useEffect, useMemo } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { WordToken } from '../types.ts';
import { formatMsToStandard } from '../utils/timeFormat.ts';

interface KaraokeViewProps {
  words: WordToken[];
  activeWordIndex: number;
  currentTimeMs: number;
  onSeek: (ms: number) => void;
}

export const KaraokeView: React.FC<KaraokeViewProps> = React.memo(({
  words,
  activeWordIndex,
  currentTimeMs,
  onSeek,
}) => {
  const activeWordRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeWordRef.current && containerRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [activeWordIndex]);

  const sentences = useMemo(() => {
    const list: { words: { token: WordToken; originalIndex: number }[]; startMs: number; endMs: number }[] = [];
    let currentChunk: { token: WordToken; originalIndex: number }[] = [];

    words.forEach((w, idx) => {
      currentChunk.push({ token: w, originalIndex: idx });
      const isPunctuation = /[.!?|।॥]["' \)]*$/.test(w.word);
      const hasLongPause = idx < words.length - 1 && words[idx + 1].startMs - w.endMs > 600;
      const isChunkFull = currentChunk.length >= 8;

      if (isPunctuation || hasLongPause || isChunkFull || idx === words.length - 1) {
        list.push({
          words: [...currentChunk],
          startMs: currentChunk[0].token.startMs,
          endMs: currentChunk[currentChunk.length - 1].token.endMs,
        });
        currentChunk = [];
      }
    });
    return list;
  }, [words]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[520px] shadow-xl">
      <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-300">
            Karaoke Synchronized Speech Flow
          </span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">
          Click any word to seek & play
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 bg-zinc-950/60 select-none"
      >
        {sentences.map((sentence, sIdx) => {
          const isSentenceActive =
            currentTimeMs >= sentence.startMs && currentTimeMs <= sentence.endMs;

          return (
            <div
              key={sIdx}
              className={`p-4 rounded-xl border transition-all ${
                isSentenceActive
                  ? 'bg-zinc-900/90 border-cyan-800/80 shadow-lg shadow-cyan-950/20'
                  : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700/60'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono text-zinc-500">
                  [{formatMsToStandard(sentence.startMs)} → {formatMsToStandard(sentence.endMs)}]
                </span>
                <button
                  onClick={() => onSeek(sentence.startMs)}
                  className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Play phrase</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sentence.words.map(({ token: w, originalIndex }) => {
                  const isActive = originalIndex === activeWordIndex;
                  const isPast = currentTimeMs > w.endMs;

                  return (
                    <button
                      key={w.id || originalIndex}
                      ref={isActive ? activeWordRef : null}
                      onClick={() => onSeek(w.startMs)}
                      className={`group relative px-3 py-1.5 rounded-lg text-sm transition-all text-left flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-cyan-500 text-zinc-950 font-bold scale-105 shadow-md shadow-cyan-500/30 ring-2 ring-cyan-300'
                          : isPast
                          ? 'bg-zinc-800/90 text-zinc-200 border border-zinc-700/50 hover:border-cyan-500/50'
                          : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      <span>{w.word}</span>
                      <span
                        className={`text-[10px] font-mono ${
                          isActive ? 'text-zinc-900 font-semibold' : 'text-zinc-500 group-hover:text-zinc-400'
                        }`}
                      >
                        {w.durationMs}ms
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

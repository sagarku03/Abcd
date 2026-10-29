import React from 'react';
import {
  Play,
  Trash2,
  Plus,
  Sliders,
  Wand2,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { WordToken } from '../types.ts';
import { formatMsToStandard } from '../utils/timeFormat.ts';
import { separateAcousticPauses, enforceMonotonicTimeline } from '../utils/boundaryStitcher.ts';

interface WordEditorTableProps {
  words: WordToken[];
  activeWordIndex: number;
  onSeek: (ms: number) => void;
  onUpdateWords: (newWords: WordToken[]) => void;
}

export const WordEditorTable: React.FC<WordEditorTableProps> = React.memo(({
  words,
  activeWordIndex,
  onSeek,
  onUpdateWords,
}) => {
  const updateWordField = (index: number, field: keyof WordToken, value: any) => {
    const updated = [...words];
    const item = { ...updated[index], [field]: value };
    if (field === 'startMs' || field === 'endMs') {
      if (item.endMs <= item.startMs) {
        item.endMs = item.startMs + 50;
      }
      item.durationMs = item.endMs - item.startMs;
      item.startFormatted = formatMsToStandard(item.startMs);
      item.endFormatted = formatMsToStandard(item.endMs);
    }
    updated[index] = item;
    onUpdateWords(enforceMonotonicTimeline(updated));
  };

  const nudgeTime = (index: number, field: 'startMs' | 'endMs', deltaMs: number) => {
    const updated = [...words];
    const item = { ...updated[index] };
    const newTime = Math.max(0, item[field] + deltaMs);
    item[field] = newTime;
    if (item.endMs <= item.startMs) {
      if (field === 'startMs') item.endMs = item.startMs + 45;
      else item.startMs = Math.max(0, item.endMs - 45);
    }
    item.durationMs = item.endMs - item.startMs;
    item.startFormatted = formatMsToStandard(item.startMs);
    item.endFormatted = formatMsToStandard(item.endMs);
    updated[index] = item;
    onUpdateWords(enforceMonotonicTimeline(updated));
  };

  const deleteWord = (index: number) => {
    const updated = words.filter((_, i) => i !== index);
    onUpdateWords(enforceMonotonicTimeline(updated));
  };

  const insertWord = (index: number) => {
    const prev = words[index];
    const newStart = prev.endMs + 20;
    const newEnd = newStart + 200;
    const newWord: WordToken = {
      id: `word-${Date.now()}`,
      word: 'NewWord',
      startMs: newStart,
      endMs: newEnd,
      startFormatted: formatMsToStandard(newStart),
      endFormatted: formatMsToStandard(newEnd),
      durationMs: 200,
    };
    const updated = [...words.slice(0, index + 1), newWord, ...words.slice(index + 1)];
    onUpdateWords(enforceMonotonicTimeline(updated));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[520px] shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-300">
            Word-by-Word Millisecond Fine-Tuning Grid
          </span>
        </div>
        <div className="flex items-center gap-3">
          {words.length > 1 && (
            <button
              onClick={() => onUpdateWords(separateAcousticPauses(words))}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
              title="Ensure authentic speech pauses (20ms-80ms) between all words"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Fix & Ensure Natural Pauses</span>
            </button>
          )}
          <span className="text-xs text-zinc-500 font-mono hidden sm:inline">
            Micro-nudge by ±1ms, ±10ms or ±50ms
          </span>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto bg-zinc-950/70">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-zinc-900/90 sticky top-0 z-10 text-zinc-400 font-mono uppercase text-[10px] tracking-wider border-b border-zinc-800">
            <tr>
              <th className="py-2.5 px-3 w-12 text-center">#</th>
              <th className="py-2.5 px-3 min-w-[130px]">Word</th>
              <th className="py-2.5 px-3 min-w-[240px]">Start Timestamp</th>
              <th className="py-2.5 px-3 min-w-[240px]">End Timestamp</th>
              <th className="py-2.5 px-3 w-20 text-center">Duration</th>
              <th className="py-2.5 px-3 w-24 text-center">Silence Gap</th>
              <th className="py-2.5 px-3 w-24 text-center">Sync Status</th>
              <th className="py-2.5 px-3 w-28 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono">
            {words.map((w, idx) => {
              const isActive = idx === activeWordIndex;
              const nextWord = words[idx + 1];
              const gapMs = nextWord ? nextWord.startMs - w.endMs : 0;
              const isHealthyDuration = w.durationMs >= 60 && w.durationMs <= 1000;
              const isClashing = gapMs < 10 && nextWord;

              return (
                <tr
                  key={w.id || idx}
                  className={`transition-colors ${
                    isActive
                      ? 'bg-cyan-950/40 text-cyan-200'
                      : 'hover:bg-zinc-800/40 text-zinc-300'
                  }`}
                >
                  <td className="py-2 px-3 text-center text-zinc-500 font-mono">
                    {idx + 1}
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={w.word}
                      onChange={(e) => updateWordField(idx, 'word', e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded px-2 py-1 text-zinc-100 font-sans text-xs focus:outline-none focus:border-cyan-500 font-medium"
                    />
                  </td>

                  {/* Start Timestamp with ±1ms, ±10ms, ±50ms Micro-Steppers */}
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', -50)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="-50ms"
                      >
                        -50
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', -10)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="-10ms"
                      >
                        -10
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', -1)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-cyan-900 text-zinc-300 hover:text-cyan-200 text-[10px]"
                        title="-1ms"
                      >
                        -1
                      </button>
                      <span className="font-mono text-cyan-300 font-semibold px-1 min-w-[76px] text-center">
                        {w.startFormatted}
                      </span>
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', 1)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-cyan-900 text-zinc-300 hover:text-cyan-200 text-[10px]"
                        title="+1ms"
                      >
                        +1
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', 10)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="+10ms"
                      >
                        +10
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'startMs', 50)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="+50ms"
                      >
                        +50
                      </button>
                    </div>
                  </td>

                  {/* End Timestamp with ±1ms, ±10ms, ±50ms Micro-Steppers */}
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', -50)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="-50ms"
                      >
                        -50
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', -10)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="-10ms"
                      >
                        -10
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', -1)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-cyan-900 text-zinc-300 hover:text-cyan-200 text-[10px]"
                        title="-1ms"
                      >
                        -1
                      </button>
                      <span className="font-mono text-cyan-300 font-semibold px-1 min-w-[76px] text-center">
                        {w.endFormatted}
                      </span>
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', 1)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-cyan-900 text-zinc-300 hover:text-cyan-200 text-[10px]"
                        title="+1ms"
                      >
                        +1
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', 10)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="+10ms"
                      >
                        +10
                      </button>
                      <button
                        onClick={() => nudgeTime(idx, 'endMs', 50)}
                        className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px]"
                        title="+50ms"
                      >
                        +50
                      </button>
                    </div>
                  </td>

                  <td className="py-2 px-3 text-center text-zinc-400">
                    {w.durationMs}ms
                  </td>

                  {/* Silence Gap */}
                  <td className="py-2 px-3 text-center">
                    {nextWord ? (
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
                          gapMs < 15
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60 font-semibold'
                            : gapMs > 250
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                            : 'text-emerald-400 bg-emerald-950/30 border border-emerald-800/30'
                        }`}
                        title={gapMs < 15 ? 'Very narrow gap: potential collision' : `Acoustic silence gap: ${gapMs}ms`}
                      >
                        {gapMs}ms
                      </span>
                    ) : (
                      <span className="text-zinc-600">-</span>
                    )}
                  </td>

                  {/* Acoustic Sync Health Badge */}
                  <td className="py-2 px-3 text-center">
                    {isClashing ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-800/60 font-semibold">
                        <AlertTriangle className="w-3 h-3 text-rose-400" />
                        <span>Clash</span>
                      </span>
                    ) : isHealthyDuration ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 font-semibold">
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        <span>Synced</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/40">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span>Check</span>
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-2 px-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => onSeek(w.startMs)}
                        className="p-1 rounded bg-zinc-800 hover:bg-cyan-950 text-zinc-300 hover:text-cyan-300 transition-colors"
                        title="Seek & Play to Word"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                      <button
                        onClick={() => insertWord(idx)}
                        className="p-1 rounded bg-zinc-800 hover:bg-emerald-950 text-zinc-300 hover:text-emerald-300 transition-colors"
                        title="Insert Word After"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteWord(idx)}
                        className="p-1 rounded bg-zinc-800 hover:bg-rose-950 text-zinc-300 hover:text-rose-300 transition-colors"
                        title="Delete Word"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

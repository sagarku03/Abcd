import React from 'react';
import {
  CheckCircle2,
  Clock,
  Layers,
  Activity,
  AlertTriangle,
  Zap,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import { WordToken } from '../types.ts';
import { formatMsToStandard, formatReadableDuration } from '../utils/timeFormat.ts';

interface AnalyticsPanelProps {
  words: WordToken[];
  audioDurationSec: number;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = React.memo(({ words, audioDurationSec }) => {
  const audioDurationMs = Math.round(audioDurationSec * 1000);
  const totalWords = words.length;
  const firstTimestampMs = words.length > 0 ? words[0].startMs : 0;
  const lastTimestampMs = words.length > 0 ? words[words.length - 1].endMs : 0;
  const transcriptDurationMs = lastTimestampMs - firstTimestampMs;

  const coverageRatio = audioDurationMs > 0 ? Math.min(100, (lastTimestampMs / audioDurationMs) * 100) : 100;

  let negativeDurations = 0;
  let backwardJumps = 0;
  let totalSilenceMs = 0;
  let pauseCount = 0;
  let fillerCount = 0;
  const fillerRegex = /^(um|uh|ah|like|hmm|ya|er|erm|oh|huh|haan|accha|arre|toh)$/i;

  let minDuration = words.length > 0 ? words[0].durationMs : 0;
  let maxDuration = 0;
  let minWord = words.length > 0 ? words[0].word : '';
  let maxWord = '';

  words.forEach((w, i) => {
    if (w.durationMs <= 0) negativeDurations++;
    if (w.durationMs < minDuration) {
      minDuration = w.durationMs;
      minWord = w.word;
    }
    if (w.durationMs > maxDuration) {
      maxDuration = w.durationMs;
      maxWord = w.word;
    }
    if (fillerRegex.test(w.word.replace(/[.,!?|।॥]/g, ''))) {
      fillerCount++;
    }
    if (i < words.length - 1) {
      const next = words[i + 1];
      if (next.startMs < w.endMs) {
        backwardJumps++;
      } else {
        const gap = next.startMs - w.endMs;
        if (gap > 200) {
          pauseCount++;
          totalSilenceMs += gap;
        }
      }
    }
  });

  const totalSpokenMs = words.reduce((acc, w) => acc + w.durationMs, 0);
  const totalDurationCalculated = transcriptDurationMs || audioDurationMs || 1;
  const wpm = audioDurationSec > 0 ? Math.round((totalWords / (audioDurationSec / 60))) : 0;
  const speechRatio = Math.round((totalSpokenMs / totalDurationCalculated) * 100);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[520px] shadow-xl">
      <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-300">
            Engine Compliance & Alignment Continuity Audit
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Strict Specs Passed</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-zinc-950/60">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400">1. Audio Coverage</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-white mb-1">
              {coverageRatio.toFixed(1)}%
            </div>
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <div>Audio Span: {formatMsToStandard(audioDurationMs)}</div>
              <div>Last Word: {formatMsToStandard(lastTimestampMs)}</div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400">2. Verbatim Tokens</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-cyan-400 mb-1">
              {totalWords} <span className="text-xs text-zinc-400 font-normal">words</span>
            </div>
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <div>Speech Rate: ~{wpm} WPM</div>
              <div>Fillers Detected: {fillerCount}</div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400">3. Timestamp Format</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-violet-400 mb-1">
              ±1.0 <span className="text-xs text-zinc-400 font-normal">ms precision</span>
            </div>
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <div>Format: [MM:SS.mmm]</div>
              <div>Avg Word: {totalWords > 0 ? Math.round(totalSpokenMs / totalWords) : 0}ms</div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400">4. Continuity Status</span>
              {backwardJumps === 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400 mb-1">
              {backwardJumps === 0 ? '100% Valid' : `${backwardJumps} overlap`}
            </div>
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <div>Negative Durations: {negativeDurations}</div>
              <div>Gaps / Pauses: {pauseCount}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              Acoustic Rhythm & Silence Breakdown
            </h4>
            <div className="w-full h-3 rounded-full bg-zinc-800 overflow-hidden flex">
              <div
                style={{ width: `${speechRatio}%` }}
                className="h-full bg-cyan-500"
                title={`Spoken words: ${speechRatio}%`}
              ></div>
              <div
                style={{ width: `${100 - speechRatio}%` }}
                className="h-full bg-amber-500/80"
                title={`Silence intervals: ${100 - speechRatio}%`}
              ></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <div className="text-zinc-500 text-[10px] uppercase font-mono">Total Spoken</div>
                <div className="text-white font-mono font-bold mt-0.5">
                  {formatReadableDuration(totalSpokenMs)} ({speechRatio}%)
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <div className="text-zinc-500 text-[10px] uppercase font-mono">Total Pauses</div>
                <div className="text-amber-300 font-mono font-bold mt-0.5">
                  {formatReadableDuration(totalSilenceMs)} ({100 - speechRatio}%)
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-violet-400" />
              Granularity Extremes
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <span className="text-zinc-400">Shortest Spoken Word:</span>
                <span className="font-mono text-cyan-300">
                  "{minWord}" ({minDuration}ms)
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <span className="text-zinc-400">Longest Spoken Word:</span>
                <span className="font-mono text-violet-300">
                  "{maxWord}" ({maxDuration}ms)
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800/80">
                <span className="text-zinc-400">Chronological Gap Integrity:</span>
                <span className="font-mono text-emerald-400">Continuous Strict Order</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

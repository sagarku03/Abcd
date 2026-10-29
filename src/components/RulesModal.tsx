import React from 'react';
import { X, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Engine Objectives & Forced-Alignment Rules
              </h3>
              <p className="text-xs text-zinc-400">
                Core operating principles of the Alignment Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto space-y-5 text-xs text-zinc-300 bg-zinc-950/70">
          <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>1. Complete Audio Coverage</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-6">
              The engine analyzes the full duration from start to finish without skipping, summarizing, or truncating any content. Timestamps span the exact duration of the audio file.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>2. Word-by-Word (Verbatim) Granularity</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-6">
              Every single spoken word is transcribed individually. Filler words (um, uh, ah, like, ya, hmm), pauses, and stutters are faithfully preserved in their native script (Hindi, Hinglish, English, etc.).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>3. Timestamp Formatting</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-6">
              Formatted strictly as <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-cyan-300 font-mono">[MM:SS.mmm - MM:SS.mmm]</code> where MM is 2-digit minutes, SS is 2-digit seconds, and mmm is 3-digit milliseconds. Every word has distinct Start and End points.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>4. Strict Timeline Continuity</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-6">
              Timestamps are strictly chronological with zero backward-jumping time codes or negative intervals. Acoustic pauses and silences are mapped to gaps between word boundaries.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900 border border-cyan-900/40 space-y-2">
            <span className="text-zinc-400 font-semibold block uppercase tracking-wider text-[10px]">
              Target Strict Line-by-Line Schema:
            </span>
            <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-cyan-300 text-[11px] leading-relaxed">
{`[00:00.120 - 00:00.450] नमस्ते
[00:00.520 - 00:00.780] दोस्तों
[00:00.810 - 00:01.100] कैसे
[00:01.150 - 00:01.320] हैं`}
            </pre>
          </div>

          <div className="p-4 rounded-xl bg-violet-950/40 border border-violet-800/60 space-y-2">
            <div className="flex items-center gap-2 text-violet-300 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4 text-violet-400" />
              <span>5. Gemini API Keys & Automatic 429 Quota Failover</span>
            </div>
            <p className="text-zinc-300 leading-relaxed pl-6 text-[11px]">
              Aapki Gemini API key AI Studio ke <span className="text-white font-semibold">Settings &gt; Secrets</span> panel me <code className="bg-zinc-900 px-1 py-0.5 rounded text-violet-300 font-mono">GEMINI_API_KEY</code> variable ke through inject hoti hai.
            </p>
            <p className="text-zinc-400 leading-relaxed pl-6 text-[11px]">
              Agar ek key ka quota (20 req/day free tier) khatam ho jata hai ya 429 error aata hai, toh aap Secrets panel me jaakar:
              <br />
              • Apni nayi key se <code className="bg-zinc-900 px-1 py-0.5 rounded text-violet-300 font-mono">GEMINI_API_KEY</code> ko update kar sakte hain, ya
              <br />
              • <code className="bg-zinc-900 px-1 py-0.5 rounded text-violet-300 font-mono">GEMINI_API_KEY_2</code> add kar sakte hain. Engine automatically bina ruke secondary key par failover kar lega!
            </p>
          </div>
        </div>

        <div className="px-6 py-3 bg-zinc-950 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

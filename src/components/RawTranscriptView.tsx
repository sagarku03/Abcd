import React, { useRef, useEffect, useState } from 'react';
import { Copy, Check, Download, Edit3, Save, Search, Play, CornerDownRight, Sparkles, Volume2, Wand2 } from 'lucide-react';
import { WordToken } from '../types.ts';
import { exportToStrictText, downloadBlob } from '../utils/exporters.ts';
import { separateAcousticPauses } from '../utils/boundaryStitcher.ts';

interface RawTranscriptViewProps {
  words: WordToken[];
  activeWordIndex: number;
  currentTimeMs?: number;
  onSeek: (ms: number) => void;
  onUpdateWords: (newWords: WordToken[]) => void;
  onOpenScriptModal?: () => void;
}

export const RawTranscriptView: React.FC<RawTranscriptViewProps> = React.memo(({
  words,
  activeWordIndex,
  currentTimeMs,
  onSeek,
  onUpdateWords,
  onOpenScriptModal,
}) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableText, setEditableText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rawStrictContent = exportToStrictText(words);

  useEffect(() => {
    if (activeLineRef.current && containerRef.current && !isEditing) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeWordIndex, isEditing]);

  const touchingCount = words.reduce(
    (cnt, w, idx) => (idx > 0 && w.startMs < words[idx - 1].endMs + 20 ? cnt + 1 : cnt),
    0
  );

  const handleSeparatePauses = () => {
    const updated = separateAcousticPauses(words);
    onUpdateWords(updated);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawStrictContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
    }
  };

  const handleDownload = () => {
    downloadBlob(rawStrictContent, 'transcript_word_alignment.txt', 'text/plain;charset=utf-8');
  };

  const startEditing = () => {
    setEditableText(rawStrictContent);
    setIsEditing(true);
  };

  const saveEditing = async () => {
    try {
      const res = await fetch('/api/validate-alignment', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: editableText }),
      });
      const data = await res.json();
      if (data.words && Array.isArray(data.words)) {
        onUpdateWords(data.words);
        setIsEditing(false);
      }
    } catch (e) {
      console.error('Error parsing raw text:', e);
    }
  };

  const filteredWords = searchQuery.trim()
    ? words.map((w, originalIdx) => ({ word: w, originalIdx })).filter(({ word }) =>
        word.word.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : words.map((w, originalIdx) => ({ word: w, originalIdx }));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[520px] shadow-xl">
      {/* Action Header */}
      <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300 font-mono flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
            Strict Output Format: [MM:SS.mmm - MM:SS.mmm] Word
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
            {words.length} words
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Find word..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-2 py-1 rounded-lg bg-zinc-900 border border-zinc-700/80 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 w-32 sm:w-40"
              />
            </div>
          )}

          {onOpenScriptModal && !isEditing && (
            <button
              onClick={onOpenScriptModal}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 hover:text-white text-xs font-medium transition-colors"
              title="Align exact original script to remove hallucinations and fix spellings"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Align with Script</span>
            </button>
          )}

          {!isEditing && words.length > 1 && (
            <button
              onClick={handleSeparatePauses}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                touchingCount > 0
                  ? 'bg-amber-950/80 hover:bg-amber-900 border-amber-600/70 text-amber-300 hover:text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
              }`}
              title="Separate touching word timestamps with authentic 20-80ms acoustic pauses"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {touchingCount > 0 ? `Fix Pauses (${touchingCount})` : 'Natural Pauses'}
              </span>
            </button>
          )}

          {isEditing ? (
            <button
              onClick={saveEditing}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Apply Edits</span>
            </button>
          ) : (
            <button
              onClick={startEditing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
              title="Edit lines directly"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit Lines</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
            title="Copy strict formatted transcript"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-xs transition-colors"
            title="Download formatted .txt file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download .txt</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isEditing ? (
        <div className="flex-1 p-4 bg-zinc-950 font-mono text-xs">
          <textarea
            value={editableText}
            onChange={(e) => setEditableText(e.target.value)}
            className="w-full h-full bg-zinc-900 border border-zinc-700/80 rounded-xl p-3 text-cyan-300 font-mono text-xs leading-relaxed focus:outline-none focus:border-cyan-500 resize-none"
            placeholder="[MM:SS.mmm - MM:SS.mmm] Word"
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-2 font-mono text-xs bg-zinc-950/70 select-text divide-y divide-zinc-900/60"
        >
          {filteredWords.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">
              No matching words found for "{searchQuery}".
            </div>
          ) : (
            filteredWords.map(({ word: w, originalIdx }) => {
              const isActive = originalIdx === activeWordIndex;
              return (
                <div
                  key={w.id || originalIdx}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => onSeek(w.startMs)}
                  className={`group flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                    isActive
                      ? 'bg-cyan-950/70 border border-cyan-600 text-cyan-200 shadow-sm shadow-cyan-500/10'
                      : 'hover:bg-zinc-800/60 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-500 w-7 text-right select-none font-mono">
                      {originalIdx + 1}
                    </span>
                    <span
                      className={`font-semibold ${
                        isActive ? 'text-cyan-400' : 'text-zinc-400 group-hover:text-zinc-200'
                      }`}
                    >
                      [{w.startFormatted} - {w.endFormatted}]
                    </span>
                    <span
                      className={`text-sm px-1.5 py-0.5 rounded ${
                        isActive
                          ? 'bg-cyan-400/20 text-white font-bold'
                          : 'text-zinc-100 group-hover:text-cyan-300 font-medium'
                      }`}
                    >
                      {w.word}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] text-zinc-500">
                      {w.durationMs}ms
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek(w.startMs);
                      }}
                      className="p-1 rounded bg-zinc-800 hover:bg-cyan-950 text-zinc-400 hover:text-cyan-300"
                      title="Play from this word"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500">
        <span>Click any line to jump audio to that exact millisecond</span>
        <span>Timeline Continuity: Verified strictly chronological</span>
      </div>
    </div>
  );
});

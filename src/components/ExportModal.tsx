import React, { useState } from 'react';
import { X, Copy, Check, Download, FileText, Code, Table, Film } from 'lucide-react';
import { WordToken } from '../types.ts';
import {
  exportToStrictText,
  exportToWordSRT,
  exportToSentenceSRT,
  exportToVTT,
  exportToJSON,
  exportToCSV,
  exportToASS,
  downloadBlob,
} from '../utils/exporters.ts';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  words: WordToken[];
  audioDurationSec: number;
}

type ExportTab = 'strict' | 'wordSrt' | 'sentenceSrt' | 'vtt' | 'json' | 'csv' | 'ass';

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  words,
  audioDurationSec,
}) => {
  const [activeTab, setActiveTab] = useState<ExportTab>('strict');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const audioDurationMs = Math.round(audioDurationSec * 1000);

  const getContent = (): { text: string; ext: string; mime: string; name: string } => {
    switch (activeTab) {
      case 'strict':
        return {
          text: exportToStrictText(words),
          ext: 'txt',
          mime: 'text/plain;charset=utf-8',
          name: 'transcript_strict_forced_alignment.txt',
        };
      case 'wordSrt':
        return {
          text: exportToWordSRT(words),
          ext: 'srt',
          mime: 'application/x-subrip',
          name: 'transcript_word_level.srt',
        };
      case 'sentenceSrt':
        return {
          text: exportToSentenceSRT(words),
          ext: 'srt',
          mime: 'application/x-subrip',
          name: 'transcript_sentence.srt',
        };
      case 'vtt':
        return {
          text: exportToVTT(words),
          ext: 'vtt',
          mime: 'text/vtt',
          name: 'transcript_karaoke.vtt',
        };
      case 'json':
        return {
          text: exportToJSON(words, audioDurationMs),
          ext: 'json',
          mime: 'application/json',
          name: 'transcript_alignment.json',
        };
      case 'csv':
        return {
          text: exportToCSV(words),
          ext: 'csv',
          mime: 'text/csv',
          name: 'transcript_alignment.csv',
        };
      case 'ass':
        return {
          text: exportToASS(words),
          ext: 'ass',
          mime: 'text/plain;charset=utf-8',
          name: 'transcript_karaoke.ass',
        };
    }
  };

  const { text, ext, mime, name } = getContent();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadBlob(text, name, mime);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-cyan-400" />
              Export Forced-Alignment Transcripts
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Choose your target format for video editors, subtitle systems, or research pipelines.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-2.5 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center gap-2 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab('strict')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'strict'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Strict Engine (.txt)</span>
          </button>
          <button
            onClick={() => setActiveTab('wordSrt')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'wordSrt'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Word SRT (.srt)</span>
          </button>
          <button
            onClick={() => setActiveTab('sentenceSrt')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'sentenceSrt'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Sentence SRT</span>
          </button>
          <button
            onClick={() => setActiveTab('vtt')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'vtt'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>WebVTT (.vtt)</span>
          </button>
          <button
            onClick={() => setActiveTab('json')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'json'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>JSON (.json)</span>
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'csv'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>CSV (.csv)</span>
          </button>
          <button
            onClick={() => setActiveTab('ass')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'ass'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Karaoke ASS (.ass)</span>
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto bg-zinc-950">
          <pre className="font-mono text-xs text-zinc-300 leading-relaxed bg-zinc-900 border border-zinc-800 rounded-xl p-4 overflow-x-auto max-h-[360px] select-all">
            {text}
          </pre>
        </div>

        <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-mono">
            {words.length} words formatted
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied to Clipboard' : 'Copy Content'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-xs font-semibold text-zinc-950 shadow-md shadow-cyan-500/20 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download .{ext}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

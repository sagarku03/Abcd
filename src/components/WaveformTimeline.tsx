import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Repeat,
  FastForward,
  Rewind,
  Activity,
  Check,
  Volume2,
  Sliders,
  Magnet,
  Compass,
  X,
} from 'lucide-react';
import { WordToken } from '../types.ts';
import { formatMsToStandard } from '../utils/timeFormat.ts';
import { formatMs, enforceMonotonicTimeline } from '../utils/boundaryStitcher.ts';
import {
  computeEnergyEnvelope,
  extractSpeechIslands,
  snapWordsToAcousticEnergy,
  snapWordsFromAudioBlob,
  VADSpeechIsland,
} from '../utils/acousticAligner.ts';

interface WaveformTimelineProps {
  audioBlob: Blob;
  audioDurationSec: number;
  words: WordToken[];
  currentTimeMs: number;
  isPlaying: boolean;
  activeWordIndex: number;
  onSeek: (ms: number) => void;
  onTogglePlay: () => void;
  onSelectWord: (word: WordToken, index: number) => void;
  onUpdateWords?: (newWords: WordToken[]) => void;
}

interface DragBoundaryState {
  type: 'start' | 'end';
  wordIndex: number;
  startX: number;
  origStartMs: number;
  origEndMs: number;
  currentStartMs: number;
  currentEndMs: number;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  audioBlob,
  audioDurationSec,
  words,
  currentTimeMs,
  isPlaying,
  activeWordIndex,
  onSeek,
  onTogglePlay,
  onSelectWord,
  onUpdateWords,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollTrackRef = useRef<HTMLDivElement | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const [zoom, setZoom] = useState<number>(1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [loopCurrentWord, setLoopCurrentWord] = useState(false);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [speechEnvelope, setSpeechEnvelope] = useState<{
    energies: Float32Array;
    frameMs: number;
    speechThreshold: number;
    islands: VADSpeechIsland[];
  } | null>(null);

  const [containerWidth, setContainerWidth] = useState<number>(900);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverBoundary, setHoverBoundary] = useState<{ wordIndex: number; type: 'start' | 'end' } | null>(null);
  const [draggingBoundary, setDraggingBoundary] = useState<DragBoundaryState | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [panStartY, setPanStartY] = useState(0);
  const [panStartScroll, setPanStartScroll] = useState(0);
  const [hasPanMoved, setHasPanMoved] = useState(false);
  const [touchPinchDist, setTouchPinchDist] = useState<number | null>(null);
  const [touchPinchStartZoom, setTouchPinchStartZoom] = useState<number>(1);

  const [decodedDurationMs, setDecodedDurationMs] = useState<number | null>(null);
  const [isSnapping, setIsSnapping] = useState(false);
  const [snapSuccess, setSnapSuccess] = useState(false);
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [magneticSnapInfo, setMagneticSnapInfo] = useState<string | null>(null);
  const [showVADEnvelope, setShowVADEnvelope] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
  const isProgrammaticScrollRef = useRef(false);

  const totalDurationMs = decodedDurationMs || (audioDurationSec > 0
    ? Math.round(audioDurationSec * 1000)
    : (words.length > 0 ? words[words.length - 1].endMs : 1000));

  // Measure container width accurately using ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const w = container.clientWidth || 900;
      setContainerWidth(w);
    };
    updateWidth();

    const ro = new ResizeObserver(() => {
      updateWidth();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Decode audio, extract high-resolution peaks and compute VAD speech envelope
  useEffect(() => {
    let isCancelled = false;
    async function extractPeaksAndEnvelope() {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        ctx.close();
        if (isCancelled) return;

        audioBufferRef.current = decoded;
        const exactDurationMs = Math.round(decoded.duration * 1000);
        setDecodedDurationMs(exactDurationMs);

        // High resolution 24,000 peak points for 100x zoom
        const channelData = decoded.getChannelData(0);
        const targetCount = 24000;
        const step = Math.max(1, Math.floor(channelData.length / targetCount));
        const actualCount = Math.min(targetCount, Math.floor(channelData.length / step));
        const p = new Float32Array(actualCount);
        for (let i = 0; i < actualCount; i++) {
          const start = i * step;
          let max = 0;
          for (let j = 0; j < step; j++) {
            const val = Math.abs(channelData[start + j] || 0);
            if (val > max) max = val;
          }
          p[i] = max;
        }
        setPeaks(p);

        // Compute high-resolution RMS speech energy envelope and speech islands
        const env = computeEnergyEnvelope(decoded, 8);
        const islands = extractSpeechIslands(env.energies, env.frameMs, env.speechThreshold);
        setSpeechEnvelope({
          energies: env.energies,
          frameMs: env.frameMs,
          speechThreshold: env.speechThreshold,
          islands,
        });
      } catch (e) {
        console.warn('Could not decode audio buffer:', e);
      }
    }
    extractPeaksAndEnvelope();
    return () => {
      isCancelled = true;
    };
  }, [audioBlob]);

  // Compute virtual timeline width in pixels
  const timelinePixelWidth = useMemo(() => {
    return Math.max(containerWidth, Math.round(containerWidth * zoom));
  }, [containerWidth, zoom]);

  const maxScroll = Math.max(0, timelinePixelWidth - containerWidth);

  // Synchronize scroll track div with current scrollLeft
  const syncScrollTrack = useCallback((newScroll: number) => {
    if (scrollTrackRef.current) {
      scrollTrackRef.current.scrollLeft = newScroll;
    }
  }, []);

  // Update zoom with anchor centering (keeps current active word or playhead centered)
  const changeZoomWithAnchor = useCallback((newZoom: number) => {
    const clampedZoom = Math.max(1, Math.min(100, newZoom));
    const oldWidth = timelinePixelWidth;
    const newWidth = Math.max(containerWidth, Math.round(containerWidth * clampedZoom));
    const newMaxScroll = Math.max(0, newWidth - containerWidth);

    const activeWord = activeWordIndex >= 0 && words[activeWordIndex] ? words[activeWordIndex] : null;
    let anchorTimeMs = 0;
    if (activeWord) {
      anchorTimeMs = (activeWord.startMs + activeWord.endMs) / 2;
    } else if (currentTimeMs > 0 && currentTimeMs <= totalDurationMs) {
      anchorTimeMs = currentTimeMs;
    } else {
      anchorTimeMs = ((scrollLeft + containerWidth / 2) / (oldWidth || 1)) * totalDurationMs;
    }

    const newCenterVirtualX = (anchorTimeMs / (totalDurationMs || 1)) * newWidth;
    const targetScroll = Math.max(0, Math.min(newMaxScroll, Math.round(newCenterVirtualX - containerWidth / 2)));

    setZoom(clampedZoom);
    setScrollLeft(targetScroll);
    syncScrollTrack(targetScroll);
  }, [timelinePixelWidth, containerWidth, activeWordIndex, words, currentTimeMs, totalDurationMs, scrollLeft, syncScrollTrack]);

  // Keep playhead comfortably visible during playback
  useEffect(() => {
    if (zoom <= 1 || !isPlaying) return;
    const playheadVirtualX = (currentTimeMs / (totalDurationMs || 1)) * timelinePixelWidth;
    const screenX = playheadVirtualX - scrollLeft;
    if (screenX > containerWidth * 0.85 || screenX < containerWidth * 0.05) {
      const targetScroll = Math.max(0, Math.min(maxScroll, Math.round(playheadVirtualX - containerWidth * 0.25)));
      isProgrammaticScrollRef.current = true;
      setScrollLeft(targetScroll);
      syncScrollTrack(targetScroll);
    }
  }, [currentTimeMs, isPlaying, zoom, totalDurationMs, timelinePixelWidth, scrollLeft, containerWidth, maxScroll, syncScrollTrack]);


  // Loop active word logic
  useEffect(() => {
    if (!loopCurrentWord || activeWordIndex === -1 || !words[activeWordIndex]) return;
    const currentWord = words[activeWordIndex];
    if (currentTimeMs >= currentWord.endMs) {
      onSeek(currentWord.startMs);
    }
  }, [currentTimeMs, loopCurrentWord, activeWordIndex, words, onSeek]);

  // Audition single word
  useEffect(() => {
    if (!isAuditioning || activeWordIndex === -1 || !words[activeWordIndex]) return;
    const currentWord = words[activeWordIndex];
    if (currentTimeMs >= currentWord.endMs) {
      if (isPlaying) {
        onTogglePlay();
      }
      setIsAuditioning(false);
    }
  }, [currentTimeMs, isAuditioning, activeWordIndex, words, isPlaying, onTogglePlay]);

  const handleAuditionWord = (wordIdx?: number) => {
    const idx = wordIdx !== undefined ? wordIdx : activeWordIndex;
    if (idx === -1 || !words[idx]) return;
    const targetWord = words[idx];
    onSelectWord(targetWord, idx);
    onSeek(targetWord.startMs);
    setIsAuditioning(true);
    if (!isPlaying) {
      onTogglePlay();
    }
  };

  // Keyboard shortcuts (Space: play, A: audition, L: loop, [: prev word, ]: next word)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyA') {
        e.preventDefault();
        handleAuditionWord();
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        setLoopCurrentWord((prev) => !prev);
      } else if (e.code === 'BracketLeft') {
        e.preventDefault();
        if (words.length > 0) {
          const nextIdx = Math.max(0, (activeWordIndex === -1 ? 0 : activeWordIndex) - 1);
          onSelectWord(words[nextIdx], nextIdx);
          onSeek(words[nextIdx].startMs);
        }
      } else if (e.code === 'BracketRight') {
        e.preventDefault();
        if (words.length > 0) {
          const nextIdx = Math.min(words.length - 1, (activeWordIndex === -1 ? -1 : activeWordIndex) + 1);
          onSelectWord(words[nextIdx], nextIdx);
          onSeek(words[nextIdx].startMs);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeWordIndex, words, onSelectWord, onSeek]);

  // One-click instant acoustic snapping
  const handleSnapToPeaks = async () => {
    if (!onUpdateWords || words.length === 0) return;
    setIsSnapping(true);
    try {
      let snapped: WordToken[];
      if (audioBufferRef.current) {
        snapped = snapWordsToAcousticEnergy(words, audioBufferRef.current);
      } else {
        snapped = await snapWordsFromAudioBlob(words, audioBlob);
      }
      onUpdateWords(snapped);
      setSnapSuccess(true);
      setTimeout(() => setSnapSuccess(false), 3000);
    } catch (err) {
      console.error('Snap to peaks failed:', err);
    } finally {
      setIsSnapping(false);
    }
  };

  // Render Minimap Overview Canvas (0 to 100% of audio)
  const renderMinimap = useCallback(() => {
    if (!showMinimap) return;
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth;
    const h = 24;
    const neededW = Math.round(w * dpr);
    const neededH = Math.round(h * dpr);

    if (canvas.width !== neededW || canvas.height !== neededH) {
      canvas.width = neededW;
      canvas.height = neededH;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Waveform silhouette in minimap
    if (peaks && peaks.length > 0) {
      const centerY = h / 2;
      const count = Math.min(peaks.length, Math.round(w));
      const step = peaks.length / count;
      for (let i = 0; i < count; i++) {
        const peakIdx = Math.floor(i * step);
        const norm = peaks[peakIdx] || 0;
        const barH = Math.max(1, norm * (h / 2) * 0.95);
        ctx.fillStyle = norm > 0.2 ? '#0284c7' : norm > 0.05 ? '#4338ca' : '#27272a';
        ctx.fillRect(i, centerY - barH, 1, barH * 2);
      }
    }

    // Mini word blocks overlay
    if (words.length > 0 && totalDurationMs > 0) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      words.forEach((wd) => {
        const x1 = (wd.startMs / totalDurationMs) * w;
        const x2 = (wd.endMs / totalDurationMs) * w;
        ctx.fillRect(x1, 1, Math.max(1, x2 - x1), h - 2);
      });
    }

    ctx.restore();
  }, [showMinimap, containerWidth, peaks, words, totalDurationMs]);

  useEffect(() => {
    if (showMinimap) {
      renderMinimap();
    }
  }, [showMinimap, renderMinimap]);

  // Main Waveform Canvas Rendering (Viewport Canvas Architecture)
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = containerWidth;
    const height = 160;
    const neededPixelW = Math.round(width * dpr);
    const neededPixelH = Math.round(height * dpr);

    if (canvas.width !== neededPixelW || canvas.height !== neededPixelH) {
      canvas.width = neededPixelW;
      canvas.height = neededPixelH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // Time Ruler Header Bar
    const timeRulerHeight = 24;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, width, timeRulerHeight);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, timeRulerHeight);
    ctx.lineTo(width, timeRulerHeight);
    ctx.stroke();

    const visibleStartMs = Math.max(0, (scrollLeft / timelinePixelWidth) * totalDurationMs);
    const visibleEndMs = Math.min(totalDurationMs, ((scrollLeft + containerWidth) / timelinePixelWidth) * totalDurationMs);
    const pixelsPerMs = totalDurationMs > 0 ? timelinePixelWidth / totalDurationMs : 1;

    // Granular step intervals down to 1ms (.001s)
    const candidateStepMs = [
      1,      // 1ms
      2,      // 2ms
      5,      // 5ms
      10,     // 10ms
      20,     // 20ms
      50,     // 50ms
      100,    // 100ms
      250,    // 250ms
      500,    // 500ms
      1000,   // 1s
      2000,   // 2s
      5000,   // 5s
      10000,  // 10s
      30000,  // 30s
      60000,  // 1min
    ];

    let stepMs = candidateStepMs[candidateStepMs.length - 1];
    for (const cand of candidateStepMs) {
      if (cand * pixelsPerMs >= 75) {
        stepMs = cand;
        break;
      }
    }

    ctx.font = '10px monospace';
    ctx.fillStyle = '#71717a';

    const startGridMs = Math.max(0, Math.floor(visibleStartMs / stepMs) * stepMs);
    const endGridMs = Math.min(totalDurationMs, Math.ceil(visibleEndMs / stepMs) * stepMs + stepMs);

    // Render Time Ruler Ticks & 3-Digit Millisecond Labels
    for (let currentMs = startGridMs; currentMs <= endGridMs; currentMs += stepMs) {
      const virtualX = (currentMs / totalDurationMs) * timelinePixelWidth;
      const screenX = virtualX - scrollLeft;
      if (screenX < -2 || screenX > width + 2) continue;

      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, timeRulerHeight);
      ctx.strokeStyle = '#3f3f46';
      ctx.stroke();

      // Sub-ticks
      const subDivisions = stepMs <= 2 ? 1 : stepMs <= 10 ? 2 : 5;
      if (subDivisions > 1) {
        const subMs = stepMs / subDivisions;
        for (let sub = 1; sub < subDivisions; sub++) {
          const subVirtualX = ((currentMs + sub * subMs) / totalDurationMs) * timelinePixelWidth;
          const subScreenX = subVirtualX - scrollLeft;
          if (subScreenX >= 0 && subScreenX <= width) {
            ctx.beginPath();
            ctx.moveTo(subScreenX, timeRulerHeight - 6);
            ctx.lineTo(subScreenX, timeRulerHeight);
            ctx.strokeStyle = '#27272a';
            ctx.stroke();
          }
        }
      }

      // Format 3-digit millisecond label: e.g. 00:01.234s
      const min = Math.floor(currentMs / 60000);
      const sec = Math.floor((currentMs % 60000) / 1000);
      const millis = currentMs % 1000;
      let label: string;
      if (stepMs < 1000 || millis > 0) {
        label = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}s`;
      } else {
        label = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}s`;
      }
      ctx.fillText(label, screenX + 3, 15);
    }

    // Authentic Silence Indicators (Acoustic Pauses where wave = 0)
    if (speechEnvelope && speechEnvelope.islands.length > 0) {
      const islands = speechEnvelope.islands;
      const waveTop = timeRulerHeight + 36;
      const waveH = height - waveTop - 6;

      // Leading silence before speech
      if (islands[0].startMs > 50 && islands[0].startMs >= visibleStartMs && 0 <= visibleEndMs) {
        const sX = (0 / totalDurationMs) * timelinePixelWidth - scrollLeft;
        const eX = (islands[0].startMs / totalDurationMs) * timelinePixelWidth - scrollLeft;
        const sW = Math.max(0, Math.min(width, eX) - Math.max(0, sX));
        if (sW > 8) {
          ctx.fillStyle = 'rgba(39, 39, 42, 0.4)';
          ctx.fillRect(Math.max(0, sX), waveTop, sW, waveH);
          if (sW > 60) {
            ctx.font = '9px sans-serif';
            ctx.fillStyle = '#71717a';
            ctx.textAlign = 'center';
            ctx.fillText('Natural Silence (0.0s)', Math.max(0, sX) + sW / 2, waveTop + waveH / 2);
          }
        }
      }

      // Inter-speech silence pauses
      for (let isl = 0; isl < islands.length - 1; isl++) {
        const pauseStart = islands[isl].endMs;
        const pauseEnd = islands[isl + 1].startMs;
        if (pauseEnd - pauseStart >= 40 && pauseEnd >= visibleStartMs && pauseStart <= visibleEndMs) {
          const pVirtualStart = (pauseStart / totalDurationMs) * timelinePixelWidth;
          const pVirtualEnd = (pauseEnd / totalDurationMs) * timelinePixelWidth;
          const pScreenStart = pVirtualStart - scrollLeft;
          const pScreenEnd = pVirtualEnd - scrollLeft;
          const pWidth = pScreenEnd - pScreenStart;
          if (pWidth >= 8) {
            ctx.fillStyle = 'rgba(24, 24, 27, 0.65)';
            ctx.fillRect(pScreenStart, waveTop, pWidth, waveH);
            if (pWidth >= 40 && zoom >= 4) {
              ctx.font = '8px monospace';
              ctx.fillStyle = '#52525b';
              ctx.textAlign = 'center';
              ctx.fillText(`Pause ${pauseEnd - pauseStart}ms`, pScreenStart + pWidth / 2, waveTop + 14);
            }
          }
        }
      }
    }

    // Word Boxes Layer
    const wordAreaTop = timeRulerHeight + 2;
    const wordAreaHeight = 34;

    words.forEach((w, idx) => {
      const isDraggingThis = draggingBoundary && draggingBoundary.wordIndex === idx;
      const startMs = isDraggingThis ? draggingBoundary.currentStartMs : w.startMs;
      const endMs = isDraggingThis ? draggingBoundary.currentEndMs : w.endMs;

      // Filter words outside visible window
      if (endMs < visibleStartMs || startMs > visibleEndMs) return;

      const virtualStartX = (startMs / totalDurationMs) * timelinePixelWidth;
      const virtualEndX = (endMs / totalDurationMs) * timelinePixelWidth;
      const startX = virtualStartX - scrollLeft;
      const endX = virtualEndX - scrollLeft;
      const wordWidth = Math.max(endX - startX, 2);
      const isActive = idx === activeWordIndex;
      const isHoverStart = hoverBoundary && hoverBoundary.wordIndex === idx && hoverBoundary.type === 'start';
      const isHoverEnd = hoverBoundary && hoverBoundary.wordIndex === idx && hoverBoundary.type === 'end';

      if (isActive) {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.38)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
      } else {
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(99, 102, 241, 0.16)' : 'rgba(168, 85, 247, 0.16)';
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 1;
      }
      ctx.fillRect(startX, wordAreaTop, wordWidth, wordAreaHeight);
      ctx.strokeRect(startX, wordAreaTop, wordWidth, wordAreaHeight);

      // Boundary Grippers
      if (isActive || isHoverStart || isHoverEnd || zoom >= 3) {
        ctx.fillStyle = isHoverStart || (isDraggingThis && draggingBoundary.type === 'start')
          ? '#f43f5e'
          : isActive ? '#38bdf8' : 'rgba(255,255,255,0.4)';
        ctx.fillRect(startX, wordAreaTop, Math.min(3, wordWidth / 2), wordAreaHeight);

        ctx.fillStyle = isHoverEnd || (isDraggingThis && draggingBoundary.type === 'end')
          ? '#f43f5e'
          : isActive ? '#38bdf8' : 'rgba(255,255,255,0.4)';
        ctx.fillRect(endX - Math.min(3, wordWidth / 2), wordAreaTop, Math.min(3, wordWidth / 2), wordAreaHeight);
      }

      // Word Label Text & Timestamps
      if (wordWidth > 8) {
        const isWideForTimestamps = wordWidth > 90 && zoom >= 6;
        const fontSize = wordWidth < 26 ? 9 : isActive ? 12 : 11;
        ctx.font = `${isActive ? 'bold ' : ''}${fontSize}px sans-serif`;
        ctx.fillStyle = isActive ? '#38bdf8' : '#f4f4f5';
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX + 3, wordAreaTop, Math.max(0, wordWidth - 6), wordAreaHeight);
        ctx.clip();
        ctx.textAlign = 'center';
        ctx.fillText(w.word, startX + wordWidth / 2, wordAreaTop + (isWideForTimestamps ? 16 : 22));

        if (isWideForTimestamps) {
          ctx.font = '9px monospace';
          ctx.fillStyle = isActive ? '#7dd3fc' : '#a1a1aa';
          ctx.fillText(`[${w.startFormatted} - ${w.endFormatted}] ${w.durationMs}ms`, startX + wordWidth / 2, wordAreaTop + 29);
        }
        ctx.restore();
      }

      // Inter-Word Gap Display (Authentic pause diagnostics)
      if (zoom >= 3 && idx < words.length - 1) {
        const nextWord = words[idx + 1];
        const nextStartMs = draggingBoundary && draggingBoundary.wordIndex === idx + 1
          ? draggingBoundary.currentStartMs
          : nextWord.startMs;
        const gapMs = nextStartMs - endMs;
        const gapStartX = endX;
        const gapEndX = ((nextStartMs / totalDurationMs) * timelinePixelWidth) - scrollLeft;
        const gapWidth = gapEndX - gapStartX;
        if (gapWidth >= 16) {
          ctx.fillStyle = gapMs < 15 ? 'rgba(244, 63, 94, 0.25)' : 'rgba(113, 113, 122, 0.15)';
          ctx.fillRect(gapStartX, wordAreaTop + wordAreaHeight - 10, gapWidth, 10);
          ctx.font = '8px monospace';
          ctx.fillStyle = gapMs < 15 ? '#fda4af' : '#a1a1aa';
          ctx.textAlign = 'center';
          ctx.fillText(`${gapMs}ms`, gapStartX + gapWidth / 2, wordAreaTop + wordAreaHeight - 2);
        }
      }
    });

    // Waveform Rendering Layer
    const waveTop = wordAreaTop + wordAreaHeight + 4;
    const waveHeight = height - waveTop - 6;
    const waveCenterY = waveTop + waveHeight / 2;

    if (peaks && peaks.length > 0) {
      const startPeakIdx = Math.max(0, Math.floor((visibleStartMs / totalDurationMs) * peaks.length));
      const endPeakIdx = Math.min(peaks.length - 1, Math.ceil((visibleEndMs / totalDurationMs) * peaks.length));
      const barWidth = Math.max(1, (timelinePixelWidth / peaks.length) * 0.9);

      for (let i = startPeakIdx; i <= endPeakIdx; i++) {
        const virtualX = (i / peaks.length) * timelinePixelWidth;
        const screenX = virtualX - scrollLeft;
        if (screenX < -barWidth || screenX > width + barWidth) continue;

        const norm = Math.min(1, peaks[i] * 1.55);
        const barH = Math.max(2, norm * (waveHeight / 2));

        // Color coding based on acoustic energy
        if (norm > 0.25) {
          ctx.fillStyle = '#06b6d4'; // Cyan vibrant speech
        } else if (norm > 0.08) {
          ctx.fillStyle = '#6366f1'; // Indigo moderate speech / consonant
        } else {
          ctx.fillStyle = '#3f3f46'; // Zinc noise floor / silence
        }
        ctx.fillRect(screenX, waveCenterY - barH, barWidth, barH * 2);
      }

      // Subtle RMS Energy Contour Line Overlay
      if (showVADEnvelope && speechEnvelope) {
        const envEnergies = speechEnvelope.energies;
        const envFrameMs = speechEnvelope.frameMs;
        const totalFrames = envEnergies.length;
        const startFrame = Math.max(0, Math.floor(visibleStartMs / envFrameMs));
        const endFrame = Math.min(totalFrames - 1, Math.ceil(visibleEndMs / envFrameMs));

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        for (let f = startFrame; f <= endFrame; f++) {
          const tMs = f * envFrameMs;
          const sX = (tMs / totalDurationMs) * timelinePixelWidth - scrollLeft;
          const envVal = Math.min(1, envEnergies[f] * 2.2);
          const sY = waveCenterY - envVal * (waveHeight / 2);
          if (first) {
            ctx.moveTo(sX, sY);
            first = false;
          } else {
            ctx.lineTo(sX, sY);
          }
        }
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#3f3f46';
      ctx.beginPath();
      ctx.moveTo(0, waveCenterY);
      ctx.lineTo(width, waveCenterY);
      ctx.stroke();
    }

    // Hover Cursor Time Guide
    if (hoverTimeMs !== null) {
      const hoverVirtualX = (hoverTimeMs / totalDurationMs) * timelinePixelWidth;
      const hoverScreenX = hoverVirtualX - scrollLeft;
      if (hoverScreenX >= 0 && hoverScreenX <= width) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hoverScreenX, 0);
        ctx.lineTo(hoverScreenX, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
  }, [
    containerWidth,
    scrollLeft,
    timelinePixelWidth,
    totalDurationMs,
    words,
    activeWordIndex,
    peaks,
    speechEnvelope,
    showVADEnvelope,
    hoverTimeMs,
    hoverBoundary,
    draggingBoundary,
    zoom,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Boundary hit test with Y-level awareness (word area vs waveform area)
  const getBoundaryAtCoord = (
    clientX: number,
    localY: number,
    tolerance: number
  ): { wordIndex: number; type: 'start' | 'end' } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // Only allow boundary drag if clicked/touched inside or near the word bar (Y: 15 to 72)
    if (localY > 72) return null;

    const screenMouseX = clientX - rect.left;
    const virtualMouseX = screenMouseX + scrollLeft;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const startX = (w.startMs / totalDurationMs) * timelinePixelWidth;
      const endX = (w.endMs / totalDurationMs) * timelinePixelWidth;
      if (Math.abs(virtualMouseX - startX) <= tolerance) {
        return { wordIndex: i, type: 'start' };
      }
      if (Math.abs(virtualMouseX - endX) <= tolerance) {
        return { wordIndex: i, type: 'end' };
      }
    }
    return null;
  };

  // Find nearest acoustic snap point (valley dip or speech island boundary)
  const findMagneticSnapMs = (targetMs: number): { snappedMs: number; label: string } | null => {
    if (!speechEnvelope) return null;
    const { islands, energies, frameMs } = speechEnvelope;

    // Check speech islands onset and offset
    for (const isl of islands) {
      if (Math.abs(targetMs - isl.startMs) <= 25) {
        return { snappedMs: isl.startMs, label: `Speech Onset (${isl.startMs}ms)` };
      }
      if (Math.abs(targetMs - isl.endMs) <= 25) {
        return { snappedMs: isl.endMs, label: `Speech Offset (${isl.endMs}ms)` };
      }
    }

    // Check local energy dip (valley)
    const targetFrame = Math.round(targetMs / frameMs);
    const searchRadius = Math.round(24 / frameMs);
    let minVal = Infinity;
    let minFrame = targetFrame;
    for (let f = Math.max(0, targetFrame - searchRadius); f <= Math.min(energies.length - 1, targetFrame + searchRadius); f++) {
      if (energies[f] < minVal) {
        minVal = energies[f];
        minFrame = f;
      }
    }
    const valleyMs = minFrame * frameMs;
    if (Math.abs(targetMs - valleyMs) <= 20) {
      return { snappedMs: valleyMs, label: `Acoustic Valley (${valleyMs}ms)` };
    }

    return null;
  };

  // Unified Pointer/Touch Start (supports both Mobile Touch and Desktop Mouse)
  const handlePointerDown = (clientX: number, clientY: number, isTouch: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localY = clientY - rect.top;

    // Check if dragging a boundary edge (tolerance 22px for touch, 10px for mouse)
    const b = getBoundaryAtCoord(clientX, localY, isTouch ? 22 : 10);
    if (b) {
      const targetWord = words[b.wordIndex];
      setDraggingBoundary({
        type: b.type,
        wordIndex: b.wordIndex,
        startX: clientX,
        origStartMs: targetWord.startMs,
        origEndMs: targetWord.endMs,
        currentStartMs: targetWord.startMs,
        currentEndMs: targetWord.endMs,
      });
      onSelectWord(targetWord, b.wordIndex);
      return;
    }

    // Otherwise, start Panning (swiping left/right on timeline)
    setIsPanning(true);
    setPanStartX(clientX);
    setPanStartY(clientY);
    setPanStartScroll(scrollLeft);
    setHasPanMoved(false);
  };

  // Unified Pointer/Touch Move
  const handlePointerMove = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPanning) {
      const deltaX = clientX - panStartX;
      const deltaY = clientY - panStartY;
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        setHasPanMoved(true);
      }
      const targetScroll = Math.max(0, Math.min(maxScroll, panStartScroll - deltaX));
      setScrollLeft(targetScroll);
      syncScrollTrack(targetScroll);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const virtualX = screenX + scrollLeft;
    const ratio = virtualX / timelinePixelWidth;
    const rawMs = Math.max(0, Math.min(totalDurationMs, Math.round(ratio * totalDurationMs)));
    setHoverTimeMs(rawMs);

    if (draggingBoundary) {
      const idx = draggingBoundary.wordIndex;
      const prevWord = idx > 0 ? words[idx - 1] : null;
      const nextWord = idx < words.length - 1 ? words[idx + 1] : null;

      let activeMs = rawMs;
      const snapResult = findMagneticSnapMs(rawMs);
      if (snapResult) {
        activeMs = snapResult.snappedMs;
        setMagneticSnapInfo(`Magnet: Snapped to ${snapResult.label}`);
      } else {
        setMagneticSnapInfo(null);
      }

      if (draggingBoundary.type === 'start') {
        const minStart = prevWord ? prevWord.endMs + 10 : 0;
        const maxStart = draggingBoundary.origEndMs - 45;
        const clampedStart = Math.max(minStart, Math.min(maxStart, activeMs));
        setDraggingBoundary((prev) => (prev ? { ...prev, currentStartMs: clampedStart } : null));
      } else {
        const minEnd = draggingBoundary.origStartMs + 45;
        const maxEnd = nextWord ? nextWord.startMs - 10 : totalDurationMs;
        const clampedEnd = Math.max(minEnd, Math.min(maxEnd, activeMs));
        setDraggingBoundary((prev) => (prev ? { ...prev, currentEndMs: clampedEnd } : null));
      }
      return;
    }

    const localY = clientY - rect.top;
    const b = getBoundaryAtCoord(clientX, localY, 10);
    setHoverBoundary(b);
  };

  // Unified Pointer/Touch Release
  const handlePointerUp = (clientX?: number) => {
    if (isPanning) {
      // If user merely tapped without moving, select the word or seek!
      if (!hasPanMoved && clientX !== undefined && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const screenX = clientX - rect.left;
        const virtualX = screenX + scrollLeft;
        const clickedRatio = virtualX / timelinePixelWidth;
        const targetMs = Math.round(clickedRatio * totalDurationMs);

        const foundWordIdx = words.findIndex((w) => targetMs >= w.startMs && targetMs <= w.endMs);
        if (foundWordIdx !== -1) {
          onSelectWord(words[foundWordIdx], foundWordIdx);
          onSeek(words[foundWordIdx].startMs);
        } else {
          onSeek(Math.max(0, Math.min(totalDurationMs, targetMs)));
        }
      }
      setIsPanning(false);
      setHasPanMoved(false);
    }

    if (draggingBoundary && onUpdateWords) {
      const updatedWords = words.map((w, idx) => {
        if (idx === draggingBoundary.wordIndex) {
          const s = draggingBoundary.currentStartMs;
          const e = draggingBoundary.currentEndMs;
          return {
            ...w,
            startMs: s,
            endMs: e,
            startFormatted: formatMs(s),
            endFormatted: formatMs(e),
            durationMs: e - s,
          };
        }
        return w;
      });
      onUpdateWords(enforceMonotonicTimeline(updatedWords, totalDurationMs));
      setDraggingBoundary(null);
      setMagneticSnapInfo(null);
    }
  };

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePointerDown(e.clientX, e.clientY, false);
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePointerMove(e.clientX, e.clientY);
  };
  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePointerUp(e.clientX);
  };
  const handleMouseLeave = () => {
    setHoverTimeMs(null);
    setHoverBoundary(null);
    if (isPanning) setIsPanning(false);
    if (draggingBoundary) handlePointerUp();
  };

  // Touch Handlers (Mobile Left-Right Dragging & 2-Finger Pinch Zoom)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setTouchPinchDist(dist);
      setTouchPinchStartZoom(zoom);
      setIsPanning(false);
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handlePointerDown(touch.clientX, touch.clientY, true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && touchPinchDist) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / touchPinchDist;
      const targetZoom = Math.max(1, Math.min(100, Math.round(touchPinchStartZoom * ratio)));
      if (targetZoom !== zoom) {
        changeZoomWithAnchor(targetZoom);
      }
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handlePointerMove(touch.clientX, touch.clientY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchPinchDist) {
      setTouchPinchDist(null);
      return;
    }
    const clientX = e.changedTouches[0]?.clientX;
    handlePointerUp(clientX);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const virtualX = screenX + scrollLeft;
    const targetMs = Math.round((virtualX / timelinePixelWidth) * totalDurationMs);
    const foundWordIdx = words.findIndex((w) => targetMs >= w.startMs && targetMs <= w.endMs);
    if (foundWordIdx !== -1) {
      handleAuditionWord(foundWordIdx);
    }
  };

  // Mouse wheel: horizontal scrolling or zoom on Ctrl/Alt
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const step = zoom >= 20 ? 5 : 1;
      if (e.deltaY < 0) {
        changeZoomWithAnchor(zoom + step);
      } else if (e.deltaY > 0) {
        changeZoomWithAnchor(zoom - step);
      }
    } else {
      // Horizontal scroll
      if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const targetScroll = Math.max(0, Math.min(maxScroll, scrollLeft + delta));
        setScrollLeft(targetScroll);
        syncScrollTrack(targetScroll);
      }
    }
  };

  // Scroll track scroll sync
  const handleScrollTrack = (e: React.UIEvent<HTMLDivElement>) => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  // Minimap navigation (supports click & touch swipe)
  const handleMinimapPointer = (clientX: number) => {
    const minimap = minimapCanvasRef.current;
    if (!minimap) return;
    const rect = minimap.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetMs = clickRatio * totalDurationMs;
    const targetVirtualX = (targetMs / (totalDurationMs || 1)) * timelinePixelWidth;
    const targetScroll = Math.max(0, Math.min(maxScroll, Math.round(targetVirtualX - containerWidth / 2)));
    setScrollLeft(targetScroll);
    syncScrollTrack(targetScroll);
  };

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    handleMinimapPointer(e.clientX);
  };

  const handleMinimapTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      handleMinimapPointer(e.touches[0].clientX);
    }
  };

  const cursorClass = draggingBoundary || hoverBoundary
    ? 'cursor-col-resize'
    : isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair';

  // Minimap lens positions
  const minimapLensLeft = timelinePixelWidth > 0 ? (scrollLeft / timelinePixelWidth) * containerWidth : 0;
  const minimapLensWidth = timelinePixelWidth > 0 ? Math.max(16, (containerWidth / timelinePixelWidth) * containerWidth) : containerWidth;
  const minimapPlayheadX = totalDurationMs > 0 ? (currentTimeMs / totalDurationMs) * containerWidth : 0;

  // Playhead screen coordinate
  const screenPlayheadX = totalDurationMs > 0
    ? ((currentTimeMs / totalDurationMs) * timelinePixelWidth) - scrollLeft
    : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl select-none">
      {/* Top Header with Active Word Info, Nudge Micro-Steppers, and Zoom Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-2 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-zinc-300">Acoustic Timeline</span>
          </div>
        </div>

        {/* Zoom Presets & Precision Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
              showMinimap
                ? 'bg-cyan-950/80 border-cyan-700/80 text-cyan-300'
                : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Toggle Minimap Overview bar"
          >
            <Compass className="w-3 h-3 text-cyan-400" />
            <span>Minimap</span>
          </button>

          <span className="text-[11px] text-zinc-400 font-medium ml-1">Zoom:</span>
          {[1, 2, 5, 10, 20, 50, 100].map((level) => (
            <button
              key={level}
              onClick={() => changeZoomWithAnchor(level)}
              className={`px-2 py-0.5 rounded text-xs font-mono font-semibold transition-all ${
                zoom === level
                  ? 'bg-cyan-500 text-zinc-950 shadow-sm'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {level}x
            </button>
          ))}
          {zoom >= 50 ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 font-semibold shadow-sm animate-pulse">
              3-Digit Millisecond Mode Active (.001s / 1ms)
            </span>
          ) : zoom >= 20 ? (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/90 border border-cyan-500/80 text-cyan-300 font-semibold shadow-sm">
              Ultra Zoom ({zoom}x)
            </span>
          ) : null}
        </div>
      </div>

      {/* Optional Minimap Overview Bar with Viewport Lens */}
      {showMinimap && (
        <div className="relative mb-2 flex items-center gap-1.5 animate-in fade-in duration-150">
          <div
            onClick={handleMinimapClick}
            onTouchStart={handleMinimapTouch}
            onTouchMove={handleMinimapTouch}
            className="relative flex-1 h-6 rounded-lg bg-zinc-950 border border-zinc-800/80 overflow-hidden cursor-pointer group touch-none"
            title="Minimap: Click or touch to jump view instantly"
          >
            <canvas ref={minimapCanvasRef} className="w-full h-full block touch-none" />

            {/* Draggable Viewport Lens (Hardware accelerated transform) */}
            <div
              style={{
                transform: `translate3d(${minimapLensLeft}px, 0, 0)`,
                width: `${minimapLensWidth}px`,
              }}
              className="absolute top-0 bottom-0 left-0 border-2 border-cyan-400/90 bg-cyan-400/20 rounded pointer-events-none will-change-transform"
            />

            {/* Mini Playhead Marker (Hardware accelerated transform) */}
            <div
              style={{
                transform: `translate3d(${minimapPlayheadX}px, 0, 0)`,
              }}
              className="absolute top-0 bottom-0 left-0 w-0.5 bg-rose-500 pointer-events-none shadow-[0_0_6px_rgba(244,63,94,0.9)] will-change-transform"
            />
          </div>
          <button
            onClick={() => setShowMinimap(false)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Close Minimap"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Waveform Viewport (Viewport Canvas: 100% stable, zero clipping/sticky bugs) */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="relative w-full h-[160px] rounded-xl border border-zinc-800/80 bg-zinc-950 overflow-hidden shadow-inner touch-none"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className={`w-full h-full block touch-none ${cursorClass}`}
        />

        {/* Hardware-Accelerated Playhead Needle (Compositor-only, 0ms CPU load) */}
        {screenPlayheadX >= -2 && screenPlayheadX <= containerWidth + 2 && (
          <div
            style={{ transform: `translate3d(${screenPlayheadX}px, 0, 0)` }}
            className="absolute top-0 bottom-0 left-0 w-0.5 bg-rose-500 pointer-events-none z-20 shadow-[0_0_8px_rgba(244,63,94,0.95)] will-change-transform"
          >
            {/* Top Triangle Needle Head */}
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-rose-500 -ml-[4px]" />
          </div>
        )}


        {/* Magnetic Snap Feedback Banner */}
        {magneticSnapInfo && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 px-2.5 py-1 rounded-lg bg-amber-950/95 border border-amber-500 text-[11px] font-mono text-amber-200 shadow-xl flex items-center gap-1.5 animate-pulse">
            <Magnet className="w-3.5 h-3.5 text-amber-400" />
            <span>{magneticSnapInfo}</span>
          </div>
        )}

        {/* Dragging Active Word Indicator */}
        {draggingBoundary && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1 rounded-lg bg-cyan-950/95 border border-cyan-500 text-xs font-mono text-cyan-200 shadow-xl z-20 flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>
              {words[draggingBoundary.wordIndex].word}: [{formatMs(draggingBoundary.currentStartMs)} - {formatMs(draggingBoundary.currentEndMs)}] ({draggingBoundary.currentEndMs - draggingBoundary.currentStartMs}ms)
            </span>
          </div>
        )}

        {/* Hover Time Tooltip */}
        {!draggingBoundary && hoverTimeMs !== null && (
          <div className="absolute left-2 top-1 pointer-events-none px-2 py-0.5 rounded bg-zinc-900/95 border border-zinc-700 text-[10px] font-mono text-zinc-300 z-20 shadow-md">
            Cursor: <span className="text-cyan-400 font-bold">{formatMsToStandard(hoverTimeMs)}</span> ({hoverTimeMs}ms)
          </div>
        )}
      </div>

      {/* Synchronized Virtual Scrollbar Track */}
      <div
        ref={scrollTrackRef}
        onScroll={handleScrollTrack}
        className="w-full h-3 mt-1 bg-zinc-950 rounded border border-zinc-800/80 overflow-x-auto overflow-y-hidden"
        title="Timeline Scrollbar: Drag to navigate"
      >
        <div style={{ width: `${timelinePixelWidth}px`, height: '1px' }} />
      </div>

      {/* Mobile Swipe & Pinch Helper Tip */}
      <div className="flex sm:hidden items-center justify-between mt-1.5 px-1 text-[10px] text-zinc-400 font-mono">
        <span className="flex items-center gap-1">
          <span className="text-cyan-400 font-bold">👈 Swipe 👉</span> left/right to scroll timeline
        </span>
        <span className="text-zinc-500">2-Finger Pinch Zoom</span>
      </div>

      {/* Control Toolbar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSeek(Math.max(0, currentTimeMs - 2000))}
            className="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition-colors"
            title="Rewind 2 seconds"
          >
            <Rewind className="w-4 h-4" />
          </button>
          <button
            onClick={onTogglePlay}
            className="h-10 w-10 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 flex items-center justify-center font-bold shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => onSeek(Math.min(totalDurationMs, currentTimeMs + 2000))}
            className="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition-colors"
            title="Fast Forward 2 seconds"
          >
            <FastForward className="w-4 h-4" />
          </button>

          {/* Audition Word Solo Play */}
          <button
            onClick={() => handleAuditionWord()}
            disabled={activeWordIndex < 0 || !words[activeWordIndex]}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 transition-all disabled:opacity-40"
            title="Audition selected word solo (HotKey: A or double-click)"
          >
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Audition (A)</span>
          </button>

          {/* Loop Word */}
          <button
            onClick={() => setLoopCurrentWord(!loopCurrentWord)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              loopCurrentWord
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
                : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Loop currently highlighted word (HotKey: L)"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Loop (L)</span>
          </button>

          {/* Auto-Align Words to Acoustic Peaks */}
          {onUpdateWords && words.length > 0 && (
            <button
              onClick={handleSnapToPeaks}
              disabled={isSnapping}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all ${
                snapSuccess
                  ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-500/25 hover:scale-105 active:scale-95'
              } disabled:opacity-50`}
              title="Acoustically snap word boundaries to authentic sound wave energy peaks and zero-silence pauses"
            >
              {snapSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-200" />
                  <span>Peaks Synced!</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-cyan-200" />
                  <span>{isSnapping ? 'Snapping...' : 'Auto-Align to Waves'}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Current Time Display */}
        <div className="flex items-center gap-1.5 font-mono text-sm">
          <span className="text-cyan-400 font-bold px-2 py-1 rounded bg-zinc-950 border border-zinc-800">
            {formatMsToStandard(currentTimeMs)}
          </span>
          <span className="text-zinc-500">/</span>
          <span className="text-zinc-400 px-2 py-1 rounded bg-zinc-950 border border-zinc-800">
            {formatMsToStandard(totalDurationMs)}
          </span>
        </div>

        {/* Speed & Zoom Controls */}
        <div className="flex items-center gap-2">
          <select
            value={playbackRate}
            onChange={(e) => {
              const r = parseFloat(e.target.value);
              setPlaybackRate(r);
              const audioEl = document.querySelector('audio');
              if (audioEl) audioEl.playbackRate = r;
            }}
            className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 font-mono focus:outline-none focus:border-cyan-500"
            title="Playback speed"
          >
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1.0x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>

          <div className="flex items-center rounded-lg bg-zinc-800 border border-zinc-700 px-1 py-0.5">
            <button
              onClick={() => changeZoomWithAnchor(zoom <= 20 ? zoom - 1 : zoom - 5)}
              disabled={zoom <= 1}
              className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-40"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={zoom}
              onChange={(e) => changeZoomWithAnchor(parseInt(e.target.value, 10))}
              className="w-16 sm:w-24 accent-cyan-400 mx-1 cursor-pointer"
              title={`Zoom: ${zoom}x (Up to 100x • 3-digit millisecond precision)`}
            />
            <span className="text-[11px] font-mono px-1 text-cyan-400 font-bold min-w-[34px] text-center">
              {zoom}x
            </span>
            <button
              onClick={() => changeZoomWithAnchor(zoom < 20 ? zoom + 1 : zoom + 5)}
              disabled={zoom >= 100}
              className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-40"
              title="Zoom In (up to 100x • 3-digit ms mode)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

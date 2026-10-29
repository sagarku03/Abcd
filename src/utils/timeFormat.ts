/**
 * Time formatting utilities for Millisecond-Precision Forced Alignment
 */

export function formatMsToStandard(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function parseStandardToMs(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(/[\[\]]/g, '');
  const match = cleaned.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return 0;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  const msStr = (match[4] || '0').padEnd(3, '0').slice(0, 3);
  const ms = parseInt(msStr, 10);

  return hours * 3600000 + mins * 60000 + secs * 1000 + ms;
}

export function formatMsToSRT(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function formatMsToVTT(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatMsToASS(ms: number): string {
  if (isNaN(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const cs = Math.floor((ms % 1000) / 10); // centiseconds

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatReadableDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(2);
  if (ms < 60000) return `${secs}s`;
  const mins = Math.floor(ms / 60000);
  const remSecs = ((ms % 60000) / 1000).toFixed(1);
  return `${mins}m ${remSecs}s`;
}

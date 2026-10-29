import { WordToken } from '../types.ts';

const DB_NAME = 'ai_speech_transcription_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'active_transcription_session';

export interface SavedSession {
  fileName: string;
  audioBlob: Blob;
  audioDurationSec: number;
  mimeType: string;
  words: WordToken[];
  modelUsed: string;
  scriptText?: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save current transcription session (including audio blob & words) into IndexedDB
 */
export async function saveSessionToStorage(session: Omit<SavedSession, 'timestamp'>): Promise<void> {
  try {
    const db = await openDB();
    const dataToSave: SavedSession = {
      ...session,
      timestamp: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dataToSave, SESSION_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to save session to IndexedDB:', err);
  }
}

/**
 * Load saved transcription session from IndexedDB
 */
export async function loadSessionFromStorage(): Promise<SavedSession | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to load session from IndexedDB:', err);
    return null;
  }
}

/**
 * Clear the saved session from IndexedDB
 */
export async function clearSessionFromStorage(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(SESSION_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to clear session from IndexedDB:', err);
  }
}

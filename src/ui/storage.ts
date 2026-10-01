import type { Project } from '../model';

const DB = 'fire-sign-designator';
const STORE = 'autosave';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveAutosave(p: Project) {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(p, 'current');
  } catch {
    /* autosave is best-effort */
  }
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const r = db.transaction(STORE).objectStore(STORE).get('current');
      r.onsuccess = () => res((r.result as Project) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

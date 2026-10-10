// 완성(마무리) 이미지 원본 보관. 크기가 커서 localStorage 대신 IndexedDB에 둔다.
// IndexedDB를 못 쓰면(사생활 보호 창 등) 이번 세션 메모리에만 둔다.

export interface StoredFile {
  key: string;
  name: string;
  blob: Blob;
  savedAt: number;
}

const DB_NAME = 'comfy-asset-tool';
const STORE = 'finals';
const memory = new Map<string, StoredFile>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** 프로젝트별로 키를 나눈다 */
export function fileKey(projectId: string, rowKey: string): string {
  return `${projectId}::${rowKey}`;
}

export async function putFile(key: string, name: string, blob: Blob): Promise<void> {
  const rec = { key, name, blob, savedAt: Date.now() };
  memory.set(key, rec);
  await tx('readwrite', (s) => s.put(rec));
}

export async function getFile(key: string): Promise<StoredFile | undefined> {
  return memory.get(key) ?? (await tx<StoredFile>('readonly', (s) => s.get(key)));
}

export async function deleteFile(key: string): Promise<void> {
  memory.delete(key);
  await tx('readwrite', (s) => s.delete(key));
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? [];
  const all = new Set([...keys.map(String), ...memory.keys()]);
  return [...all].filter((k) => k.startsWith(prefix));
}

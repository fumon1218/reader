import { useEffect, useRef, useState } from 'react';
import type { Book, CacheEntry, DayStat, Highlight, Section, Word } from './types';
import { recordTomb } from './lib/sync/tombs';

/**
 * 아주 얇은 IndexedDB 래퍼. 외부 라이브러리 없이 책/단어/통계를 기기에 저장합니다.
 * 쓰기 후에는 해당 테이블의 변경을 알려서, useLive()로 읽는 화면이 자동으로 갱신됩니다.
 */
export type StoreName = 'books' | 'sections' | 'words' | 'highlights' | 'days' | 'cache';
export const STORES: StoreName[] = ['books', 'sections', 'words', 'highlights', 'days', 'cache'];

const DB_NAME = 'world-through-stories';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      const auto = { keyPath: 'id', autoIncrement: true } as const;
      const books = d.createObjectStore('books', auto);
      books.createIndex('status', 'status');
      books.createIndex('language', 'language');
      const sections = d.createObjectStore('sections', auto);
      sections.createIndex('bookId', 'bookId');
      sections.createIndex('bookIndex', ['bookId', 'index'], { unique: true });
      const words = d.createObjectStore('words', auto);
      words.createIndex('key', 'key', { unique: true });
      words.createIndex('language', 'language');
      words.createIndex('bookId', 'bookId');
      words.createIndex('status', 'status');
      words.createIndex('due', 'due');
      const hl = d.createObjectStore('highlights', auto);
      hl.createIndex('bookId', 'bookId');
      const days = d.createObjectStore('days', { keyPath: 'key' });
      days.createIndex('date', 'date');
      days.createIndex('bookId', 'bookId');
      d.createObjectStore('cache', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      dbPromise = null;
      reject(r.error ?? new Error('저장소를 열 수 없어요'));
    };
  });
  return dbPromise;
}

const wrap = <T,>(r: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소됐어요'));
  });

// ---- 변경 알림 -------------------------------------------------------
type Listener = (tables: StoreName[]) => void;
const listeners = new Set<Listener>();
function emit(tables: StoreName[]) {
  listeners.forEach((l) => l(tables));
}
/** 어느 테이블이든 바뀌면 알려 달라고 등록합니다(동기화용). 해제 함수를 돌려줍니다. */
export function onTablesChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ---- 테이블 ----------------------------------------------------------
export function newUid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export interface Table<T> {
  /** 동기화로 받은 값을 그대로(수정 시각을 바꾸지 않고) 저장/삭제합니다. */
  putRaw(value: T): Promise<IDBValidKey>;
  bulkPutRaw(values: T[]): Promise<void>;
  delRaw(key: IDBValidKey): Promise<void>;
  all(): Promise<T[]>;
  get(key: IDBValidKey): Promise<T | undefined>;
  put(value: T): Promise<IDBValidKey>;
  bulkPut(values: T[]): Promise<void>;
  del(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  where(index: string, value: IDBValidKey | IDBKeyRange): Promise<T[]>;
}

/** 저장할 때 수정 시각(과 필요하면 고유 번호)을 자동으로 붙입니다. */
type Stamp = { uid?: boolean; time?: boolean } | undefined;
function stamped<T>(v: T, stamp: Stamp): T {
  if (!stamp) return v;
  const o = { ...(v as Record<string, unknown>) };
  if (stamp.time) o.updatedAt = Date.now();
  if (stamp.uid && !o.uid) o.uid = newUid();
  return o as T;
}

function table<T>(name: StoreName, stamp?: Stamp): Table<T> {
  const run = async <R,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const d = await openDb();
    const tx = d.transaction(name, mode);
    const result = wrap(f(tx.objectStore(name)));
    if (mode === 'readwrite') {
      const [r] = await Promise.all([result, txDone(tx)]);
      return r;
    }
    return result;
  };
  return {
    all: () => run('readonly', (s) => s.getAll() as IDBRequest<T[]>),
    get: (key) => run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
    put: async (value) => {
      const k = await run('readwrite', (s) => s.put(stamped(value, stamp)));
      emit([name]);
      return k;
    },
    bulkPut: async (values) => {
      if (!values.length) return;
      const d = await openDb();
      const tx = d.transaction(name, 'readwrite');
      const s = tx.objectStore(name);
      values.forEach((v) => s.put(stamped(v, stamp)));
      await txDone(tx);
      emit([name]);
    },
    putRaw: async (value) => {
      const k = await run('readwrite', (s) => s.put(value));
      emit([name]);
      return k;
    },
    bulkPutRaw: async (values) => {
      if (!values.length) return;
      const d = await openDb();
      const tx = d.transaction(name, 'readwrite');
      const s = tx.objectStore(name);
      values.forEach((v) => s.put(v));
      await txDone(tx);
      emit([name]);
    },
    del: async (key) => {
      if (name === 'highlights') {
        const h = (await run('readonly', (s) => s.get(key) as IDBRequest<Highlight | undefined>)) as Highlight | undefined;
        if (h?.uid) recordTomb('highlights', h.uid);
      }
      await run('readwrite', (s) => s.delete(key));
      emit([name]);
    },
    delRaw: async (key) => {
      await run('readwrite', (s) => s.delete(key));
      emit([name]);
    },
    clear: async () => {
      await run('readwrite', (s) => s.clear());
      emit([name]);
    },
    count: () => run('readonly', (s) => s.count()),
    where: (index, value) =>
      run('readonly', (s) =>
        s.index(index).getAll(value instanceof IDBKeyRange ? value : IDBKeyRange.only(value)) as IDBRequest<T[]>
      ),
  };
}

export const books = table<Book>('books', { uid: true, time: true });
export const sections = table<Section>('sections');
export const words = table<Word>('words');
export const highlights = table<Highlight>('highlights', { uid: true, time: true });
export const days = table<DayStat>('days', { time: true });
export const cache = table<CacheEntry>('cache');

// ---- 여러 테이블에 걸친 작업 ---------------------------------------------
/** 커서로 순회하며 콜백이 true를 돌려주면 삭제, 객체를 돌려주면 갱신 */
function eachCursor<T>(req: IDBRequest<IDBCursorWithValue | null>, cb: (v: T) => 'delete' | T | void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const out = cb(c.value as T);
      if (out === 'delete') c.delete();
      else if (out) c.update(out);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** 책과 관련 데이터를 지웁니다. 단어장의 단어는 남기고 책 연결만 끊습니다. */
export async function deleteBook(id: number, opts: { fromSync?: boolean } = {}) {
  if (!opts.fromSync) {
    // 다른 기기에서도 지워지도록 삭제 기록을 남깁니다.
    const b = await books.get(id);
    if (b?.uid) recordTomb('books', b.uid);
    for (const h of await highlights.where('bookId', id)) if (h.uid) recordTomb('highlights', h.uid);
  }
  const d = await openDb();
  const tx = d.transaction(['books', 'sections', 'highlights', 'days', 'words'], 'readwrite');
  const done = txDone(tx);
  const only = IDBKeyRange.only(id);
  await Promise.all([
    eachCursor(tx.objectStore('sections').index('bookId').openCursor(only), () => 'delete'),
    eachCursor(tx.objectStore('highlights').index('bookId').openCursor(only), () => 'delete'),
    eachCursor(tx.objectStore('days').index('bookId').openCursor(only), () => 'delete'),
    eachCursor<Word>(tx.objectStore('words').index('bookId').openCursor(only), (w) => {
      const { bookId, sectionIndex, paraIndex, ...rest } = w;
      void bookId;
      void sectionIndex;
      void paraIndex;
      return rest as Word;
    }),
    wrap(tx.objectStore('books').delete(id)),
  ]);
  await done;
  emit(['books', 'sections', 'highlights', 'days', 'words']);
}

/** 새 책과 그 구간들을 한 번에 저장하고 책 id를 돌려줍니다. */
export async function addBookWithSections(book: Book, secs: Omit<Section, 'id' | 'bookId'>[]): Promise<number> {
  const d = await openDb();
  const tx = d.transaction(['books', 'sections'], 'readwrite');
  const done = txDone(tx);
  const id = (await wrap(tx.objectStore('books').add({ ...book, uid: book.uid ?? newUid(), updatedAt: Date.now() }))) as number;
  const s = tx.objectStore('sections');
  secs.forEach((sec) => s.add({ ...sec, bookId: id }));
  await done;
  emit(['books', 'sections']);
  return id;
}

export async function getSection(bookId: number, index: number): Promise<Section | undefined> {
  const d = await openDb();
  const tx = d.transaction('sections', 'readonly');
  return (await wrap(tx.objectStore('sections').index('bookIndex').get([bookId, index]))) as Section | undefined;
}

export async function getSectionTitles(bookId: number): Promise<{ index: number; title: string; chars: number }[]> {
  const all = await sections.where('bookId', bookId);
  return all.map((s) => ({ index: s.index, title: s.title, chars: s.chars })).sort((a, b) => a.index - b.index);
}

/** 백업 파일 내보내기용: 캐시를 제외한 모든 데이터 */
export async function dumpAll() {
  const [b, s, w, h, d] = await Promise.all([books.all(), sections.all(), words.all(), highlights.all(), days.all()]);
  return { books: b, sections: s, words: w, highlights: h, days: d };
}

export type Dump = Awaited<ReturnType<typeof dumpAll>>;

/** 백업 복원: 기존 데이터를 모두 지우고 백업 내용으로 교체합니다. */
export async function restoreAll(data: Dump) {
  const d = await openDb();
  const tx = d.transaction(STORES, 'readwrite');
  const done = txDone(tx);
  STORES.forEach((n) => tx.objectStore(n).clear());
  const put = (n: StoreName, rows: unknown[] | undefined) => (rows ?? []).forEach((r) => tx.objectStore(n).put(r));
  put('books', data.books);
  put('sections', data.sections);
  put('words', data.words);
  put('highlights', data.highlights);
  put('days', data.days);
  await done;
  emit(STORES);
}

export async function wipeAll() {
  const d = await openDb();
  const tx = d.transaction(STORES, 'readwrite');
  const done = txDone(tx);
  STORES.forEach((n) => tx.objectStore(n).clear());
  await done;
  emit(STORES);
}

// ---- React 훅 --------------------------------------------------------
/**
 * 쿼리를 실행해 결과를 돌려주고, 지정한 테이블이 바뀌면 다시 실행합니다.
 * 처음 결과가 올 때까지는 undefined입니다.
 */
export function useLive<T>(tables: StoreName[], query: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      queryRef.current().then(
        (v) => {
          if (alive && mine === seq) setValue(v);
        },
        (e) => console.error('DB 읽기 실패', e)
      );
    };
    run();
    const l: Listener = (changed) => {
      if (changed.some((c) => tables.includes(c))) run();
    };
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

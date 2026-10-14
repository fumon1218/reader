import { useSyncExternalStore } from 'react';
import { books, days, deleteBook, highlights, newUid, onTablesChange, sections, words } from '../../db';
import type { Book, DayStat, Highlight, Section } from '../../types';
import { planItems, planSync, type RemoteItem } from './engine';
import { dropTombs, readTombs } from './tombs';
import * as remote from './remote';

export type SyncStatus = 'off' | 'connecting' | 'idle' | 'syncing' | 'error';
export interface SyncState {
  status: SyncStatus;
  user: remote.SyncUser | null;
  lastSyncAt: number | null;
  error: string;
  /** 마지막 동기화 결과 (확인용) */
  result: { local: number; pushed: number; pulled: number; removed: number } | null;
}

const FLAG = 'wts_sync_on';
let state: SyncState = { status: 'off', user: null, lastSyncAt: null, error: '', result: null };
const subs = new Set<() => void>();
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export function useSync(): SyncState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => state
  );
}

type CollName = 'words' | 'books' | 'highlights' | 'days';
const COLLS: CollName[] = ['words', 'books', 'highlights', 'days'];
interface Mark {
  lastPulled: number;
  lastPushed: number;
}
interface Marks {
  lastSyncAt: number;
  c: Record<CollName, Mark>;
}
const marksKey = (uid: string) => `wts_sync_marks_${uid}`;
function loadMarks(uid: string): Marks {
  const empty = (): Mark => ({ lastPulled: 0, lastPushed: 0 });
  const m: Marks = { lastSyncAt: 0, c: { words: empty(), books: empty(), highlights: empty(), days: empty() } };
  try {
    const raw = JSON.parse(localStorage.getItem(marksKey(uid)) ?? '{}') as Record<string, unknown>;
    m.lastSyncAt = Number(raw.lastSyncAt) || 0;
    if (raw.c && typeof raw.c === 'object') {
      for (const k of COLLS) m.c[k] = { ...empty(), ...((raw.c as Record<string, Mark>)[k] ?? {}) };
    } else if (raw.lastPushed !== undefined) {
      // 이전 버전(단어만 동기화)의 기록
      m.c.words = { lastPulled: Number(raw.lastPulled) || 0, lastPushed: Number(raw.lastPushed) || 0 };
    }
  } catch {
    /* 기본값 */
  }
  return m;
}
function saveMarks(uid: string, m: Marks) {
  try {
    localStorage.setItem(marksKey(uid), JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** 이 기기의 고유 번호(독서 기록을 기기별로 나눠 저장하기 위해). */
function deviceId(): string {
  try {
    let d = localStorage.getItem('wts_device');
    if (!d) {
      d = newUid().slice(0, 8);
      localStorage.setItem('wts_device', d);
    }
    return d;
  } catch {
    return 'dev';
  }
}

export function syncErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  const map: Record<string, string> = {
    'auth/popup-closed-by-user': '로그인 창이 닫혔어요.',
    'auth/cancelled-popup-request': '로그인 창이 닫혔어요.',
    'auth/unauthorized-domain': '이 주소가 Firebase의 “승인된 도메인”에 없어요. Authentication → 설정에서 fumon1218.github.io를 추가해 주세요.',
    'auth/operation-not-allowed': '이 로그인 방식이 아직 꺼져 있어요. Firebase Authentication → Sign-in method에서 켜 주세요.',
    'auth/invalid-credential': '이메일이나 비밀번호가 맞지 않아요.',
    'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
    'auth/email-already-in-use': '이미 가입된 이메일이에요. “로그인”을 눌러 주세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
    'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
    'permission-denied': '서버가 저장을 허락하지 않았어요. Firestore 보안 규칙을 확인해 주세요.',
    unavailable: '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
    'failed-precondition': 'Firestore 데이터베이스가 아직 만들어지지 않았을 수 있어요.',
  };
  return (map[code] ?? ((e as Error).message || '동기화에 실패했어요')) + (map[code] ? '' : code ? ` (${code})` : '');
}

// ---- 동기화 실행 ---------------------------------------------------------
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const echo = new Map<string, number>();

export function syncNow(): Promise<void> {
  return run();
}

type BookData = Omit<Book, 'id'>;
interface HlData {
  bookUid: string;
  sectionIndex: number;
  paraIndex: number;
  start: number;
  end: number;
  text: string;
  note: string;
  createdAt: number;
}
interface DayData {
  date: string;
  bookUid: string;
  device: string;
  seconds: number;
  chars: number;
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const secPushedKey = (uid: string) => `wts_sync_secpushed_${uid}`;
function readSecPushed(uid: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(secPushedKey(uid)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function writeSecPushed(uid: string, s: Set<string>) {
  try {
    localStorage.setItem(secPushedKey(uid), JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

interface Tally {
  pushed: number;
  pulled: number;
  removed: number;
}

/** 이전 버전에서 만든 책·하이라이트·기록에 고유 번호와 수정 시각을 붙입니다. */
async function ensureIds() {
  const bs = await books.all();
  const needB = bs.filter((b) => !b.uid || !b.updatedAt);
  if (needB.length) await books.bulkPutRaw(needB.map((b) => ({ ...b, uid: b.uid ?? newUid(), updatedAt: b.updatedAt ?? b.lastReadAt ?? b.createdAt })));
  const hs = await highlights.all();
  const needH = hs.filter((h) => !h.uid || !h.updatedAt);
  if (needH.length) await highlights.bulkPutRaw(needH.map((h) => ({ ...h, uid: h.uid ?? newUid(), updatedAt: h.updatedAt ?? h.createdAt })));
  const ds = await days.all();
  const needD = ds.filter((d) => !d.updatedAt);
  if (needD.length) await days.bulkPutRaw(needD.map((d) => ({ ...d, updatedAt: Date.now() })));
}

async function syncWords(uid: string, m: Mark, start: number, t: Tally) {
  const incoming = await remote.pullWords(uid, Math.max(0, m.lastPulled - 5 * 60 * 1000));
  const local = await words.all();
  const plan = planSync(local, incoming, readTombs('words'), m.lastPushed, prefixed('words'));
  if (plan.upsertLocal.length) {
    plan.upsertLocal.forEach((w) => echo.set('words:' + w.key, w.updatedAt));
    await words.bulkPut(plan.upsertLocal);
  }
  for (const key of plan.deleteLocal) {
    const hit = (await words.where('key', key))[0];
    if (hit?.id !== undefined) await words.del(hit.id);
  }
  if (plan.push.length) await remote.pushWords(uid, plan.push);
  dropTombs('words', [...plan.dropTombs, ...plan.push.filter((p) => p.deleted).map((p) => p.key)]);
  m.lastPulled = Math.max(m.lastPulled, plan.maxRemote);
  m.lastPushed = start;
  t.pushed += plan.push.length;
  t.pulled += plan.upsertLocal.length;
  t.removed += plan.deleteLocal.length;
  return local.length;
}

async function syncBooks(uid: string, m: Mark, start: number, t: Tally) {
  const incoming = await remote.pullItems<BookData>(uid, 'books', Math.max(0, m.lastPulled - 5 * 60 * 1000));
  const local = await books.all();
  const byUid = new Map(local.map((b) => [b.uid!, b]));
  const plan = planItems<BookData>(
    local.map((b) => ({ key: b.uid!, updatedAt: b.updatedAt ?? 0 })),
    incoming,
    readTombs('books'),
    m.lastPushed,
    prefixed('books')
  );
  const toPut: Book[] = plan.apply.map((r) => {
    const l = byUid.get(r.key);
    const b = { ...(r.data as BookData), uid: r.key, updatedAt: r.updatedAt } as Book;
    if (l?.id !== undefined) b.id = l.id;
    echo.set('books:' + r.key, r.updatedAt);
    return b;
  });
  for (const b of toPut) await books.putRaw(b);
  for (const key of plan.deleteLocal) {
    const l = byUid.get(key);
    if (l?.id !== undefined) await deleteBook(l.id, { fromSync: true });
  }
  const items: RemoteItem[] = [
    ...plan.pushKeys.map((k) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...rest } = byUid.get(k)!;
      void id;
      return { key: k, updatedAt: byUid.get(k)!.updatedAt ?? 0, data: clean(rest) } as RemoteItem;
    }),
    ...plan.pushTombs.map((x) => ({ key: x.key, updatedAt: x.deletedAt, deleted: true }) as RemoteItem),
  ];
  if (items.length) await remote.pushItems(uid, 'books', items);
  for (const x of plan.pushTombs) await remote.deleteSections(uid, x.key).catch(() => undefined);
  dropTombs('books', [...plan.dropTombs, ...plan.pushTombs.map((x) => x.key)]);
  m.lastPulled = Math.max(m.lastPulled, plan.maxRemote);
  m.lastPushed = start;
  t.pushed += items.length;
  t.pulled += toPut.length;
  t.removed += plan.deleteLocal.length;
}

/** 책 본문을 서버에 올리거나(내 기기에만 있는 책) 내려받습니다(다른 기기에서 온 책). */
async function syncSections(uid: string, t: Tally) {
  const pushedSet = readSecPushed(uid);
  const local = await books.all();
  for (const b of local) {
    if (!b.uid || b.id === undefined) continue;
    const secs = await sections.where('bookId', b.id);
    if (secs.length === 0 && b.sectionCount > 0) {
      const got = await remote.pullSections(uid, b.uid);
      if (got.length) {
        await sections.bulkPutRaw(got.map((s) => ({ ...s, bookId: b.id! }) as Section));
        pushedSet.add(b.uid);
        t.pulled += got.length;
      }
    } else if (secs.length >= b.sectionCount && !pushedSet.has(b.uid)) {
      await remote.pushSections(
        uid,
        b.uid,
        secs.map((s) => ({ index: s.index, title: s.title, paragraphs: s.paragraphs, startChars: s.startChars, chars: s.chars }))
      );
      pushedSet.add(b.uid);
      t.pushed += secs.length;
    }
  }
  writeSecPushed(uid, pushedSet);
}

async function syncHighlights(uid: string, m: Mark, start: number, t: Tally) {
  const incoming = await remote.pullItems<HlData>(uid, 'highlights', Math.max(0, m.lastPulled - 5 * 60 * 1000));
  const bs = await books.all();
  const idByUid = new Map(bs.map((b) => [b.uid!, b.id!]));
  const uidById = new Map(bs.map((b) => [b.id!, b.uid!]));
  const local = await highlights.all();
  const byUid = new Map(local.map((h) => [h.uid!, h]));
  const plan = planItems<HlData>(
    local.map((h) => ({ key: h.uid!, updatedAt: h.updatedAt ?? 0 })),
    incoming,
    readTombs('highlights'),
    m.lastPushed,
    prefixed('highlights')
  );
  const toPut: Highlight[] = [];
  for (const r of plan.apply) {
    const d = r.data as HlData;
    const bookId = idByUid.get(d.bookUid);
    if (bookId === undefined) continue; // 이 기기에 없는 책
    const l = byUid.get(r.key);
    const h: Highlight = { bookId, sectionIndex: d.sectionIndex, paraIndex: d.paraIndex, start: d.start, end: d.end, text: d.text, note: d.note, createdAt: d.createdAt, uid: r.key, updatedAt: r.updatedAt };
    if (l?.id !== undefined) h.id = l.id;
    echo.set('highlights:' + r.key, r.updatedAt);
    toPut.push(h);
  }
  if (toPut.length) await highlights.bulkPutRaw(toPut);
  for (const key of plan.deleteLocal) {
    const l = byUid.get(key);
    if (l?.id !== undefined) await highlights.delRaw(l.id);
  }
  const items: RemoteItem[] = [];
  for (const k of plan.pushKeys) {
    const h = byUid.get(k)!;
    const bookUid = uidById.get(h.bookId);
    if (!bookUid) continue;
    const data: HlData = { bookUid, sectionIndex: h.sectionIndex, paraIndex: h.paraIndex, start: h.start, end: h.end, text: h.text, note: h.note, createdAt: h.createdAt };
    items.push({ key: k, updatedAt: h.updatedAt ?? 0, data });
  }
  plan.pushTombs.forEach((x) => items.push({ key: x.key, updatedAt: x.deletedAt, deleted: true }));
  if (items.length) await remote.pushItems(uid, 'highlights', items);
  dropTombs('highlights', [...plan.dropTombs, ...plan.pushTombs.map((x) => x.key)]);
  m.lastPulled = Math.max(m.lastPulled, plan.maxRemote);
  m.lastPushed = start;
  t.pushed += items.length;
  t.pulled += toPut.length;
  t.removed += plan.deleteLocal.length;
}

/** 독서 시간 기록: 이 기기의 기록은 올리고, 다른 기기의 기록은 'r|'로 시작하는 별도 줄로 받아 합산합니다. */
async function syncDays(uid: string, m: Mark, start: number, t: Tally) {
  const me = deviceId();
  const incoming = await remote.pullItems<DayData>(uid, 'days', Math.max(0, m.lastPulled - 5 * 60 * 1000));
  const bs = await books.all();
  const idByUid = new Map(bs.map((b) => [b.uid!, b.id!]));
  const uidById = new Map(bs.map((b) => [b.id!, b.uid!]));
  const local = await days.all();
  const keyOf = (d: DayStat): string | null => {
    if (d.key.startsWith('r|')) return d.key.slice(2);
    const bu = uidById.get(d.bookId);
    return bu ? `${d.date}|${bu}|${me}` : null;
  };
  const byRemoteKey = new Map<string, DayStat>();
  for (const d of local) {
    const k = keyOf(d);
    if (k) byRemoteKey.set(k, d);
  }
  const mine = incoming.filter((r) => r.data && r.data.device !== me);
  const plan = planItems<DayData>(
    [...byRemoteKey].map(([key, d]) => ({ key, updatedAt: d.updatedAt ?? 0 })),
    mine,
    [],
    m.lastPushed,
    prefixed('days')
  );
  const toPut: DayStat[] = [];
  for (const r of plan.apply) {
    const d = r.data as DayData;
    const bookId = idByUid.get(d.bookUid);
    if (bookId === undefined) continue;
    echo.set('days:' + r.key, r.updatedAt);
    toPut.push({ key: 'r|' + r.key, date: d.date, bookId, seconds: d.seconds, chars: d.chars, updatedAt: r.updatedAt });
  }
  if (toPut.length) await days.bulkPutRaw(toPut);
  const items: RemoteItem[] = [];
  for (const k of plan.pushKeys) {
    const d = byRemoteKey.get(k)!;
    if (d.key.startsWith('r|')) continue; // 다른 기기의 기록은 되돌려 올리지 않음
    const bookUid = uidById.get(d.bookId)!;
    items.push({ key: k, updatedAt: d.updatedAt ?? 0, data: { date: d.date, bookUid, device: me, seconds: d.seconds, chars: d.chars } });
  }
  if (items.length) await remote.pushItems(uid, 'days', items);
  m.lastPulled = Math.max(m.lastPulled, plan.maxRemote, ...incoming.map((r) => r.updatedAt));
  m.lastPushed = start;
  t.pushed += items.length;
  t.pulled += toPut.length;
}

/** 방금 서버에서 받은 항목을 되돌려 올리지 않기 위한 조회(echo 맵의 종류별 보기). */
function prefixed(coll: CollName): Map<string, number> {
  const out = new Map<string, number>();
  const p = coll + ':';
  for (const [k, v] of echo) if (k.startsWith(p)) out.set(k.slice(p.length), v);
  return out;
}

async function run(): Promise<void> {
  const user = state.user;
  if (!user) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setState({ status: 'syncing', error: '' });
  try {
    const start = Date.now();
    const marks = loadMarks(user.uid);
    const t: Tally = { pushed: 0, pulled: 0, removed: 0 };
    await ensureIds();
    const wordCount = await syncWords(user.uid, marks.c.words, start, t);
    saveMarks(user.uid, marks);
    await syncBooks(user.uid, marks.c.books, start, t);
    saveMarks(user.uid, marks);
    await syncSections(user.uid, t);
    await syncHighlights(user.uid, marks.c.highlights, start, t);
    await syncDays(user.uid, marks.c.days, start, t);
    const done = Date.now();
    marks.lastSyncAt = done;
    saveMarks(user.uid, marks);
    setState({ status: 'idle', lastSyncAt: done, result: { local: wordCount, pushed: t.pushed, pulled: t.pulled, removed: t.removed } });
  } catch (e) {
    console.error('동기화 실패', e);
    setState({ status: 'error', error: syncErrorMessage(e) });
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(1500);
    }
  }
}

function schedule(ms: number) {
  if (!state.user) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), ms);
}

// ---- 시작/로그인/로그아웃 ----------------------------------------------------
let watching = false;
let unwatch: (() => void) | null = null;

async function startWatching() {
  if (watching) return;
  watching = true;
  try {
    setState({ status: 'connecting' });
    unwatch = await remote.watchAuth((u) => {
      if (u) {
        const marks = loadMarks(u.uid);
        setState({ user: u, status: 'idle', lastSyncAt: marks.lastSyncAt || null, error: '' });
        schedule(300);
      } else {
        setState({ user: null, status: 'off' });
      }
    });
    onTablesChange((t) => {
      if (t.some((x) => x === 'words' || x === 'books' || x === 'highlights' || x === 'days')) schedule(20000);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule(500);
    });
    window.addEventListener('online', () => schedule(500));
  } catch (e) {
    watching = false;
    setState({ status: 'error', error: syncErrorMessage(e) });
  }
}

/** 앱을 열 때 호출: 전에 로그인한 적이 있을 때만 Firebase를 불러옵니다. */
export function initSync() {
  try {
    if (localStorage.getItem(FLAG) === '1') void startWatching();
  } catch {
    /* ignore */
  }
}

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}

export async function signInWithGoogle() {
  remember(true);
  await startWatching();
  await remote.signInGoogle();
}

export async function signInWithEmail(email: string, password: string, create: boolean) {
  remember(true);
  await startWatching();
  await remote.signInEmail(email.trim(), password, create);
}

export async function signOutSync() {
  remember(false);
  await remote.signOutUser();
  setState({ user: null, status: 'off', error: '' });
  void unwatch;
}

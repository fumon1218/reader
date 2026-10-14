import { useSyncExternalStore } from 'react';
import { onTablesChange, words } from '../../db';
import { planSync } from './engine';
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

interface Marks {
  lastPulled: number;
  lastPushed: number;
  lastSyncAt: number;
}
const marksKey = (uid: string) => `wts_sync_marks_${uid}`;
function loadMarks(uid: string): Marks {
  try {
    return { lastPulled: 0, lastPushed: 0, lastSyncAt: 0, ...JSON.parse(localStorage.getItem(marksKey(uid)) ?? '{}') };
  } catch {
    return { lastPulled: 0, lastPushed: 0, lastSyncAt: 0 };
  }
}
function saveMarks(uid: string, m: Marks) {
  try {
    localStorage.setItem(marksKey(uid), JSON.stringify(m));
  } catch {
    /* ignore */
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
    // 시계가 조금 어긋난 기기를 위해 5분 겹쳐서 가져옵니다.
    const incoming = await remote.pullWords(user.uid, Math.max(0, marks.lastPulled - 5 * 60 * 1000));
    const local = await words.all();
    const plan = planSync(local, incoming, readTombs(), marks.lastPushed, echo);

    if (plan.upsertLocal.length) {
      plan.upsertLocal.forEach((w) => echo.set(w.key, w.updatedAt));
      await words.bulkPut(plan.upsertLocal);
    }
    for (const key of plan.deleteLocal) {
      const hit = (await words.where('key', key))[0];
      if (hit?.id !== undefined) await words.del(hit.id);
    }
    if (plan.push.length) await remote.pushWords(user.uid, plan.push);

    dropTombs([...plan.dropTombs, ...plan.push.filter((p) => p.deleted).map((p) => p.key)]);
    const done = Date.now();
    saveMarks(user.uid, { lastPulled: Math.max(marks.lastPulled, plan.maxRemote), lastPushed: start, lastSyncAt: done });
    setState({
      status: 'idle',
      lastSyncAt: done,
      result: { local: local.length, pushed: plan.push.length, pulled: plan.upsertLocal.length, removed: plan.deleteLocal.length },
    });
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
      if (t.includes('words')) schedule(4000);
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

import { firebaseConfig } from './config';
import type { RemoteItem, RemoteWord, SyncedWord } from './engine';

/**
 * Firebase 연결부. SDK는 로그인할 때만 내려받도록 동적으로 불러옵니다.
 * 서버 구조: users/{uid}/words/{단어key} = { key, updatedAt, deleted, d }
 */
type AuthMod = typeof import('firebase/auth');
type FsMod = typeof import('firebase/firestore/lite');
interface Ctx {
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore/lite').Firestore;
  A: AuthMod;
  F: FsMod;
}

let ctxP: Promise<Ctx> | null = null;

export function loadFirebase(): Promise<Ctx> {
  if (!ctxP) {
    ctxP = (async () => {
      const [{ initializeApp }, A, F] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')]);
      const app = initializeApp(firebaseConfig);
      const auth = A.getAuth(app);
      const db = F.getFirestore(app);
      // 리다이렉트 로그인에서 돌아온 경우 결과를 마무리합니다.
      A.getRedirectResult(auth).catch(() => undefined);
      return { auth, db, A, F };
    })().catch((e) => {
      ctxP = null;
      throw e;
    });
  }
  return ctxP;
}

export interface SyncUser {
  uid: string;
  email: string;
}

export async function watchAuth(cb: (u: SyncUser | null) => void): Promise<() => void> {
  const { auth, A } = await loadFirebase();
  return A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email ?? '' } : null));
}

export async function signInGoogle(): Promise<void> {
  const { auth, A } = await loadFirebase();
  const provider = new A.GoogleAuthProvider();
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await A.signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export async function signInEmail(email: string, password: string, create: boolean): Promise<void> {
  const { auth, A } = await loadFirebase();
  if (create) await A.createUserWithEmailAndPassword(auth, email, password);
  else await A.signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser(): Promise<void> {
  const { auth, A } = await loadFirebase();
  await A.signOut(auth);
}

const docId = (key: string) => encodeURIComponent(key);

export type Coll = 'words' | 'books' | 'highlights' | 'days';

/** since 이후에 서버에서 바뀐 항목을 가져옵니다. */
export async function pullItems<D>(uid: string, coll: Coll, since: number): Promise<RemoteItem<D>[]> {
  const { db, F } = await loadFirebase();
  const q = F.query(F.collection(db, 'users', uid, coll), F.where('updatedAt', '>', since));
  const snap = await F.getDocs(q);
  return snap.docs.map((d) => {
    const v = d.data() as { key: string; updatedAt: number; deleted?: boolean; d?: D };
    return { key: v.key, updatedAt: v.updatedAt, deleted: !!v.deleted, data: v.d };
  });
}

/** 변경을 서버에 올립니다(여러 건씩 묶어서). */
export async function pushItems(uid: string, coll: Coll, items: RemoteItem[]): Promise<void> {
  const { db, F } = await loadFirebase();
  for (let i = 0; i < items.length; i += 300) {
    const batch = F.writeBatch(db);
    for (const it of items.slice(i, i + 300)) {
      const ref = F.doc(db, 'users', uid, coll, docId(it.key));
      batch.set(ref, it.deleted ? { key: it.key, updatedAt: it.updatedAt, deleted: true } : { key: it.key, updatedAt: it.updatedAt, deleted: false, d: JSON.parse(JSON.stringify(it.data)) });
    }
    await batch.commit();
  }
}

export interface RemoteSection {
  index: number;
  title: string;
  paragraphs: string[];
  startChars: number;
  chars: number;
}

/** 책 본문(구간)은 책마다 하위 컬렉션에 한 구간씩 저장합니다. */
export async function pushSections(uid: string, bookUid: string, secs: RemoteSection[]): Promise<void> {
  const { db, F } = await loadFirebase();
  for (let i = 0; i < secs.length; i += 60) {
    const batch = F.writeBatch(db);
    for (const sec of secs.slice(i, i + 60)) {
      batch.set(F.doc(db, 'users', uid, 'books', docId(bookUid), 'sections', String(sec.index)), JSON.parse(JSON.stringify(sec)));
    }
    await batch.commit();
  }
}

export async function pullSections(uid: string, bookUid: string): Promise<RemoteSection[]> {
  const { db, F } = await loadFirebase();
  const snap = await F.getDocs(F.collection(db, 'users', uid, 'books', docId(bookUid), 'sections'));
  return snap.docs.map((d) => d.data() as RemoteSection).sort((a, b) => a.index - b.index);
}

export async function deleteSections(uid: string, bookUid: string): Promise<void> {
  const { db, F } = await loadFirebase();
  const snap = await F.getDocs(F.collection(db, 'users', uid, 'books', docId(bookUid), 'sections'));
  for (let i = 0; i < snap.docs.length; i += 300) {
    const batch = F.writeBatch(db);
    snap.docs.slice(i, i + 300).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// 단어용 (이전 이름 유지)
export const pullWords = (uid: string, since: number) => pullItems<SyncedWord>(uid, 'words', since) as Promise<RemoteWord[]>;
export const pushWords = (uid: string, items: RemoteWord[]) => pushItems(uid, 'words', items);

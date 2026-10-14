import { firebaseConfig } from './config';
import type { RemoteWord, SyncedWord } from './engine';

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

/** since 이후에 서버에서 바뀐 단어를 가져옵니다. */
export async function pullWords(uid: string, since: number): Promise<RemoteWord[]> {
  const { db, F } = await loadFirebase();
  const q = F.query(F.collection(db, 'users', uid, 'words'), F.where('updatedAt', '>', since));
  const snap = await F.getDocs(q);
  return snap.docs.map((d) => {
    const v = d.data() as { key: string; updatedAt: number; deleted?: boolean; d?: SyncedWord };
    return { key: v.key, updatedAt: v.updatedAt, deleted: !!v.deleted, data: v.d };
  });
}

/** 변경을 서버에 올립니다(500개씩 묶어서). */
export async function pushWords(uid: string, items: RemoteWord[]): Promise<void> {
  const { db, F } = await loadFirebase();
  for (let i = 0; i < items.length; i += 400) {
    const batch = F.writeBatch(db);
    for (const it of items.slice(i, i + 400)) {
      const ref = F.doc(db, 'users', uid, 'words', docId(it.key));
      batch.set(ref, it.deleted ? { key: it.key, updatedAt: it.updatedAt, deleted: true } : { key: it.key, updatedAt: it.updatedAt, deleted: false, d: it.data });
    }
    await batch.commit();
  }
}

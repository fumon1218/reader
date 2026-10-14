import type { Word } from '../../types';

/** 기기마다 다른 값(책 번호, 읽던 위치)은 동기화하지 않습니다. */
export type SyncedWord = Omit<Word, 'id' | 'bookId' | 'sectionIndex' | 'paraIndex'>;

export interface RemoteWord {
  key: string;
  updatedAt: number;
  deleted?: boolean;
  data?: SyncedWord;
}

export interface Tomb {
  key: string;
  deletedAt: number;
}

export function toSynced(w: Word): SyncedWord {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, bookId, sectionIndex, paraIndex, ...rest } = w;
  void id;
  void bookId;
  void sectionIndex;
  void paraIndex;
  // Firestore는 undefined 값을 받지 않으므로 제거합니다.
  return JSON.parse(JSON.stringify(rest)) as SyncedWord;
}

export interface Plan {
  /** 로컬에 새로 넣거나 덮어쓸 단어 */
  upsertLocal: Word[];
  /** 로컬에서 지울 단어의 key */
  deleteLocal: string[];
  /** 서버로 올릴 변경 */
  push: RemoteWord[];
  /** 정리해도 되는(서버에 반영됐거나 더 새로운 변경에 밀린) 삭제 기록 */
  dropTombs: string[];
  /** 서버에서 받은 변경 중 가장 늦은 시각 */
  maxRemote: number;
}

/**
 * 로컬과 서버의 변경을 비교해 할 일을 계산합니다. (같은 단어는 더 늦게 고친 쪽이 이김)
 * - remote: 마지막 동기화 이후 서버에서 바뀐 항목
 * - lastPushed: 이 시각 이후에 로컬에서 바뀐 항목만 올립니다.
 * - echo: 방금 서버에서 받아 적용한 항목(key → updatedAt)은 다시 올리지 않습니다.
 */
export function planSync(local: Word[], remote: RemoteWord[], tombs: Tomb[], lastPushed: number, echo: Map<string, number> = new Map()): Plan {
  const localByKey = new Map(local.map((w) => [w.key, w]));
  const tombByKey = new Map<string, number>();
  tombs.forEach((t) => tombByKey.set(t.key, Math.max(tombByKey.get(t.key) ?? 0, t.deletedAt)));

  const upsertLocal: Word[] = [];
  const deleteLocal: string[] = [];
  const dropTombs = new Set<string>();
  const remoteByKey = new Map<string, RemoteWord>();
  let maxRemote = 0;

  for (const r of remote) {
    remoteByKey.set(r.key, r);
    maxRemote = Math.max(maxRemote, r.updatedAt);
    const l = localByKey.get(r.key);
    const tomb = tombByKey.get(r.key);

    if (r.deleted) {
      if (l && l.updatedAt <= r.updatedAt) deleteLocal.push(r.key);
      if (tomb !== undefined && tomb <= r.updatedAt) dropTombs.add(r.key);
      continue;
    }
    if (!r.data) continue;
    if (tomb !== undefined && tomb >= r.updatedAt) continue; // 로컬에서 더 늦게 지운 단어
    if (tomb !== undefined) dropTombs.add(r.key); // 서버가 더 새로움: 삭제 기록 폐기
    if (!l) {
      upsertLocal.push({ ...r.data } as Word);
    } else if (r.updatedAt > l.updatedAt) {
      upsertLocal.push({ ...l, ...r.data, id: l.id, bookId: l.bookId, sectionIndex: l.sectionIndex, paraIndex: l.paraIndex } as Word);
    }
  }

  const replaced = new Set(upsertLocal.map((w) => w.key));
  const push: RemoteWord[] = [];
  for (const l of local) {
    if (l.updatedAt <= lastPushed || replaced.has(l.key)) continue;
    if (echo.get(l.key) === l.updatedAt) continue;
    const r = remoteByKey.get(l.key);
    if (r && r.updatedAt >= l.updatedAt) continue;
    const tomb = tombByKey.get(l.key);
    if (tomb !== undefined && tomb > l.updatedAt) continue; // 삭제가 더 늦음
    push.push({ key: l.key, updatedAt: l.updatedAt, data: toSynced(l) });
  }
  for (const [key, deletedAt] of tombByKey) {
    if (dropTombs.has(key)) continue;
    const r = remoteByKey.get(key);
    if (r && r.updatedAt >= deletedAt) continue;
    const l = localByKey.get(key);
    if (l && l.updatedAt >= deletedAt) {
      dropTombs.add(key); // 삭제 뒤에 다시 저장한 단어
      continue;
    }
    if (deletedAt > lastPushed) push.push({ key, updatedAt: deletedAt, deleted: true });
  }

  return { upsertLocal, deleteLocal, push, dropTombs: [...dropTombs], maxRemote };
}

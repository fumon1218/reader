import type { Tomb } from './engine';

/** 삭제 기록(다른 기기에서도 지우기 위해 필요). 종류별로 따로 보관합니다. */
export type TombColl = 'words' | 'books' | 'highlights';
const keyOf = (c: TombColl) => (c === 'words' ? 'wts_tombs_v1' : `wts_tombs_${c}_v1`);

export function readTombs(c: TombColl = 'words'): Tomb[] {
  try {
    const o = JSON.parse(localStorage.getItem(keyOf(c)) ?? '{}') as Record<string, number>;
    return Object.entries(o).map(([key, deletedAt]) => ({ key, deletedAt }));
  } catch {
    return [];
  }
}

function write(c: TombColl, list: Tomb[]) {
  try {
    localStorage.setItem(keyOf(c), JSON.stringify(Object.fromEntries(list.map((t) => [t.key, t.deletedAt]))));
  } catch {
    /* 저장 공간 문제는 무시 */
  }
}

export function recordTomb(c: TombColl, key: string, at = Date.now()) {
  const list = readTombs(c).filter((t) => t.key !== key);
  list.push({ key, deletedAt: at });
  write(c, list);
}

export function dropTombs(c: TombColl, keys: string[]) {
  if (!keys.length) return;
  const drop = new Set(keys);
  write(c, readTombs(c).filter((t) => !drop.has(t.key)));
}

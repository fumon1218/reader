import type { Tomb } from './engine';

const KEY = 'wts_tombs_v1';

export function readTombs(): Tomb[] {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
    return Object.entries(o).map(([key, deletedAt]) => ({ key, deletedAt }));
  } catch {
    return [];
  }
}

function write(list: Tomb[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(list.map((t) => [t.key, t.deletedAt]))));
  } catch {
    /* 저장 공간 문제는 무시 */
  }
}

/** 단어를 지웠다는 기록(다른 기기에서도 지우기 위해 필요). */
export function recordTomb(key: string, at = Date.now()) {
  const list = readTombs().filter((t) => t.key !== key);
  list.push({ key, deletedAt: at });
  write(list);
}

export function dropTombs(keys: string[]) {
  if (!keys.length) return;
  const drop = new Set(keys);
  write(readTombs().filter((t) => !drop.has(t.key)));
}

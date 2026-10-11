import { days } from '../db';
import type { DayStat } from '../types';
import { addDays, dateKey } from './util';

let chain: Promise<unknown> = Promise.resolve();

/** 오늘의 독서 기록에 시간(초)과 글자 수를 더합니다. 동시에 여러 번 불려도 순서대로 처리됩니다. */
export function addReading(bookId: number, seconds: number, chars: number): Promise<void> {
  if (seconds <= 0 && chars <= 0) return Promise.resolve();
  const task = chain.then(async () => {
    const date = dateKey();
    const key = `${date}|${bookId}`;
    const cur = await days.get(key);
    await days.put({ key, date, bookId, seconds: (cur?.seconds ?? 0) + seconds, chars: (cur?.chars ?? 0) + chars });
  });
  chain = task.catch(() => undefined);
  return task.catch(() => undefined);
}

export function totalsByDate(rows: DayStat[]): Map<string, { seconds: number; chars: number }> {
  const m = new Map<string, { seconds: number; chars: number }>();
  for (const r of rows) {
    const cur = m.get(r.date) ?? { seconds: 0, chars: 0 };
    cur.seconds += r.seconds;
    cur.chars += r.chars;
    m.set(r.date, cur);
  }
  return m;
}

/** 오늘(또는 어제)부터 거꾸로 하루 1분 이상 읽은 날이 이어진 일수 */
export function computeStreak(byDate: Map<string, { seconds: number }>, today = new Date(), minSeconds = 60): number {
  const ok = (d: Date) => (byDate.get(dateKey(d))?.seconds ?? 0) >= minSeconds;
  let cursor = today;
  if (!ok(cursor)) cursor = addDays(today, -1);
  let n = 0;
  while (ok(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

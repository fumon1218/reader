export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  interval: number; // 일
  ease: number;
  reps: number;
  lapses: number;
}

export interface Scheduled extends CardState {
  due: number;
}

export const DAY = 86_400_000;
export const AGAIN_DELAY = 10 * 60_000; // 틀리면 10분 뒤 다시
const MAX_INTERVAL = 365;

export function newCard(now = Date.now()): Scheduled {
  return { interval: 0, ease: 2.5, reps: 0, lapses: 0, due: now };
}

/** SM-2를 단순화한 간격 계산 */
export function schedule(card: CardState, grade: Grade, now = Date.now()): Scheduled {
  let { interval, ease, reps, lapses } = card;
  if (grade === 'again') {
    return { interval: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, lapses: lapses + 1, due: now + AGAIN_DELAY };
  }
  let next: number;
  if (grade === 'hard') {
    next = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else if (grade === 'good') {
    next = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
  } else {
    next = reps === 0 ? 3 : reps === 1 ? 6 : Math.max(interval + 2, Math.round(interval * ease * 1.3));
    ease += 0.15;
  }
  next = Math.min(MAX_INTERVAL, next);
  return { interval: next, ease, reps: reps + 1, lapses, due: now + next * DAY };
}

export function intervalLabel(card: CardState, grade: Grade): string {
  if (grade === 'again') return '10분';
  const d = schedule(card, grade, 0).interval;
  if (d < 30) return `${d}일`;
  if (d < 365) return `${Math.round(d / 30)}개월`;
  return '1년';
}

import { isCjk } from './tokenize';

export interface Cloze {
  before: string;
  answer: string;
  after: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 문장에서 대상 단어(여러 후보 중 가장 긴 것부터)를 찾아 빈칸 문제로 나눕니다. */
export function makeCloze(context: string, targets: string[]): Cloze | null {
  const cands = [...new Set(targets.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const t of cands) {
    let idx = -1;
    let len = t.length;
    if (isCjk(t)) {
      idx = context.indexOf(t);
    } else {
      const re = new RegExp(`(?<![\\p{L}\\p{M}])${esc(t)}(?![\\p{L}\\p{M}])`, 'iu');
      const m = re.exec(context);
      if (m) {
        idx = m.index;
        len = m[0].length;
      }
    }
    if (idx >= 0) {
      return { before: context.slice(0, idx), answer: context.slice(idx, idx + len), after: context.slice(idx + len) };
    }
  }
  return null;
}

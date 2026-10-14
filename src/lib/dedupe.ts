import type { Word } from '../types';

/** 악센트·대소문자·공백을 무시한 비교용 글자 */
export const looseKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s'’\-]/g, '');

/** 같은 단어일 가능성이 높은 묶음을 찾습니다. (같은 언어 안에서만) */
export function findDuplicateGroups(all: Word[]): Word[][] {
  const byLang = new Map<string, Word[]>();
  all.forEach((w) => byLang.set(w.language, [...(byLang.get(w.language) ?? []), w]));
  const groups: Word[][] = [];
  for (const list of byLang.values()) {
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    list.forEach((w) => parent.set(w.key, w.key));
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const byLoose = new Map<string, Word>();
    list.forEach((w) => {
      const k = looseKey(w.lemma);
      const hit = byLoose.get(k);
      if (hit) union(hit.key, w.key);
      else byLoose.set(k, w);
    });
    // 한 단어의 '변화형'에 다른 단어의 원형이 들어 있으면 같은 단어로 봅니다 (예: ran ↔ run)
    list.forEach((w) =>
      w.forms.forEach((f) => {
        const other = byLoose.get(looseKey(f));
        if (other && other.key !== w.key) union(other.key, w.key);
      })
    );
    const m = new Map<string, Word[]>();
    list.forEach((w) => {
      const r = find(w.key);
      m.set(r, [...(m.get(r) ?? []), w]);
    });
    m.forEach((g) => g.length > 1 && groups.push(g));
  }
  return groups;
}

/** 묶음에서 남길 단어(많이 복습한 쪽)와 합쳐진 결과를 만듭니다. */
export function mergeGroup(group: Word[]): { keep: Word; drop: Word[] } {
  const sorted = [...group].sort((a, b) => b.reps - a.reps || a.createdAt - b.createdAt);
  const keep = sorted[0];
  const drop = sorted.slice(1);
  const forms = new Set(keep.forms);
  let { meaning, reading, context, note, pos, koreanReading } = keep;
  drop.forEach((d) => {
    d.forms.forEach((f) => forms.add(f));
    forms.add(d.surface);
    forms.add(d.lemma.toLowerCase());
    if (!meaning.trim()) meaning = d.meaning;
    else if (d.meaning.trim() && !meaning.includes(d.meaning.trim())) meaning = `${meaning}; ${d.meaning.trim()}`;
    if (!reading) reading = d.reading;
    if (!context) context = d.context;
    if (!pos) pos = d.pos;
    if (!koreanReading) koreanReading = d.koreanReading;
    if (d.note && !note.includes(d.note)) note = note ? `${note} / ${d.note}` : d.note;
  });
  return {
    keep: {
      ...keep,
      forms: [...forms].filter(Boolean),
      meaning,
      reading,
      context,
      note,
      pos,
      koreanReading,
      lapses: Math.max(keep.lapses, ...drop.map((d) => d.lapses)),
      updatedAt: Date.now(),
    },
    drop,
  };
}

/** 자주 틀리는 단어인지 */
export const isHard = (w: Word) => w.status === 'learning' && (w.lapses >= 2 || (w.reps >= 3 && w.ease < 2.0));

import { words } from '../db';
import type { Book, LangCode, LookupResult, Word, WordStatus } from '../types';
import { normalizeForm } from './tokenize';
import { newCard } from './srs';
import type { ImportedWord } from './csv';

export const wordKey = (lang: LangCode, lemma: string) => `${lang}:${normalizeForm(lemma)}`;

export interface SaveArgs {
  language: LangCode;
  book?: Pick<Book, 'id'>;
  sectionIndex?: number;
  paraIndex?: number;
  selected: string;
  sentence: string;
  result: LookupResult | null;
  status: WordStatus;
}

/** 단어를 단어장에 저장(이미 있으면 형태·상태를 합침). */
export async function saveWord(a: SaveArgs): Promise<Word> {
  const lemma = a.result?.lemma?.trim() || a.selected.trim();
  const key = wordKey(a.language, lemma);
  const forms = new Set([normalizeForm(a.selected), normalizeForm(lemma)]);
  const now = Date.now();
  const existing = (await words.where('key', key))[0];

  if (existing) {
    existing.forms.forEach((f) => forms.add(f));
    const merged: Word = {
      ...existing,
      forms: [...forms],
      status: a.status,
      updatedAt: now,
      reading: existing.reading || a.result?.reading || '',
      koreanReading: existing.koreanReading || a.result?.koreanReading || '',
      pos: existing.pos || a.result?.pos || '',
      meaning: existing.meaning || a.result?.meaning || '',
      note: existing.note || a.result?.note || '',
      context: existing.context || a.sentence,
    };
    if (existing.status === 'known' && a.status === 'learning') merged.due = now;
    await words.put(merged);
    return merged;
  }

  const w: Word = {
    key,
    language: a.language,
    bookId: a.book?.id,
    lemma,
    surface: a.selected.trim(),
    forms: [...forms],
    reading: a.result?.reading ?? '',
    koreanReading: a.result?.koreanReading ?? '',
    pos: a.result?.pos ?? '',
    meaning: a.result?.meaning ?? '',
    note: a.result?.note ?? '',
    context: a.sentence,
    sectionIndex: a.sectionIndex,
    paraIndex: a.paraIndex,
    status: a.status,
    createdAt: now,
    updatedAt: now,
    ...newCard(now),
  };
  const id = (await words.put(w)) as number;
  return { ...w, id };
}

/** CSV/직접 입력 단어 추가. 이미 있는 단어는 건너뜁니다. 추가된 개수를 돌려줍니다. */
export async function addImportedWords(lang: LangCode, list: ImportedWord[]): Promise<{ added: number; skipped: number }> {
  const existing = new Set((await words.where('language', lang)).map((w) => w.key));
  const now = Date.now();
  const rows: Word[] = [];
  let skipped = 0;
  for (const it of list) {
    const lemma = it.word.trim();
    const key = wordKey(lang, lemma);
    if (!lemma || existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    rows.push({
      key,
      language: lang,
      lemma,
      surface: lemma,
      forms: [normalizeForm(lemma)],
      reading: it.reading,
      koreanReading: '',
      pos: '',
      meaning: it.meaning,
      note: it.note,
      context: it.context,
      status: 'learning',
      createdAt: now,
      updatedAt: now,
      ...newCard(now),
    });
  }
  await words.bulkPut(rows);
  return { added: rows.length, skipped };
}

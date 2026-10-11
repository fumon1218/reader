import { dumpAll, restoreAll, type Dump } from '../db';
import { saveBlob, dateKey } from './util';

const FORMAT = 'world-through-stories-backup';

export async function exportBackup(): Promise<{ books: number; words: number }> {
  const data = await dumpAll();
  const payload = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  await saveBlob(`reader-backup-${dateKey()}.json`, blob, 'application/json');
  return { books: data.books.length, words: data.words.length };
}

export function parseBackup(text: string): Dump {
  let obj: Partial<Dump> & { format?: string };
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('백업 파일을 읽을 수 없어요. (JSON 형식이 아니에요)');
  }
  if (obj.format !== FORMAT || !Array.isArray(obj.books) || !Array.isArray(obj.words)) {
    throw new Error('이 앱에서 만든 백업 파일이 아니에요.');
  }
  return {
    books: obj.books,
    sections: obj.sections ?? [],
    words: obj.words,
    highlights: obj.highlights ?? [],
    days: obj.days ?? [],
  };
}

export async function importBackup(file: File): Promise<{ books: number; words: number }> {
  const data = parseBackup(await file.text());
  await restoreAll(data);
  return { books: data.books.length, words: data.words.length };
}

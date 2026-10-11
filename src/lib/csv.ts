/** 따옴표, 줄바꿈, BOM, 쉼표/탭/세미콜론 구분자를 처리하는 CSV 파서 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch as keyof typeof counts]++;
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',') as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

export function toCsv(rows: string[][], delim = ','): string {
  const q = (s: string) => (/[",\n\r\t;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join(delim)).join('\n');
}

export interface ImportedWord {
  word: string;
  reading: string;
  meaning: string;
  context: string;
  note: string;
}

const H = {
  word: ['word', 'lemma', 'term', 'front', '단어', '표제어', '原文', '単語', 'palabra'],
  meaning: ['meaning', 'translation', 'back', 'definition', '뜻', '의미', '번역', '意味', 'significado'],
  reading: ['reading', 'pronunciation', '발음', '읽기', '読み', 'ruby'],
  context: ['context', 'example', 'sentence', '예문', '문장', '例文', 'ejemplo'],
  note: ['note', 'notes', 'memo', '메모', '노트', '비고'],
};

/** CSV 행을 단어로 변환. 첫 줄이 머리글이면 열 이름으로, 아니면 위치로 해석합니다. */
export function rowsToWords(rows: string[][]): ImportedWord[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    word: find(H.word),
    meaning: find(H.meaning),
    reading: find(H.reading),
    context: find(H.context),
    note: find(H.note),
  };
  const hasHeader = idx.word >= 0 && idx.meaning >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ImportedWord[] = [];
  for (const r of body) {
    let w: ImportedWord;
    if (hasHeader) {
      const g = (i: number) => (i >= 0 ? r[i] ?? '' : '');
      w = { word: g(idx.word), meaning: g(idx.meaning), reading: g(idx.reading), context: g(idx.context), note: g(idx.note) };
    } else if (r.length >= 3) {
      w = { word: r[0], reading: r[1], meaning: r[2], context: r[3] ?? '', note: r[4] ?? '' };
    } else {
      w = { word: r[0] ?? '', reading: '', meaning: r[1] ?? '', context: '', note: '' };
    }
    if (w.word.trim()) out.push(w);
  }
  return out;
}

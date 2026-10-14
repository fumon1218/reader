import type { Book, Highlight, Word } from '../types';
import { STATUS_LABEL, langInfo } from '../types';
import { formatDate } from './util';

/** 책 한 권의 독서 노트를 마크다운 글로 만듭니다. */
export function buildBookNotes(book: Book, hls: Highlight[], ws: Word[]): string {
  const out: string[] = [];
  out.push(`# ${book.title.replace(/\s*\(맛보기\)/, '')}`);
  const meta = [book.author, langInfo(book.language).label, STATUS_LABEL[book.status], `${Math.round(book.progress * 100)}%`];
  if (book.rating) meta.push('★'.repeat(book.rating));
  out.push(meta.filter(Boolean).join(' · '));
  if (book.startedAt) out.push(`읽기 시작: ${formatDate(book.startedAt)}${book.finishedAt ? ` · 완독: ${formatDate(book.finishedAt)}` : ''}`);
  if (book.memo?.trim()) out.push('', '## 독서 메모', book.memo.trim());

  const marks = hls.filter((h) => h.kind !== 'bookmark').sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex);
  if (marks.length) {
    out.push('', `## 하이라이트 (${marks.length})`);
    marks.forEach((h) => {
      out.push('', `> ${h.text.replace(/\n+/g, ' ')}`);
      if (h.note.trim()) out.push('', `메모: ${h.note.trim()}`);
    });
  }
  if (ws.length) {
    out.push('', `## 저장한 단어 (${ws.length})`);
    [...ws]
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((w) => {
        const head = `- **${w.lemma}**${w.reading && w.reading !== w.lemma ? ` (${w.reading})` : ''} — ${w.meaning || '뜻 없음'}`;
        out.push(head);
        if (w.context) out.push(`  - ${w.context.replace(/\n+/g, ' ')}`);
      });
  }
  return out.join('\n') + '\n';
}

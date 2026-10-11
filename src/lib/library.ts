import { addBookWithSections } from '../db';
import type { Book, LangCode } from '../types';
import { buildSections, totalChars, type Chapter } from './importers';
import { resizeCover } from './cover';

export interface NewBookInput {
  title: string;
  author: string;
  language: LangCode;
  chapters: Chapter[];
  coverBlob?: Blob;
  sample?: boolean;
  status?: Book['status'];
}

export async function createBook(input: NewBookInput): Promise<number> {
  const secs = buildSections(input.chapters, input.language);
  if (!secs.length) throw new Error('읽을 수 있는 글이 없어요.');
  const cover = input.coverBlob ? await resizeCover(input.coverBlob) : undefined;
  const now = Date.now();
  const book: Book = {
    title: input.title.trim() || '제목 없음',
    author: input.author.trim(),
    language: input.language,
    status: input.status ?? 'wishlist',
    createdAt: now,
    sectionIndex: 0,
    paraIndex: 0,
    progress: 0,
    totalChars: totalChars(secs),
    sectionCount: secs.length,
    cover,
    sample: input.sample,
  };
  return addBookWithSections(book, secs);
}

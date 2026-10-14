import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups, isHard, mergeGroup } from '../src/lib/dedupe.ts';
import { buildBookNotes } from '../src/lib/notes.ts';
import type { Book, Word } from '../src/types.ts';

const w = (lemma: string, extra: Partial<Word> = {}): Word => ({
  key: `en:${lemma}`, language: 'en', lemma, surface: lemma, forms: [], reading: '', koreanReading: '', pos: '', meaning: 'm',
  note: '', context: '', status: 'learning', createdAt: 1, updatedAt: 1, due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, ...extra,
});

test('악센트만 다른 단어를 같은 묶음으로', () => {
  const g = findDuplicateGroups([w('café'), w('cafe'), w('tea')]);
  assert.equal(g.length, 1);
  assert.equal(g[0].length, 2);
});

test('변화형에 다른 단어의 원형이 있으면 묶음', () => {
  const g = findDuplicateGroups([w('run', { forms: ['ran'] }), w('ran')]);
  assert.equal(g.length, 1);
});

test('다른 언어는 묶지 않음', () => {
  const g = findDuplicateGroups([w('pan'), { ...w('pan'), key: 'es:pan', language: 'es' }]);
  assert.equal(g.length, 0);
});

test('합치기: 복습 많은 쪽을 남기고 뜻·변화형을 모음', () => {
  const { keep, drop } = mergeGroup([w('cafe', { reps: 1, meaning: '카페' }), w('café', { reps: 3, meaning: '커피집', forms: ['cafés'] })]);
  assert.equal(keep.lemma, 'café');
  assert.equal(drop.length, 1);
  assert.ok(keep.meaning.includes('카페') && keep.meaning.includes('커피집'));
  assert.ok(keep.forms.includes('cafés') && keep.forms.includes('cafe'));
});

test('어려운 단어 판정', () => {
  assert.equal(isHard(w('a', { lapses: 2 })), true);
  assert.equal(isHard(w('a', { reps: 4, ease: 1.8 })), true);
  assert.equal(isHard(w('a')), false);
  assert.equal(isHard(w('a', { lapses: 5, status: 'known' })), false);
});

test('독서 노트 마크다운', () => {
  const book = { title: 'T', author: 'A', language: 'en', status: 'reading', progress: 0.5, memo: '좋음', createdAt: 1 } as Book;
  const md = buildBookNotes(book, [{ bookId: 1, sectionIndex: 0, paraIndex: 0, start: 0, end: 1, text: 'Hello.', note: '인사', createdAt: 1 }], [w('garden', { meaning: '정원', context: 'A garden.' })]);
  assert.ok(md.startsWith('# T'));
  assert.ok(md.includes('> Hello.') && md.includes('메모: 인사') && md.includes('**garden**'));
});

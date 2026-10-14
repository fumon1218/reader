import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, toSynced, type RemoteWord } from '../src/lib/sync/engine.ts';
import type { Word } from '../src/types.ts';

const mk = (key: string, updatedAt: number, extra: Partial<Word> = {}): Word => ({
  id: 1,
  key,
  language: 'en',
  bookId: 5,
  lemma: key.split(':')[1],
  surface: key.split(':')[1],
  forms: [],
  reading: '',
  koreanReading: '',
  pos: '',
  meaning: 'm',
  note: '',
  context: '',
  status: 'learning',
  createdAt: 1,
  updatedAt,
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  ...extra,
});
const rem = (w: Word): RemoteWord => ({ key: w.key, updatedAt: w.updatedAt, data: toSynced(w) });

test('toSynced: 기기별 값 제거, undefined 제거', () => {
  const s = toSynced(mk('en:a', 10, { sectionIndex: 2, paraIndex: 3, firstReviewedAt: undefined }));
  assert.ok(!('id' in s) && !('bookId' in s) && !('sectionIndex' in s) && !('paraIndex' in s) && !('firstReviewedAt' in s));
});

test('처음 동기화: 로컬은 모두 올리고 서버 단어는 받는다', () => {
  const p = planSync([mk('en:a', 10)], [rem(mk('en:b', 20))], [], 0);
  assert.deepEqual(p.push.map((x) => x.key), ['en:a']);
  assert.deepEqual(p.upsertLocal.map((x) => x.key), ['en:b']);
  assert.equal(p.maxRemote, 20);
});

test('더 늦게 고친 쪽이 이긴다 (서버가 새로움, 기기별 값 유지)', () => {
  const l = mk('en:a', 10, { bookId: 7, sectionIndex: 1 });
  const p = planSync([l], [rem(mk('en:a', 20, { meaning: 'new' }))], [], 100);
  assert.equal(p.upsertLocal[0].meaning, 'new');
  assert.equal(p.upsertLocal[0].id, 1);
  assert.equal(p.upsertLocal[0].bookId, 7);
  assert.equal(p.push.length, 0);
});

test('로컬이 더 새로우면 올린다', () => {
  const p = planSync([mk('en:a', 30, { meaning: 'mine' })], [rem(mk('en:a', 20))], [], 5);
  assert.equal(p.upsertLocal.length, 0);
  assert.equal(p.push[0].data?.meaning, 'mine');
});

test('이미 올린 변경(lastPushed 이전)은 다시 올리지 않는다', () => {
  const p = planSync([mk('en:a', 10)], [], [], 50);
  assert.equal(p.push.length, 0);
});

test('서버에서 받은 단어는 되돌려 올리지 않는다(echo)', () => {
  const w = mk('en:a', 40);
  const p = planSync([w], [], [], 10, new Map([['en:a', 40]]));
  assert.equal(p.push.length, 0);
});

test('서버의 삭제가 더 늦으면 로컬에서도 지운다', () => {
  const p = planSync([mk('en:a', 10)], [{ key: 'en:a', updatedAt: 20, deleted: true }], [], 100);
  assert.deepEqual(p.deleteLocal, ['en:a']);
});

test('삭제 뒤에 로컬에서 다시 고친 단어는 살린다', () => {
  const p = planSync([mk('en:a', 30)], [{ key: 'en:a', updatedAt: 20, deleted: true }], [], 5);
  assert.deepEqual(p.deleteLocal, []);
  assert.equal(p.push.length, 1);
});

test('로컬 삭제 기록은 서버에 올리고, 서버가 더 새로우면 폐기', () => {
  const up = planSync([], [], [{ key: 'en:a', deletedAt: 50 }], 10);
  assert.deepEqual(up.push, [{ key: 'en:a', updatedAt: 50, deleted: true }]);
  const lose = planSync([], [rem(mk('en:a', 60))], [{ key: 'en:a', deletedAt: 50 }], 10);
  assert.deepEqual(lose.dropTombs, ['en:a']);
  assert.equal(lose.upsertLocal.length, 1);
  const keep = planSync([], [rem(mk('en:a', 40))], [{ key: 'en:a', deletedAt: 50 }], 10);
  assert.equal(keep.upsertLocal.length, 0);
  assert.equal(keep.push[0].deleted, true);
});

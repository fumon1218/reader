import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, sentenceSpans, spanAt, extendRange, normalizeForm } from '../src/lib/tokenize.ts';
import { makeCloze } from '../src/lib/cloze.ts';
import { schedule, newCard, intervalLabel } from '../src/lib/srs.ts';
import { parseCsv, rowsToWords, toCsv } from '../src/lib/csv.ts';
import { parseTxt, buildSections, guessLanguage, isHeading } from '../src/lib/importers.ts';
import { computeStreak } from '../src/lib/stats.ts';
import { dateKey, addDays } from '../src/lib/util.ts';

test('tokenize: 영어 단어/구두점 분리, 축약형 유지', () => {
  const t = tokenize("Don't go, Alice!", 'en');
  const words = t.filter((x) => x.word).map((x) => x.text);
  assert.deepEqual(words, ["Don't", 'go', 'Alice']);
  assert.equal(t.map((x) => x.text).join(''), "Don't go, Alice!");
});

test('tokenize: 일본어는 단어 단위로 쪼개진다', () => {
  const t = tokenize('吾輩は猫である。', 'ja');
  assert.ok(t.filter((x) => x.word).length >= 3);
  assert.equal(t.map((x) => x.text).join(''), '吾輩は猫である。');
  assert.ok(t.some((x) => x.text === '猫'));
});

test('tokenize: 스페인어 악센트 보존, 부호 제외', () => {
  const t = tokenize('¿Qué día es hoy? Está bien.', 'es');
  assert.deepEqual(t.filter((x) => x.word).map((x) => x.text), ['Qué', 'día', 'es', 'hoy', 'Está', 'bien']);
});

test('sentenceSpans/spanAt: 문장 경계', () => {
  const text = 'It was late. She ran home. Why?';
  const spans = sentenceSpans(text, 'en');
  assert.equal(spans.length, 3);
  const s = spanAt(spans, text.indexOf('ran'));
  assert.equal(text.slice(s.start, s.end).trim(), 'She ran home.');
});

test('extendRange: 앞/뒤 단어로 넓히기', () => {
  const t = tokenize('give up now', 'en');
  const gi = t.findIndex((x) => x.text === 'give');
  const [a, b] = extendRange(t, gi, gi, 'next');
  assert.equal(t.slice(a, b + 1).map((x) => x.text).join(''), 'give up');
  assert.deepEqual(extendRange(t, 0, 0, 'prev'), [0, 0]);
});

test('normalizeForm', () => {
  assert.equal(normalizeForm('Don’t'), "don't");
});

test('makeCloze: 경계 일치, 대소문자 무시, 일본어', () => {
  const c = makeCloze('She wore a Part of the art.', ['art']);
  assert.equal(c?.answer, 'art');
  assert.equal(c?.after, '.');
  assert.equal(makeCloze('Cats run.', ['run'])?.before, 'Cats ');
  assert.equal(makeCloze('吾輩は猫である。', ['猫'])?.after, 'である。');
  assert.equal(makeCloze('nothing here', ['zzz']), null);
});

test('SRS: 다시/좋음/쉬움 간격 증가와 하한', () => {
  const now = 0;
  let c = { ...newCard(now) };
  const again = schedule(c, 'again', now);
  assert.equal(again.reps, 0);
  assert.equal(again.lapses, 1);
  assert.equal(again.due, 10 * 60_000);
  const g1 = schedule(c, 'good', now);
  assert.equal(g1.interval, 1);
  const g2 = schedule(g1, 'good', now);
  assert.equal(g2.interval, 3);
  const g3 = schedule(g2, 'good', now);
  assert.ok(g3.interval >= 7);
  const easy = schedule(g2, 'easy', now);
  assert.ok(easy.interval > g3.interval);
  let hard = c as ReturnType<typeof schedule>;
  for (let i = 0; i < 20; i++) hard = schedule(hard, 'hard', now);
  assert.ok(hard.ease >= 1.3);
  assert.equal(intervalLabel(c, 'again'), '10분');
  assert.equal(intervalLabel(c, 'good'), '1일');
});

test('CSV: 따옴표/쉼표/BOM/탭, 머리글 해석', () => {
  const rows = parseCsv('﻿word,meaning,example\n"a, b","뜻 ""하나""","He said ""hi"""\nrun,달리다,\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'a, b');
  assert.equal(rows[1][1], '뜻 "하나"');
  const w = rowsToWords(rows);
  assert.equal(w.length, 2);
  assert.equal(w[0].context, 'He said "hi"');
  const tsv = rowsToWords(parseCsv('学校\tがっこう\t학교\n猫\tねこ\t고양이'));
  assert.deepEqual(tsv.map((x) => [x.word, x.reading, x.meaning]), [['学校', 'がっこう', '학교'], ['猫', 'ねこ', '고양이']]);
  assert.equal(toCsv([['a,b', 'c']]), '"a,b",c');
});

test('parseTxt: Gutenberg 머리말 제거 + 장 나누기', () => {
  const body = ['Title: Test Book', 'Author: Me', '', '*** START OF THE PROJECT GUTENBERG EBOOK TEST ***', ''];
  for (let i = 1; i <= 3; i++) {
    body.push(`CHAPTER ${i}`, '', `Line one of chapter ${i}\nwrapped here.`, '', 'Second paragraph.', '');
  }
  body.push('*** END OF THE PROJECT GUTENBERG EBOOK TEST ***', 'license text');
  const p = parseTxt(body.join('\n'), 'en');
  assert.equal(p.title, 'Test Book');
  assert.equal(p.author, 'Me');
  assert.equal(p.chapters.length, 3);
  assert.equal(p.chapters[0].title, 'CHAPTER 1');
  assert.ok(p.chapters[0].paragraphs.includes('Line one of chapter 1 wrapped here.'));
  assert.ok(!p.chapters.flatMap((c) => c.paragraphs).some((x) => /license/.test(x)));
});

test('parseTxt: 아오조라 루비 표기 제거', () => {
  const p = parseTxt('吾輩《わがはい》は猫｜である［＃「である」に傍点］。\n名前はまだ無い。', 'ja');
  assert.equal(p.chapters[0].paragraphs[0], '吾輩は猫である。');
  assert.equal(p.chapters[0].paragraphs.length, 2);
});

test('buildSections: 길이 분할과 누적 글자수', () => {
  const para = 'word '.repeat(300).trim(); // 1499자
  const secs = buildSections([{ title: 'Ch', paragraphs: Array(10).fill(para) }], 'en');
  assert.ok(secs.length >= 2);
  assert.equal(secs[0].startChars, 0);
  assert.equal(secs[1].startChars, secs[0].chars);
  assert.match(secs[0].title, /Ch \(1\//);
  const long = buildSections([{ title: '', paragraphs: ['This is a sentence. '.repeat(400)] }], 'en');
  assert.ok(long.every((s) => s.paragraphs.every((p) => p.length <= 2800)));
});

test('guessLanguage / isHeading', () => {
  assert.equal(guessLanguage('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'), 'ja');
  assert.equal(guessLanguage('En un lugar de la Mancha, de cuyo nombre no quiero acordarme, el hidalgo y la vida.'), 'es');
  assert.equal(guessLanguage('It was the best of times, it was the worst of times, and the end of the story.'), 'en');
  assert.ok(isHeading('CHAPTER XII'));
  assert.ok(isHeading('第三章 旅立ち'));
  assert.ok(!isHeading('This is just a sentence about a chapter in a book that is much too long to be a heading at all.'));
});

test('computeStreak', () => {
  const today = new Date(2026, 9, 11);
  const m = new Map<string, { seconds: number }>();
  for (const back of [0, 1, 2, 4]) m.set(dateKey(addDays(today, -back)), { seconds: 120 });
  assert.equal(computeStreak(m, today), 3);
  m.delete(dateKey(today));
  assert.equal(computeStreak(m, today), 2); // 오늘 아직 안 읽었어도 어제까지의 연속은 유지
  assert.equal(computeStreak(new Map(), today), 0);
});

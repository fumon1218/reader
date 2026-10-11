import type { LangCode } from '../types';

export interface Token {
  text: string;
  start: number;
  end: number;
  /** 탭할 수 있는 단어인지 (글자가 있는 토큰) */
  word: boolean;
}

export interface Span {
  start: number;
  end: number;
}

const HAS_LETTER = /[\p{L}\p{M}]/u;
const KANJI = /[㐀-鿿豈-﫿]/;
const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

export const containsKanji = (s: string) => KANJI.test(s);
export const isCjk = (s: string) => CJK.test(s);

/** 하이라이트/단어 비교용 정규화: 유니코드 NFC, 소문자, 곡선 따옴표 통일 */
export function normalizeForm(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").trim();
}

type SegGran = 'word' | 'sentence';
const segs = new Map<string, Intl.Segmenter | null>();

function getSegmenter(lang: LangCode, gran: SegGran): Intl.Segmenter | null {
  const k = `${lang}:${gran}`;
  if (segs.has(k)) return segs.get(k) ?? null;
  let s: Intl.Segmenter | null = null;
  try {
    s = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(lang, { granularity: gran }) : null;
  } catch {
    s = null;
  }
  segs.set(k, s);
  return s;
}

const tokenCache = new Map<string, Token[]>();
const TOKEN_CACHE_MAX = 400;

export function tokenize(text: string, lang: LangCode): Token[] {
  const ck = `${lang}|${text}`;
  const hit = tokenCache.get(ck);
  if (hit) return hit;

  const out: Token[] = [];
  const seg = getSegmenter(lang, 'word');
  if (seg) {
    for (const s of seg.segment(text)) {
      out.push({
        text: s.segment,
        start: s.index,
        end: s.index + s.segment.length,
        word: !!s.isWordLike && HAS_LETTER.test(s.segment),
      });
    }
  } else {
    // Intl.Segmenter가 없는 오래된 환경용 대체 구현
    const re = /[\p{L}\p{M}][\p{L}\p{M}'’-]*|[^\p{L}\p{M}]+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ text: m[0], start: m.index, end: m.index + m[0].length, word: HAS_LETTER.test(m[0]) });
    }
  }
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(ck, out);
  return out;
}

export function sentenceSpans(text: string, lang: LangCode): Span[] {
  const seg = getSegmenter(lang, 'sentence');
  const spans: Span[] = [];
  if (seg) {
    for (const s of seg.segment(text)) spans.push({ start: s.index, end: s.index + s.segment.length });
  } else {
    const re = /[^.!?。！？]+[.!?。！？]*["”’)」』]*\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans.length ? spans : [{ start: 0, end: text.length }];
}

export function spanAt(spans: Span[], index: number): Span {
  return spans.find((s) => index >= s.start && index < s.end) ?? spans[spans.length - 1];
}

/** a번째 토큰부터 b번째 토큰까지의 원문 */
export function textOfRange(text: string, tokens: Token[], a: number, b: number): string {
  return text.slice(tokens[a].start, tokens[b].end);
}

/** 선택 범위를 앞/뒤로 한 단어 넓힙니다. 넓힐 수 없으면 그대로 돌려줍니다. */
export function extendRange(tokens: Token[], a: number, b: number, dir: 'prev' | 'next'): [number, number] {
  if (dir === 'prev') {
    for (let i = a - 1; i >= 0; i--) if (tokens[i].word) return [i, b];
    return [a, b];
  }
  for (let i = b + 1; i < tokens.length; i++) if (tokens[i].word) return [a, i];
  return [a, b];
}

import JSZip from 'jszip';
import type { LangCode, Section } from '../types';
import { sentenceSpans } from './tokenize';

export interface Chapter {
  title: string;
  paragraphs: string[];
}

export type NewSection = Omit<Section, 'id' | 'bookId'>;

export interface ParsedBook {
  title: string;
  author: string;
  language?: LangCode;
  chapters: Chapter[];
  coverBlob?: Blob;
}

// 한 화면 덩어리(섹션)의 최대 글자 수. 폰에서도 가볍게 넘어가도록 작게 유지합니다.
const MAX_SECTION_CHARS: Record<LangCode, number> = { en: 6000, es: 6000, ja: 3000 };

// ---------------------------------------------------------------------------
// 공통: 챕터 → 섹션
// ---------------------------------------------------------------------------

/** 너무 긴 문단은 문장 단위로 잘라 한 문단이 화면을 독점하지 않게 합니다. */
export function splitLongParagraph(p: string, lang: LangCode, limit = 1400): string[] {
  if (p.length <= limit) return [p];
  const spans = sentenceSpans(p, lang);
  const out: string[] = [];
  let cur = '';
  for (const s of spans) {
    const piece = p.slice(s.start, s.end);
    if (cur && cur.length + piece.length > limit) {
      out.push(cur.trim());
      cur = '';
    }
    cur += piece;
  }
  if (cur.trim()) out.push(cur.trim());
  // 문장 하나가 limit보다 긴 경우까지 안전하게 처리
  return out.flatMap((x) => (x.length > limit * 2 ? x.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g')) ?? [x] : [x]));
}

export function buildSections(chapters: Chapter[], lang: LangCode): NewSection[] {
  const max = MAX_SECTION_CHARS[lang];
  const parts: { title: string; paragraphs: string[] }[] = [];

  for (const ch of chapters) {
    const paras = ch.paragraphs.flatMap((p) => splitLongParagraph(p, lang)).filter((p) => p.trim());
    if (!paras.length) continue;
    const groups: string[][] = [];
    let cur: string[] = [];
    let len = 0;
    for (const p of paras) {
      if (cur.length && len + p.length > max) {
        groups.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(p);
      len += p.length;
    }
    if (cur.length) groups.push(cur);
    groups.forEach((g, i) => {
      const base = ch.title?.trim() || '';
      const title = groups.length > 1 ? `${base || '본문'} (${i + 1}/${groups.length})` : base;
      parts.push({ title, paragraphs: g });
    });
  }

  let acc = 0;
  return parts.map((p, i) => {
    const chars = p.paragraphs.reduce((n, x) => n + x.length, 0);
    const sec: NewSection = { index: i, title: p.title || `${i + 1}`, paragraphs: p.paragraphs, startChars: acc, chars };
    acc += chars;
    return sec;
  });
}

export function totalChars(sections: NewSection[]): number {
  return sections.reduce((n, s) => n + s.chars, 0);
}

// ---------------------------------------------------------------------------
// 언어 추정 / 텍스트 디코딩
// ---------------------------------------------------------------------------

export function guessLanguage(text: string): LangCode {
  const sample = text.slice(0, 4000);
  const kana = (sample.match(/[぀-ヿ]/g) ?? []).length;
  if (kana > 15) return 'ja';
  const es = (sample.match(/[¿¡ñáéíóúü]/gi) ?? []).length;
  const words = (sample.toLowerCase().match(/\b(el|la|los|las|de|que|y|en|un|una|es|por|con|para|su|se)\b/g) ?? []).length;
  const en = (sample.toLowerCase().match(/\b(the|and|of|to|in|was|that|his|her|with|for|it|is)\b/g) ?? []).length;
  if (es > 8 && words > en) return 'es';
  if (words > en * 1.3) return 'es';
  return 'en';
}

export function decodeText(buf: ArrayBuffer, lang?: LangCode): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    const fallback = lang === 'ja' ? 'shift_jis' : 'windows-1252';
    try {
      return new TextDecoder(fallback).decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

// ---------------------------------------------------------------------------
// TXT
// ---------------------------------------------------------------------------

const HEADING_WORDS =
  /^(chapter|cap[ií]tulo|cap\.|parte|part|book|libro|canto|act|prólogo|prologue|epílogo|epilogue|preface|prefacio|introduction|introducción)\b/i;
const HEADING_JA = /^第[一二三四五六七八九十百千0-9０-９]+[章話回節部編巻]/;
const ROMAN_ONLY = /^[IVXLC]{1,7}\.?$/;

export function isHeading(p: string): boolean {
  const t = p.trim();
  if (t.length === 0 || t.length > 60) return false;
  return HEADING_WORDS.test(t) || HEADING_JA.test(t) || ROMAN_ONLY.test(t);
}

export function parseTxt(raw: string, lang: LangCode): ParsedBook {
  let text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let title = '';
  let author = '';

  // Project Gutenberg 머리말/꼬리말 제거
  const start = text.match(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i);
  if (start && start.index !== undefined) {
    const header = text.slice(0, start.index);
    title = header.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ?? '';
    author = header.match(/^Author:\s*(.+)$/im)?.[1]?.trim() ?? '';
    text = text.slice(start.index + start[0].length);
  }
  const end = text.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end >= 0) text = text.slice(0, end);

  if (lang === 'ja') {
    // 아오조라 문고 표기 정리: 해설 블록, 루비 《》, ｜, 주기 ［＃…］
    text = text
      .replace(/^-{20,}\n[\s\S]*?\n-{20,}\n/, '')
      .replace(/《[^》]*》/g, '')
      .replace(/｜/g, '')
      .replace(/［＃[^］]*］/g, '');
  }

  const blocks = text.split(/\n[ \t]*\n/);
  const join = lang === 'ja' ? '' : ' ';
  let paragraphs: string[];
  if (blocks.length >= 5) {
    paragraphs = blocks.map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean).join(join));
  } else {
    paragraphs = text.split('\n');
  }
  paragraphs = paragraphs.map((p) => p.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);

  const headingIdx = paragraphs.map((p, i) => (isHeading(p) ? i : -1)).filter((i) => i >= 0);
  let chapters: Chapter[];
  if (headingIdx.length >= 3) {
    chapters = [];
    if (headingIdx[0] > 0) chapters.push({ title: '앞부분', paragraphs: paragraphs.slice(0, headingIdx[0]) });
    headingIdx.forEach((hi, k) => {
      const next = headingIdx[k + 1] ?? paragraphs.length;
      chapters.push({ title: paragraphs[hi], paragraphs: paragraphs.slice(hi, next) });
    });
  } else {
    chapters = [{ title: '', paragraphs }];
  }
  return { title, author, language: lang, chapters };
}

export function parseTxtBuffer(buf: ArrayBuffer, lang: LangCode | 'auto', fileName = ''): ParsedBook & { language: LangCode } {
  const first = decodeText(buf, lang === 'auto' ? undefined : lang);
  const language = lang === 'auto' ? guessLanguage(first) : lang;
  const text = lang === 'auto' && language === 'ja' && /�/.test(first) ? decodeText(buf, 'ja') : first;
  const parsed = parseTxt(text, language);
  if (!parsed.title) parsed.title = fileName.replace(/\.[^.]+$/, '');
  return { ...parsed, language };
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'figure', 'figcaption', 'body', 'caption', 'hr',
]);

const local = (el: Element) => (el.localName || el.nodeName).toLowerCase();

function parseDoc(src: string, type: DOMParserSupportedType): Document {
  return new DOMParser().parseFromString(src, type);
}

function parseXhtml(src: string): Document {
  let doc = parseDoc(src, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) doc = parseDoc(src, 'text/html');
  return doc;
}

const byLocal = (root: Document | Element, name: string): Element[] => Array.from(root.getElementsByTagNameNS('*', name));

const cleanText = (s: string | null | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function textOf(el: Element): string {
  el.querySelectorAll('br').forEach((b) => b.replaceWith(' '));
  return cleanText(el.textContent);
}

function collect(el: Element, out: string[]) {
  const kids = Array.from(el.children);
  if (!kids.some((c) => BLOCK.has(local(c)))) {
    const t = textOf(el);
    if (t) out.push(t);
    return;
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const t = cleanText(node.textContent);
      if (t) out.push(t);
    } else if (node.nodeType === 1) {
      const c = node as Element;
      if (BLOCK.has(local(c))) collect(c, out);
      else {
        const t = textOf(c);
        if (t) out.push(t);
      }
    }
  }
}

export function extractParagraphs(xhtml: string): { paragraphs: string[]; heading: string } {
  const doc = parseXhtml(xhtml);
  const body = doc.body ?? byLocal(doc, 'body')[0] ?? doc.documentElement;
  body.querySelectorAll('script,style,rt,rp,nav').forEach((n) => n.remove());
  const heading = cleanText(body.querySelector('h1,h2,h3')?.textContent);
  const paragraphs: string[] = [];
  collect(body, paragraphs);
  return { paragraphs: paragraphs.filter((p) => !/^\d{1,4}$/.test(p)), heading };
}

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function resolvePath(base: string, href: string): string {
  const raw = href.split('#')[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const parts = (base ? `${base}/${decoded}` : decoded).split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function mapLang(code: string | undefined): LangCode | undefined {
  const c = (code ?? '').toLowerCase();
  if (c.startsWith('ja')) return 'ja';
  if (c.startsWith('es')) return 'es';
  if (c.startsWith('en')) return 'en';
  return undefined;
}

export async function parseEpub(data: ArrayBuffer): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(data);
  const readText = async (path: string) => {
    const f = zip.file(path);
    return f ? f.async('string') : null;
  };

  const containerXml = await readText('META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB 파일이 아니에요. (container.xml 없음)');
  const opfPath = byLocal(parseDoc(containerXml, 'application/xml'), 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB 구조를 읽지 못했어요.');
  const opfXml = await readText(opfPath);
  if (!opfXml) throw new Error('EPUB의 목록 파일(opf)을 찾지 못했어요.');
  const opf = parseDoc(opfXml, 'application/xml');
  const opfDir = dirname(opfPath);

  const meta = (name: string) => cleanText(byLocal(opf, name)[0]?.textContent);
  const title = meta('title');
  const author = meta('creator');
  const language = mapLang(meta('language'));

  const items = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byLocal(opf, 'item')) {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (id && href) items.set(id, { href, type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
  }

  // 목차에서 장 제목 얻기 (nav 또는 ncx)
  const tocTitles = new Map<string, string>();
  try {
    const navItem = [...items.values()].find((i) => i.props.split(/\s+/).includes('nav'));
    const spineEl = byLocal(opf, 'spine')[0];
    const ncxItem = items.get(spineEl?.getAttribute('toc') ?? '') ?? [...items.values()].find((i) => i.type === 'application/x-dtbncx+xml');
    if (navItem) {
      const navPath = resolvePath(opfDir, navItem.href);
      const src = await readText(navPath);
      if (src) {
        const doc = parseXhtml(src);
        for (const a of Array.from(doc.querySelectorAll('nav a[href]'))) {
          const p = resolvePath(dirname(navPath), a.getAttribute('href') ?? '');
          const t = cleanText(a.textContent);
          if (t && !tocTitles.has(p)) tocTitles.set(p, t);
        }
      }
    }
    if (!tocTitles.size && ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href);
      const src = await readText(ncxPath);
      if (src) {
        const doc = parseDoc(src, 'application/xml');
        for (const np of byLocal(doc, 'navPoint')) {
          const t = cleanText(byLocal(np, 'text')[0]?.textContent);
          const c = byLocal(np, 'content')[0]?.getAttribute('src');
          if (t && c) {
            const p = resolvePath(dirname(ncxPath), c);
            if (!tocTitles.has(p)) tocTitles.set(p, t);
          }
        }
      }
    }
  } catch {
    /* 목차 없이도 진행 */
  }

  const chapters: Chapter[] = [];
  const spine = byLocal(opf, 'itemref')
    .map((r) => r.getAttribute('idref'))
    .filter((x): x is string => !!x);
  for (const idref of spine) {
    const item = items.get(idref);
    if (!item || !/x?html|xml/.test(item.type)) continue;
    const path = resolvePath(opfDir, item.href);
    const src = await readText(path);
    if (!src) continue;
    const { paragraphs, heading } = extractParagraphs(src);
    const chars = paragraphs.reduce((n, p) => n + p.length, 0);
    if (chars < 30) continue; // 표지·빈 페이지 등
    const chTitle = tocTitles.get(path) || heading || '';
    // 제목이 본문 첫 줄에도 반복되면(대부분의 EPUB) 한 번만 보이도록 본문에서 뺍니다.
    const same = (x: string) => x.replace(/\s+/g, '') === (heading || chTitle).replace(/\s+/g, '') || x.replace(/\s+/g, '') === chTitle.replace(/\s+/g, '');
    const body = paragraphs.length > 1 && same(paragraphs[0]) ? paragraphs.slice(1) : paragraphs;
    chapters.push({ title: chTitle, paragraphs: body });
  }
  if (!chapters.length) throw new Error('읽을 수 있는 본문을 찾지 못했어요.');

  // 표지
  let coverBlob: Blob | undefined;
  try {
    const metaCover = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem =
      [...items.values()].find((i) => i.props.split(/\s+/).includes('cover-image')) ?? (metaCover ? items.get(metaCover) : undefined);
    if (coverItem) {
      const f = zip.file(resolvePath(opfDir, coverItem.href));
      if (f) coverBlob = await f.async('blob');
    }
  } catch {
    /* 표지 없이 진행 */
  }

  return { title, author, language, chapters, coverBlob };
}

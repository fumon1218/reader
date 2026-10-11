import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import Icon from '../components/Icon';
import WordSheet from '../components/WordSheet';
import DisplayControls from '../components/DisplayControls';
import { Sheet, useUI } from '../components/ui';
import { books, getSection, getSectionTitles, highlights, useLive, words as wordsTable } from '../db';
import { errorMessage, translateText } from '../lib/gemini';
import { addReading } from '../lib/stats';
import { containsKanji, normalizeForm, tokenize, type Span } from '../lib/tokenize';
import { stopSpeaking } from '../lib/tts';
import { back, navigate } from '../router';
import { useSettings } from '../settings';
import type { Book, LangCode, Section, Word } from '../types';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

type Tr = { status: 'loading' | 'done'; text?: string };

interface ParaProps {
  text: string;
  index: number;
  lang: LangCode;
  forms: Map<string, Word>;
  ruby: boolean;
  sel: { a: number; b: number } | null;
  hl: Span[] | undefined;
  hlKey: string;
  tr: Tr | undefined;
  onTranslate: (i: number) => void;
}

const Para = memo(
  function Para({ text, index, lang, forms, ruby, sel, hl, tr, onTranslate }: ParaProps) {
    const tokens = tokenize(text, lang);
    const nodes: ReactNode[] = [];
    tokens.forEach((t, ti) => {
      const inSel = !!sel && ti >= sel.a && ti <= sel.b;
      const inHl = !!hl && hl.some((h) => t.start < h.end && t.end > h.start);
      if (!t.word) {
        if (inSel || inHl) nodes.push(<span key={ti} className={cx(inSel && 'w-sel', inHl && 'hl')}>{t.text}</span>);
        else nodes.push(t.text);
        return;
      }
      const entry = forms.get(normalizeForm(t.text));
      let content: ReactNode = t.text;
      if (ruby && lang === 'ja' && entry?.reading && entry.lemma === t.text && containsKanji(t.text)) {
        content = (
          <ruby>
            {t.text}
            <rt>{entry.reading}</rt>
          </ruby>
        );
      }
      nodes.push(
        <span
          key={ti}
          data-p={index}
          data-t={ti}
          className={cx('w', entry?.status === 'learning' && 'w-learning', entry?.status === 'known' && 'w-known', inSel && 'w-sel', inHl && 'hl')}
        >
          {content}
        </span>
      );
    });
    return (
      <div className="para" data-para={index}>
        <p>{nodes}</p>
        <button className="para-tr-btn" onClick={() => onTranslate(index)} aria-label="문단 번역" title="문단 번역">
          <Icon name="translate" size={16} />
        </button>
        {tr && <div className={cx('para-tr', tr.status === 'loading' && 'loading')}>{tr.status === 'loading' ? '번역 중…' : tr.text}</div>}
      </div>
    );
  },
  (a, b) =>
    a.text === b.text &&
    a.index === b.index &&
    a.lang === b.lang &&
    a.forms === b.forms &&
    a.ruby === b.ruby &&
    a.hlKey === b.hlKey &&
    a.tr === b.tr &&
    a.onTranslate === b.onTranslate &&
    a.sel?.a === b.sel?.a &&
    a.sel?.b === b.sel?.b
);

export default function Reader({ bookId, startSection, startPara }: { bookId: number; startSection?: number; startPara?: number }) {
  const ui = useUI();
  const [settings] = useSettings();
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [sIdx, setSIdx] = useState<number | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [sel, setSel] = useState<{ p: number; a: number; b: number } | null>(null);
  const [trs, setTrs] = useState<Record<number, Tr>>({});
  const [showDisplay, setShowDisplay] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [toc, setToc] = useState<{ index: number; title: string }[]>([]);
  const [barsHidden, setBarsHidden] = useState(false);
  const [progress, setProgress] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const restorePara = useRef<number | null>(null);
  const savePosOnLoad = useRef(false);

  // 책 불러오기
  useEffect(() => {
    let alive = true;
    books.get(bookId).then((b) => {
      if (!alive) return;
      setBook(b ?? null);
      if (b) {
        const s = startSection ?? b.sectionIndex;
        restorePara.current = startPara ?? (s === b.sectionIndex ? b.paraIndex : 0);
        setSIdx(Math.min(Math.max(0, s), Math.max(0, b.sectionCount - 1)));
        setProgress(b.progress);
        getSectionTitles(bookId).then((t) => alive && setToc(t));
      }
    });
    return () => {
      alive = false;
    };
  }, [bookId, startSection, startPara]);

  // 구간 불러오기
  useEffect(() => {
    if (sIdx === null) return;
    let alive = true;
    getSection(bookId, sIdx).then((s) => {
      if (alive) setSection(s ?? null);
    });
    return () => {
      alive = false;
    };
  }, [bookId, sIdx]);

  const lang = book?.language ?? 'en';
  const allWords = useLive(['words'], () => (book ? wordsTable.where('language', book.language) : Promise.resolve([] as Word[])), [book?.language]);
  const forms = useMemo(() => {
    const m = new Map<string, Word>();
    (allWords ?? []).forEach((w) => {
      w.forms.forEach((f) => m.set(f, w));
      m.set(normalizeForm(w.lemma), w);
    });
    return m;
  }, [allWords]);

  const hlRows = useLive(['highlights'], () => highlights.where('bookId', bookId), [bookId]);
  const hlByPara = useMemo(() => {
    const m = new Map<number, { spans: Span[]; key: string }>();
    (hlRows ?? [])
      .filter((h) => h.sectionIndex === sIdx)
      .forEach((h) => {
        const cur = m.get(h.paraIndex) ?? { spans: [], key: '' };
        cur.spans.push({ start: h.start, end: h.end });
        cur.key += `${h.start}-${h.end},`;
        m.set(h.paraIndex, cur);
      });
    return m;
  }, [hlRows, sIdx]);

  // 문단 앞까지의 누적 글자수 (진행률 계산용)
  const cum = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    (section?.paragraphs ?? []).forEach((p) => {
      out.push(acc);
      acc += p.length;
    });
    return out;
  }, [section]);

  // ---- 읽은 시간/글자 기록 ----
  const pendingSec = useRef(0);
  const pendingChars = useRef(0);
  const lastActive = useRef(Date.now());
  const lastAbs = useRef<number | null>(null);
  useEffect(() => {
    const flush = () => {
      const s = pendingSec.current;
      const c = pendingChars.current;
      pendingSec.current = 0;
      pendingChars.current = 0;
      if (s > 0 || c > 0) void addReading(bookId, s, c);
    };
    const act = () => {
      lastActive.current = Date.now();
    };
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive.current < 45_000) pendingSec.current += 1;
      if (pendingSec.current >= 15) flush();
    }, 1000);
    const evs = ['scroll', 'touchstart', 'click', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, act, { passive: true }));
    const hide = () => flush();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      window.clearInterval(iv);
      evs.forEach((e) => window.removeEventListener(e, act));
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      flush();
      stopSpeaking();
    };
  }, [bookId]);

  // ---- 위치 저장 ----
  const savePosition = useCallback(
    async (paraIndex: number) => {
      if (!book || !section || sIdx === null) return;
      const abs = section.startChars + (cum[paraIndex] ?? 0);
      const prog = book.totalChars ? Math.min(1, abs / book.totalChars) : 0;
      if (lastAbs.current !== null) {
        const d = abs - lastAbs.current;
        if (d > 0 && d < 4000) pendingChars.current += d;
      }
      lastAbs.current = abs;
      setProgress(prog);
      const cur = await books.get(bookId);
      if (!cur) return;
      const patch: Partial<Book> = { sectionIndex: sIdx, paraIndex, progress: prog, lastReadAt: Date.now() };
      if (cur.status === 'wishlist') {
        patch.status = 'reading';
        patch.startedAt = Date.now();
      }
      await books.put({ ...cur, ...patch });
    },
    [book, section, sIdx, cum, bookId]
  );

  const firstVisibleParagraph = useCallback((): number => {
    const root = contentRef.current;
    if (!root) return 0;
    const limit = (topRef.current?.getBoundingClientRect().height ?? 56) + 24;
    const els = root.querySelectorAll<HTMLElement>('[data-para]');
    let idx = 0;
    for (const el of Array.from(els)) {
      idx = Number(el.dataset.para);
      if (el.getBoundingClientRect().bottom > limit) break;
    }
    return idx;
  }, []);

  // 구간이 바뀌면 원하는 문단으로 스크롤
  useLayoutEffect(() => {
    if (!section) return;
    const target = restorePara.current;
    restorePara.current = null;
    if (target && target > 0) {
      const el = contentRef.current?.querySelector<HTMLElement>(`[data-para="${target}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - (topRef.current?.getBoundingClientRect().height ?? 56) - 12;
        window.scrollTo(0, Math.max(0, top));
      }
    } else {
      window.scrollTo(0, 0);
    }
    lastAbs.current = null;
    if (savePosOnLoad.current) {
      savePosOnLoad.current = false;
      void savePosition(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  // 스크롤: 상단바 자동 숨김 + 위치 저장(디바운스)
  const saveRef = useRef(savePosition);
  saveRef.current = savePosition;
  useEffect(() => {
    let lastY = window.scrollY;
    let timer: number | undefined;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) > 12) {
        setBarsHidden(y > lastY && y > 140);
        lastY = y;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void saveRef.current(firstVisibleParagraph()), 700);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, [firstVisibleParagraph]);

  // 탭한 단어가 시트에 가려지지 않게 위로 올리기
  useEffect(() => {
    if (!sel) return;
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-p="${sel.p}"][data-t="${sel.a}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const limit = window.innerHeight * 0.4;
    if (r.bottom > limit) window.scrollBy({ top: r.bottom - limit + 24, behavior: 'smooth' });
    else if (r.top < 70) window.scrollBy({ top: r.top - 90, behavior: 'smooth' });
  }, [sel?.p, sel?.a]);

  const onTextClick = (e: ReactMouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!el) {
      setSel(null);
      return;
    }
    const p = Number(el.dataset.p);
    const t = Number(el.dataset.t);
    setSel({ p, a: t, b: t });
  };

  const translatePara = useCallback(
    async (i: number) => {
      if (!section) return;
      if (trs[i]) {
        setTrs((m) => {
          const { [i]: _, ...rest } = m;
          void _;
          return rest;
        });
        return;
      }
      setTrs((m) => ({ ...m, [i]: { status: 'loading' } }));
      try {
        const r = await translateText(lang, section.paragraphs[i], 'paragraph');
        setTrs((m) => ({ ...m, [i]: { status: 'done', text: r.translation } }));
      } catch (e) {
        ui.toast(errorMessage(e));
        setTrs((m) => {
          const { [i]: _, ...rest } = m;
          void _;
          return rest;
        });
      }
    },
    [section, trs, lang, ui]
  );

  const goSection = (i: number) => {
    if (!book || i < 0 || i >= book.sectionCount) return;
    setSel(null);
    setTrs({});
    restorePara.current = 0;
    savePosOnLoad.current = true;
    setSIdx(i);
  };

  const finish = async () => {
    const cur = await books.get(bookId);
    if (!cur) return;
    await books.put({ ...cur, status: 'finished', finishedAt: Date.now(), progress: 1, sectionIndex: sIdx ?? cur.sectionIndex });
    ui.toast('완독을 축하해요! 🎉');
    navigate('');
  };

  if (book === null) {
    return (
      <div className="page center-msg">
        <p>책을 찾을 수 없어요.</p>
        <button className="btn primary" onClick={() => navigate('')}>
          서재로
        </button>
      </div>
    );
  }
  if (!book || !section || sIdx === null) {
    return (
      <div className="page center-msg">
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }

  const isLast = sIdx >= book.sectionCount - 1;
  const selPara = sel ? section.paragraphs[sel.p] : undefined;

  return (
    <div className="reader" style={{ ['--rd-size' as string]: `${settings.fontSize}px`, ['--rd-lh' as string]: settings.lineHeight }}>
      <div className="rd-progress" aria-hidden="true">
        <i style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </div>
      <header ref={topRef} className={cx('rd-top', barsHidden && !sel && 'hidden')}>
        <button className="icon-btn" onClick={() => back('')} aria-label="서재로">
          <Icon name="left" />
        </button>
        <button className="rd-title" onClick={() => setShowToc(true)}>
          <b>{book.title.replace(/\s*\(맛보기\)/, '')}</b>
          <span>
            {section.title} · {sIdx + 1}/{book.sectionCount}
          </span>
        </button>
        <button className="icon-btn" onClick={() => setShowToc(true)} aria-label="목차">
          <Icon name="list" />
        </button>
        <button className="icon-btn" onClick={() => setShowDisplay(true)} aria-label="화면 설정">
          <Icon name="type" />
        </button>
      </header>

      <div
        ref={contentRef}
        className={cx('rd-text', `reader-font-${settings.fontFamily}`, sel && 'has-sheet')}
        lang={lang}
        onClick={onTextClick}
      >
        <h2 className="rd-heading">{section.title}</h2>
        {section.paragraphs.map((text, i) => (
          <Para
            key={`${sIdx}-${i}`}
            text={text}
            index={i}
            lang={lang}
            forms={forms}
            ruby={settings.showRuby}
            sel={sel && sel.p === i ? { a: sel.a, b: sel.b } : null}
            hl={hlByPara.get(i)?.spans}
            hlKey={hlByPara.get(i)?.key ?? ''}
            tr={trs[i]}
            onTranslate={translatePara}
          />
        ))}

        <nav className="rd-nav" onClick={(e) => e.stopPropagation()}>
          <button className="btn" disabled={sIdx === 0} onClick={() => goSection(sIdx - 1)}>
            <Icon name="left" size={18} /> 이전
          </button>
          <span className="muted">
            {sIdx + 1} / {book.sectionCount}
          </span>
          {isLast ? (
            <button className="btn primary" onClick={finish}>
              <Icon name="check" size={18} /> 완독
            </button>
          ) : (
            <button className="btn primary" onClick={() => goSection(sIdx + 1)}>
              다음 <Icon name="right" size={18} />
            </button>
          )}
        </nav>
      </div>

      {sel && selPara !== undefined && (
        <WordSheet
          key={`${sIdx}-${sel.p}`}
          lang={lang}
          book={book}
          sectionIndex={sIdx}
          paraIndex={sel.p}
          paragraph={selPara}
          a={sel.a}
          b={sel.b}
          forms={forms}
          ttsRate={settings.ttsRate}
          showKorean={settings.showKoreanReading}
          showRuby={settings.showRuby}
          onRange={(a, b) => setSel({ p: sel.p, a, b })}
          onClose={() => setSel(null)}
        />
      )}

      <Sheet open={showDisplay} onClose={() => setShowDisplay(false)} title="화면 설정">
        <DisplayControls />
      </Sheet>
      <Sheet open={showToc} onClose={() => setShowToc(false)} title="목차">
        <ul className="toc">
          {toc.map((t) => (
            <li key={t.index}>
              <button
                className={cx(t.index === sIdx && 'on')}
                onClick={() => {
                  setShowToc(false);
                  goSection(t.index);
                }}
              >
                <span className="toc-n">{t.index + 1}</span>
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

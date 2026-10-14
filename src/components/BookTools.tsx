import { useEffect, useState } from 'react';
import Icon from './Icon';
import { Sheet } from './ui';
import { highlights, sections, useLive } from '../db';
import type { LangCode } from '../types';

type Hit = { s: number; p: number; before: string; match: string; after: string; title: string };

const MAX_HITS = 80;

export default function BookTools({
  open,
  onClose,
  bookId,
  lang,
  tab,
  onTab,
  onGo,
}: {
  open: boolean;
  onClose: () => void;
  bookId: number;
  lang: LangCode;
  tab: 'search' | 'mark' | 'hl';
  onTab: (t: 'search' | 'mark' | 'hl') => void;
  onGo: (s: number, p: number) => void;
}) {
  const rows = useLive(['highlights'], () => highlights.where('bookId', bookId), [bookId]);
  const marks = (rows ?? []).filter((h) => h.kind === 'bookmark').sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex);
  const hls = (rows ?? []).filter((h) => h.kind !== 'bookmark').sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!open || tab !== 'search' || term.length < 1) {
      setHits(null);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(async () => {
      const all = (await sections.where('bookId', bookId)).sort((a, b) => a.index - b.index);
      const out: Hit[] = [];
      let over = false;
      outer: for (const sec of all) {
        for (let p = 0; p < sec.paragraphs.length; p++) {
          const text = sec.paragraphs[p];
          const at = text.toLowerCase().indexOf(term);
          if (at < 0) continue;
          if (out.length >= MAX_HITS) {
            over = true;
            break outer;
          }
          const a = Math.max(0, at - 28);
          out.push({
            s: sec.index,
            p,
            before: (a > 0 ? '…' : '') + text.slice(a, at),
            match: text.slice(at, at + term.length),
            after: text.slice(at + term.length, at + term.length + 48) + (at + term.length + 48 < text.length ? '…' : ''),
            title: sec.title,
          });
        }
      }
      if (!alive) return;
      setHits(out);
      setMore(over);
      setBusy(false);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, tab, open, bookId]);

  const go = (s: number, p: number) => {
    onClose();
    onGo(s, p);
  };

  return (
    <Sheet open={open} onClose={onClose} title="찾기 · 책갈피 · 하이라이트">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => onTab('search')}>검색</button>
        <button className={tab === 'mark' ? 'on' : ''} onClick={() => onTab('mark')}>책갈피 {marks.length}</button>
        <button className={tab === 'hl' ? 'on' : ''} onClick={() => onTab('hl')}>하이라이트 {hls.length}</button>
      </div>

      {tab === 'search' && (
        <div>
          <input
            className="input"
            type="search"
            placeholder="책 안에서 찾을 단어나 문장"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            lang={lang}
          />
          {busy && <p className="muted" style={{ marginTop: 10 }}>찾는 중…</p>}
          {!busy && hits && hits.length === 0 && <p className="muted" style={{ marginTop: 10 }}>찾은 내용이 없어요.</p>}
          {hits && hits.length > 0 && (
            <ul className="hl-list" style={{ marginTop: 10 }}>
              {hits.map((h) => (
                <li key={`${h.s}-${h.p}`}>
                  <button className="hl-text" onClick={() => go(h.s, h.p)}>
                    <span lang={lang}>
                      {h.before}
                      <mark>{h.match}</mark>
                      {h.after}
                    </span>
                    <em>{h.title}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {more && <p className="muted" style={{ marginTop: 8 }}>결과가 많아 앞쪽 {MAX_HITS}개만 보여요. 더 길게 입력해 보세요.</p>}
        </div>
      )}

      {tab === 'mark' &&
        (marks.length === 0 ? (
          <p className="muted">책갈피가 없어요. 읽기 화면 위쪽의 책갈피 버튼을 눌러 지금 위치를 표시해 보세요.</p>
        ) : (
          <ul className="hl-list">
            {marks.map((h) => (
              <li key={h.id}>
                <button className="hl-text" onClick={() => go(h.sectionIndex, h.paraIndex)}>
                  <span lang={lang}>{h.text}</span>
                  <em>{h.sectionIndex + 1}번째 구간</em>
                </button>
                <button className="icon-btn" aria-label="책갈피 삭제" onClick={() => h.id !== undefined && highlights.del(h.id)}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'hl' &&
        (hls.length === 0 ? (
          <p className="muted">하이라이트가 없어요. 단어를 눌러 나오는 창에서 문장을 하이라이트할 수 있어요.</p>
        ) : (
          <ul className="hl-list">
            {hls.map((h) => (
              <li key={h.id}>
                <button className="hl-text" onClick={() => go(h.sectionIndex, h.paraIndex)}>
                  <span lang={lang}>{h.text}</span>
                  {h.note && <em>{h.note}</em>}
                </button>
                <button className="icon-btn" aria-label="하이라이트 삭제" onClick={() => h.id !== undefined && highlights.del(h.id)}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        ))}
    </Sheet>
  );
}

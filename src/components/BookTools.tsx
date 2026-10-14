import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { Sheet } from './ui';
import { highlights, sections, useLive } from '../db';
import { normalizeForm, tokenize } from '../lib/tokenize';
import type { LangCode, Section, Word } from '../types';

export type ToolTab = 'search' | 'mark' | 'hl' | 'words';

type Hit = { s: number; p: number; before: string; match: string; after: string; title: string };

const MAX_HITS = 80;
// 너무 흔해서 미리보기에서 빼는 긴 단어들
const COMMON = new Set('through between everything something because before without another nothing thought against should around itself himself herself myself yourself there their these those which would could really almost always never anyone someone however though although while where within across behind before after under until again still being having people little'.split(' '));

export default function BookTools({
  open,
  onClose,
  bookId,
  lang,
  tab,
  onTab,
  onGo,
  section,
  forms,
  onPickWord,
}: {
  open: boolean;
  onClose: () => void;
  bookId: number;
  lang: LangCode;
  tab: ToolTab;
  onTab: (t: ToolTab) => void;
  onGo: (s: number, p: number) => void;
  section: Section | null;
  forms: Map<string, Word>;
  onPickWord: (p: number, t: number) => void;
}) {
  const rows = useLive(['highlights'], () => highlights.where('bookId', bookId), [bookId]);
  const marks = (rows ?? []).filter((h) => h.kind === 'bookmark').sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex);
  const hls = (rows ?? []).filter((h) => h.kind !== 'bookmark').sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex);

  // 이 구간 미리보기: 내가 학습 중인 단어 + 여러 번 나오는 낯선 단어
  const preview = useMemo(() => {
    if (!open || tab !== 'words' || !section) return null;
    const mine = new Map<string, { w: Word; n: number }>();
    const fresh = new Map<string, { text: string; n: number; p: number; t: number }>();
    const cjk = lang === 'ja' || lang === 'zh';
    section.paragraphs.forEach((para, p) => {
      tokenize(para, lang).forEach((tok, t) => {
        if (!tok.word) return;
        const key = normalizeForm(tok.text);
        const w = forms.get(key);
        if (w) {
          if (w.status === 'learning') {
            const cur = mine.get(w.key);
            if (cur) cur.n++;
            else mine.set(w.key, { w, n: 1 });
          }
          return;
        }
        if (COMMON.has(key) || tok.text.length < (cjk ? 2 : 6) || /^[\d\p{P}]+$/u.test(tok.text)) return;
        const cur = fresh.get(key);
        if (cur) cur.n++;
        else fresh.set(key, { text: tok.text, n: 1, p, t });
      });
    });
    return {
      mine: [...mine.values()].sort((a, b) => b.n - a.n),
      fresh: [...fresh.values()].filter((f) => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, 24),
    };
  }, [open, tab, section, forms, lang]);

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
    <Sheet open={open} onClose={onClose} title="찾기 · 책갈피 · 단어">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => onTab('search')}>검색</button>
        <button className={tab === 'mark' ? 'on' : ''} onClick={() => onTab('mark')}>책갈피 {marks.length}</button>
        <button className={tab === 'hl' ? 'on' : ''} onClick={() => onTab('hl')}>하이라이트 {hls.length}</button>
        <button className={tab === 'words' ? 'on' : ''} onClick={() => onTab('words')}>단어 미리보기</button>
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

      {tab === 'words' && preview && (
        <div className="stack">
          <p className="muted small">지금 읽는 구간({section?.title})을 훑어본 결과예요.</p>
          <div>
            <div className="label">내가 학습 중인 단어 ({preview.mine.length})</div>
            {preview.mine.length === 0 ? (
              <p className="muted small">이 구간에는 학습 중인 단어가 없어요.</p>
            ) : (
              <ul className="hl-list">
                {preview.mine.map(({ w, n }) => (
                  <li key={w.key}>
                    <div className="hl-text">
                      <span lang={lang}><b>{w.lemma}</b>{w.reading && w.reading !== w.lemma ? ` (${w.reading})` : ''}</span>
                      <em>{w.meaning} · {n}번 나와요</em>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="label">자주 나오는 낯선 단어 ({preview.fresh.length})</div>
            {preview.fresh.length === 0 ? (
              <p className="muted small">두 번 이상 나오는 낯선 단어가 없어요.</p>
            ) : (
              <>
                <p className="muted small">누르면 본문의 그 자리로 가서 뜻을 찾을 수 있어요.</p>
                <div className="pills" style={{ flexWrap: 'wrap' }}>
                  {preview.fresh.map((f) => (
                    <button
                      key={f.text}
                      className="pill"
                      lang={lang}
                      onClick={() => {
                        onClose();
                        onPickWord(f.p, f.t);
                      }}
                    >
                      {f.text} ×{f.n}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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

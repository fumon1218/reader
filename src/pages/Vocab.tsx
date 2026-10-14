import { useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import KanjiBreakdown from '../components/KanjiBreakdown';
import { Empty, LangPills, Segmented, Sheet, WordText, useUI } from '../components/ui';
import { books, words, useLive } from '../db';
import { parseCsv, rowsToWords, toCsv } from '../lib/csv';
import { errorMessage } from '../lib/gemini';
import { speak } from '../lib/tts';
import { recordTomb } from '../lib/sync/tombs';
import { addImportedWords } from '../lib/vocab';
import { findDuplicateGroups, isHard, mergeGroup } from '../lib/dedupe';
import { makeCloze } from '../lib/cloze';
import { relativeDue, saveBlob, dateKey } from '../lib/util';
import { navigate } from '../router';
import { useSettings } from '../settings';
import { LANGS, langInfo, type LangCode, type Word, type WordStatus } from '../types';

type StatusFilter = WordStatus | 'all';
type Sort = 'recent' | 'alpha' | 'due' | 'hard';

function WordRow({ w, bookTitle, open, onToggle }: { w: Word; bookTitle?: string; open: boolean; onToggle: () => void }) {
  const ui = useUI();
  const [s] = useSettings();
  const [meaning, setMeaning] = useState(w.meaning);
  const [reading, setReading] = useState(w.reading);
  const [note, setNote] = useState(w.note);
  const [context, setContext] = useState(w.context);
  const [pos, setPos] = useState(w.pos);
  const cloze = open ? makeCloze(w.context, [w.surface, w.lemma, ...w.forms]) : null;
  const patch = (p: Partial<Word>) => words.put({ ...w, ...p, updatedAt: Date.now() });

  return (
    <li className={`wrow ${open ? 'open' : ''}`}>
      <button className="wrow-main" onClick={onToggle}>
        <div className="wrow-word" lang={w.language}>
          <WordText lemma={w.lemma} reading={w.reading} lang={w.language} ruby={s.showRuby} />
        </div>
        <div className="wrow-meaning">{w.meaning || <span className="muted">뜻 없음</span>}</div>
        <div className="wrow-side">
          <span className="tag">{langInfo(w.language).short}</span>
          {isHard(w) && <span className="tag">자주 틀림</span>}
          {w.status === 'known' ? <span className="tag good">아는 단어</span> : <span className="muted small">{relativeDue(w.due)}</span>}
        </div>
      </button>
      {open && (
        <div className="wrow-detail">
          {w.context && (
            <p className="wrow-ctx" lang={w.language}>
              {cloze ? (
                <>
                  {cloze.before}
                  <mark>{cloze.answer}</mark>
                  {cloze.after}
                </>
              ) : (
                w.context
              )}
            </p>
          )}
          <div className="grid2">
            <div>
              <div className="label">뜻</div>
              <input className="input" value={meaning} onChange={(e) => setMeaning(e.target.value)} onBlur={() => meaning !== w.meaning && patch({ meaning })} />
            </div>
            <div>
              <div className="label">읽기</div>
              <input className="input" value={reading} onChange={(e) => setReading(e.target.value)} onBlur={() => reading !== w.reading && patch({ reading })} />
            </div>
          </div>
          <div className="grid2">
            <div>
              <div className="label">품사</div>
              <input className="input" value={pos} onChange={(e) => setPos(e.target.value)} onBlur={() => pos !== w.pos && patch({ pos })} />
            </div>
            <div>
              <div className="label">메모</div>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== w.note && patch({ note })} />
            </div>
          </div>
          <div>
            <div className="label">예문</div>
            <input className="input" lang={w.language} value={context} onChange={(e) => setContext(e.target.value)} onBlur={() => context !== w.context && patch({ context })} />
          </div>
          <KanjiBreakdown lang={w.language} word={w.lemma} saved={w.kanji} onLoaded={(k) => patch({ kanji: k })} />
          {(w.koreanReading || bookTitle) && (
            <p className="muted small">
              {[w.koreanReading, bookTitle].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="row-btns">
            <button className="btn small" onClick={() => speak(w.lemma, w.language, s.ttsRate)}>
              <Icon name="volume" size={16} /> 듣기
            </button>
            <button className="btn small" onClick={() => patch({ status: w.status === 'known' ? 'learning' : 'known', due: w.status === 'known' ? Date.now() : w.due })}>
              <Icon name="check" size={16} /> {w.status === 'known' ? '학습 중으로' : '아는 단어로'}
            </button>
            {w.bookId !== undefined && w.sectionIndex !== undefined && (
              <button className="btn small" onClick={() => navigate(`read/${w.bookId}?s=${w.sectionIndex}&p=${w.paraIndex ?? 0}`)}>
                <Icon name="book" size={16} /> 본문에서 보기
              </button>
            )}
            <button
              className="btn small danger-ghost"
              onClick={async () => {
                if (await ui.confirm(`"${w.lemma}"을(를) 단어장에서 삭제할까요?`, { okLabel: '삭제', danger: true })) {
                  if (w.id !== undefined) {
                    await words.del(w.id);
                    recordTomb('words', w.key);
                  }
                }
              }}
            >
              <Icon name="trash" size={16} /> 삭제
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function Vocab() {
  const ui = useUI();
  const rows = useLive(['words'], () => words.all(), []);
  const bookRows = useLive(['books'], () => books.all(), []);
  const [lang, setLang] = useState<LangCode | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('learning');
  const [sort, setSort] = useState<Sort>('recent');
  const [bookId, setBookId] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const [openId, setOpenId] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);

  const titleOf = useMemo(() => new Map((bookRows ?? []).map((b) => [b.id!, b.title])), [bookRows]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = (rows ?? []).filter((w) => (lang === 'all' || w.language === lang) && (status === 'all' || w.status === status) && (bookId === 'all' || w.bookId === bookId));
    if (needle) r = r.filter((w) => w.lemma.toLowerCase().includes(needle) || w.meaning.toLowerCase().includes(needle) || w.reading.includes(needle));
    if (sort === 'recent') r = [...r].sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === 'alpha') r = [...r].sort((a, b) => a.lemma.localeCompare(b.lemma));
    else if (sort === 'hard') r = [...r].sort((a, b) => b.lapses - a.lapses || a.ease - b.ease || b.createdAt - a.createdAt);
    else r = [...r].sort((a, b) => a.due - b.due);
    return r;
  }, [rows, lang, status, bookId, q, sort]);

  const counts = useMemo(() => {
    const c = { learning: 0, known: 0 };
    (rows ?? []).forEach((w) => c[w.status]++);
    return c;
  }, [rows]);

  const dupGroups = useMemo(() => (dupOpen ? findDuplicateGroups(rows ?? []) : []), [dupOpen, rows]);
  const mergeOne = async (g: Word[]) => {
    const { keep, drop } = mergeGroup(g);
    await words.put(keep);
    for (const d of drop) {
      if (d.id !== undefined) await words.del(d.id);
      recordTomb('words', d.key);
    }
  };
  const mergeAll = async () => {
    if (!(await ui.confirm(`${dupGroups.length}묶음을 모두 합칠까요? 뜻은 이어 붙고, 복습 기록은 더 많이 복습한 쪽을 남겨요.`, { okLabel: '모두 합치기' }))) return;
    for (const g of dupGroups) await mergeOne(g);
    ui.toast('합쳤어요');
  };

  const exportCsv = async () => {
    const out = [['word', 'reading', 'meaning', 'context', 'note', 'language', 'status']].concat(
      list.map((w) => [w.lemma, w.reading, w.meaning, w.context, w.note, w.language, w.status])
    );
    await saveBlob(`vocab-${dateKey()}.csv`, new Blob(['﻿' + toCsv(out)], { type: 'text/csv' }), 'text/csv');
    setMenu(false);
  };
  const exportAnki = async () => {
    const lines = list.map((w) => {
      const front = w.reading ? `${w.lemma} [${w.reading}]` : w.lemma;
      const back = [w.meaning, w.context ? `<i>${w.context}</i>` : ''].filter(Boolean).join('<br>');
      return [front, back].map((x) => x.replace(/[\t\n\r]+/g, ' ')).join('\t');
    });
    await saveBlob(`anki-${dateKey()}.txt`, new Blob([lines.join('\n')], { type: 'text/plain' }), 'text/plain');
    ui.toast('Anki에서 “노트 가져오기”로 불러오세요 (탭 구분, HTML 허용)');
    setMenu(false);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>단어장</h1>
          <p className="muted">
            학습 중 {counts.learning} · 아는 단어 {counts.known}
          </p>
        </div>
        <div className="row-btns">
          <button className="icon-btn boxed" onClick={() => setAdding(true)} aria-label="단어 추가">
            <Icon name="plus" />
          </button>
          <button className="icon-btn boxed" onClick={() => setMenu(true)} aria-label="더 보기">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <LangPills value={lang} onChange={setLang} withAll />

      <div className="searchbar">
        <Icon name="search" size={18} />
        <input placeholder="단어나 뜻 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="toolbar">
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'learning', label: '학습 중' },
            { value: 'known', label: '아는 단어' },
            { value: 'all', label: '전체' },
          ]}
        />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
          <option value="recent">최근 저장순</option>
          <option value="alpha">가나다·ABC순</option>
          <option value="due">복습 임박순</option>
          <option value="hard">어려운 순(많이 틀린)</option>
        </select>
        {(bookRows?.length ?? 0) > 0 && (
          <select className="select" value={bookId} onChange={(e) => setBookId(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="책 필터">
            <option value="all">모든 책</option>
            {bookRows!.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title.replace(/\s*\(맛보기\)/, '')}
              </option>
            ))}
          </select>
        )}
      </div>

      {rows && list.length === 0 ? (
        <Empty icon="vocab" title={rows.length === 0 ? '단어장이 비어 있어요' : '조건에 맞는 단어가 없어요'}>
          {rows.length === 0 ? '책을 읽다가 모르는 단어를 탭하고 ‘단어장에 저장’을 눌러 보세요.' : '검색어나 필터를 바꿔 보세요.'}
        </Empty>
      ) : (
        <ul className="wlist">
          {list.slice(0, limit).map((w) => (
            <WordRow key={w.id} w={w} bookTitle={w.bookId !== undefined ? titleOf.get(w.bookId)?.replace(/\s*\(맛보기\)/, '') : undefined} open={openId === w.id} onToggle={() => setOpenId(openId === w.id ? null : w.id!)} />
          ))}
        </ul>
      )}
      {list.length > limit && (
        <button className="btn block" onClick={() => setLimit((n) => n + 60)}>
          더 보기 ({list.length - limit}개 남음)
        </button>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="단어장 관리">
        <div className="stack">
          <button className="btn block" onClick={() => { setMenu(false); setAdding(true); }}>
            <Icon name="plus" size={18} /> 단어 직접 추가 / CSV 가져오기
          </button>
          <button className="btn block" onClick={exportCsv} disabled={!list.length}>
            <Icon name="download" size={18} /> CSV로 내보내기 ({list.length}개)
          </button>
          <button className="btn block" onClick={exportAnki} disabled={!list.length}>
            <Icon name="download" size={18} /> Anki용 텍스트로 내보내기
          </button>
          <button className="btn block" onClick={() => { setMenu(false); setDupOpen(true); }}>
            <Icon name="refresh" size={18} /> 비슷한 단어 정리(중복 합치기)
          </button>
          <p className="muted small">내보내기는 지금 화면에 보이는 필터 결과를 기준으로 해요.</p>
        </div>
      </Sheet>
      <Sheet open={dupOpen} onClose={() => setDupOpen(false)} title="비슷한 단어 정리">
        <div className="stack">
          {dupGroups.length === 0 ? (
            <p className="muted">합칠 만한 비슷한 단어가 없어요.</p>
          ) : (
            <>
              <p className="muted small">악센트·대소문자만 다르거나, 한 단어의 변화형이 다른 단어와 같은 경우예요. 합치면 뜻과 변화형이 한 카드로 모여요.</p>
              {dupGroups.map((g) => (
                <div key={g.map((w) => w.key).join('|')} className="card" style={{ padding: 12 }}>
                  {g.map((w) => (
                    <div key={w.key} lang={w.language}>
                      <b>{w.lemma}</b> <span className="muted small">{w.meaning} · 복습 {w.reps}회</span>
                    </div>
                  ))}
                  <button className="btn small" style={{ marginTop: 8 }} onClick={() => mergeOne(g)}>
                    이 묶음 합치기
                  </button>
                </div>
              ))}
              <button className="btn primary block" onClick={mergeAll}>
                모두 합치기 ({dupGroups.length}묶음)
              </button>
            </>
          )}
        </div>
      </Sheet>
      <AddWords open={adding} onClose={() => setAdding(false)} defaultLang={lang === 'all' ? 'en' : lang} />
    </div>
  );
}

function AddWords({ open, onClose, defaultLang }: { open: boolean; onClose: () => void; defaultLang: LangCode }) {
  const ui = useUI();
  const [lang, setLang] = useState<LangCode>(defaultLang);
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [context, setContext] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const add = async () => {
    if (!word.trim() || !meaning.trim()) return ui.toast('단어와 뜻을 입력해 주세요');
    const r = await addImportedWords(lang, [{ word, reading, meaning, context, note: '' }]);
    ui.toast(r.added ? '추가했어요' : '이미 있는 단어예요');
    setWord('');
    setReading('');
    setMeaning('');
    setContext('');
  };

  const importFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        text = new TextDecoder('euc-kr').decode(buf); // 엑셀에서 저장한 한글 CSV
      }
      const list = rowsToWords(parseCsv(text));
      if (!list.length) return ui.toast('가져올 단어를 찾지 못했어요');
      const r = await addImportedWords(lang, list);
      ui.toast(`${r.added}개 추가${r.skipped ? `, ${r.skipped}개는 건너뜀` : ''}`);
      onClose();
    } catch (e) {
      ui.toast(errorMessage(e));
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="단어 추가">
      <div className="stack">
        <div>
          <div className="label">언어</div>
          <Segmented<LangCode> value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
        </div>
        <input className="input" placeholder="단어 (예: 学校)" value={word} onChange={(e) => setWord(e.target.value)} />
        <input className="input" placeholder="읽기 (선택, 예: がっこう)" value={reading} onChange={(e) => setReading(e.target.value)} />
        <input className="input" placeholder="뜻" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        <input className="input" placeholder="예문 (선택)" value={context} onChange={(e) => setContext(e.target.value)} />
        <button className="btn primary block" onClick={add}>
          <Icon name="plus" size={18} /> 추가
        </button>
        <hr />
        <input ref={file} type="file" hidden accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <button className="btn block" onClick={() => file.current?.click()}>
          <Icon name="upload" size={18} /> CSV 파일 가져오기 ({langInfo(lang).label}로)
        </button>
        <p className="muted small">머리글(word, meaning, reading, context)이 있으면 열 이름으로, 없으면 “단어, 뜻” 또는 “단어, 읽기, 뜻” 순서로 읽어요.</p>
      </div>
    </Sheet>
  );
}

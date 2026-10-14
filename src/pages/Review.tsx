import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { Empty, LangPills, Segmented, WordText } from '../components/ui';
import { words, useLive } from '../db';
import { makeCloze } from '../lib/cloze';
import { intervalLabel, schedule, type Grade } from '../lib/srs';
import { speak } from '../lib/tts';
import { dateKey, hash } from '../lib/util';
import { normalizeForm } from '../lib/tokenize';
import { navigate } from '../router';
import { useSettings } from '../settings';
import type { LangCode, Word } from '../types';

type Mode = 'recall' | 'cloze' | 'type' | 'choice' | 'listen' | 'mix';
type Eff = Exclude<Mode, 'mix'>;
const MODES: Mode[] = ['recall', 'cloze', 'type', 'choice', 'listen', 'mix'];
const MODE_HELP: Record<Mode, string> = {
  recall: '문장 속 단어를 보고 뜻을 떠올려요. 읽기 연습에 가장 가까워요.',
  cloze: '뜻을 힌트로 보고 문장의 빈칸 단어를 떠올려요. 쓰기·말하기 연습에 좋아요.',
  type: '뜻을 보고 단어를 직접 써 봐요. 철자까지 기억하고 싶을 때 좋아요.',
  choice: '단어를 보고 4개 중에서 뜻을 골라요. 가볍게 훑어볼 때 좋아요.',
  listen: '소리를 듣고 뜻을 떠올려요. 듣기 연습에 좋아요.',
  mix: '카드마다 방식을 섞어서 내요. 지루하지 않아요.',
};
const MODE_KEY = 'wts_review_mode';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function buildQueue(all: Word[], lang: LangCode | 'all', newLimit: number): { due: Word[]; fresh: Word[] } {
  const now = Date.now();
  const learning = all.filter((w) => w.status === 'learning' && (lang === 'all' || w.language === lang));
  const introducedToday = all.filter((w) => w.firstReviewedAt && w.firstReviewedAt >= startOfToday()).length;
  const due = learning.filter((w) => w.reps > 0 || w.lapses > 0 ? w.due <= now : false).sort((a, b) => a.due - b.due);
  const freshAll = learning.filter((w) => w.reps === 0 && w.lapses === 0 && !w.firstReviewedAt).sort((a, b) => a.createdAt - b.createdAt);
  const fresh = freshAll.slice(0, Math.max(0, newLimit - introducedToday));
  return { due, fresh };
}

export default function Review() {
  const [settings] = useSettings();
  const all = useLive(['words'], () => words.all(), []);
  const [lang, setLang] = useState<LangCode | 'all'>('all');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as Mode;
      return MODES.includes(m) ? m : 'recall';
    } catch {
      return 'recall';
    }
  });
  const [queue, setQueue] = useState<Word[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [total, setTotal] = useState(0);
  const sessionLang = useRef<LangCode | 'all'>('all');
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // 복습 중에는 하단 탭바가 버튼을 가리지 않도록 숨깁니다.
  const running = queue !== null;
  useEffect(() => {
    if (!running) return;
    document.body.classList.add('immersive');
    return () => document.body.classList.remove('immersive');
  }, [running]);

  const summary = useMemo(() => (all ? buildQueue(all, lang, settings.newPerDay) : null), [all, lang, settings.newPerDay]);

  const start = () => {
    if (!summary) return;
    const q = [...summary.due, ...summary.fresh];
    sessionLang.current = lang;
    setQueue(q);
    setTotal(q.length);
    setFlipped(false);
    setTyped('');
    setPicked(null);
    setDone({ again: 0, hard: 0, good: 0, easy: 0 });
  };

  const card = queue?.[0];

  const grade = async (g: Grade) => {
    if (!card) return;
    const now = Date.now();
    const next = schedule(card, g, now);
    const updated: Word = { ...card, ...next, lastReviewedAt: now, firstReviewedAt: card.firstReviewedAt ?? now, updatedAt: now };
    await words.put(updated);
    setDone((d) => ({ ...d, [g]: d[g] + 1 }));
    setQueue((q) => {
      if (!q) return q;
      const rest = q.slice(1);
      if (g === 'again') rest.splice(Math.min(rest.length, 4), 0, updated);
      return rest;
    });
    setFlipped(false);
    setTyped('');
    setPicked(null);
  };

  // 카드마다 실제로 쓸 방식 (섞기 모드이거나 재료가 모자라면 알맞게 바꿔요)
  const distractors = (c: Word): string[] => {
    const pool = (all ?? []).filter((w) => w.key !== c.key && w.meaning.trim() && w.meaning.trim() !== c.meaning.trim());
    const same = pool.filter((w) => w.language === c.language);
    const src = same.length >= 3 ? same : pool;
    const seen = new Set<string>();
    return src
      .sort((a, b) => (hash(c.key + a.key) < hash(c.key + b.key) ? -1 : 1))
      .map((w) => w.meaning.trim())
      .filter((m) => (seen.has(m) ? false : (seen.add(m), true)))
      .slice(0, 3);
  };
  const effMode = (c: Word): Eff => {
    const hasCloze = !!makeCloze(c.context, [c.surface, c.lemma, ...c.forms]);
    const hasChoice = !!c.meaning.trim() && distractors(c).length >= 3;
    const ok = (m: Eff) => (m === 'cloze' ? hasCloze : m === 'choice' ? hasChoice : m === 'type' ? !!c.meaning.trim() : true);
    let m: Eff;
    if (mode === 'mix') {
      const opts = (['recall', 'cloze', 'type', 'choice', 'listen'] as Eff[]).filter(ok);
      m = opts[parseInt(hash(c.key + c.reps).slice(0, 4), 36) % opts.length];
    } else m = mode;
    return ok(m) ? m : 'recall';
  };

  // 키보드: 스페이스로 뒤집기, 1~4로 평가 (외장 키보드용)
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped) {
        const g = ({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' } as Record<string, Grade>)[e.key];
        if (g) void grade(g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 듣기 카드는 나타날 때 자동으로 한 번 읽어 줍니다.
  const cardKey = card ? `${card.key}|${card.reps}|${card.lapses}` : '';
  useEffect(() => {
    if (card && !flipped && effMode(card) === 'listen') void speak(card.lemma, card.language, settings.ttsRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, mode]);

  // ---------- 진행 중 ----------
  if (queue && card) {
    const eff = effMode(card);
    const cloze = eff === 'cloze' || eff === 'type' ? makeCloze(card.context, [card.surface, card.lemma, ...card.forms]) : null;
    const useCloze = eff === 'cloze' && cloze;
    const options = eff === 'choice' ? [card.meaning.trim(), ...distractors(card)].sort((a, b) => (hash(card.key + a) < hash(card.key + b) ? -1 : 1)) : [];
    const typedOk = normalizeForm(typed) !== '' && [card.lemma, card.surface, ...card.forms].some((f) => normalizeForm(f) === normalizeForm(typed));
    const submitTyped = () => setFlipped(true);
    const doneCount = total - queue.length;
    const labels: [Grade, string][] = [
      ['again', '다시'],
      ['hard', '어려움'],
      ['good', '좋음'],
      ['easy', '쉬움'],
    ];
    return (
      <div className="page review-run">
        <header className="rv-top">
          <button className="icon-btn" onClick={() => setQueue(null)} aria-label="그만하기">
            <Icon name="x" />
          </button>
          <div className="bar grow">
            <i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
          </div>
          <span className="muted small">{queue.length}</span>
        </header>

        <div className="rv-card" onClick={() => !flipped && setFlipped(true)}>
          <div className="rv-lang">{card.language.toUpperCase()}</div>
          {useCloze ? (
            <>
              <p className="rv-sentence" lang={card.language}>
                {cloze.before}
                {flipped ? <mark>{cloze.answer}</mark> : <span className="blank">＿＿＿＿</span>}
                {cloze.after}
              </p>
              <p className="rv-hint">{card.meaning}</p>
            </>
          ) : eff === 'type' ? (
            <>
              {cloze && (
                <p className="rv-sentence" lang={card.language}>
                  {cloze.before}
                  {flipped ? <mark>{cloze.answer}</mark> : <span className="blank">＿＿＿＿</span>}
                  {cloze.after}
                </p>
              )}
              <p className="rv-hint">{card.meaning}</p>
              {!flipped && (
                <input
                  className="input rv-input"
                  lang={card.language}
                  autoFocus
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="단어를 써 보세요"
                  value={typed}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
                />
              )}
              {flipped && (
                <p className={typedOk ? 'rv-ok' : 'rv-no'}>{typed.trim() ? (typedOk ? '맞았어요! ' : '아쉬워요. ') + `내가 쓴 답: ${typed}` : '쓰지 않고 정답을 봤어요'}</p>
              )}
            </>
          ) : eff === 'choice' ? (
            <>
              <p className="rv-word" lang={card.language}>
                <WordText lemma={card.lemma} reading={flipped ? card.reading : ''} lang={card.language} />
              </p>
              <div className="rv-options" onClick={(e) => e.stopPropagation()}>
                {options.map((o) => (
                  <button
                    key={o}
                    className={`rv-opt ${flipped ? (o === card.meaning.trim() ? 'right' : o === picked ? 'wrong' : '') : ''}`}
                    disabled={flipped}
                    onClick={() => {
                      setPicked(o);
                      setFlipped(true);
                    }}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </>
          ) : eff === 'listen' ? (
            <button
              className="rv-listen"
              onClick={(e) => {
                e.stopPropagation();
                void speak(card.lemma, card.language, settings.ttsRate);
              }}
              aria-label="다시 듣기"
            >
              <Icon name="volume" size={44} />
              <span className="muted">눌러서 다시 듣기</span>
            </button>
          ) : card.context && makeCloze(card.context, [card.surface, card.lemma, ...card.forms]) ? (
            <p className="rv-sentence" lang={card.language}>
              {(() => {
                const c = makeCloze(card.context, [card.surface, card.lemma, ...card.forms])!;
                return (
                  <>
                    {c.before}
                    <mark>{c.answer}</mark>
                    {c.after}
                  </>
                );
              })()}
            </p>
          ) : (
            <p className="rv-word" lang={card.language}>
              <WordText lemma={card.lemma} reading={flipped ? card.reading : ''} lang={card.language} />
            </p>
          )}

          {flipped ? (
            <div className="rv-back">
              <div className="rv-answer" lang={card.language}>
                <WordText lemma={card.lemma} reading={card.reading} lang={card.language} />
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    speak(card.lemma, card.language, settings.ttsRate);
                  }}
                  aria-label="듣기"
                >
                  <Icon name="volume" />
                </button>
              </div>
              {card.koreanReading && settings.showKoreanReading && <div className="muted">{card.koreanReading}</div>}
              <div className="rv-meaning">{card.meaning || '뜻이 비어 있어요'}</div>
              {card.note && <div className="muted small">{card.note}</div>}
            </div>
          ) : (
            eff !== 'choice' && eff !== 'type' && <div className="rv-tap muted">{useCloze ? '탭해서 정답 보기' : '탭해서 뜻 보기'}</div>
          )}
        </div>

        {flipped ? (
          <div className="grades">
            {labels.map(([g, label], i) => (
              <button key={g} className={`grade ${g}`} onClick={() => grade(g)}>
                <b>{label}</b>
                <span>{intervalLabel(card, g)}</span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        ) : (
          <button className="btn primary block big" onClick={() => setFlipped(true)}>
            {eff === 'type' && typed.trim() ? '확인' : eff === 'choice' ? '모르겠어요' : '정답 보기'}
          </button>
        )}
      </div>
    );
  }

  // ---------- 끝났을 때 ----------
  if (queue && !card) {
    const n = done.again + done.hard + done.good + done.easy;
    return (
      <div className="page center-msg">
        <div className="empty-ic big">
          <Icon name="check" size={36} />
        </div>
        <h2>오늘 복습 끝!</h2>
        <p className="muted">
          {n}번 복습했어요 · 다시 {done.again} · 어려움 {done.hard} · 좋음 {done.good} · 쉬움 {done.easy}
        </p>
        <div className="row-btns">
          <button className="btn" onClick={() => setQueue(null)}>
            돌아가기
          </button>
          <button className="btn primary" onClick={() => navigate('')}>
            이어서 책 읽기
          </button>
        </div>
      </div>
    );
  }

  // ---------- 시작 화면 ----------
  const nDue = summary?.due.length ?? 0;
  const nNew = summary?.fresh.length ?? 0;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>복습</h1>
          <p className="muted">책에서 만난 문장으로 단어를 떠올려요</p>
        </div>
      </header>
      <LangPills value={lang} onChange={setLang} withAll />
      <section className="card review-summary">
        <div className="kpis">
          <div>
            <b>{nDue}</b>
            <span>복습할 단어</span>
          </div>
          <div>
            <b>{nNew}</b>
            <span>새 단어</span>
          </div>
          <div>
            <b>{settings.newPerDay}</b>
            <span>하루 새 단어 한도</span>
          </div>
        </div>
        <div>
          <div className="label">카드 방식</div>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'recall', label: '뜻 떠올리기' },
              { value: 'cloze', label: '빈칸 채우기' },
              { value: 'type', label: '직접 쓰기' },
              { value: 'choice', label: '4지선다' },
              { value: 'listen', label: '듣고 맞히기' },
              { value: 'mix', label: '섞어서' },
            ]}
          />
          <p className="muted small" style={{ marginTop: 8 }}>
            {MODE_HELP[mode]}
          </p>
        </div>
        <button className="btn primary block big" disabled={nDue + nNew === 0} onClick={start}>
          <Icon name="review" size={20} /> {nDue + nNew === 0 ? '오늘 할 복습이 없어요' : `${nDue + nNew}장 복습 시작`}
        </button>
      </section>
      {all && all.filter((w) => w.status === 'learning').length === 0 && (
        <Empty icon="review" title="복습할 단어가 아직 없어요">
          책을 읽다가 모르는 단어를 저장하면 여기에 쌓여요.
        </Empty>
      )}
      <p className="muted small center">오늘 날짜 {dateKey()}</p>
    </div>
  );
}

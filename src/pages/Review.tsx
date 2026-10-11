import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { Empty, LangPills, Segmented, WordText } from '../components/ui';
import { words, useLive } from '../db';
import { makeCloze } from '../lib/cloze';
import { intervalLabel, schedule, type Grade } from '../lib/srs';
import { speak } from '../lib/tts';
import { dateKey } from '../lib/util';
import { navigate } from '../router';
import { useSettings } from '../settings';
import type { LangCode, Word } from '../types';

type Mode = 'recall' | 'cloze';
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
      return (localStorage.getItem(MODE_KEY) as Mode) || 'recall';
    } catch {
      return 'recall';
    }
  });
  const [queue, setQueue] = useState<Word[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [total, setTotal] = useState(0);
  const sessionLang = useRef<LangCode | 'all'>('all');

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

  // ---------- 진행 중 ----------
  if (queue && card) {
    const cloze = mode === 'cloze' ? makeCloze(card.context, [card.surface, card.lemma, ...card.forms]) : null;
    const useCloze = mode === 'cloze' && cloze;
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
            <div className="rv-tap muted">{useCloze ? '탭해서 정답 보기' : '탭해서 뜻 보기'}</div>
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
            정답 보기
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
            ]}
          />
          <p className="muted small" style={{ marginTop: 8 }}>
            {mode === 'recall' ? '문장 속 단어를 보고 뜻을 떠올려요. 읽기 연습에 가장 가까워요.' : '뜻을 힌트로 보고 문장의 빈칸 단어를 떠올려요. 쓰기·말하기 연습에 좋아요.'}
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

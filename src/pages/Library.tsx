import { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import ImportDialog from '../components/ImportDialog';
import BookSheet from '../components/BookSheet';
import { BookCover, Empty, Segmented } from '../components/ui';
import { books, days, words, useLive } from '../db';
import { computeStreak, totalsByDate } from '../lib/stats';
import { dateKey, formatMinutes } from '../lib/util';
import { navigate } from '../router';
import { useSettings } from '../settings';
import { STATUS_LABEL, langInfo, type Book, type BookStatus } from '../types';

type Filter = BookStatus | 'all';

export default function Library() {
  const [settings] = useSettings();
  const rows = useLive(['books'], () => books.all(), []);
  const dayRows = useLive(['days'], () => days.all(), []);
  const wordRows = useLive(['words'], () => words.all(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const byDate = useMemo(() => totalsByDate(dayRows ?? []), [dayRows]);
  const today = byDate.get(dateKey())?.seconds ?? 0;
  const streak = useMemo(() => computeStreak(byDate), [byDate]);
  const due = (wordRows ?? []).filter((w) => w.status === 'learning' && w.due <= Date.now()).length;
  const startToday = new Date().setHours(0, 0, 0, 0);
  const savedToday = (wordRows ?? []).filter((w) => w.createdAt >= startToday).length;
  const reviewedToday = (wordRows ?? []).filter((w) => (w.lastReviewedAt ?? 0) >= startToday).length;
  const learningCount = (wordRows ?? []).filter((w) => w.status === 'learning').length;
  const goal = settings.dailyGoalMin * 60;
  const pct = Math.min(100, Math.round((today / goal) * 100));

  const list = useMemo(() => {
    const all = rows ?? [];
    const f = filter === 'all' ? all : all.filter((b) => b.status === filter);
    return [...f].sort((a, b) => (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt));
  }, [rows, filter]);

  const current: Book | undefined = useMemo(
    () => [...(rows ?? [])].filter((b) => b.status === 'reading').sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0],
    [rows]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0, wishlist: 0, reading: 0, finished: 0 };
    (rows ?? []).forEach((b) => c[b.status]++);
    return c;
  }, [rows]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>서재</h1>
          <p className="muted">이야기로 만나는 외국어</p>
        </div>
        <button className="btn primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={18} /> 책 추가
        </button>
      </header>

      <section className="today card">
        <div className="today-main">
          <div className="today-ring" style={{ ['--pct' as string]: `${pct}%` }}>
            <span>{pct}%</span>
          </div>
          <div className="grow">
            <div className="today-title">오늘 {formatMinutes(today)} 읽었어요</div>
            <div className="muted small">목표 {settings.dailyGoalMin}분</div>
          </div>
          <div className="streak" title="연속 독서일">
            <Icon name="flame" size={20} />
            <b>{streak}</b>일
          </div>
        </div>
        <div className="today-nums muted small">
          오늘 저장 <b>{savedToday}</b> · 복습 <b>{reviewedToday}</b> · 학습 중 <b>{learningCount}</b>개
        </div>
        {due > 0 && (
          <button className="due-bar" onClick={() => navigate('review')}>
            <Icon name="review" size={18} />
            <span>복습할 단어가 {due}개 있어요</span>
            <Icon name="right" size={18} />
          </button>
        )}
      </section>

      {current && (
        <section className="continue card" onClick={() => navigate(`read/${current.id}`)}>
          <BookCover book={current} className="sm" />
          <div className="grow">
            <div className="eyebrow">이어 읽기</div>
            <h3 className="clamp2">{current.title.replace(/\s*\(맛보기\)/, '')}</h3>
            <div className="bar">
              <i style={{ width: `${Math.round(current.progress * 100)}%` }} />
            </div>
            <div className="muted small">{Math.round(current.progress * 100)}% · {langInfo(current.language).label}</div>
          </div>
          <span className="go">
            <Icon name="right" size={22} />
          </span>
        </section>
      )}

      {(rows?.length ?? 0) > 0 && (
        <Segmented<Filter>
          className="filters"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `전체 ${counts.all}` },
            { value: 'reading', label: `${STATUS_LABEL.reading} ${counts.reading}` },
            { value: 'wishlist', label: `${STATUS_LABEL.wishlist} ${counts.wishlist}` },
            { value: 'finished', label: `${STATUS_LABEL.finished} ${counts.finished}` },
          ]}
        />
      )}

      {rows && rows.length === 0 && (
        <Empty icon="book" title="아직 책이 없어요">
          EPUB·TXT 파일을 올리거나 글을 붙여넣어 읽기 시작해 보세요. 처음이라면 ‘책 추가’에서 맛보기 책을 고를 수 있어요.
          <br />
          <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={18} /> 책 추가
          </button>
        </Empty>
      )}

      <div className="shelf">
        {list.map((b) => (
          <article key={b.id} className="book">
            <button className="book-open" onClick={() => navigate(`read/${b.id}`)} aria-label={`${b.title} 읽기`}>
              <BookCover book={b} />
              {b.status === 'finished' && <span className="done-badge"><Icon name="check" size={14} /></span>}
            </button>
            <div className="book-meta">
              <div className="book-title clamp2" lang={b.language}>{b.title.replace(/\s*\(맛보기\)/, '')}</div>
              <div className="muted small clamp1">{b.author || langInfo(b.language).label}</div>
              <div className="bar slim">
                <i style={{ width: `${Math.round(b.progress * 100)}%` }} />
              </div>
              <div className="book-foot">
                <span className="muted small">{b.status === 'finished' ? '완독' : `${Math.round(b.progress * 100)}%`}</span>
                <button className="icon-btn tiny" onClick={() => setEditId(b.id!)} aria-label="책 정보">
                  <Icon name="more" size={18} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <ImportDialog open={showAdd} onClose={() => setShowAdd(false)} />
      {editId !== null && <BookSheet bookId={editId} onClose={() => setEditId(null)} />}
    </div>
  );
}

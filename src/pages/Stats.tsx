import { useMemo } from 'react';
import Icon from '../components/Icon';
import { Empty } from '../components/ui';
import { books, days, words, useLive } from '../db';
import { computeStreak, totalsByDate } from '../lib/stats';
import { addDays, dateKey, formatMinutes } from '../lib/util';
import { useSettings } from '../settings';

export default function Stats() {
  const [settings] = useSettings();
  const dayRows = useLive(['days'], () => days.all(), []);
  const bookRows = useLive(['books'], () => books.all(), []);
  const wordRows = useLive(['words'], () => words.all(), []);

  const data = useMemo(() => {
    const byDate = totalsByDate(dayRows ?? []);
    const today = new Date();
    const series = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      const k = dateKey(d);
      return { key: k, day: d.getDate(), dow: '일월화수목금토'[d.getDay()], seconds: byDate.get(k)?.seconds ?? 0 };
    });
    const week = series.slice(7).reduce((n, s) => n + s.seconds, 0);
    const totalSec = (dayRows ?? []).reduce((n, r) => n + r.seconds, 0);
    const totalChars = (dayRows ?? []).reduce((n, r) => n + r.chars, 0);
    const perBook = new Map<number, number>();
    (dayRows ?? []).forEach((r) => perBook.set(r.bookId, (perBook.get(r.bookId) ?? 0) + r.seconds));
    return { byDate, series, week, totalSec, totalChars, perBook, streak: computeStreak(byDate), todaySec: byDate.get(dateKey(today))?.seconds ?? 0 };
  }, [dayRows]);

  const goal = settings.dailyGoalMin * 60;
  const max = Math.max(goal, ...data.series.map((s) => s.seconds), 1);
  const finished = (bookRows ?? []).filter((b) => b.status === 'finished').length;
  const learning = (wordRows ?? []).filter((w) => w.status === 'learning').length;
  const known = (wordRows ?? []).filter((w) => w.status === 'known').length;
  const mature = (wordRows ?? []).filter((w) => w.status === 'learning' && w.interval >= 21).length;
  const rank = [...data.perBook.entries()]
    .map(([id, sec]) => ({ book: (bookRows ?? []).find((b) => b.id === id), sec }))
    .filter((r) => r.book)
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 5);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>기록</h1>
          <p className="muted">꾸준히 읽은 만큼 쌓여요</p>
        </div>
      </header>

      <div className="kpi-grid">
        <div className="card kpi">
          <Icon name="flame" size={20} />
          <b>{data.streak}일</b>
          <span>연속 독서</span>
        </div>
        <div className="card kpi">
          <Icon name="clock" size={20} />
          <b>{formatMinutes(data.todaySec)}</b>
          <span>오늘 (목표 {settings.dailyGoalMin}분)</span>
        </div>
        <div className="card kpi">
          <Icon name="chart" size={20} />
          <b>{formatMinutes(data.week)}</b>
          <span>최근 7일</span>
        </div>
        <div className="card kpi">
          <Icon name="book" size={20} />
          <b>{finished}권</b>
          <span>완독</span>
        </div>
      </div>

      <section className="card">
        <h3>최근 14일</h3>
        {data.totalSec === 0 ? (
          <Empty icon="chart" title="아직 읽은 기록이 없어요">
            책을 열어 읽으면 시간이 자동으로 기록돼요. 화면을 보고 있고 스크롤·탭 같은 움직임이 있을 때만 세요.
          </Empty>
        ) : (
          <div className="chart" role="img" aria-label="최근 14일 독서 시간">
            <div className="plot">
              <div className="goal-line" style={{ bottom: `${(goal / max) * 100}%` }}>
                <span>목표 {settings.dailyGoalMin}분</span>
              </div>
              {data.series.map((s) => (
                <div key={s.key} className="bar-col">
                  <i className={s.seconds >= goal ? 'hit' : ''} style={{ height: `${Math.max(s.seconds ? 3 : 0, (s.seconds / max) * 100)}%` }} title={formatMinutes(s.seconds)} />
                </div>
              ))}
            </div>
            <div className="labels">
              {data.series.map((s, i) => (
                <small key={s.key} className={i === 13 ? 'today' : ''}>
                  {s.day}
                </small>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>단어</h3>
        <div className="kpis">
          <div>
            <b>{learning}</b>
            <span>학습 중</span>
          </div>
          <div>
            <b>{mature}</b>
            <span>오래 기억(21일+)</span>
          </div>
          <div>
            <b>{known}</b>
            <span>아는 단어</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>전체</h3>
        <div className="kpis">
          <div>
            <b>{formatMinutes(data.totalSec)}</b>
            <span>총 독서 시간</span>
          </div>
          <div>
            <b>{data.totalChars.toLocaleString()}</b>
            <span>읽은 글자 수</span>
          </div>
          <div>
            <b>{bookRows?.length ?? 0}</b>
            <span>서재의 책</span>
          </div>
        </div>
      </section>

      {rank.length > 0 && (
        <section className="card">
          <h3>많이 읽은 책</h3>
          <ol className="rank">
            {rank.map((r, i) => (
              <li key={r.book!.id}>
                <span className="rank-n">{i + 1}</span>
                <span className="grow clamp1">{r.book!.title.replace(/\s*\(맛보기\)/, '')}</span>
                <b>{formatMinutes(r.sec)}</b>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

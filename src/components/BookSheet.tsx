import { useEffect, useState } from 'react';
import { BookCover, Segmented, Sheet, Stars, useUI } from './ui';
import Icon from './Icon';
import { books, days, deleteBook, highlights, words, useLive } from '../db';
import { navigate } from '../router';
import { formatDate, formatMinutes } from '../lib/util';
import { STATUS_LABEL, langInfo, type BookStatus } from '../types';

export default function BookSheet({ bookId, onClose }: { bookId: number; onClose: () => void }) {
  const ui = useUI();
  const book = useLive(['books'], () => books.get(bookId), [bookId]);
  const hls = useLive(['highlights'], async () => (await highlights.where('bookId', bookId)).filter((h) => h.kind !== 'bookmark'), [bookId]);
  const dayRows = useLive(['days'], () => days.where('bookId', bookId), [bookId]);
  const wordRows = useLive(['words'], () => words.where('bookId', bookId), [bookId]);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author);
      setMemo(book.memo ?? '');
    }
    // 처음 로드될 때와 다른 책일 때만 폼을 채웁니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  if (!book) return null;
  const update = (patch: Partial<typeof book>) => books.put({ ...book, ...patch });
  const secs = (dayRows ?? []).reduce((n, d) => n + d.seconds, 0);

  const setStatus = (s: BookStatus) => {
    const patch: Partial<typeof book> = { status: s };
    if (s === 'reading' && !book.startedAt) patch.startedAt = Date.now();
    if (s === 'finished') patch.finishedAt = Date.now();
    void update(patch);
  };

  const remove = async () => {
    const ok = await ui.confirm(`"${book.title}"을(를) 서재에서 삭제할까요? 읽은 기록과 하이라이트도 함께 지워져요. 단어장의 단어는 남아요.`, {
      title: '책 삭제',
      okLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    await deleteBook(bookId);
    ui.toast('삭제했어요');
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="책 정보">
      <div className="stack">
        <div className="book-head">
          <BookCover book={book} className="sm" />
          <div className="grow">
            <input className="input title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && update({ title: title.trim() })} />
            <input className="input" placeholder="저자" value={author} onChange={(e) => setAuthor(e.target.value)} onBlur={() => update({ author: author.trim() })} />
            <div className="muted small">
              {langInfo(book.language).label} · {book.sectionCount}개 구간
            </div>
          </div>
        </div>

        <Segmented<BookStatus>
          value={book.status}
          onChange={setStatus}
          options={(['wishlist', 'reading', 'finished'] as BookStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />

        <div className="kpis">
          <div>
            <b>{Math.round(book.progress * 100)}%</b>
            <span>진행</span>
          </div>
          <div>
            <b>{formatMinutes(secs)}</b>
            <span>읽은 시간</span>
          </div>
          <div>
            <b>{wordRows?.filter((w) => w.status === 'learning').length ?? 0}</b>
            <span>저장한 단어</span>
          </div>
        </div>
        <div className="muted small">
          {book.startedAt ? `시작 ${formatDate(book.startedAt)}` : '아직 읽기 전'}
          {book.finishedAt && book.status === 'finished' ? ` · 완독 ${formatDate(book.finishedAt)}` : ''}
        </div>

        <div>
          <div className="label">평점</div>
          <Stars value={book.rating ?? 0} onChange={(v) => update({ rating: v })} />
        </div>

        <div>
          <div className="label">독서 메모</div>
          <textarea className="input" rows={3} placeholder="이 책에 대한 생각을 적어 보세요" value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => update({ memo })} />
        </div>

        <div>
          <div className="label">하이라이트 ({hls?.length ?? 0})</div>
          {hls && hls.length > 0 ? (
            <ul className="hl-list">
              {[...hls]
                .sort((a, b) => a.sectionIndex - b.sectionIndex || a.paraIndex - b.paraIndex)
                .map((h) => (
                  <li key={h.id}>
                    <button
                      className="hl-text"
                      onClick={() => {
                        onClose();
                        navigate(`read/${bookId}?s=${h.sectionIndex}&p=${h.paraIndex}`);
                      }}
                    >
                      <span lang={book.language}>{h.text}</span>
                      {h.note && <em>{h.note}</em>}
                    </button>
                    <button className="icon-btn" aria-label="하이라이트 삭제" onClick={() => h.id !== undefined && highlights.del(h.id)}>
                      <Icon name="trash" size={18} />
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="muted small">읽다가 단어를 탭한 뒤 ‘하이라이트’를 누르면 문장이 여기에 모여요.</p>
          )}
        </div>

        <button className="btn danger-ghost block" onClick={remove}>
          <Icon name="trash" size={18} /> 책 삭제
        </button>
      </div>
    </Sheet>
  );
}

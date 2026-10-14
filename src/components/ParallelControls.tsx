import { Toggle } from './ui';
import { LANGS, PAR_MAX, parLabel, type Book } from '../types';

/** 읽기 화면의 병렬 모드 설정: 칸(원문·한국어·다른 언어)을 고르고 순서를 정합니다. 책마다 기억돼요. */
export default function ParallelControls({ book, onChange }: { book: Book; onChange: (patch: Partial<Book>) => void }) {
  const list = book.par && book.par.length ? book.par : ['orig', 'ko'];
  const on = !!book.parOn;
  const set = (par: string[]) => onChange({ par });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    set(n);
  };
  const addable = ['ko', ...LANGS.map((l) => l.code)].filter((id) => id !== book.language && !list.includes(id));

  return (
    <div className="par-box">
      <Toggle
        checked={on}
        onChange={(v) => onChange({ parOn: v, par: list })}
        label="병렬 모드"
        hint="문단 옆 번역 버튼을 누르면 고른 언어를 한 번에 나란히 보여 줘요 (최대 4칸)"
      />
      {on && (
        <>
          <ol className="par-list">
            {list.map((id, i) => (
              <li key={id}>
                <span className="par-n">{i + 1}</span>
                <b>{parLabel(id, book.language)}</b>
                <span className="par-btns">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>
                  <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>
                  <button className="icon-btn" disabled={id === 'orig'} onClick={() => set(list.filter((x) => x !== id))} aria-label="빼기">✕</button>
                </span>
              </li>
            ))}
          </ol>
          {list.length < PAR_MAX ? (
            <div className="pills" style={{ flexWrap: 'wrap' }}>
              {addable.map((id) => (
                <button key={id} className="pill" onClick={() => set([...list, id])}>
                  + {parLabel(id, book.language)}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">4칸이 가득 찼어요. 다른 언어를 넣으려면 먼저 하나를 빼 주세요.</p>
          )}
        </>
      )}
    </div>
  );
}

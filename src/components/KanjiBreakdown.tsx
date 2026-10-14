import { useState } from 'react';
import { AiError, errorMessage, lookupKanji } from '../lib/gemini';
import { containsKanji } from '../lib/tokenize';
import type { KanjiInfo, LangCode } from '../types';

/** 단어 속 한자를 글자별로 풀어 보여 줍니다. 풀이는 단어장에 저장돼 다른 기기에서도 보여요. */
export default function KanjiBreakdown({
  lang,
  word,
  saved,
  onLoaded,
}: {
  lang: LangCode;
  word: string;
  saved?: KanjiInfo[];
  /** 새로 풀이를 받으면 호출 (저장용) */
  onLoaded?: (k: KanjiInfo[]) => void;
}) {
  const [fresh, setFresh] = useState<KanjiInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  if ((lang !== 'ja' && lang !== 'zh') || !containsKanji(word)) return null;
  const list = fresh ?? (saved && saved.length ? saved : null);

  const load = async (force = false) => {
    setLoading(true);
    setErr('');
    try {
      const k = await lookupKanji(lang, word, force);
      setFresh(k);
      onLoaded?.(k);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (!list) {
    return (
      <div className="kj">
        <button className="btn small" onClick={() => load()} disabled={loading}>
          {loading ? '풀이 중…' : '한자 풀이 (한국 한자음)'}
        </button>
        {err && <p className="muted small">{err}</p>}
      </div>
    );
  }
  return (
    <div className="kj">
      <div className="kj-grid">
        {list.map((k) => (
          <div key={k.ch} className="kj-card">
            <div className="kj-ch" lang={lang}>{k.ch}</div>
            <div className="kj-hun">{k.hun}</div>
            {k.reading && <div className="kj-rd muted small" lang={lang}>{k.reading}</div>}
            {k.words.length > 0 && (
              <div className="kj-words muted small" lang={lang}>
                {k.words.join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="btn small ghost" onClick={() => load(true)} disabled={loading}>
        {loading ? '다시 풀이 중…' : '다시 풀이'}
      </button>
      {err && <p className="muted small">{err}</p>}
    </div>
  );
}

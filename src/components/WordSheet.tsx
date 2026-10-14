import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import KanjiBreakdown from './KanjiBreakdown';
import { WordText, useUI } from './ui';
import { highlights, words as wordsTable, useLive } from '../db';
import { AiError, errorMessage, lookupWord, translateText } from '../lib/gemini';
import { extendRange, normalizeForm, sentenceSpans, spanAt, textOfRange, tokenize } from '../lib/tokenize';
import { saveWord } from '../lib/vocab';
import { speak } from '../lib/tts';
import { navigate } from '../router';
import type { Book, KanjiInfo, LangCode, LookupResult, TranslationResult, Word, WordStatus } from '../types';

interface Props {
  lang: LangCode;
  book: Book;
  sectionIndex: number;
  paraIndex: number;
  paragraph: string;
  a: number;
  b: number;
  forms: Map<string, Word>;
  ttsRate: number;
  showKorean: boolean;
  showRuby: boolean;
  onRange: (a: number, b: number) => void;
  onClose: () => void;
}

const toResult = (w: Word): LookupResult => ({
  lemma: w.lemma,
  reading: w.reading,
  koreanReading: w.koreanReading,
  pos: w.pos,
  meaning: w.meaning,
  otherMeanings: [],
  note: w.note,
});

export default function WordSheet(p: Props) {
  const { lang, book, paragraph, a, b, forms } = p;
  const ui = useUI();
  const tokens = useMemo(() => tokenize(paragraph, lang), [paragraph, lang]);
  const safeA = Math.min(a, tokens.length - 1);
  const safeB = Math.min(b, tokens.length - 1);
  const selected = textOfRange(paragraph, tokens, safeA, safeB);
  const spans = useMemo(() => sentenceSpans(paragraph, lang), [paragraph, lang]);
  const span = spanAt(spans, tokens[safeA].start);
  const sentence = paragraph.slice(span.start, span.end).trim();
  // 앞뒤 문장도 AI에게 보여 주면 문맥에 맞는 뜻을 더 잘 고릅니다.
  const spanIdx = spans.indexOf(span);
  const around = [spans[spanIdx - 1], spans[spanIdx + 1]]
    .map((s) => (s ? paragraph.slice(s.start, s.end).trim() : ''))
    .join(' … ')
    .slice(0, 400);
  const existing = forms.get(normalizeForm(selected));
  const existingRef = useRef<Word | undefined>(existing);
  existingRef.current = existing;

  const [res, setRes] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<AiError | null>(null);
  const [trans, setTrans] = useState<TranslationResult | null>(null);
  const [transLoading, setTransLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [note, setNote] = useState('');
  const [kanji, setKanji] = useState<KanjiInfo[] | null>(null);
  useEffect(() => setKanji(null), [selected]);

  const hasMeaning = !!existing?.meaning;
  useEffect(() => {
    let alive = true;
    setErr(null);
    setTrans(null);
    if (existingRef.current && existingRef.current.meaning) {
      setRes(toResult(existingRef.current));
      setLoading(false);
      return;
    }
    setRes(null);
    setLoading(true);
    lookupWord(lang, selected, sentence, retry > 0, around).then(
      async (r) => {
        if (!alive) return;
        setRes(r);
        setLoading(false);
        const ex = existingRef.current;
        if (ex && !ex.meaning) {
          await saveWord({ language: lang, book, selected, sentence, result: r, status: ex.status });
        }
      },
      (e) => {
        if (!alive) return;
        setErr(e instanceof AiError ? e : new AiError('bad', errorMessage(e)));
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sentence, hasMeaning, retry]);

  // 현재 문장의 하이라이트
  const hlRows = useLive(['highlights'], () => highlights.where('bookId', book.id!), [book.id]);
  const hl = hlRows?.find((h) => h.sectionIndex === p.sectionIndex && h.paraIndex === p.paraIndex && h.start === span.start);
  useEffect(() => setNote(hl?.note ?? ''), [hl?.id, hl?.note]);

  const canPrev = extendRange(tokens, safeA, safeB, "prev")[0] !== safeA;
  const canNext = extendRange(tokens, safeA, safeB, 'next')[1] !== safeB;

  const save = async (status: WordStatus) => {
    try {
      const saved = await saveWord({ language: lang, book, sectionIndex: p.sectionIndex, paraIndex: p.paraIndex, selected, sentence, result: res, status });
      if (kanji && !saved.kanji) await wordsTable.put({ ...saved, kanji, updatedAt: Date.now() });
      ui.toast(status === 'learning' ? '단어장에 저장했어요' : '아는 단어로 표시했어요');
    } catch (e) {
      ui.toast(errorMessage(e));
    }
  };
  const remove = async () => {
    if (existing?.id !== undefined) {
      await wordsTable.del(existing.id);
      ui.toast('단어장에서 뺐어요');
    }
  };

  const translate = async () => {
    setTransLoading(true);
    try {
      setTrans(await translateText(lang, sentence, 'sentence'));
    } catch (e) {
      ui.toast(errorMessage(e));
    } finally {
      setTransLoading(false);
    }
  };

  const toggleHighlight = async () => {
    if (hl?.id !== undefined) {
      await highlights.del(hl.id);
      return;
    }
    await highlights.put({
      bookId: book.id!,
      sectionIndex: p.sectionIndex,
      paraIndex: p.paraIndex,
      start: span.start,
      end: span.end,
      text: sentence,
      note: '',
      createdAt: Date.now(),
    });
    ui.toast('문장을 하이라이트했어요');
  };

  const saveNote = async () => {
    if (hl?.id !== undefined && note !== hl.note) await highlights.put({ ...hl, note });
  };

  const idx = sentence.indexOf(selected);
  const lemma = res?.lemma || selected;

  return (
    <div className="wsheet" role="dialog" aria-label="단어 정보">
      <div className="wsheet-grab" />
      <div className="wsheet-scroll">
        <div className="ws-top">
          <div className="ws-word" lang={lang}>
            <WordText lemma={lemma} reading={res?.reading} lang={lang} />
          </div>
          <button className="icon-btn" onClick={() => speak(selected, lang, p.ttsRate)} aria-label="단어 듣기">
            <Icon name="volume" />
          </button>
          <button className="icon-btn" onClick={p.onClose} aria-label="닫기">
            <Icon name="x" />
          </button>
        </div>

        {res && (
          <div className="chips">
            {(lang === 'ja' || lang === 'zh') && res.reading && <span className="chip">{res.reading}</span>}
            {p.showKorean && res.koreanReading && <span className="chip">{res.koreanReading}</span>}
            {res.pos && <span className="chip muted">{res.pos}</span>}
            {existing && <span className={`chip ${existing.status === 'known' ? 'good' : 'accent'}`}>{existing.status === 'known' ? '아는 단어' : '학습 중'}</span>}
          </div>
        )}

        {loading && (
          <div className="skeleton" aria-label="찾는 중">
            <i style={{ width: '55%' }} />
            <i style={{ width: '80%' }} />
          </div>
        )}
        {err && (
          <div className="ws-err">
            <p>{err.message}</p>
            <div className="row-btns">
              {err.code === 'nokey' || err.code === 'auth' ? (
                <button className="btn small primary" onClick={() => navigate('settings')}>
                  설정 열기
                </button>
              ) : (
                <button className="btn small" onClick={() => setRetry((n) => n + 1)}>
                  다시 시도
                </button>
              )}
              {!existing && (
                <button className="btn small" onClick={() => save('known')}>
                  뜻 없이 ‘아는 단어’로
                </button>
              )}
            </div>
          </div>
        )}
        {res && (
          <div className="ws-meaning">
            <div className="ws-main">{res.meaning}</div>
            {res.otherMeanings.length > 0 && <div className="ws-other">{res.otherMeanings.join(' · ')}</div>}
            {res.note && <div className="ws-note">{res.note}</div>}
          </div>
        )}

        {res && (
          <KanjiBreakdown
            key={res.lemma}
            lang={lang}
            word={res.lemma || selected}
            saved={existing?.kanji ?? kanji ?? undefined}
            onLoaded={(k) => {
              setKanji(k);
              const ex = existingRef.current;
              if (ex) void wordsTable.put({ ...ex, kanji: k, updatedAt: Date.now() });
            }}
          />
        )}

        <div className="ws-range">
          <button className="btn small ghost" disabled={!canPrev} onClick={() => p.onRange(...extendRange(tokens, safeA, safeB, 'prev'))}>
            <Icon name="left" size={16} /> 앞 단어 포함
          </button>
          <button className="btn small ghost" disabled={!canNext} onClick={() => p.onRange(...extendRange(tokens, safeA, safeB, 'next'))}>
            뒤 단어 포함 <Icon name="right" size={16} />
          </button>
        </div>

        <div className="ws-sentence" lang={lang}>
          {idx >= 0 ? (
            <>
              {sentence.slice(0, idx)}
              <mark>{selected}</mark>
              {sentence.slice(idx + selected.length)}
            </>
          ) : (
            sentence
          )}
        </div>
        <div className="row-btns">
          <button className="btn small" onClick={translate} disabled={transLoading}>
            <Icon name="translate" size={16} /> {transLoading ? '번역 중…' : '문장 번역'}
          </button>
          <button className="btn small" onClick={() => speak(sentence, lang, p.ttsRate)}>
            <Icon name="volume" size={16} /> 문장 듣기
          </button>
          <button className={`btn small ${hl ? 'accent' : ''}`} onClick={toggleHighlight}>
            <Icon name="pen" size={16} /> {hl ? '하이라이트 해제' : '하이라이트'}
          </button>
        </div>
        {trans && (
          <div className="ws-trans">
            <p>{trans.translation}</p>
            {trans.grammar.length > 0 && (
              <ul>
                {trans.grammar.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {hl && (
          <textarea
            className="input memo"
            rows={2}
            placeholder="이 문장에 메모 남기기"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
          />
        )}
      </div>

      <div className="ws-actions">
        {!existing ? (
          <>
            <button className="btn primary grow" onClick={() => save('learning')} disabled={loading}>
              <Icon name="plus" size={18} /> 단어장에 저장
            </button>
            <button className="btn grow" onClick={() => save('known')}>
              <Icon name="check" size={18} /> 이미 알아요
            </button>
          </>
        ) : (
          <>
            {existing.status === 'known' ? (
              <button className="btn primary grow" onClick={() => save('learning')}>
                학습 중으로 바꾸기
              </button>
            ) : (
              <button className="btn grow" onClick={() => save('known')}>
                <Icon name="check" size={18} /> 이제 알아요
              </button>
            )}
            <button className="btn danger-ghost" onClick={remove} aria-label="단어장에서 빼기">
              <Icon name="trash" size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { Segmented, Sheet, useUI } from './ui';
import Icon from './Icon';
import { createBook } from '../lib/library';
import { guessLanguage, parseEpub, parseTxt, parseTxtBuffer, buildSections, totalChars, type ParsedBook } from '../lib/importers';
import { SAMPLES } from '../lib/samples';
import { errorMessage } from '../lib/gemini';
import { LANGS, type LangCode } from '../types';

type Mode = 'file' | 'paste';
type Source = { kind: 'epub' | 'txt'; buf: ArrayBuffer; name: string } | null;

export default function ImportDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: number) => void }) {
  const ui = useUI();
  const [mode, setMode] = useState<Mode>('file');
  const [source, setSource] = useState<Source>(null);
  const [parsed, setParsed] = useState<ParsedBook | null>(null);
  const [lang, setLang] = useState<LangCode>('en');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setSource(null);
    setParsed(null);
    setTitle('');
    setAuthor('');
    setPasteText('');
    setErr('');
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const loadFile = async (file: File) => {
    setBusy(true);
    setErr('');
    try {
      const buf = await file.arrayBuffer();
      const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
      if (isEpub) {
        const p = await parseEpub(buf);
        const sample = p.chapters[0]?.paragraphs.slice(0, 3).join(' ') ?? '';
        const l = p.language ?? guessLanguage(sample);
        setSource({ kind: 'epub', buf, name: file.name });
        setParsed(p);
        setLang(l);
        setTitle(p.title || file.name.replace(/\.[^.]+$/, ''));
        setAuthor(p.author);
      } else {
        const p = parseTxtBuffer(buf, 'auto', file.name);
        setSource({ kind: 'txt', buf, name: file.name });
        setParsed(p);
        setLang(p.language);
        setTitle(p.title);
        setAuthor(p.author);
      }
    } catch (e) {
      setErr(errorMessage(e));
      setParsed(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changeLang = (l: LangCode) => {
    setLang(l);
    // TXT는 언어에 따라 줄 합치기/표기 정리가 달라서 다시 해석합니다.
    if (source?.kind === 'txt') {
      try {
        const p = parseTxtBuffer(source.buf, l, source.name);
        setParsed(p);
      } catch (e) {
        setErr(errorMessage(e));
      }
    }
  };

  const preview = (() => {
    try {
      if (mode === 'paste' && pasteText.trim()) return parseTxt(pasteText, lang);
      if (mode === 'file') return parsed;
    } catch {
      /* ignore */
    }
    return null;
  })();
  const stats = preview ? (() => {
    const secs = buildSections(preview.chapters, lang);
    return { sections: secs.length, chars: totalChars(secs) };
  })() : null;

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const id = await createBook({
        title: title || preview.title,
        author,
        language: lang,
        chapters: preview.chapters,
        coverBlob: mode === 'file' ? parsed?.coverBlob : undefined,
      });
      ui.toast('서재에 추가했어요');
      close();
      onCreated?.(id);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  const addSample = async (i: number) => {
    setBusy(true);
    try {
      const s = SAMPLES[i];
      const id = await createBook({ title: s.title, author: s.author, language: s.language, chapters: s.chapters, sample: true });
      ui.toast('맛보기 책을 추가했어요');
      close();
      onCreated?.(id);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="책 추가"
      footer={
        preview ? (
          <button className="btn primary block" disabled={busy || !stats?.chars} onClick={submit}>
            <Icon name="plus" size={18} /> {busy ? '추가하는 중…' : '서재에 추가'}
          </button>
        ) : undefined
      }
    >
      <div className="stack">
        <Segmented<Mode>
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErr('');
          }}
          options={[
            { value: 'file', label: 'EPUB·TXT 파일' },
            { value: 'paste', label: '붙여넣기' },
          ]}
        />

        {mode === 'file' && (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".epub,.txt,.text,application/epub+zip,text/plain"
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            />
            <button className="drop" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="upload" size={26} />
              <b>{busy ? '파일을 읽는 중…' : source ? source.name : '파일 선택하기'}</b>
              <span>EPUB 또는 TXT · 파일은 이 기기 안에만 저장돼요</span>
            </button>
          </>
        )}

        {mode === 'paste' && (
          <textarea
            className="input"
            rows={7}
            placeholder="읽고 싶은 글을 여기에 붙여넣으세요"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
              if (e.target.value.length > 40 && !title) setLang(guessLanguage(e.target.value));
            }}
          />
        )}

        {err && <p className="error-text">{err}</p>}

        {(preview || mode === 'paste') && (
          <div className="stack">
            <div>
              <div className="label">언어</div>
              <Segmented<LangCode> value={lang} onChange={changeLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
            </div>
            <div>
              <div className="label">제목</div>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="책 제목" />
            </div>
            <div>
              <div className="label">저자 (선택)</div>
              <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="저자" />
            </div>
            {stats && (
              <p className="muted small">
                {stats.sections}개 구간 · 약 {stats.chars.toLocaleString()}자
              </p>
            )}
          </div>
        )}

        {!preview && (
          <div className="samples">
            <div className="label">처음이라면 맛보기 책으로 시험해 보세요 (저작권이 풀린 첫 대목)</div>
            <div className="row-btns">
              {SAMPLES.map((s, i) => (
                <button key={s.title} className="btn small" disabled={busy} onClick={() => addSample(i)}>
                  <Icon name="sparkles" size={16} /> {LANGS.find((l) => l.code === s.language)?.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

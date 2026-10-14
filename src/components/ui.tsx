import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { langInfo, LANGS, type Book, type LangCode } from '../types';
import { containsKanji } from '../lib/tokenize';
import { hash } from '../lib/util';

// ---------------------------------------------------------------------------
// 토스트 + 확인창
// ---------------------------------------------------------------------------
interface ConfirmOpts {
  title?: string;
  okLabel?: string;
  danger?: boolean;
}
interface UICtx {
  toast: (msg: string) => void;
  confirm: (msg: string, opts?: ConfirmOpts) => Promise<boolean>;
}
const Ctx = createContext<UICtx>({ toast: () => {}, confirm: async () => false });
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [dlg, setDlg] = useState<{ msg: string; opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const confirm = useCallback(
    (msg: string, opts: ConfirmOpts = {}) => new Promise<boolean>((resolve) => setDlg({ msg, opts, resolve })),
    []
  );
  const close = (v: boolean) => {
    dlg?.resolve(v);
    setDlg(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
      {dlg && (
        <div className="modal-back center" onClick={() => close(false)}>
          <div className="dialog" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            {dlg.opts.title && <h3>{dlg.opts.title}</h3>}
            <p>{dlg.msg}</p>
            <div className="dialog-actions">
              <button className="btn" onClick={() => close(false)}>
                취소
              </button>
              <button className={`btn ${dlg.opts.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>
                {dlg.opts.okLabel ?? '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------------------
// 시트(모달)
// ---------------------------------------------------------------------------
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 작은 부품들
// ---------------------------------------------------------------------------
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function BookCover({ book, className = '' }: { book: Pick<Book, 'title' | 'cover' | 'language' | 'author'>; className?: string }) {
  if (book.cover) return <img className={`cover ${className}`} src={book.cover} alt="" />;
  const h = parseInt(hash(book.title).slice(0, 4), 36) % 360;
  return (
    <div
      className={`cover gen ${className}`}
      style={{ background: `linear-gradient(150deg, hsl(${h} 42% 40%), hsl(${(h + 40) % 360} 48% 26%))` }}
    >
      <span className="cover-lang">{langInfo(book.language).short}</span>
      <span className="cover-title" lang={book.language}>
        {book.title.replace(/\s*\(맛보기\)/, '')}
      </span>
      {book.author && <span className="cover-author">{book.author}</span>}
    </div>
  );
}

/** 단어 표기. 일본어 한자에는 읽는 법을 위에 얹어 보여줍니다. */
export function WordText({ lemma, reading, lang, ruby = true }: { lemma: string; reading?: string; lang: LangCode; ruby?: boolean }) {
  if (lang === 'ja' && ruby && reading && containsKanji(lemma) && reading !== lemma) {
    return (
      <ruby>
        {lemma}
        <rt>{reading}</rt>
      </ruby>
    );
  }
  return <>{lemma}</>;
}

export function Empty({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LangPills({ value, onChange, withAll = false }: { value: LangCode | 'all'; onChange: (v: LangCode | 'all') => void; withAll?: boolean }) {
  const opts: { value: LangCode | 'all'; label: string }[] = [
    ...(withAll ? [{ value: 'all' as const, label: '전체' }] : []),
    ...LANGS.map((l) => ({ value: l.code as LangCode | 'all', label: l.label })),
  ];
  return (
    <div className="pills">
      {opts.map((o) => (
        <button key={o.value} className={`pill ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="row toggle-row">
      <span className="grow">
        <span className="row-title">{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="knob" />
      </span>
    </label>
  );
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="평점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'on' : ''}
          onClick={() => onChange?.(n === value ? 0 : n)}
          disabled={!onChange}
          aria-label={`${n}점`}
        >
          <Icon name="star" size={22} fill={n <= value} />
        </button>
      ))}
    </div>
  );
}

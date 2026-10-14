import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import DisplayControls from '../components/DisplayControls';
import { useUI } from '../components/ui';
import { wipeAll } from '../db';
import { exportBackup, importBackup } from '../lib/backup';
import { errorMessage, testConnection } from '../lib/gemini';
import { ttsSupported, speak } from '../lib/tts';
import { useSettings } from '../settings';
import { signInWithEmail, signInWithGoogle, signOutSync, syncErrorMessage, syncNow, useSync } from '../lib/sync/sync';

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export default function Settings() {
  const ui = useUI();
  const [s, set] = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const doSignIn = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ui.toast(syncErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshStorage = async () => {
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
      const est = await navigator.storage?.estimate?.();
      if (est?.usage !== undefined) setUsage(formatBytes(est.usage));
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    void refreshStorage();
  }, []);

  const test = async () => {
    setTesting(true);
    try {
      await testConnection();
      ui.toast('연결 성공! 이제 단어를 찾을 수 있어요');
    } catch (e) {
      ui.toast(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const askPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      ui.toast(ok ? '이 기기에 데이터를 보존하도록 요청했어요' : '브라우저가 아직 허락하지 않았어요. 홈 화면에 추가해서 쓰면 더 안전해요');
    } catch {
      ui.toast('이 브라우저는 지원하지 않아요');
    }
    void refreshStorage();
  };

  const doBackup = async () => {
    try {
      const r = await exportBackup();
      ui.toast(`책 ${r.books}권, 단어 ${r.words}개를 백업했어요`);
    } catch (e) {
      ui.toast(errorMessage(e));
    }
  };

  const doRestore = async (f: File) => {
    const ok = await ui.confirm('백업 파일로 복원하면 지금 이 기기의 책·단어·기록이 모두 백업 내용으로 바뀌어요. 계속할까요?', {
      title: '백업 복원',
      okLabel: '복원',
      danger: true,
    });
    if (!ok) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const r = await importBackup(f);
      ui.toast(`복원했어요: 책 ${r.books}권, 단어 ${r.words}개`);
    } catch (e) {
      ui.toast(errorMessage(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const wipe = async () => {
    const ok = await ui.confirm('책, 단어장, 읽기 기록을 모두 지워요. 되돌릴 수 없으니 먼저 백업을 권해요.', { title: '모든 데이터 삭제', okLabel: '모두 삭제', danger: true });
    if (ok) {
      await wipeAll();
      ui.toast('모두 지웠어요');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>설정</h1>
          <p className="muted">내 기기에만 저장돼요</p>
        </div>
      </header>

      <section className="card stack">
        <h3>AI 연결 (Gemini)</h3>
        <p className="muted small">
          단어 뜻과 번역에 Gemini를 써요. <b>Google AI Studio</b>(aistudio.google.com)에서 무료 키를 만들어 붙여넣으세요. 키는 이 기기에만 저장되고 Google 서버로만 전송돼요. 앱 코드나 GitHub에는 들어가지 않아요.
        </p>
        <div className="field">
          <div className="label">API 키</div>
          <div className="input-row">
            <input
              className="input"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="AIza..."
              value={s.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            <button className="icon-btn boxed" onClick={() => setShowKey((v) => !v)} aria-label="키 보기">
              <Icon name="eye" />
            </button>
          </div>
        </div>
        <div className="field">
          <div className="label">모델</div>
          <input className="input" list="models" value={s.model} onChange={(e) => set({ model: e.target.value.trim() })} />
          <datalist id="models">
            <option value="gemini-3-flash-preview" />
            <option value="gemini-2.5-flash" />
            <option value="gemini-2.5-flash-lite" />
            <option value="gemini-2.5-pro" />
          </datalist>
        </div>
        <button className="btn block" onClick={test} disabled={testing || !s.apiKey.trim()}>
          <Icon name="refresh" size={18} /> {testing ? '확인하는 중…' : '연결 테스트'}
        </button>
      </section>

      <section className="card stack">
        <h3>기기 간 동기화</h3>
        <p className="muted small">
          로그인하면 PC·아이폰·아이패드의 <b>단어장</b>이 같아져요. 책 본문과 API 키는 기기마다 따로 두는 값이라 동기화하지 않아요.
        </p>
        {sync.user ? (
          <>
            <p>
              <b>{sync.user.email || '로그인됨'}</b>
              <br />
              <span className="muted small">
                {sync.status === 'syncing' ? '동기화하는 중…' : sync.lastSyncAt ? `마지막 동기화 ${new Date(sync.lastSyncAt).toLocaleString('ko-KR')}` : '아직 동기화 전이에요'}
              </span>
            </p>
            {sync.result && (
              <p className="muted small">
                이 기기 단어 {sync.result.local}개 · 서버로 올림 {sync.result.pushed}개 · 서버에서 받음 {sync.result.pulled}개
                {sync.result.removed ? ` · 삭제 반영 ${sync.result.removed}개` : ''}
              </p>
            )}
            {sync.error && <p className="ws-err">{sync.error}</p>}
            <div className="row-btns">
              <button className="btn" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
                <Icon name="refresh" size={18} /> 지금 동기화
              </button>
              <button className="btn" onClick={() => doSignIn(signOutSync)}>
                로그아웃
              </button>
            </div>
          </>
        ) : (
          <>
            <button className="btn block" onClick={() => doSignIn(signInWithGoogle)} disabled={busy}>
              Google로 로그인
            </button>
            <p className="muted small">Google 로그인이 안 되면(특히 홈 화면 앱) 아래 이메일로 로그인해 보세요.</p>
            <input className="input" type="email" autoComplete="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" type="password" autoComplete="current-password" placeholder="비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <div className="row-btns">
              <button className="btn" onClick={() => doSignIn(() => signInWithEmail(email, pw, false))} disabled={busy || !email || !pw}>
                로그인
              </button>
              <button className="btn" onClick={() => doSignIn(() => signInWithEmail(email, pw, true))} disabled={busy || !email || !pw}>
                처음이라면 가입
              </button>
            </div>
            {sync.error && <p className="ws-err">{sync.error}</p>}
          </>
        )}
      </section>

      <section className="card stack">
        <h3>읽기 화면</h3>
        <DisplayControls />
      </section>

      <section className="card stack">
        <h3>학습</h3>
        <div className="field">
          <div className="label">
            음성 속도 <b>{s.ttsRate.toFixed(2)}×</b>
          </div>
          <input className="range" type="range" min={0.5} max={1.3} step={0.05} value={s.ttsRate} onChange={(e) => set({ ttsRate: +e.target.value })} />
          {ttsSupported() && (
            <div className="row-btns" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => speak('Hello, nice to meet you.', 'en', s.ttsRate)}>
                <Icon name="volume" size={16} /> 영어
              </button>
              <button className="btn small" onClick={() => speak('こんにちは、はじめまして。', 'ja', s.ttsRate)}>
                <Icon name="volume" size={16} /> 일본어
              </button>
              <button className="btn small" onClick={() => speak('Hola, mucho gusto.', 'es', s.ttsRate)}>
                <Icon name="volume" size={16} /> 스페인어
              </button>
            </div>
          )}
        </div>
        <div className="grid2">
          <div className="field">
            <div className="label">하루 독서 목표</div>
            <select className="select full" value={s.dailyGoalMin} onChange={(e) => set({ dailyGoalMin: +e.target.value })}>
              {[10, 15, 20, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m}분
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <div className="label">하루 새 단어 복습</div>
            <select className="select full" value={s.newPerDay} onChange={(e) => set({ newPerDay: +e.target.value })}>
              {[5, 10, 15, 20, 30, 50].map((m) => (
                <option key={m} value={m}>
                  {m}개
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h3>데이터</h3>
        <p className="muted small">
          책과 단어는 이 기기의 브라우저 저장소에 있어요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에는 꼭 백업하세요.
          {usage && ` (현재 사용량 ${usage})`}
        </p>
        <button className="btn block" onClick={doBackup}>
          <Icon name="download" size={18} /> 백업 파일 내보내기
        </button>
        <input ref={fileRef} type="file" hidden accept=".json,application/json" onChange={(e) => e.target.files?.[0] && doRestore(e.target.files[0])} />
        <button className="btn block" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> 백업에서 복원
        </button>
        <button className="btn block" onClick={askPersist} disabled={persisted === true}>
          <Icon name="check" size={18} /> {persisted ? '데이터 보존이 허용됨' : '브라우저가 데이터를 지우지 않도록 요청'}
        </button>
        <button className="btn danger-ghost block" onClick={wipe}>
          <Icon name="trash" size={18} /> 모든 데이터 삭제
        </button>
      </section>

      <section className="card stack">
        <h3>아이폰·아이패드에 설치</h3>
        <ol className="steps">
          <li>Safari로 이 주소를 열어요.</li>
          <li>공유 버튼 → <b>홈 화면에 추가</b>를 눌러요.</li>
          <li>홈 화면의 아이콘으로 열면 앱처럼 전체 화면으로 써요. 책은 오프라인에서도 읽을 수 있어요.</li>
          <li>기기마다 API 키를 한 번씩 입력하고, 기기 간 이동은 백업 파일로 해요.</li>
        </ol>
      </section>
    </div>
  );
}

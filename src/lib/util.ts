/** 기기 로컬 날짜 YYYY-MM-DD */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** 짧은 해시(캐시 키용) */
export function hash(s: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

export function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function relativeDue(due: number, now = Date.now()): string {
  const diff = due - now;
  if (diff <= 0) return '지금';
  const day = 86400000;
  if (diff < day) return '오늘';
  const d = Math.round(diff / day);
  if (d < 30) return `${d}일 후`;
  return `${Math.round(d / 30)}개월 후`;
}

export async function saveBlob(name: string, blob: Blob, mime: string) {
  const file = new File([blob], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // iPhone/iPad에서는 공유 시트로 "파일에 저장"을 고를 수 있어 가장 확실합니다.
  if (nav.canShare && nav.canShare({ files: [file] }) && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

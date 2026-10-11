import { useSyncExternalStore } from 'react';

export type ThemeSetting = 'auto' | 'paper' | 'sepia' | 'dark';

export interface Settings {
  apiKey: string;
  model: string;
  theme: ThemeSetting;
  fontFamily: 'serif' | 'sans';
  fontSize: number; // px
  lineHeight: number; // 배수
  ttsRate: number;
  showRuby: boolean;
  showKoreanReading: boolean;
  dailyGoalMin: number;
  newPerDay: number;
}

export const DEFAULTS: Settings = {
  apiKey: '',
  model: 'gemini-2.5-flash',
  theme: 'auto',
  fontFamily: 'serif',
  fontSize: 20,
  lineHeight: 1.85,
  ttsRate: 0.9,
  showRuby: true,
  showKoreanReading: true,
  dailyGoalMin: 20,
  newPerDay: 15,
};

const KEY = 'wts_settings_v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* 저장소 접근이 막힌 환경에서는 기본값으로 동작 */
  }
  return { ...DEFAULTS };
}

let state: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
  return [s, updateSettings];
}

/** 'auto'를 실제 테마로 풀어서 <html data-theme>에 적용 */
export function applyTheme() {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const t = state.theme === 'auto' ? (prefersDark ? 'dark' : 'paper') : state.theme;
  document.documentElement.dataset.theme = t;
  const colors: Record<string, string> = { paper: '#f6f3ec', sepia: '#efe4cc', dark: '#121214' };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[t]);
}

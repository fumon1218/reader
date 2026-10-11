export type LangCode = 'en' | 'ja' | 'es';

export interface LangInfo {
  code: LangCode;
  label: string;
  english: string;
  tts: string;
  short: string;
}

export const LANGS: LangInfo[] = [
  { code: 'en', label: '영어', english: 'English', tts: 'en-US', short: 'EN' },
  { code: 'ja', label: '일본어', english: 'Japanese', tts: 'ja-JP', short: 'JA' },
  { code: 'es', label: '스페인어', english: 'Spanish', tts: 'es-ES', short: 'ES' },
];

export const langInfo = (c: LangCode): LangInfo => LANGS.find((l) => l.code === c) ?? LANGS[0];

export type BookStatus = 'wishlist' | 'reading' | 'finished';

export const STATUS_LABEL: Record<BookStatus, string> = {
  wishlist: '읽고 싶은',
  reading: '읽는 중',
  finished: '완독',
};

export interface Book {
  id?: number;
  title: string;
  author: string;
  language: LangCode;
  status: BookStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastReadAt?: number;
  /** 마지막으로 읽던 구간(섹션)과 문단 */
  sectionIndex: number;
  paraIndex: number;
  /** 0~1 */
  progress: number;
  totalChars: number;
  sectionCount: number;
  rating?: number;
  memo?: string;
  /** data URL (작게 줄인 표지) */
  cover?: string;
  sample?: boolean;
}

export interface Section {
  id?: number;
  bookId: number;
  index: number;
  title: string;
  paragraphs: string[];
  /** 이 구간 앞까지의 누적 글자 수 */
  startChars: number;
  chars: number;
}

export type WordStatus = 'learning' | 'known';

export interface Word {
  id?: number;
  /** `${language}:${lemma 소문자}` — 고유 */
  key: string;
  language: LangCode;
  bookId?: number;
  lemma: string;
  /** 책에서 처음 만난 모습 */
  surface: string;
  /** 본문에서 하이라이트에 쓰는 형태들(정규화됨) */
  forms: string[];
  /** 일본어 히라가나 읽기 등 */
  reading: string;
  koreanReading: string;
  pos: string;
  meaning: string;
  note: string;
  context: string;
  contextTranslation?: string;
  sectionIndex?: number;
  paraIndex?: number;
  status: WordStatus;
  createdAt: number;
  updatedAt: number;
  // 간격 반복
  due: number;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  firstReviewedAt?: number;
  lastReviewedAt?: number;
}

export interface Highlight {
  id?: number;
  bookId: number;
  sectionIndex: number;
  paraIndex: number;
  start: number;
  end: number;
  text: string;
  note: string;
  createdAt: number;
}

export interface DayStat {
  /** `${date}|${bookId}` */
  key: string;
  date: string;
  bookId: number;
  seconds: number;
  chars: number;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  createdAt: number;
}

export interface LookupResult {
  lemma: string;
  reading: string;
  koreanReading: string;
  pos: string;
  meaning: string;
  otherMeanings: string[];
  note: string;
}

export interface TranslationResult {
  translation: string;
  grammar: string[];
}

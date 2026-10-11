import { cache } from '../db';
import { getSettings } from '../settings';
import { langInfo, type LangCode, type LookupResult, type TranslationResult } from '../types';
import { hash } from './util';

export type AiErrorCode = 'nokey' | 'auth' | 'quota' | 'network' | 'blocked' | 'bad';

export class AiError extends Error {
  code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

async function callGemini<T>(prompt: string, schema: unknown, timeoutMs = 45000): Promise<T> {
  const { apiKey, model } = getSettings();
  if (!apiKey.trim()) throw new AiError('nokey', '설정에서 Gemini API 키를 먼저 입력해 주세요.');

  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema: schema,
    temperature: 0.2,
  };
  // 2.5 flash는 생각(thinking)을 끄면 훨씬 빠릅니다.
  if (/gemini-2\.5-flash(?!-lite)/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const candidates = [model, 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-2.5-flash'].filter((m, i, a) => m && a.indexOf(m) === i);
  let res: Response | null = null;
  let detail = '';
  for (const m of candidates) {
    const cfg = { ...generationConfig };
    if (!/gemini-2\.5-flash(?!-lite)/.test(m)) delete cfg.thinkingConfig;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiError('network', '응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.');
      throw new AiError('network', `서버에 연결하지 못했어요. (${(e as Error).message})`);
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) break;
    detail = '';
    try {
      detail = ((await res.clone().json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* ignore */
    }
    if (res.status !== 404) break;
  }
  if (!res) throw new AiError('network', '요청을 보내지 못했어요.');

  if (!res.ok) {
    const d = detail ? ` [${detail.slice(0, 160)}]` : '';
    if (res.status === 400 && /API key/i.test(detail)) throw new AiError('auth', `API 키가 올바르지 않아요. 키를 다시 복사해 붙여넣어 주세요.${d}`);
    if (res.status === 401 || res.status === 403) throw new AiError('auth', `API 키 권한 문제예요.${d}`);
    if (res.status === 404) throw new AiError('bad', `사용할 수 있는 모델을 찾지 못했어요.${d}`);
    if (res.status === 429) throw new AiError('quota', `요청 한도를 넘었어요. 잠시 후 다시 시도해 주세요.${d}`);
    throw new AiError('bad', `AI 요청에 실패했어요 (${res.status}).${d}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new AiError('blocked', '이 내용은 AI가 처리하지 못했어요.');
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new AiError('bad', 'AI가 빈 응답을 보냈어요. 다시 시도해 주세요.');
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fallthrough */
      }
    }
    throw new AiError('bad', 'AI 응답을 해석하지 못했어요. 다시 시도해 주세요.');
  }
}

async function cached<T>(key: string, force: boolean, fn: () => Promise<T>): Promise<T> {
  if (!force) {
    try {
      const hit = await cache.get(key);
      if (hit) return hit.value as T;
    } catch {
      /* 캐시 실패는 무시 */
    }
  }
  const value = await fn();
  try {
    await cache.put({ key, value, createdAt: Date.now() });
  } catch {
    /* ignore */
  }
  return value;
}

const str = { type: 'STRING' };
const strArr = { type: 'ARRAY', items: { type: 'STRING' } };

const LOOKUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lemma: str,
    reading: str,
    koreanReading: str,
    pos: str,
    meaning: str,
    otherMeanings: strArr,
    note: str,
  },
  required: ['lemma', 'reading', 'koreanReading', 'pos', 'meaning', 'otherMeanings', 'note'],
};

/** 문장 속에서 선택한 단어/구절의 뜻을 한국어로 찾습니다. (같은 단어+문장은 캐시) */
export function lookupWord(lang: LangCode, selected: string, sentence: string, force = false): Promise<LookupResult> {
  const key = `lk|${lang}|${selected.toLowerCase()}|${hash(sentence)}`;
  return cached(key, force, async () => {
    const L = langInfo(lang).english;
    const jaRules =
      lang === 'ja'
        ? `- "reading": the hiragana reading of the lemma.\n- "koreanReading": Korean Hangul transcription of how the selected text is pronounced (e.g. 学校 -> 각꼬-).`
        : `- "reading": empty string.\n- "koreanReading": approximate Korean Hangul pronunciation of the selected text (e.g. gracias -> 그라시아스).`;
    const prompt = `You are a concise dictionary for a Korean speaker reading a ${L} book.

Sentence: """${sentence}"""
Selected text: """${selected}"""

Describe the selected text AS IT IS USED in this sentence. Answer in Korean unless noted.
- "lemma": dictionary form in ${L} (for a phrase or idiom, the natural phrase form). Keep the original script.
${jaRules}
- "pos": part of speech in Korean (명사, 동사, 형용사, 부사, 조사, 접속사, 관용구 ...).
- "meaning": the meaning that fits THIS sentence, short (under 25 characters).
- "otherMeanings": up to 3 other common meanings (may be empty).
- "note": one short Korean note only if useful (conjugation like "ran → run의 과거형", nuance, idiom). Otherwise empty string.`;
    const r = await callGemini<Partial<LookupResult>>(prompt, LOOKUP_SCHEMA);
    if (!r.meaning?.trim()) throw new AiError('bad', '뜻을 찾지 못했어요. 다시 시도해 주세요.');
    return {
      lemma: (r.lemma ?? selected).trim() || selected,
      reading: (r.reading ?? '').trim(),
      koreanReading: (r.koreanReading ?? '').trim(),
      pos: (r.pos ?? '').trim(),
      meaning: r.meaning.trim(),
      otherMeanings: (r.otherMeanings ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3),
      note: (r.note ?? '').trim(),
    };
  });
}

const TRANSLATE_SCHEMA = {
  type: 'OBJECT',
  properties: { translation: str, grammar: strArr },
  required: ['translation', 'grammar'],
};

/** 문장(문법 포인트 포함) 또는 문단을 자연스러운 한국어로 번역 */
export function translateText(lang: LangCode, text: string, mode: 'sentence' | 'paragraph', force = false): Promise<TranslationResult> {
  const key = `tr|${lang}|${mode}|${hash(text)}`;
  return cached(key, force, async () => {
    const L = langInfo(lang).english;
    const grammarRule =
      mode === 'sentence'
        ? `"grammar": 1-3 short Korean notes about key grammar or expressions in the sentence that a learner may stumble on.`
        : `"grammar": an empty array.`;
    const prompt = `Translate this ${L} text into natural Korean, faithful to the meaning and tone.

Text: """${text}"""

Return JSON with "translation" (Korean only) and ${grammarRule}`;
    const r = await callGemini<Partial<TranslationResult>>(prompt, TRANSLATE_SCHEMA);
    if (!r.translation?.trim()) throw new AiError('bad', '번역 결과가 비어 있어요. 다시 시도해 주세요.');
    return { translation: r.translation.trim(), grammar: (r.grammar ?? []).map((g) => g.trim()).filter(Boolean) };
  });
}

/** 설정 화면의 "연결 테스트" */
export async function testConnection(): Promise<void> {
  await callGemini<{ ok: string }>('Return JSON {"ok":"yes"}', { type: 'OBJECT', properties: { ok: str }, required: ['ok'] }, 20000);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '알 수 없는 오류가 났어요.';
}

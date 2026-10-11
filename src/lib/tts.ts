import { langInfo, type LangCode } from '../types';

let voicesReady = false;

function pickVoice(lang: LangCode): SpeechSynthesisVoice | undefined {
  const prefix = langInfo(lang).tts.slice(0, 2).toLowerCase();
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix));
  if (!voices.length) return undefined;
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|siri/i.test(v.name) ? 4 : 0) + (v.lang.replace('_', '-').toLowerCase() === langInfo(lang).tts.toLowerCase() ? 2 : 0) + (v.localService ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0];
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}

/** 브라우저(iOS) 내장 음성으로 읽어 줍니다. 무료이고 오프라인에서도 됩니다. */
export function speak(text: string, lang: LangCode, rate = 0.9): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsSupported() || !text.trim()) return resolve();
    if (!voicesReady) {
      voicesReady = true;
      speechSynthesis.getVoices();
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langInfo(lang).tts;
    u.rate = rate;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

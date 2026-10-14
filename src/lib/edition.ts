/**
 * 두 가지 판이 있어요.
 *  - 기본 판: 내 기기들끼리 동기화(Firebase)
 *  - 'share' 판: 다른 사람에게 나눠 주는 배포용. 동기화·로그인 없이 기기 안에만 저장합니다.
 * 같은 주소 아래(/share/)에 올라가므로 저장 공간 이름을 따로 씁니다.
 */
const mode = typeof import.meta !== 'undefined' && (import.meta as { env?: { MODE?: string } }).env ? (import.meta as { env: { MODE?: string } }).env.MODE : '';

export const IS_SHARE = mode === 'share';
export const DB_NAME = IS_SHARE ? 'world-through-stories-share' : 'world-through-stories';

/** 배포용 판은 localStorage 키 앞머리를 바꿔서, 같은 도메인의 내 앱 데이터와 섞이지 않게 합니다. */
export function installStoragePrefix() {
  if (!IS_SHARE || typeof Storage === 'undefined') return;
  const map = (k: string) => (k.startsWith('wts_') ? `wtss_${k.slice(4)}` : k);
  const p = Storage.prototype;
  const get = p.getItem;
  const set = p.setItem;
  const del = p.removeItem;
  p.getItem = function (k: string) {
    return get.call(this, map(k));
  };
  p.setItem = function (k: string, v: string) {
    return set.call(this, map(k), v);
  };
  p.removeItem = function (k: string) {
    return del.call(this, map(k));
  };
}

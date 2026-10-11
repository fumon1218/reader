import { useMemo, useSyncExternalStore } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const snapshot = () => window.location.hash;

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const h = useSyncExternalStore(subscribe, snapshot, () => '');
  return useMemo(() => parseHash(h), [h]);
}

export function navigate(to: string, replace = false) {
  const url = `#/${to.replace(/^#?\/?/, '')}`;
  if (replace) window.history.replaceState(null, '', url), window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = url;
}

export function back(fallback = '') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, true);
}

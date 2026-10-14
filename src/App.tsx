import { useEffect, useState } from 'react';
import GuideSheet, { hasSeenGuide } from './components/Guide';
import { IS_SHARE } from './lib/edition';
import Icon, { type IconName } from './components/Icon';
import { UIProvider } from './components/ui';
import { words, useLive } from './db';
import Library from './pages/Library';
import Reader from './pages/Reader';
import Review from './pages/Review';
import Settings from './pages/Settings';
import Stats from './pages/Stats';
import Vocab from './pages/Vocab';
import { useRoute } from './router';
import { applyTheme, useSettings } from './settings';

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: '', label: '서재', icon: 'library' },
  { path: 'vocab', label: '단어장', icon: 'vocab' },
  { path: 'review', label: '복습', icon: 'review' },
  { path: 'stats', label: '기록', icon: 'chart' },
  { path: 'settings', label: '설정', icon: 'settings' },
];

function TabBar({ current }: { current: string }) {
  const due = useLive(['words'], async () => (await words.all()).filter((w) => w.status === 'learning' && w.due <= Date.now() && (w.reps > 0 || w.lapses > 0)).length, []);
  return (
    <nav className="tabbar" aria-label="주 메뉴">
      {TABS.map((t) => (
        <a key={t.path} href={`#/${t.path}`} className={current === t.path ? 'on' : ''} aria-current={current === t.path ? 'page' : undefined}>
          <span className="tab-ic">
            <Icon name={t.icon} size={24} />
            {t.path === 'review' && !!due && <i className="badge">{due > 99 ? '99+' : due}</i>}
          </span>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function App() {
  const route = useRoute();
  const [settings] = useSettings();
  const [guide, setGuide] = useState(() => IS_SHARE && !hasSeenGuide());

  useEffect(() => {
    applyTheme();
  }, [settings.theme]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', applyTheme);
    return () => mq?.removeEventListener?.('change', applyTheme);
  }, []);

  const first = route.path[0] ?? '';
  let page;
  if (first === 'read' && route.path[1]) {
    const q = route.query;
    page = (
      <Reader
        key={route.path[1]}
        bookId={Number(route.path[1])}
        startSection={q.has('s') ? Number(q.get('s')) : undefined}
        startPara={q.has('p') ? Number(q.get('p')) : undefined}
      />
    );
  } else if (first === 'vocab') page = <Vocab />;
  else if (first === 'review') page = <Review />;
  else if (first === 'stats') page = <Stats />;
  else if (first === 'settings') page = <Settings />;
  else page = <Library />;

  return (
    <UIProvider>
      {page}
      {IS_SHARE && <GuideSheet open={guide} onClose={() => setGuide(false)} />}
      {first !== 'read' && <TabBar current={TABS.some((t) => t.path === first) ? first : ''} />}
    </UIProvider>
  );
}

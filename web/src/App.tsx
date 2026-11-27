import { useEffect, useState } from 'react';
import { Student } from './Student';
import { Teacher } from './Teacher';
import { seedBuiltins } from './db';
import { setupOffline } from './offline';
import { useI18n } from './i18n';

const STATIC_DEMO = import.meta.env.VITE_STUDENT_ONLY === 'true';
const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'dev';

export function App() {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [ready, setReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    document.documentElement.lang = lang;
    void seedBuiltins().then(() => setReady(true));
    setupOffline(() => setOfflineReady(true));
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:sticky sm:top-0 dark:border-slate-800 dark:bg-slate-950/90">
        <h1 className="mr-auto text-lg font-bold">{t('appTitle')}</h1>
        <span data-testid="offline-status" data-ready={offlineReady}
          className={`badge ${offlineReady ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' : ''}`}>
          {offlineReady ? t('offlineReady') : t('offlineLoading')}
        </span>
        {!online && <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">{t('noNetwork')}</span>}
        <button className="badge ring-1 ring-slate-300 hover:bg-slate-200 dark:ring-slate-700" data-testid="ui-lang" lang={lang === 'ru' ? 'kk' : 'ru'}
          onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}>{t('switchLang')}</button>
        {!STATIC_DEMO && (
          <nav className="flex rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
            {(['student', 'teacher'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} data-testid={`mode-${m}`}
                className={`rounded-md px-3 py-1 ${mode === m ? 'bg-white shadow dark:bg-slate-700' : ''}`}>{m === 'student' ? t('modeStudent') : t('modeTeacher')}</button>
            ))}
          </nav>
        )}
      </header>
      {!ready ? <p>{t('loading')}</p> : mode === 'student' || STATIC_DEMO ? <Student /> : <Teacher />}
      <footer className="mt-10 text-center text-xs text-slate-400" data-testid="build">{t('build', { sha: BUILD_SHA.slice(0, 7) })}</footer>
    </div>
  );
}

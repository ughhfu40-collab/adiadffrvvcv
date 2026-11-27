import { useEffect, useState } from 'react';
import { Student } from './Student';
import { Teacher } from './Teacher';
import { seedBuiltins } from './db';
import { setupOffline } from './offline';
import { PITCH_URL, useI18n, type UiLang } from './i18n';

const STATIC_DEMO = import.meta.env.VITE_STUDENT_ONLY === 'true';
const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'dev';

const LANGS: { id: UiLang; label: string }[] = [{ id: 'kk', label: 'Қазақша' }, { id: 'ru', label: 'Русский' }];

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
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <span className="mr-auto font-serif text-[1.7rem] font-bold leading-none tracking-tight text-ink" translate="no">
            {t('appTitle')}<span className="text-brand-ink" aria-hidden="true">.</span>
          </span>
          <span data-testid="offline-status" data-ready={offlineReady} role="status" title={offlineReady ? t('offlineReady') : t('offlineLoading')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${offlineReady ? 'bg-ok' : 'animate-pulse bg-line'}`} />
            <span className="max-[419px]:sr-only">{offlineReady ? t('offlineReady') : t('offlineLoading')}</span>
          </span>
          {!online && <span className="badge border-warn/40 bg-warn-soft text-warn">{t('noNetwork')}</span>}
          {/* Одна кнопка-переключатель (data-testid=ui-lang): видны оба языка, активный — залит. */}
          <button type="button" data-testid="ui-lang" aria-label={`${t('langLabel')}: ${lang === 'kk' ? 'Қазақша' : 'Русский'}`}
            onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}
            className="inline-flex rounded-full border border-line bg-card p-0.5 text-sm">
            {LANGS.map((l) => (
              <span key={l.id} lang={l.id} className={`rounded-full px-3 py-1.5 transition ${lang === l.id ? 'bg-ink font-semibold text-paper' : 'text-muted'}`}>{l.label}</span>
            ))}
          </button>
          {!STATIC_DEMO && (
            <nav aria-label={t('modeLabel')} className="order-last flex w-full rounded-full border border-line bg-card p-0.5 text-sm sm:order-none sm:w-auto">
              {(['student', 'teacher'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} data-testid={`mode-${m}`} aria-current={mode === m ? 'page' : undefined}
                  className={`flex-1 rounded-full px-4 py-1.5 transition ${mode === m ? 'bg-brand font-semibold text-on-brand' : 'text-muted hover:text-ink'}`}>
                  {m === 'student' ? t('modeStudent') : t('modeTeacher')}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {!ready ? <p className="py-10 text-muted">{t('loading')}</p> : mode === 'student' || STATIC_DEMO ? <Student /> : <Teacher />}
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-6 text-xs text-muted sm:px-6">
        <a className="link" href={PITCH_URL} target="_blank" rel="noopener noreferrer">{t('pitchLink')}</a>
        <span data-testid="build">{t('build', { sha: BUILD_SHA.slice(0, 7) })}</span>
      </footer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Student } from './Student';
import { Teacher } from './Teacher';
import { seedBuiltins } from './db';
import { setupOffline } from './offline';
import { PITCH_URL, useI18n, type UiLang } from './i18n';
import { Icon, Spinner } from './Icon';

const STATIC_DEMO = import.meta.env.VITE_STUDENT_ONLY === 'true';
const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'dev';

const LANGS: { id: UiLang; label: string }[] = [{ id: 'kk', label: 'Қазақша' }, { id: 'ru', label: 'Русский' }];

export function App() {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [storage, setStorage] = useState<'loading' | 'ready' | 'error'>('loading');
  const [offline, setOffline] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const offlineLabel = t(offline === 'ready' ? 'offlineReady' : offline === 'unavailable' ? 'offlineUnavailable' : 'offlineLoading');
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (storage !== 'loading') return;
    let active = true;
    void seedBuiltins().then(
      () => { if (active) setStorage('ready'); },
      () => { if (active) setStorage('error'); },
    );
    return () => { active = false; };
  }, [storage]);

  useEffect(() => {
    const stopOffline = setupOffline(setOffline);
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { stopOffline?.(); removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only rounded-control bg-card px-4 py-2 font-medium text-ink shadow-raised focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">{t('skipToContent')}</a>
      <header className="border-b border-line bg-paper/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:gap-x-4 sm:px-6">
          {/* Логотип: слово, выделенное маркером, — как главное действие в уроке. Цвета маркера одинаковы в обеих темах. */}
          <span className="mr-auto font-serif text-[1.75rem] font-bold leading-none tracking-tight text-ink" translate="no">
            <span className="inline-block -rotate-1 rounded-chip bg-marker px-1.5 pb-1 pt-0.5 text-marker-ink">{t('appTitle')}</span>
          </span>
          {/* Статус офлайна: форма значка различается по состоянию (не только цвет), подпись — всегда в доступном имени. */}
          <span data-testid="offline-status" data-ready={offline === 'ready'} role="status" title={offlineLabel}
            className={`inline-flex items-center gap-1.5 text-caption font-medium ${offline === 'ready' ? 'text-ok' : offline === 'unavailable' ? 'text-warn' : 'text-muted'}`}>
            {offline === 'ready' ? <Icon name="offline-ok" className="h-5 w-5" /> : offline === 'unavailable' ? <Icon name="alert" className="h-[1.125rem] w-[1.125rem]" /> : <Spinner className="h-3.5 w-3.5" />}
            <span className={offline === 'unavailable' ? 'max-[359px]:sr-only' : 'max-[479px]:sr-only'}>{offlineLabel}</span>
          </span>
          {!online && <span className="badge border-warn/50 bg-warn-soft text-warn"><Icon name="wifi-off" className="h-3.5 w-3.5" />{t('noNetwork')}</span>}
          {/* Одна кнопка-переключатель (data-testid=ui-lang): видны оба языка, активный — залит и выделен жирным. */}
          <button type="button" data-testid="ui-lang" aria-label={`${t('langLabel')}: ${lang === 'kk' ? 'Қазақша' : 'Русский'}`}
            onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}
            className="inline-flex shrink-0 rounded-full border border-line-strong/50 bg-card p-0.5 text-sm">
            {LANGS.map((l) => (
              <span key={l.id} lang={l.id} className={`rounded-full px-2.5 py-1.5 transition-colors duration-150 sm:px-3 ${lang === l.id ? 'bg-ink font-semibold text-paper' : 'text-muted'}`}>{l.label}</span>
            ))}
          </button>
          {!STATIC_DEMO && (
            <nav aria-label={t('modeLabel')} className="order-last flex w-full rounded-full border border-line-strong/50 bg-card p-0.5 text-sm sm:order-none sm:w-auto">
              {(['student', 'teacher'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} data-testid={`mode-${m}`} aria-current={mode === m ? 'page' : undefined}
                  className={`min-h-10 flex-1 whitespace-nowrap rounded-full px-4 transition-colors duration-150 ${mode === m ? 'bg-ink font-semibold text-paper' : 'text-muted hover:text-ink'}`}>
                  {m === 'student' ? t('modeStudent') : t('modeTeacher')}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 focus:outline-none sm:px-6">
        {storage === 'loading' && (
          <p className="flex items-center gap-2 py-10 text-muted" role="status"><Spinner />{t('loading')}</p>
        )}
        {storage === 'error' && (
          <div className="card mt-8 max-w-xl space-y-4">
            <p role="alert" data-testid="storage-error" className="note note-bad"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t('storageUnavailable')}</span></p>
            <button type="button" className="btn" data-testid="storage-retry" onClick={() => setStorage('loading')}>{t('storageRetry')}</button>
          </div>
        )}
        {storage === 'ready' && (mode === 'student' || STATIC_DEMO ? <Student /> : <Teacher />)}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-6 text-caption text-muted sm:px-6">
          <a className="link inline-flex items-center gap-1.5" href={PITCH_URL} target="_blank" rel="noopener noreferrer"><Icon name="play" className="h-3.5 w-3.5" />{t('pitchLink')}</a>
          <span data-testid="build" className="tabular-nums">{t('build', { sha: BUILD_SHA.slice(0, 7) })}</span>
        </div>
      </footer>
    </div>
  );
}

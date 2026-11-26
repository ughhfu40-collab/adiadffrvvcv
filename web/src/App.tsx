import { useEffect, useState } from 'react';
import { Student } from './Student';
import { Teacher } from './Teacher';
import { seedBuiltins } from './db';
import { setupOffline } from './offline';

const STATIC_DEMO = import.meta.env.VITE_STUDENT_ONLY === 'true';

export function App() {
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [ready, setReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    void seedBuiltins().then(() => setReady(true));
    setupOffline(() => setOfflineReady(true));
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <h1 className="mr-auto text-lg font-bold">Oqy · читать и понимать</h1>
        <span data-testid="offline-status" data-ready={offlineReady}
          className={`badge ${offlineReady ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' : ''}`}>
          {offlineReady ? '✓ Готово к офлайну' : 'Загрузка для офлайна…'}
        </span>
        {!online && <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">Нет сети</span>}
        {!STATIC_DEMO && (
          <nav className="flex rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
            {(['student', 'teacher'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} data-testid={`mode-${m}`}
                className={`rounded-md px-3 py-1 ${mode === m ? 'bg-white shadow dark:bg-slate-700' : ''}`}>{m === 'student' ? 'Ученик' : 'Учитель'}</button>
            ))}
          </nav>
        )}
      </header>
      {!ready ? <p>Загрузка…</p> : mode === 'student' || STATIC_DEMO ? <Student /> : <Teacher />}
    </div>
  );
}

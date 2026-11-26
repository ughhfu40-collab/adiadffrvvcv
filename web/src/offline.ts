import { registerSW } from 'virtual:pwa-register';

/** Готовность офлайна: SW активен И в кеше есть оболочка приложения и бандл со встроенными уроками. */
export async function checkOfflineReady(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active) return false;
  const shell = await caches.match('index.html', { ignoreSearch: true }) ?? await caches.match(new URL('index.html', location.href).href, { ignoreSearch: true });
  if (!shell) return false;
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => s.src);
  for (const src of scripts) if (!(await caches.match(src, { ignoreSearch: true }))) return false;
  return true;
}

export function setupOffline(onReady: () => void) {
  if (import.meta.env.DEV) return;
  registerSW({ immediate: true, onOfflineReady: () => void checkOfflineReady().then((ok) => ok && onReady()) });
  const poll = async (n: number) => {
    if (await checkOfflineReady()) return onReady();
    if (n > 0) setTimeout(() => void poll(n - 1), 1000);
  };
  void poll(60);
}

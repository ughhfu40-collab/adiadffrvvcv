import { registerSW } from 'virtual:pwa-register';

/** Готовность офлайна: SW активен И в кеше есть оболочка приложения и бандл со встроенными уроками. */
export async function checkOfflineReady(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active || !navigator.serviceWorker.controller) return false;
  const shell = await caches.match(new URL('index.html', reg.scope).href, { ignoreSearch: true });
  if (!shell) return false;
  const resources = [
    ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'), (script) => script.src),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'), (style) => style.href),
  ];
  for (const url of resources) if (!(await caches.match(url, { ignoreSearch: true }))) return false;
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

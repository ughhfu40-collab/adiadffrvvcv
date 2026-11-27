import { registerSW } from 'virtual:pwa-register';

/** Готовность офлайна: SW активен И в кеше есть оболочка приложения и бандл со встроенными уроками. */
export async function checkOfflineReady(): Promise<boolean> {
  if (!navigator.serviceWorker || !window.caches) return false;
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

export function setupOffline(onStatus: (status: 'ready' | 'unavailable') => void) {
  if (import.meta.env.DEV || !navigator.serviceWorker || !window.caches) {
    onStatus('unavailable');
    return;
  }
  let active = true;
  let ready = false;
  let checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = (status: 'ready' | 'unavailable') => {
    if (!active || ready) return;
    ready = status === 'ready';
    onStatus(status);
  };
  const poll = async (attempts: number) => {
    if (!active || ready || checking) return;
    checking = true;
    try {
      if (await checkOfflineReady()) return report('ready');
    } catch {
      return report('unavailable');
    } finally {
      checking = false;
    }
    if (!active) return;
    if (attempts > 0) timer = setTimeout(() => void poll(attempts - 1), 1000);
    else report('unavailable');
  };
  registerSW({
    immediate: true,
    onOfflineReady: () => {
      if (active) {
        clearTimeout(timer);
        void poll(60);
      }
    },
    onRegisterError: () => report('unavailable'),
  });
  void poll(60);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
export interface Health { server: string; ollama: { ok: boolean; model: string; url: string; reason?: string; models?: string[] }; startCommand: string; timeoutSec?: number }
export async function getHealth(): Promise<Health | { error: string }> {
  try {
    const r = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { error: `Сервер генерации недоступен (HTTP ${r.status}). Запустите: npm run server` };
    return (await r.json()) as Health;
  } catch (e) {
    return { error: `Сервер генерации недоступен (${(e as Error).message}). Запустите: npm run server` };
  }
}

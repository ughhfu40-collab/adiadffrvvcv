import { z } from 'zod';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const HealthSchema = z.object({
  server: z.string(),
  ollama: z.object({
    ok: z.boolean(),
    model: z.string(),
    url: z.string(),
    reason: z.string().optional(),
    models: z.array(z.string()).optional(),
  }),
  startCommand: z.string(),
  timeoutSec: z.number().nonnegative().optional(),
});
export type Health = z.infer<typeof HealthSchema>;

export async function getHealth(): Promise<Health | { error: string }> {
  try {
    const r = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { error: `Сервер генерации недоступен (HTTP ${r.status}). Запустите: npm run server` };
    const result = HealthSchema.safeParse(await r.json());
    if (!result.success) return { error: 'Сервер генерации недоступен: ответ проверки не распознан. Запустите: npm run server' };
    return result.data;
  } catch (e) {
    return { error: `Сервер генерации недоступен (${(e as Error).message}). Запустите: npm run server` };
  }
}

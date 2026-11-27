// Таймаут, отмена, разрыв соединения и успешный повтор — через настоящий HTTP, тестовая Ollama.
// Сервер Oqy должен быть запущен с OLLAMA_TIMEOUT_MS=3000. node scripts/resilience.mjs <api> <fake>
import http from 'node:http';
const API = process.argv[2] ?? 'http://127.0.0.1:9197';
const FAKE = process.argv[3] ?? 'http://127.0.0.1:11935';
const text = 'МАРКЕР-SLOW первое предложение. Второе предложение здесь. Третье предложение тут.';
const good = 'Первое предложение здесь. Второе предложение здесь. Третье предложение тут.';
const stats = async () => (await fetch(`${FAKE}/__stats`)).json();
const post = (body, signal) => fetch(`${API}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// 1. Таймаут
let t0 = performance.now();
let r = await post({ text, language: 'ru' });
out.timeout = { status: r.status, kind: (await r.json()).kind, seconds: +((performance.now() - t0) / 1000).toFixed(1) };

// 2. Отмена клиентом во время генерации → сервер обрывает запрос к модели
let s0 = await stats();
const ctrl = new AbortController();
const p = post({ text, language: 'ru' }, ctrl.signal).catch((e) => e.name);
await wait(500); ctrl.abort();
out.cancel = { client: await p };
await wait(800);
out.cancel.upstreamAborted = (await stats()).aborted - s0.aborted;

// 3. Разрыв соединения (сокет закрыт без abort-сигнала)
s0 = await stats();
await new Promise((resolve) => {
  const u = new URL(`${API}/api/generate`);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json' } });
  req.on('error', () => resolve());
  req.end(JSON.stringify({ text, language: 'kk' }));
  setTimeout(() => { req.destroy(); resolve(); }, 400);
});
await wait(800);
out.disconnect = { upstreamAborted: (await stats()).aborted - s0.aborted, serverHealth: (await fetch(`${API}/api/health`)).status };

// 4. Успешный повтор после сбоев
t0 = performance.now();
r = await post({ text: good, language: 'ru' });
const j = await r.json();
out.retry = { status: r.status, ok: j.ok, id: j.lesson?.id, ms: Math.round(performance.now() - t0) };

console.log(JSON.stringify(out, null, 2));
const ok = out.timeout.status === 504 && out.timeout.kind === 'timeout' && out.cancel.client === 'AbortError' && out.cancel.upstreamAborted === 1
  && out.disconnect.upstreamAborted === 1 && out.disconnect.serverHealth === 200 && out.retry.status === 200 && out.retry.ok;
process.exit(ok ? 0 : 1);

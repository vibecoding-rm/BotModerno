// tests/worker.unit.test.js — routing y guardas del webhook del Worker
import worker from '../src/worker.js';
import { fakeEnv, stubTelegramFetch } from './helpers/fakes.js';

const SECRET = 'secreto-de-pruebas';
const ctx = { waitUntil() {} };

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(`https://bot.example${path}`, { method, headers, body });
}

beforeEach(() => { stubTelegramFetch(); });

describe('worker routing', () => {
  test('GET / responde OK sin secret', async () => {
    const res = await worker.fetch(req('/'), fakeEnv(), ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('OK CubaModel');
  });

  test('GET /health responde JSON ok', async () => {
    const res = await worker.fetch(req('/health'), fakeEnv(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('sin TG_WEBHOOK_SECRET configurado -> 500', async () => {
    const env = fakeEnv({ TG_WEBHOOK_SECRET: undefined });
    const res = await worker.fetch(req('/webhook/lo-que-sea', { method: 'POST' }), env, ctx);
    expect(res.status).toBe(500);
  });

  test('ruta desconocida -> 404', async () => {
    const res = await worker.fetch(req('/otra-cosa'), fakeEnv(), ctx);
    expect(res.status).toBe(404);
  });

  test('webhook con secret incorrecto en la ruta -> 404', async () => {
    const res = await worker.fetch(req('/webhook/incorrecto', { method: 'POST' }), fakeEnv(), ctx);
    expect(res.status).toBe(404);
  });

  test('webhook sin header X-Telegram-Bot-Api-Secret-Token -> 404', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, { method: 'POST' }), fakeEnv(), ctx);
    expect(res.status).toBe(404);
  });

  test('webhook con GET -> 405', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, {
      method: 'GET',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }
    }), fakeEnv(), ctx);
    expect(res.status).toBe(405);
  });

  test('webhook sin content-type JSON -> 400', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'Content-Type': 'text/plain' },
      body: 'hola'
    }), fakeEnv(), ctx);
    expect(res.status).toBe(400);
  });

  test('webhook con JSON inválido -> 400', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'Content-Type': 'application/json' },
      body: '{roto'
    }), fakeEnv(), ctx);
    expect(res.status).toBe(400);
  });

  test('update válido -> 200 aunque no tenga message', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 1 })
    }), fakeEnv(), ctx);
    expect(res.status).toBe(200);
  });

  test('update con payload que no valida (update_id string) -> 200 sin procesar', async () => {
    const res = await worker.fetch(req(`/webhook/${SECRET}`, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 'x' })
    }), fakeEnv(), ctx);
    expect(res.status).toBe(200); // siempre 200 para que Telegram no reintente
  });
});

/* api/webhook.js
 * Vercel serverless entry for Telegram webhook
 * Nota: solo para Vercel; no usado por Cloudflare Workers.
 */
import { createBot } from '../src/registerBot.js';

const bot = createBot();

export default async function handler(req, res) {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('webhook error', e?.message || e);
    res.status(200).json({ ok: true }); // Telegram expects 200 even on errors
  }
}
export const config = { api: { bodyParser: false } };

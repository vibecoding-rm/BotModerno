/* src/telegram.js
 * Wrapper del API de Telegram vía fetch (sin Telegraf).
 */
import { logger } from './logger.js';

// Utility: safe JSON fetch wrapper for Telegram API
export async function tgFetch(token, method, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) {
    // Log, but do not throw to avoid breaking webhook response
    logger.error('Telegram API error', null, { method, response: json });
  }
  return json;
}

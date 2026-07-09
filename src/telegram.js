/* src/telegram.js
 * Wrapper del API de Telegram vía fetch (sin Telegraf).
 */
import { logger } from './logger.js';

// IDs de efectos animados gratuitos (message_effect_id, SOLO chats privados)
export const EFFECTS = {
  party: '5046509860389126442', // 🎉
  fire: '5104841245755180586',  // 🔥
  like: '5107584321108051014',  // 👍
  heart: '5159385139981059251'  // ❤️
};

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

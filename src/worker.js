/* src/worker.js
 * Cloudflare Worker main entry point (Workers runtime)
 * Unificado para manejar el webhook de Telegram sin Telegraf.
 * Rutas:
 *  - GET  /                               -> "OK CubaModel Bot Worker"
 *  - POST /webhook/<TG_WEBHOOK_SECRET>    -> procesa update JSON de Telegram
 *  - cualquier otra                       -> 404
 */

import { SimpleTelegramBot } from './bot-simple.js';
import { validate, telegramUpdateSchema } from './validation.js';
import { logger } from './logger.js';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // GET /
      if (request.method === 'GET' && pathname === '/') {
        return new Response('OK CubaModel Bot Worker', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      // POST /webhook/<secret>
      if (request.method === 'POST' && pathname.startsWith('/webhook/')) {
        const parts = pathname.split('/').filter(Boolean); // ["webhook", "<secret>"]
        const providedSecret = parts[1] || '';
        const expectedSecret = env.TG_WEBHOOK_SECRET || '';

        if (!expectedSecret || providedSecret !== expectedSecret) {
          // No revelar si existe o no
          return new Response('Not found', { status: 404 });
        }

        // Config env para el bot (solo lo necesario)
        const botEnv = {
          BOT_TOKEN: env.BOT_TOKEN,
          SUPABASE_URL: env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
          ADMIN_TG_IDS: env.ADMIN_TG_IDS,
          ALLOWED_CHAT_IDS: env.ALLOWED_CHAT_IDS,
        };

        const bot = new SimpleTelegramBot(botEnv);

        try {
          const update = await request.json();
          const validation = validate(telegramUpdateSchema, update);
          if (!validation.success) {
            logger.error('Invalid update payload', null, { errors: validation.error });
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          await bot.handleUpdate(validation.data);
        } catch (err) {
          // Loguear pero SIEMPRE responder 200 para que Telegram no reintente
          logger.error('Webhook processing error', err);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 404 por defecto
      return new Response('Not found', { status: 404 });
    } catch (e) {
      // Fallback: nunca caer; responder 200 en caso de POST webhook; 500 para otros
      try {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname.startsWith('/webhook/')) {
          logger.error('Fatal webhook error', e);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch {}
      return new Response('Internal error', { status: 500 });
    }
  }
};

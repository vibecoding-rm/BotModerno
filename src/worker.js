
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
import { logEvent, logWebhookEvent } from './lib/events.js';

async function handleUpdate(update, env) {
  const botEnv = {
    BOT_TOKEN: env.BOT_TOKEN,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_TG_IDS: env.ADMIN_TG_IDS,
    ALLOWED_CHAT_IDS: env.ALLOWED_CHAT_IDS,
  };
  const bot = new SimpleTelegramBot(botEnv);
  const validation = validate(telegramUpdateSchema, update);
  if (!validation.success) {
    logger.error('Invalid update payload', null, { errors: validation.error });
    await logEvent(env, 'validation_error', { errors: validation.error });
    return;
  }
  
  // Log successful webhook processing
  await logWebhookEvent(env, validation.data, 'processing');
  await bot.handleUpdate(validation.data);
  await logWebhookEvent(env, validation.data, 'completed');
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Expose basic endpoints before secret validation so health checks work
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('OK CubaModel Bot Worker', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, version: '1.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST / disabled unless ALLOW_ROOT_WEBHOOK flag is explicitly set to 'true'
    // This prevents accidental webhook processing on root path in production

    const expectedSecret = env.TG_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return new Response('Misconfigured: TG_WEBHOOK_SECRET', { status: 500 });
    }

    // 1) Validación por ruta: /webhook/<secret>
    const pathParts = url.pathname.split('/').filter(Boolean); // e.g. ["webhook", "<secret>"]
    const pathSecret = pathParts[1] || '';
    if (!(pathParts[0] === 'webhook' && pathSecret === expectedSecret)) {
      // Evita filtrar información: 404
      return new Response('Not found', { status: 404 });
    }

    // 2) Validación por header oficial de Telegram
    // Telegram enviará X-Telegram-Bot-Api-Secret-Token si lo seteaste en setWebhook
    const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (headerSecret !== expectedSecret) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    // Content-Type guard before parsing body
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return new Response('Bad Request', { status: 400 });
    }

    // A partir de aquí el request es válido y viene de Telegram
    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // TODO: aquí estaba tu lógica actual del bot…

    // Ejemplo de manejo de inserción con “fingerprint” única:
    try {
      await handleUpdate(update, env); // tu función existente
      return new Response('OK', { status: 200 });
    } catch (e) {
      // Si el insert rompió unique constraint (duplicado), respondemos 200 para que Telegram no reintente
      if (String(e).includes('duplicate key value') || String(e).includes('unique constraint')) {
        // log in background; don't block response
        ctx.waitUntil(logEvent(env, 'duplicate', { reason: 'fingerprint', update_id: update?.update_id }));
        return new Response('OK', { status: 200 });
      }
      ctx.waitUntil(logEvent(env, 'error', { where: 'handleUpdate', error: String(e) }));
      return new Response('OK', { status: 200 });
    }
  }
}


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
  const bot = new SimpleTelegramBot(env);
  const validation = validate(telegramUpdateSchema, update);
  if (!validation.success) {
    logger.error('Invalid update payload', null, { errors: validation.error });
    await logEvent(env, 'validation_error', { errors: validation.error });
    return;
  }
  
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

    // Admin: GET /setup-webhook/<secret> registra el webhook y los comandos del bot
    // usando el BOT_TOKEN guardado en secrets (idempotente).
    const setupMatch = url.pathname.match(/^\/setup-webhook\/(.+)$/);
    if (request.method === 'GET' && setupMatch) {
      if (setupMatch[1] !== expectedSecret) return new Response('Not found', { status: 404 });
      const webhookUrl = `${url.origin}/webhook/${expectedSecret}`;
      const tg = (method, payload) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      const setWebhook = await tg('setWebhook', {
        url: webhookUrl,
        secret_token: expectedSecret,
        allowed_updates: ['message', 'callback_query', 'chat_join_request'],
        drop_pending_updates: true
      });
      const publicCommands = [
        { command: 'revisar', description: 'Buscar un teléfono (ej: /revisar Samsung A14)' },
        { command: 'imei', description: 'Identificar teléfono por su IMEI (*#06#)' },
        { command: 'subir', description: 'Reportar tu experiencia con un teléfono' },
        { command: 'top', description: 'Los teléfonos más confirmados por la comunidad' },
        { command: 'marca', description: 'Ver teléfonos de una marca (ej: /marca Samsung)' },
        { command: 'seguir', description: 'Recibir aviso cuando suban un modelo' },
        { command: 'misseguimientos', description: 'Ver y cancelar tus seguimientos activos' },
        { command: 'bandas', description: 'Guía de bandas 4G en Cuba' },
        { command: 'stats', description: 'Estadísticas de la base de datos' },
        { command: 'exportar', description: 'Descargar la base de datos' },
        { command: 'suscribir', description: 'Recibir avisos de todos los teléfonos nuevos' },
        { command: 'reportar', description: 'Reportar un error en los datos' },
        { command: 'ayuda', description: 'Lista de comandos y cómo usar el bot' },
        { command: 'start', description: 'Bienvenida y menú principal' },
        { command: 'reglas', description: 'Ver las reglas' },
        { command: 'id', description: 'Ver tu ID de Telegram' }
      ];
      const setCommands = await tg('setMyCommands', { commands: publicCommands });
      // Comandos extra visibles solo para admins (en su chat privado)
      const adminIds = (env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const setAdminCommands = [];
      for (const adminId of adminIds) {
        setAdminCommands.push(await tg('setMyCommands', {
          scope: { type: 'chat', chat_id: Number(adminId) },
          commands: [
            { command: 'pendientes', description: '🔧 Revisar propuestas pendientes' },
            ...publicCommands
          ]
        }));
      }
      const info = await tg('getWebhookInfo', {});
      return new Response(JSON.stringify({ setWebhook, setCommands, setAdminCommands, webhookInfo: info }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admin: GET /chat-info/<secret> -> estado del bot en cada chat de ALLOWED_CHAT_IDS
    const chatInfoMatch = url.pathname.match(/^\/chat-info\/(.+)$/);
    if (request.method === 'GET' && chatInfoMatch) {
      if (chatInfoMatch[1] !== expectedSecret) return new Response('Not found', { status: 404 });
      const tg = (method, payload) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      const me = await tg('getMe', {});
      const ids = (env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const chats = {};
      for (const id of ids) {
        const chat = await tg('getChat', { chat_id: Number(id) });
        const member = me?.result?.id
          ? await tg('getChatMember', { chat_id: Number(id), user_id: me.result.id })
          : null;
        chats[id] = {
          chat: chat.ok ? { title: chat.result?.title, type: chat.result?.type } : chat,
          bot_status: member?.ok ? member.result?.status : member
        };
      }
      return new Response(JSON.stringify({ bot: me?.result?.username, chats }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
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

    // Siempre respondemos 200 para que Telegram no reintente el update
    try {
      await handleUpdate(update, env);
      return new Response('OK', { status: 200 });
    } catch (e) {
      ctx.waitUntil(logEvent(env, 'error', { where: 'handleUpdate', error: String(e) }));
      return new Response('OK', { status: 200 });
    }
  },
  async scheduled(event, env, ctx) {
    const bot = new SimpleTelegramBot(env);
    ctx.waitUntil(bot.kickExpiredCaptchas());
    ctx.waitUntil(bot.drainPendingNotifications());
  }
}

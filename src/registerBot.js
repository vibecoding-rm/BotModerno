/* src/registerBot.js
 * Telegraf registration for CubaModel Bot.
 * Node 20, ESM.
 */
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import { handleWizardText, startWizard, cancelWizard, ensureDM, handleReport, handleSubscribe, handleUnsubscribe } from './wizard.js';

const {
  BOT_TOKEN,
  TG_WEBHOOK_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_TG_IDS,
  ALLOWED_CHAT_IDS,
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const adminIds = (ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedChatIds = (ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

export function createBot() {
  const bot = new Telegraf(BOT_TOKEN, { contextType: Telegraf.Context });
  // Attach clients
  bot.context.db = supabase;

  bot.start(async (ctx) => {
    await ctx.reply(
`¡Bienvenido a CubaModel Bot! 📱🇨🇺

Bot colaborativo para verificar qué teléfonos funcionan en Cuba.

Comandos:
• /subir — Iniciar asistente (por DM)
• /revisar — Revisar modelos
• /reportar <id> <texto> — Reportar un error
• /suscribir — Recibir notificaciones por DM
• /cancelar — Cancelar asistente en curso
`
    );
  });

  // /subir only runs in DM
  bot.command('subir', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('En el grupo usamos /revisar. Para subir, escríbeme por DM: @' + (ctx.botInfo?.username || 'este_bot'));
    }
    await startWizard(ctx);
  });

  bot.command('cancel', cancelWizard);
  bot.command('cancelar', cancelWizard);

  // Group access control for certain commands
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      if (allowedChatIds.length && !allowedChatIds.includes(String(ctx.chat.id))) {
        // Silently ignore
        return;
      }
    }
    try { await next(); } catch (err) {
      console.error('Bot error:', err?.message || err);
      try { await ctx.reply('⚠️ Ocurrió un error. Intenta de nuevo.'); } catch {}
    }
  });

  // /revisar can run in group with short answer
  bot.command('revisar', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('Te envío detalles por DM. Escríbeme: @' + (ctx.botInfo?.username || 'este_bot'));
    }
    await ctx.reply('Próximamente: revisión por DM. Por ahora usa el panel web.');
  });

  bot.command('reportar', async (ctx) => handleReport(ctx));
  bot.command('suscribir', async (ctx) => handleSubscribe(ctx));
  bot.command('cancelarsub', async (ctx) => handleUnsubscribe(ctx));
  bot.command('cancelar_sub', async (ctx) => handleUnsubscribe(ctx));

  // Intercept DM text to advance wizard if draft exists
  bot.on('text', async (ctx) => {
    if (ctx.chat?.type !== 'private') return; // only DM
    const handled = await handleWizardText(ctx);
    if (!handled) {
      // Fallback help
      await ctx.reply('Usa /subir para iniciar el asistente o /ayuda para ver comandos.');
    }
  });

  return bot;
}

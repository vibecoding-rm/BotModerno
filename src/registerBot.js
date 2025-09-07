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

export function createBot(envVars = null) {
  // Si se pasan variables de entorno, usarlas (para Cloudflare)
  const config = envVars || {
    BOT_TOKEN,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_TG_IDS,
    ALLOWED_CHAT_IDS,
  };
  
  const bot = new Telegraf(config.BOT_TOKEN, { contextType: Telegraf.Context });
  
  // Crear cliente Supabase con las variables correctas
  const botSupabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  
  // Attach clients
  bot.context.db = botSupabase;

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

  // /revisar SOLO funciona en grupos, no en DM
  bot.command('revisar', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('El comando /revisar solo funciona en grupos. Aquí en DM puedes usar /subir para agregar un teléfono.');
    }
    
    // Funcionalidad de revisar en grupo - mostrar algunos teléfonos recientes
    try {
      const { data: phones } = await ctx.db
        .from('phones')
        .select('id, commercial_name, model, works_in_cuba, status')
        .eq('status', 'approved')
        .order('id', { ascending: false })
        .limit(5);
        
      if (!phones || phones.length === 0) {
        return ctx.reply('📱 Aún no hay teléfonos aprobados en la base de datos.');
      }
      
      let message = '📱 *Últimos teléfonos verificados:*\n\n';
      phones.forEach(phone => {
        const status = phone.works_in_cuba ? '✅ Funciona' : '❌ No funciona';
        message += `• ${phone.commercial_name} (${phone.model || 'N/A'}) - ${status}\n`;
      });
      message += '\n💻 Ver más detalles en el panel web o usa /subir por DM para agregar uno.';
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in revisar command:', error);
      await ctx.reply('⚠️ Error al consultar la base de datos. Intenta de nuevo.');
    }
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

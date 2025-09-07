/* functions/api/webhook.js
 * Cloudflare Functions - Telegram webhook handler
 */
import { createBot } from '../../src/registerBot.js';

export default {
  async fetch(request, env) {
    try {
      // Configurar environment variables globalmente
      const envVars = {
        BOT_TOKEN: env.BOT_TOKEN,
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
        ADMIN_TG_IDS: env.ADMIN_TG_IDS,
        ALLOWED_CHAT_IDS: env.ALLOWED_CHAT_IDS,
      };
      
      // Crear el bot con las variables de entorno
      const bot = createBot(envVars);
      
      if (request.method === 'POST') {
        const body = await request.json();
        await bot.handleUpdate(body);
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('Webhook error:', error);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
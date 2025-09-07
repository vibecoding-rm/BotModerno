/* functions/api/setup-webhook.js
 * Cloudflare Functions - Setup Telegram webhook
 */

export default {
  async fetch(request, env) {
    try {
      const botToken = env.BOT_TOKEN;
      if (!botToken) {
        return new Response('Bot token not configured', { status: 500 });
      }
      
      // Obtener la URL del proyecto desde Cloudflare
      const url = new URL(request.url);
      const webhookUrl = `${url.protocol}//${url.host}/api/webhook`;
      
      // Configurar webhook de Telegram
      const telegramApi = `https://api.telegram.org/bot${botToken}/setWebhook`;
      const response = await fetch(telegramApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true
        })
      });
      
      const result = await response.json();
      
      if (result.ok) {
        return new Response(JSON.stringify({
          success: true,
          webhook_url: webhookUrl,
          message: 'Webhook configurado exitosamente'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          error: result.description || 'Error desconocido'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Error setting up webhook:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
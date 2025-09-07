/* src/worker.js
 * Cloudflare Worker main entry point
 * Handles Telegram webhook and bot functionality
 */

import { SimpleTelegramBot } from './bot-simple.js';

// Cloudflare Worker environment
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Configure environment for the bot
    const botEnv = {
      BOT_TOKEN: env.BOT_TOKEN,
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_TG_IDS: env.ADMIN_TG_IDS,
      ALLOWED_CHAT_IDS: env.ALLOWED_CHAT_IDS,
    };
    
    // Route handling
    if (url.pathname === '/webhook') {
      return handleWebhook(request, botEnv);
    }
    
    if (url.pathname === '/setup-webhook') {
      return handleSetupWebhook(request, env);
    }
    
    if (url.pathname === '/status') {
      return handleStatus(request, env);
    }
    
    // Default response
    return new Response('CubaModel Bot - Cloudflare Worker', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

// Handle Telegram webhook
async function handleWebhook(request, env) {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    const bot = new SimpleTelegramBot(env);
    const body = await request.json();
    
    // Process the update
    await bot.handleUpdate(body);
    
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    // Always return 200 to Telegram to avoid retries
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Setup Telegram webhook
async function handleSetupWebhook(request, env) {
  try {
    const botToken = env.BOT_TOKEN;
    if (!botToken) {
      return new Response('Bot token not configured', { status: 500 });
    }
    
    // Get the Worker URL
    const url = new URL(request.url);
    const webhookUrl = `${url.protocol}//${url.host}/webhook`;
    
    // Set webhook with Telegram
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
    
    return new Response(JSON.stringify({
      success: result.ok,
      webhook_url: webhookUrl,
      telegram_response: result
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: result.ok ? 200 : 400
    });
  } catch (error) {
    console.error('Setup webhook error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Status endpoint
async function handleStatus(request, env) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    
    // Test database connection
    const { data, error } = await supabase
      .from('phones')
      .select('id')
      .limit(1);
      
    const status = {
      ok: !error,
      timestamp: new Date().toISOString(),
      database: error ? 'error' : 'connected',
      bot: 'active',
      worker: 'running'
    };
    
    if (error) {
      status.error = error.message;
    }
    
    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' },
      status: error ? 500 : 200
    });
  } catch (error) {
    console.error('Status check failed:', error);
    
    return new Response(JSON.stringify({
      ok: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      worker: 'error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
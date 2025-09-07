#!/bin/bash

# Script de deployment automático para Cloudflare Workers
echo "=== Deploying CubaModel Bot to Cloudflare Workers ==="

# Verificar que los secretos estén disponibles
if [ -z "$BOT_TOKEN" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Error: Faltan variables de entorno necesarias"
    echo "Asegúrate de tener configurados:"
    echo "- BOT_TOKEN"
    echo "- SUPABASE_URL"
    echo "- SUPABASE_SERVICE_ROLE_KEY"
    echo "- ADMIN_TG_IDS"
    echo "- ALLOWED_CHAT_IDS"
    exit 1
fi

echo "✅ Variables de entorno verificadas"

# Deploy el worker
echo "🚀 Deploying to Cloudflare Workers..."
npx wrangler deploy

# Configurar secretos en Cloudflare Workers
echo "🔐 Configurando secretos en Cloudflare..."
echo "$BOT_TOKEN" | npx wrangler secret put BOT_TOKEN
echo "$SUPABASE_URL" | npx wrangler secret put SUPABASE_URL
echo "$SUPABASE_SERVICE_ROLE_KEY" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
echo "$ADMIN_TG_IDS" | npx wrangler secret put ADMIN_TG_IDS
echo "$ALLOWED_CHAT_IDS" | npx wrangler secret put ALLOWED_CHAT_IDS

echo "✅ Secretos configurados"

# Configurar webhook
echo "🔗 Configurando webhook de Telegram..."
sleep 5  # Esperar que el deployment esté listo

WORKER_URL="https://cubamodel-bot.workers.dev"
curl -X GET "$WORKER_URL/setup-webhook" || echo "⚠️  Webhook setup falló, hazlo manualmente"

echo "🎉 ¡Deployment completado!"
echo "Tu bot está disponible en: $WORKER_URL"
echo "Panel web: Configura Cloudflare Pages por separado"
echo ""
echo "URLs importantes:"
echo "- Status: $WORKER_URL/status"
echo "- Setup Webhook: $WORKER_URL/setup-webhook"
echo "- Webhook: $WORKER_URL/webhook"
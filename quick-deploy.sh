#!/bin/bash

# Script de despliegue rápido para Vercel
echo "🚀 Despliegue Rápido a Vercel"
echo "=============================="

# Verificar si estamos en el directorio correcto
if [ ! -f "vercel.json" ]; then
    echo "❌ Error: vercel.json no encontrado. Ejecuta desde el directorio raíz del proyecto."
    exit 1
fi

# Verificar si Vercel CLI está instalado
if ! command -v vercel &> /dev/null; then
    echo "📦 Instalando Vercel CLI..."
    npm install -g vercel
fi

echo "🔑 Verificando variables de entorno..."

# Verificar variables mínimas requeridas
if [ -z "$BOT_TOKEN" ]; then
    echo "⚠️  Variable BOT_TOKEN no encontrada en el entorno."
    read -p "Ingresa tu BOT_TOKEN de Telegram: " BOT_TOKEN
    export BOT_TOKEN="$BOT_TOKEN"
fi

if [ -z "$SUPABASE_URL" ]; then
    echo "⚠️  Variable SUPABASE_URL no encontrada en el entorno."
    read -p "Ingresa tu SUPABASE_URL: " SUPABASE_URL
    export SUPABASE_URL="$SUPABASE_URL"
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "⚠️  Variable SUPABASE_SERVICE_ROLE_KEY no encontrada en el entorno."
    read -sp "Ingresa tu SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY
    echo ""
    export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
fi

# Variables opcionales con valores por defecto
if [ -z "$DASHBOARD_USER" ]; then
    export DASHBOARD_USER="admin"
fi

if [ -z "$DASHBOARD_PASS" ]; then
    export DASHBOARD_PASS="cubamodel2024"
fi

echo "✅ Variables de entorno configuradas"

# Navegar al directorio web-panel para el despliegue
cd web-panel

echo "🏗️  Iniciando despliegue en Vercel..."

# Hacer login si es necesario (esto abrirá el navegador)
echo "🔐 Verificando autenticación en Vercel..."
vercel whoami &>/dev/null || vercel login

# Desplegar directamente a producción
echo "🚀 Desplegando a producción..."
vercel --prod --env BOT_TOKEN="$BOT_TOKEN" --env SUPABASE_URL="$SUPABASE_URL" --env SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" --env DASHBOARD_USER="$DASHBOARD_USER" --env DASHBOARD_PASS="$DASHBOARD_PASS"

echo ""
echo "✅ ¡Despliegue completado!"
echo ""
echo "📝 Próximos pasos:"
echo "1. Configura el webhook de tu bot visitando: https://tu-dominio.vercel.app/api/run-setup"
echo "2. Accede al panel de administración con las credenciales configuradas"
echo "3. Verifica que todo funcione correctamente"
echo ""
echo "🎉 ¡Tu CubaModel Bot está ahora en producción!"
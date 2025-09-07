# 🚀 CubaModel Bot - Listo para Vercel

## ✅ Estado del Proyecto
Tu proyecto está **completamente configurado** y listo para desplegarse en Vercel.

## 📋 Pre-Requisitos
Antes de desplegar, asegúrate de tener:

1. **Bot Token de Telegram** - Obtenido de @BotFather
2. **Credenciales de Supabase**:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPABASE_ANON_KEY
3. **Credenciales del Panel Admin** (opcionales):
   - DASHBOARD_USER (por defecto: admin)
   - DASHBOARD_PASS (por defecto: cubamodel2024)

## 🚀 Métodos de Despliegue

### Opción 1: Script Automatizado
```bash
# Script completo con configuración interactiva
./deploy-to-vercel.sh
```

### Opción 2: Despliegue Rápido
```bash
# Script rápido usando variables de entorno
export BOT_TOKEN="tu_bot_token_aqui"
export SUPABASE_URL="tu_supabase_url"
export SUPABASE_SERVICE_ROLE_KEY="tu_service_key"
./quick-deploy.sh
```

### Opción 3: Manual con Vercel CLI
```bash
# 1. Instalar Vercel CLI
npm install -g vercel

# 2. Navegar al directorio web-panel
cd web-panel

# 3. Hacer login
vercel login

# 4. Configurar variables de entorno
vercel env add BOT_TOKEN production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add DASHBOARD_USER production
vercel env add DASHBOARD_PASS production

# 5. Desplegar
vercel --prod
```

## 🔧 Post-Despliegue

Después del despliegue exitoso:

1. **Configurar Webhook**: Visita `https://tu-dominio.vercel.app/api/run-setup`
2. **Acceder al Panel**: Visita `https://tu-dominio.vercel.app` 
3. **Probar el Bot**: Envía `/start` a tu bot en Telegram

## 📁 Estructura del Proyecto
```
├── web-panel/          # Aplicación Next.js
├── api/               # Endpoints serverless
├── src/               # Código del bot
├── vercel.json        # Configuración Vercel
└── scripts/           # Scripts de despliegue
```

## 🔗 URLs Importantes Post-Despliegue
- Panel Admin: `https://tu-dominio.vercel.app`
- Webhook Setup: `https://tu-dominio.vercel.app/api/run-setup`
- API Status: `https://tu-dominio.vercel.app/api/status`
- Bot Webhook: `https://tu-dominio.vercel.app/api/webhook`

## 🎯 Funcionalidades Listas
- ✅ Dashboard administrativo moderno
- ✅ Gestión de teléfonos y reportes
- ✅ Bot de Telegram completamente funcional
- ✅ Integración con Supabase
- ✅ Exportación de datos
- ✅ Sistema de autenticación
- ✅ Configuración automática de webhook

¡Tu CubaModel Bot está listo para producción! 🎉
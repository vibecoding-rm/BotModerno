# 🚀 CubaModel Bot - Despliegue en Cloudflare Pages

## ✅ Configuración Completada

Tu bot está completamente configurado para Cloudflare Pages con:
- ✅ Funciones de Cloudflare para webhook y APIs
- ✅ GitHub Actions para CI/CD automático
- ✅ Base de datos Supabase con RLS configurado
- ✅ Bot optimizado para DM vs grupos
- ✅ Panel web Next.js exportable

## 📋 Pasos para Despliegue

### 1. Configurar Secretos en GitHub

En tu repositorio GitHub, ve a **Settings > Secrets and Variables > Actions** y agrega:

```
CLOUDFLARE_API_TOKEN=tu_token_de_cloudflare
CLOUDFLARE_ACCOUNT_ID=tu_account_id
BOT_TOKEN=tu_bot_token_telegram
```

### 2. Configurar Secretos en Cloudflare Pages

En tu proyecto de Cloudflare Pages, ve a **Settings > Environment Variables** y agrega:

```
BOT_TOKEN=tu_bot_token_telegram
SUPABASE_URL=tu_supabase_url
SUPABASE_SERVICE_ROLE_KEY=tu_supabase_service_key
SUPABASE_ANON_KEY=tu_supabase_anon_key
ADMIN_TG_IDS=ids_de_admins_separados_por_comas
ALLOWED_CHAT_IDS=ids_de_chats_permitidos
NODE_ENV=production
```

### 3. Crear Proyecto en Cloudflare Pages

1. Ve a [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Páginas > Crear proyecto
3. Conecta tu repositorio GitHub
4. Configuración de build:
   - **Framework**: Next.js
   - **Comando de build**: `npm run build`
   - **Directorio de output**: `web-panel/out`

### 4. Configurar Webhook Automáticamente

Una vez desplegado, visita:
```
https://tu-proyecto.pages.dev/api/setup-webhook
```

## 🤖 Funcionalidades del Bot

### Comandos por DM (Direct Message):
- `/start` - Mensaje de bienvenida
- `/subir` - Iniciar asistente para agregar teléfono
- `/reportar <id> <texto>` - Reportar error en un teléfono
- `/suscribir` - Suscribirse a notificaciones
- `/cancelar` - Cancelar asistente actual

### Comandos en Grupos:
- `/start` - Mensaje de bienvenida
- `/revisar` - Ver últimos teléfonos verificados (SOLO EN GRUPOS)
- `/suscribir` - Suscribirse a notificaciones

## 🔐 Seguridad (RLS)

La base de datos está configurada con Row Level Security:
- **phones**: Lectura pública, escritura con autenticación
- **submission_drafts**: Solo service_role (bot)
- **reports**: Solo service_role
- **subscriptions**: Solo service_role
- **events**: Solo service_role

## 📁 Estructura del Proyecto

```
├── functions/api/          # Cloudflare Functions
├── web-panel/             # Next.js app
├── src/                   # Bot logic
├── sql/                   # Database schemas
├── .github/workflows/     # GitHub Actions
└── wrangler.toml          # Cloudflare config
```

## 🔗 URLs Post-Despliegue

- Panel Admin: `https://tu-proyecto.pages.dev`
- Webhook Setup: `https://tu-proyecto.pages.dev/api/setup-webhook`
- API Status: `https://tu-proyecto.pages.dev/api/status`
- Bot Webhook: `https://tu-proyecto.pages.dev/api/webhook`

¡Tu bot está listo para Cloudflare! 🎉
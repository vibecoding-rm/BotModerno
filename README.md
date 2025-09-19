# Deploy actualizado: Septiembre 2025
# CubaModel Bot — Cloudflare Workers + Supabase (edge)

[![Deploy: Cloudflare Workers](https://github.com/devmaikelrm/BotModerno/actions/workflows/cloudflare-deploy.yml/badge.svg?branch=main)](https://github.com/devmaikelrm/BotModerno/actions/workflows/cloudflare-deploy.yml)
<!-- Cloudflare Pages disabled
[![Deploy: Cloudflare Pages](https://github.com/devmaikelrm/BotModerno/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/devmaikelrm/BotModerno/actions/workflows/deploy.yml)
-->
[![Deploy: Vercel Hook](https://github.com/devmaikelrm/BotModerno/actions/workflows/vercel-deploy.yml/badge.svg?branch=main)](https://github.com/devmaikelrm/BotModerno/actions/workflows/vercel-deploy.yml)

Este repo unifica el bot de Telegram para Cloudflare Workers con integración a Supabase, sin dependencias Node en el runtime del Worker (sin Telegraf). El panel web (Next.js) puede mantenerse aparte, pero el bot funciona 100% en Workers vía webhook.

## Instalación y desarrollo

1. Clona el repo y instala dependencias:
   ```
   npm install
   ```

2. Configura ESLint:
   ```
   npm run lint
   npm run lint:fix
   ```

3. Para desarrollo local:
   ```
   npm run dev
   ```

## Estructura
- src/worker.js — Entrada única del Worker (fetch handler)
- src/bot-simple.js — Lógica del bot (Telegram API via fetch + Supabase)
- src/validation.js — Validación de payloads con Zod
- src/logger.js — Logging estructurado
- .eslintrc.js — Configuración de ESLint
- wrangler.toml — Config del Worker
- sql/ — Scripts SQL para Supabase

## Requisitos de tablas (Supabase)
- phones(id, commercial_name, model, works, bands, provinces, observations, created_at)
- submission_drafts(tg_id, step, commercial_name, model, works, bands, provinces, observations, updated_at)
- reports(id, tg_id, chat_id, model, reason, created_at)
- subscriptions(tg_id, created_at)

Índices recomendados: index en phones(model). Guardar model en UPPERCASE.

## Variables y secretos (Cloudflare)
Configúralos como secretos en Workers (nunca en código):
- BOT_TOKEN (Telegram)
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (solo Worker)
- TG_WEBHOOK_SECRET (cadena aleatoria larga)
- ADMIN_TG_IDS (csv)
- ALLOWED_CHAT_IDS (csv opcional)

Comandos para configurar secretos:
```
wrangler secret put BOT_TOKEN
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TG_WEBHOOK_SECRET
wrangler secret put ADMIN_TG_IDS
wrangler secret put ALLOWED_CHAT_IDS
```

## Seguridad y mejores prácticas
- ✅ Secretos en Wrangler, no en código
- ✅ Validación de payloads con Zod
- ✅ Logging estructurado sin datos sensibles
- ✅ RLS en Supabase con políticas service_role
- ✅ Respuesta inmediata al webhook (<1s)
- ✅ Manejo de idempotencia por update_id
- ✅ Bundle pequeño (sin dependencias pesadas)

## Deploy (Worker del bot)
- Revisar wrangler.toml (name, main, compatibility_date)
- Publicar:
```
npm run deploy
```

## Deploy del Panel (Cloudflare Pages)
- Directorio: web/
- Build command: npm ci && npm run build
- Build output: dist
- Functions: activar Pages Functions y mapear la carpeta functions/ (en el root del repo)
- Variables de entorno (Frontend): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
- Variables de entorno (Functions): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- En Supabase Auth, agregar redirect: https://<tu-pages>.pages.dev/auth/callback

## Configurar el webhook de Telegram
Suponiendo tu worker quede en: https://<tu-subdominio>.workers.dev
- Endpoint final del webhook:
```
https://<tu-subdominio>.workers.dev/webhook/<TG_WEBHOOK_SECRET>
```
- Llamada para setear webhook:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<tu-subdominio>.workers.dev/webhook/<TG_WEBHOOK_SECRET>
```

## Rutas del Worker
- GET / → "OK CubaModel Bot Worker"
- POST /webhook/<TG_WEBHOOK_SECRET> → procesa updates de Telegram (siempre responde 200)
- Cualquier otra → 404

## Uso del bot
- /start — mensaje de bienvenida y ayuda
- /subir (DM) — inicia asistente por pasos con inline keyboard
- /revisar (grupo) — búsqueda por modelo (case/acentos insensible)
- /cancelar — cancela asistente
- /reportar — reporte simple
- /suscribir /cancelarsub — alta/baja en subscriptions

Notas:
- En DM, /subir nunca muestra el cartel de /revisar.
- Guardado de model en UPPERCASE.
- Si no hay resultados en /revisar: sugiere usar /subir.
- Filtrado de grupos por ALLOWED_CHAT_IDS si se configuró.

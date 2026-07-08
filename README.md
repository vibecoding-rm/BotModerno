# CubaModel Bot - Cloudflare Workers + D1

Bot de Telegram para consultar y aportar compatibilidad de teléfonos con las redes de Cuba (ETECSA). Corre 100% en Cloudflare Workers (sin Telegraf ni dependencias pesadas) con base de datos D1 y KV para el estado del captcha.

> El antiguo panel web Next.js (`web-panel/`) y sus Pages Functions (`functions/`) dependían de Supabase, que dejó de existir; se eliminaron del repo en julio de 2026. La administración se hace por Telegram (`/pendientes`).

## Instalación y desarrollo

```
npm install
npm run dev      # wrangler dev
npm run lint
```

## Estructura
- src/worker.js - Entrada del Worker (fetch handler, cron, endpoints admin)
- src/bot-simple.js - Lógica del bot (Telegram API vía fetch + D1)
- src/validation.js - Validación de payloads con Zod
- src/logger.js - Logging estructurado
- wrangler.toml - Config del Worker (bindings DB/APP_KV, cron, vars)
- sql/schema_d1.sql - Esquema vigente de D1 (`init.sql` y `phones.sql` son legado Supabase)
- backup/ - Respaldo local de la migración Supabase → D1

## Tablas (D1)
- phones(id, commercial_name, model, works, bands, provinces, observations, status, nombre_comercial, created_at)
- submission_drafts(tg_id, step, commercial_name, model, works, bands, provinces, observations, updated_at)
- reports(id, tg_id, chat_id, model, reason, created_at)
- subscriptions(tg_id, created_at)

`nombre_comercial` se normaliza en JS (minúsculas, sin acentos) para búsqueda; `bands`/`provinces` se guardan como JSON array en texto.

## Variables y secretos (Cloudflare)
Bindings en wrangler.toml: `DB` (D1 `cubamodel`), `APP_KV` (KV), vars `ALLOWED_CHAT_IDS`, `ADMIN_TG_IDS`.

Secretos (nunca en código):
```
wrangler secret put BOT_TOKEN
wrangler secret put TG_WEBHOOK_SECRET
```

## Deploy
```
npm run deploy
```
Luego registrar webhook y comandos:
```
GET https://<tu-worker>.workers.dev/setup-webhook/<TG_WEBHOOK_SECRET>
```

## Rutas del Worker
- GET / -> "OK CubaModel Bot Worker"
- POST /webhook/<TG_WEBHOOK_SECRET> -> procesa updates de Telegram (siempre responde 200)
- GET /setup-webhook/<TG_WEBHOOK_SECRET> -> registra webhook + setMyCommands
- GET /chat-info/<TG_WEBHOOK_SECRET> -> info de chats conocidos
- Cualquier otra -> 404

## Uso del bot
- /start - bienvenida y menú
- /revisar <modelo> - búsqueda por modelo (case/acentos insensible, paginada)
- /subir - asistente por pasos para proponer un teléfono (en el grupo)
- /bandas - guía de bandas 4G en Cuba
- /reglas /fijar - reglas del grupo
- /exportar - descarga CSV/JSON
- /reportar - reportar un error en los datos
- /suscribir /cancelarsub - avisos de novedades
- /ayuda - ayuda general
- /pendientes - (admin) moderar propuestas con botones Aprobar/Rechazar

Notas:
- El bot solo opera en el grupo autorizado (ALLOWED_CHAT_IDS); en privado solo responde a los admins (ADMIN_TG_IDS).
- Si no hay resultados en /revisar, sugiere usar /subir.

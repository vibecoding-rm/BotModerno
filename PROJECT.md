# Project: BotModerno

## Architecture
- **Telegram Bot**: Cloudflare Worker (`src/worker.js`, `src/bot-simple.js`) that processes webhook payloads.
- **Database**: Cloudflare D1 (`cubamodel`) storing phones, reports, drafts, subscriptions, and bot settings. Schema in `sql/schema_d1.sql`.
- **Captcha state**: Cloudflare KV (`APP_KV`).

> Nota histórica: el panel web Next.js (`web-panel/`) y las Pages Functions (`functions/`) dependían de Supabase, que dejó de existir. Se eliminaron del repo en julio de 2026.

## Interface Contracts
### Bot ↔ D1
- Read/write tables: `phones`, `submission_drafts`, `reports`, `subscriptions`, `bot_config`, `pending_notifications`, `events`.
- Column names: `works` (0/1), `status` (para filtrar aprobados), `nombre_comercial` (normalizado en JS: minúsculas sin acentos), `bands`/`provinces` (JSON array como texto).
- `bot_config` se lee en runtime: `captcha_enabled`, `captcha_timeout` (segundos), `auto_approve_join`, `rules`, `welcome`.
- Mensajes salientes: `parse_mode` HTML por defecto (datos de usuario pasan por `escapeHtml`); `'plain'` para textos de `bot_config`.
- Avisos a suscriptores: se encolan en `pending_notifications` y el cron (cada 5 min) envía lotes de 30 para respetar los 50 subrequests/request del plan gratis.

## Code Layout
- `src/`: Cloudflare Worker source code
- `sql/`: SQL schema definition and migrations (`schema_d1.sql` es el vigente; `init.sql`/`phones.sql` son legado Supabase)
- `backup/`: respaldo local de la migración Supabase → D1

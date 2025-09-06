
# CubaModel Bot — Vercel + Supabase (Monorepo, One Project)

This project contains:
- **Next.js dashboard** (Vercel) under `web-panel/`
- **Telegram bot webhook** as Next.js API route: `web-panel/pages/api/webhook.js`
- **Supabase integration** with SQL schema in `sql/init.sql`

## Quick Start

1) Create a Telegram bot and get `BOT_TOKEN` from @BotFather.
2) Create a Supabase project and get `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`.
3) In Supabase SQL editor, run `sql/init.sql` (creates tables and RLS).
4) Click **"Import Project"** in Vercel and select the `web-panel/` folder as the root.
5) Add Environment Variables in Vercel (Project Settings → Environment Variables):
```
BOT_TOKEN=xxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi... (anon key)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... (service role; DO NOT expose in client)
ADMIN_TG_IDS=123456789,987654321
ALLOWED_CHAT_IDS=-1001234567890,-100987654321
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi... (anon key)
```

6) Deploy on Vercel. After first deploy, set the Telegram webhook (replace the URL below with your deployment URL):
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-vercel-domain>/api/webhook
```

You can also enable **Auto Deploy**. The dashboard home shows the 3 status cards (Bot token, DB client, Vercel deploy).


## Admin & Seguridad

- Panel de administración: `/admin/phones` (CRUD, export JSON/CSV)
- Protegido con **HTTP Basic Auth** vía `middleware.js` (variables `DASHBOARD_USER`, `DASHBOARD_PASS`).
- Métricas de usuarios activos (últimos 7 días) usando tabla `events`.
- `/api/run-setup` intenta configurar el webhook automáticamente usando tu dominio de Vercel.

### Variables extra (Vercel → Environment Variables)

```
DASHBOARD_USER=admin
DASHBOARD_PASS=<elige-una-segura>
```

# Forzar redeploy en Vercel: commit automático
# BotModerno — Panel + Webhook (Vercel + Supabase)
Generado: 2025-09-06T22:13:36

- Next.js (panel + API webhook) en `web-panel/`
- SQL en `sql/init.sql`
- Admin CRUD en `/admin/phones` (Basic Auth)

Pasos:
1) Ejecuta `sql/init.sql` en Supabase.
2) En Vercel: Root Directory = `web-panel/` y variables de entorno (BOT_TOKEN, SUPABASE_*, NEXT_PUBLIC_*, DASHBOARD_*).
3) Deploy y abre `/api/run-setup` para configurar el webhook automáticamente.

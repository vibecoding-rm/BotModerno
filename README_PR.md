# CubaModel Bot — PR de mejoras

Este PR implementa:
- Wizard persistente `/subir` con `submission_drafts`
- Comandos `/cancelar`, `/reportar`, `/suscribir`
- Panel Next.js 100% SSR con Basic Auth (Edge)
- Endpoints de export (CSV/JSON)
- Páginas SSR: `/` (pendientes), `/approved`, `/exports`, `/reports`
- SQL de nuevas tablas en `sql/`
- Esqueletos de tests (Jest + Playwright)

## Estructura
```
/api/webhook.js                # Webhook del bot (Vercel)
/src/registerBot.js            # Registro de Telegraf
/src/wizard.js                 # Lógica del wizard y helpers
/web-panel/middleware.js       # Basic Auth Edge
/web-panel/pages/*.js          # Páginas SSR y APIs
/sql/*.sql                     # Migraciones
/tests/*                       # Config y tests
```

## Variables de entorno (Vercel)
### Bot (Proyecto raíz)
- `BOT_TOKEN`
- `TG_WEBHOOK_SECRET` (opcional)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TG_IDS` (coma-separado)
- `ALLOWED_CHAT_IDS` (coma-separado, opcional)

### Panel (`/web-panel`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (solo server)
- `PANEL_USER`
- `PANEL_PASS`

Marcar en Vercel para `Production`, `Preview` y `Development`.

## Deploy rápido
1. Subir SQL desde el dashboard de Supabase o con CLI (3 archivos en `sql/`).
2. En Vercel crear proyecto del bot (raíz) y del panel (`/web-panel` si es monorepo o proyecto aparte).
3. Añadir variables de entorno listadas arriba en cada proyecto.
4. Telegram: configurar webhook del bot apuntando a `https://<tu-app>.vercel.app/api/webhook`.
5. Probar en DM: `/subir`, `/cancelar`. En grupo, `/subir` debe redirigir a DM.

## Export
- `/web-panel/exports` ofrece JSON y CSV (bandas unidas por `|`, comillas escapadas).

## Notas
- No exponemos `SUPABASE_SERVICE_ROLE_KEY` en cliente; todo vive en SSR/API.
- Si tu tabla `phones` difiere, ajusta el insert en `src/wizard.js`.


## Dashboard estilo "Replit"
- Página: `/web-panel/pages/dashboard.js` (SSR) con Tailwind.
- Necesitas definir `BOT_STATUS_URL` en el **panel** apuntando a `https://<tu-bot>.vercel.app/api/status`.
- Bot expone `api/status.js` sin revelar secretos.
- Botones: **Run Full Setup Script** llama a `/web-panel/api/full-setup` (requiere RPC `exec_sql` en Supabase).


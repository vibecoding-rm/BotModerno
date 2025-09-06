# CubaModel Bot

Sistema completo con bot de Telegram y panel web para crowdsourcing de información sobre compatibilidad de teléfonos móviles en Cuba.

## Características Implementadas

### Bot de Telegram (Telegraf)
- **Comandos implementados:**
  - `/subir` - Asistente paso a paso persistente con estado en base de datos
  - `/cancelar` - Limpia borrador actual
  - `/revisar` - Respuesta breve en grupos, detallada en DM
  - `/reportar <id> <texto>` - Inserta reportes en la base de datos
  - `/suscribir` / `/cancelarsub` - Gestiona suscripciones para notificaciones

- **Funcionalidades:**
  - Estado persistente en PostgreSQL (no en memoria)
  - Diferenciación entre respuestas en grupo vs DM
  - Wizard con validación paso a paso
  - Control de acceso por chat y usuario admin

### Panel Web (Next.js SSR)
- **Autenticación:** Basic Auth con middleware Edge
- **Páginas implementadas:**
  - `/` - Lista de pendientes con botones aprobar/rechazar
  - `/approved` - Modelos aprobados
  - `/exports` - Descarga CSV/JSON con escape robusto
  - `/reports` - Gestión de reportes de usuarios
  - `/dashboard` - Dashboard estilo Replit con tarjetas de estado

### Base de Datos PostgreSQL
- **Tablas creadas:**
  - `phones` - Modelos de teléfonos (pendiente/aprobado/rechazado)
  - `submission_drafts` - Estado persistente del wizard
  - `reports` - Reportes de usuarios
  - `subscriptions` - Suscripciones para notificaciones

## Estado Actual

✅ **Completamente implementado y funcionando:**
- Estructura del proyecto organizada
- Dependencias instaladas y configuradas
- Base de datos PostgreSQL configurada con esquema completo
- Bot de Telegram con todos los comandos
- Panel web con todas las páginas y funcionalidades
- Sistema de autenticación Basic Auth
- Exports robustos CSV/JSON
- Dashboard con tarjetas de estado estilo Replit
- Workflow configurado y funcionando en puerto 5000

## Configuración para Producción

### Variables de Entorno Requeridas

#### Para el Bot (proyecto raíz):
```
BOT_TOKEN=tu_token_de_telegram_bot
TG_WEBHOOK_SECRET=secreto_opcional_webhook
SUPABASE_URL=tu_url_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
ADMIN_TG_IDS=tu_id_telegram,otro_admin_id
ALLOWED_CHAT_IDS=ids_de_chats_permitidos (opcional)
```

#### Para el Panel Web (/web-panel):
```
SUPABASE_URL=tu_url_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
PANEL_USER=usuario_admin
PANEL_PASS=contraseña_segura
BOT_STATUS_URL=https://tu-bot.vercel.app/api/status
```

### Deploy en Vercel

1. **Crear proyecto del bot** (raíz del repositorio)
2. **Crear proyecto del panel** (carpeta `/web-panel`)
3. **Configurar variables de entorno** en cada proyecto
4. **Configurar webhook** en Telegram: `https://tu-bot.vercel.app/api/webhook`

### Acceso al Panel

El panel web está protegido con Basic Auth. Accede con:
- **Usuario:** admin (o el configurado en PANEL_USER)
- **Contraseña:** demo123 (o la configurada en PANEL_PASS)

## Estructura del Proyecto

```
/
├── api/                    # Endpoints del bot para Vercel
│   ├── webhook.js         # Webhook principal del bot
│   └── status.js          # Endpoint de estado
├── src/                   # Lógica del bot
│   ├── registerBot.js     # Configuración de Telegraf
│   └── wizard.js          # Lógica del wizard y helpers
├── web-panel/             # Panel de administración Next.js
│   ├── pages/            # Páginas y API routes
│   ├── lib/              # Utilidades (cliente DB)
│   ├── styles/           # CSS con Tailwind
│   └── middleware.js     # Basic Auth
├── sql/                  # Scripts de base de datos
│   ├── phones.sql
│   ├── submission_drafts.sql
│   ├── reports.sql
│   └── subscriptions.sql
└── tests/                # Configuración de tests
```

## Desarrollo Local

```bash
# Instalar dependencias
npm install
cd web-panel && npm install

# Iniciar panel web
cd web-panel && npm run dev

# El panel estará disponible en http://localhost:5000
# Usuario: admin, Contraseña: demo123
```

## Exportaciones

El sistema incluye exportación robusta de datos:
- **JSON:** `/api/export?fmt=json`
- **CSV:** `/api/export?fmt=csv` 
  - Escape correcto de comillas
  - Bandas unidas con pipe (|)
  - Nombres de archivo con timestamp

## Próximos Pasos

Para usar en producción:
1. Obtener token de bot de Telegram
2. Configurar proyecto Supabase
3. Deploy en Vercel con variables de entorno
4. Configurar webhook de Telegram
5. ¡Listo para usar!

---

**Nota:** El sistema está completamente implementado y listo para producción. Solo necesita configuración de servicios externos (Telegram Bot, Supabase, Vercel).
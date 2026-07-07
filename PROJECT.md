# Project: BotModerno Audit & Improvements

## Architecture
- **Telegram Bot**: Cloudflare Worker (`src/worker.js`, `src/bot-simple.js`) that processes webhook payloads.
- **Web Panel**: Next.js app (`web-panel/`) and Cloudflare Pages Functions (`functions/`) for administration and status monitoring.
- **Database**: Supabase database storing phones, reports, drafts, subscriptions, and bot settings.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Exploration & Analysis | Codebase analysis, audit report | none | DONE |
| 2 | Refactoring & Credentials Rotation | Remove hardcoded Supabase credentials, replace with env variables | none | PLANNED |
| 3 | SQL Schema & Migrations | Create migrations for tables, user_roles, bot_config columns, clean SQL folder | none | PLANNED |
| 4 | Bot Logic & UX Improvements | Database-level search, inline keyboards, Captcha variables, allowed_updates | M2, M3 | PLANNED |
| 5 | Verification & Lint checks | Run lint and compile checks, verify worker runs | M2, M3, M4 | PLANNED |
| 6 | Audit Report Generation | Produce AUDIT_REPORT.md | M5 | PLANNED |

## Interface Contracts
### Bot ↔ Supabase
- Read/write tables: `phones`, `submission_drafts`, `reports`, `subscriptions`, `bot_config`, `user_roles`.
- Column names: `works` (not `works_in_cuba`), `status` (for filtering approved phones).
- Authentication: Uses environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Cloudflare Workers and Next.js / Pages functions.

## Code Layout
- `src/`: Cloudflare Worker source code
- `sql/`: SQL schema definition and migrations
- `web-panel/`: Next.js web dashboard
- `functions/`: Cloudflare Pages functions for web panel backend

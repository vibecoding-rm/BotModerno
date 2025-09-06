# Changelog (PR)

## v2.1.0 -> v2.2.0
- Add persistent submission wizard using `submission_drafts`.
- Add `/reportar`, `/suscribir`, `/cancelar` commands.
- Panel moved to full SSR (no supabase-js en cliente). Basic Auth via Edge middleware.
- Exports: robust CSV/JSON.
- SQL migrations for `submission_drafts`, `reports`, `subscriptions`.
- Tests skeletons (Jest + Playwright).

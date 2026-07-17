-- Migration 0007: watchlist de búsquedas — /seguir <modelo>
-- El usuario recibe un DM cuando se aprueba un teléfono que coincide.
CREATE TABLE IF NOT EXISTS watchlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      TEXT NOT NULL,
  query      TEXT NOT NULL,        -- búsqueda normalizada en minúsculas
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_tg ON watchlist(tg_id);

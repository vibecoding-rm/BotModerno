-- Migration 0005: votos 👍/👎 por ficha de teléfono.
-- Un voto por usuario por teléfono (PK compuesta); re-votar cambia el sentido y
-- votar lo mismo dos veces lo quita (toggle, gestionado en la app).
CREATE TABLE IF NOT EXISTS phone_votes (
  phone_id   INTEGER NOT NULL,
  tg_id      INTEGER NOT NULL,
  vote       INTEGER NOT NULL,   -- 1 = 👍 (funcionó), -1 = 👎 (no funcionó)
  created_at TEXT NOT NULL,
  PRIMARY KEY (phone_id, tg_id)
);

-- Conteo por teléfono para la vista de resultados
CREATE INDEX IF NOT EXISTS idx_phone_votes_phone ON phone_votes(phone_id);

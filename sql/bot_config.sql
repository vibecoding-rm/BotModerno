-- Bot configuration table for storing rules and welcome messages
CREATE TABLE IF NOT EXISTS bot_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rules TEXT DEFAULT '',
  welcome TEXT DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO bot_config (id, rules, welcome) 
VALUES (1, 
  '1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.',
  '👋 ¡Bienvenido {fullname} a CubaModel! 🇨🇺📱

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.
Aquí todo es distinto: la información será siempre abierta y descargable.

⚠️ Limitaciones:
• Puede ir lento en horas pico.
• Hay topes de consultas y almacenamiento.
• Puede caerse o fallar a veces (fase de desarrollo).

📜 Reglas:
1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.

Gracias por sumarte. Esto es de todos y para todos. ✨'
) ON CONFLICT (id) DO NOTHING;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bot_config_id ON bot_config(id);

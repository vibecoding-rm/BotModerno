// src/lib/events.js
import { createClient } from '@supabase/supabase-js';

export function supaAdmin(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function logEvent(env, type, payload = {}) {
  try {
    const sb = supaAdmin(env);
    await sb.from('events').insert({ type, payload });
  } catch (_) { /* evitar romper el webhook por errores de log */ }
}
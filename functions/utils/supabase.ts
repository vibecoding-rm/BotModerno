import { createClient } from '@supabase/supabase-js'

export function adminClient(env: any) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch },
  })
  return supabase
}

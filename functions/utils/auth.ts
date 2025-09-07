import { createClient } from '@supabase/supabase-js'

export async function getUserFromToken(env: any, token?: string) {
  if (!token) return null
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { fetch },
    })
    const { data } = await supabase.auth.getUser(token)
    return data.user
  } catch {
    return null
  }
}

export async function ensureRole(env: any, userId: string, roles: string[]) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch },
  })
  const { data } = await supabase
    .from('public.user_roles')
    .select('role')
    .eq('user_id', userId)
  const has = (data || []).some(r => roles.includes(r.role))
  return has
}

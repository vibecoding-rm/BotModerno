import { adminClient } from '../../../utils/supabase'
import { getUserFromToken, ensureRole } from '../../../utils/auth'

export const onRequestPost: PagesFunction = async (ctx) => {
  const { request, env } = ctx
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    const me = await getUserFromToken(env, token)
    if (!me) return new Response('Unauthorized', { status: 401 })
    const isAdmin = await ensureRole(env, me.id, ['admin','moderator'])
    if (!isAdmin) return new Response('Forbidden', { status: 403 })

    const body = await request.json() as { id: number }
    const db = adminClient(env)

    await db.from('phones_pending').delete().eq('id', body.id)

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response('Error', { status: 500 })
  }
}

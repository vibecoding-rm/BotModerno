import { adminClient } from '../../utils/supabase'
import { getUserFromToken, ensureRole } from '../../utils/auth'

export const onRequestGet: PagesFunction = async (ctx) => {
  const { request, env } = ctx
  try {
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') || '1')
    const size = 50
    const from = (page - 1) * size
    const model = url.searchParams.get('model') || ''
    const since = url.searchParams.get('since') // ISO date

    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    const me = await getUserFromToken(env, token)
    if (!me) return new Response('Unauthorized', { status: 401 })
    const isAdmin = await ensureRole(env, me.id, ['admin','moderator'])
    if (!isAdmin) return new Response('Forbidden', { status: 403 })

    const db = adminClient(env)
    let query = db
      .from('reports')
      .select('id, tg_id, chat_id, model, reason, created_at')
      .order('created_at', { ascending: false })

    if (model) query = query.ilike('model', `%${model}%`)
    if (since) query = query.gte('created_at', since)

    const { data, error } = await query.range(from, from + size - 1)
    if (error) throw error

    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response('Error', { status: 500 })
  }
}

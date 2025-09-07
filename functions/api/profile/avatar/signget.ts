import { adminClient } from '../../../../utils/supabase'
import { getUserFromToken } from '../../../../utils/auth'

export const onRequestGet: PagesFunction = async (ctx) => {
  const { request, env } = ctx
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    const me = await getUserFromToken(env, token)
    if (!me) return new Response('Unauthorized', { status: 401 })

    const db = adminClient(env)
    const path = `${me.id}/avatar.png`

    const { data, error } = await db.storage
      .from('avatars')
      .createSignedUrl(path, 120) // 2 min
    if (error) throw error

    return new Response(JSON.stringify({ url: data.signedUrl }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response('Error', { status: 500 })
  }
}

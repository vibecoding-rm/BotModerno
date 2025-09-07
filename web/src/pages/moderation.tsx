import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Moderation() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState<boolean | null>(null)

  async function checkRole() {
    try {
      const user = (await supabase.auth.getUser()).data.user
      if (!user) { setAllowed(false); return }
      // requiere RLS que permita leer solo su propio registro en user_roles
      const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', user.id)
      if (error) {
        console.error('Role check error:', error)
        setAllowed(false)
        return
      }
      const roles = (data || []).map(r => r.role)
      setAllowed(roles.includes('admin') || roles.includes('moderator'))
    } catch (err) {
      console.error('Role check error:', err)
      setAllowed(false)
    }
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('phones_pending')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (!error) setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { (async () => { await checkRole(); await load() })() }, [])

  async function approve(id: number) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const r = await fetch('/api/admin/phones/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id })
    })
    if (r.ok) {
      alert('¡Hecho! ✅')
      await load()
    } else alert('Se enredó la cosa 😅')
  }
  async function reject(id: number) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const r = await fetch('/api/admin/phones/reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id })
    })
    if (r.ok) {
      alert('¡Hecho! ✅')
      await load()
    } else alert('Se enredó la cosa 😅')
  }

  if (allowed === false) return <div className="p-4">No tienes permiso.</div>

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Pendientes</h2>
      {loading ? <div>Cargando…</div> : rows.length === 0 ? <div>Aquí no hay ná… todavía.</div> : (
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <div className="font-medium">{r.commercial_name} ({r.model})</div>
              <div className="text-sm opacity-80">Bandas: {Array.isArray(r.bands) ? r.bands.join(', ') : r.bands}</div>
              <div className="text-sm opacity-80">Prov: {Array.isArray(r.provinces) ? r.provinces.join(', ') : r.provinces}</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => approve(r.id)} className="px-3 py-1.5 rounded bg-emerald-600 text-white">Aprobar</button>
                <button onClick={() => reject(r.id)} className="px-3 py-1.5 rounded bg-rose-600 text-white">Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

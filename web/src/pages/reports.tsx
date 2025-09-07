import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Reports() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [since, setSince] = useState('')

  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true)
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const url = new URL('/api/admin/reports', window.location.origin)
      if (q) url.searchParams.set('model', q)
      if (since) url.searchParams.set('since', since)
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (r.ok) {
        const json = await r.json()
        setRows(json.data || [])
      } else setRows([])
      setLoading(false)
    }, 300)
    return () => clearTimeout(id)
  }, [q, since])

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-xl font-semibold">Reportes</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar por modelo" className="rounded border p-2 bg-white dark:bg-gray-900" />
          <input type="datetime-local" value={since} onChange={e => setSince(e.target.value)} className="rounded border p-2 bg-white dark:bg-gray-900" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow overflow-x-auto">
        {loading ? <div>Cargando…</div> : rows.length === 0 ? <div>Aquí no hay ná… todavía.</div> : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">ID</th>
                <th className="p-2">Modelo</th>
                <th className="p-2">Razón</th>
                <th className="p-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.id}</td>
                  <td className="p-2">{r.model || '—'}</td>
                  <td className="p-2">{r.reason}</td>
                  <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

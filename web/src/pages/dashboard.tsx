import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

function download(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Dashboard() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('phones')
          .select('id, commercial_name, model, works, bands, provinces, observations, created_at')
          .ilike('model', `%${q}%`)
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) {
          console.error('Dashboard query error:', error)
          setRows([])
        } else {
          setRows(data || [])
        }
      } catch (err) {
        console.error('Dashboard error:', err)
        setRows([])
      }
      setLoading(false)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const csv = useMemo(() => {
    const header = ['id','commercial_name','model','works','bands','provinces','observations','created_at']
    const lines = [header.join(',')]
    for (const r of rows) {
      const vals = header.map(h => {
        const v = r[h]
        if (Array.isArray(v)) return '"' + v.join('|').replaceAll('"','""') + '"'
        if (typeof v === 'string') return '"' + v.replaceAll('"','""') + '"'
        if (v == null) return ''
        return String(v)
      })
      lines.push(vals.join(','))
    }
    return lines.join('\n')
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-xl font-semibold">Buscar</h2>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por modelo" className="mt-2 w-full rounded border p-2 bg-white dark:bg-gray-900" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow overflow-x-auto">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => download('phones.json', JSON.stringify(rows, null, 2), 'application/json')} className="px-3 py-1.5 rounded bg-gray-900 text-white dark:bg-white dark:text-gray-900">Exportar JSON</button>
          <button onClick={() => download('phones.csv', csv, 'text/csv')} className="px-3 py-1.5 rounded bg-blue-600 text-white">Exportar CSV</button>
        </div>
        {loading ? <div>Cargando…</div> : rows.length === 0 ? <div>Aquí no hay ná… todavía.</div> : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">Nombre</th>
                <th className="p-2">Modelo</th>
                <th className="p-2">Bandas</th>
                <th className="p-2">Provincias</th>
                <th className="p-2">Obs</th>
                <th className="p-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.commercial_name}</td>
                  <td className="p-2">{r.model}</td>
                  <td className="p-2">{Array.isArray(r.bands) ? r.bands.join(', ') : r.bands}</td>
                  <td className="p-2">{Array.isArray(r.provinces) ? r.provinces.join(', ') : r.provinces}</td>
                  <td className="p-2">{r.observations}</td>
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

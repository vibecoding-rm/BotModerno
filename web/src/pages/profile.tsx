import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Profile() {
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data, error }) => {
      if (error) {
        console.error('Get user error:', error)
        return
      }
      const user = data.user
      if (!user) return
      setEmail(user.email || '')
      
      try {
        // obtener URL firmada desde backend (Service Role)
        const token = (await supabase.auth.getSession()).data.session?.access_token
        if (!token) return
        
        const r = await fetch('/api/profile/avatar/signget', { 
          headers: { 'Authorization': `Bearer ${token}` } 
        })
        if (r.ok) {
          const { url } = await r.json()
          setAvatarUrl(url)
        }
      } catch (err) {
        console.error('Avatar fetch error:', err)
      }
    }).catch(err => {
      console.error('Profile load error:', err)
    })
  }, [])

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const r = await fetch('/api/profile/avatar/presign', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } })
    if (!r.ok) { alert('Se enredó la cosa 😅'); setLoading(false); return }
    const { url } = await r.json()
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
    if (put.ok) {
      alert('¡Hecho! ✅')
      // refrescar url firmada desde backend
      const newToken = (await supabase.auth.getSession()).data.session?.access_token
      const r2 = await fetch('/api/profile/avatar/signget', { headers: { 'Authorization': `Bearer ${newToken}` } })
      if (r2.ok) {
        const { url } = await r2.json()
        setAvatarUrl(url)
      }
    } else alert('Se enredó la cosa 😅')
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-xl font-semibold">Perfil</h2>
        <div className="mt-2 text-sm">{email}</div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h3 className="font-medium mb-2">Avatar</h3>
        <div className="flex items-center gap-4">
          <img src={avatarUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='} alt="avatar" className="w-16 h-16 rounded-full object-cover bg-gray-200" />
          <label className="px-3 py-1.5 rounded bg-gray-900 text-white dark:bg-white dark:text-gray-900 cursor-pointer">
            {loading ? 'Subiendo…' : 'Cambiar'}
            <input type="file" accept="image/*" className="hidden" onChange={upload} />
          </label>
        </div>
      </div>
    </div>
  )
}

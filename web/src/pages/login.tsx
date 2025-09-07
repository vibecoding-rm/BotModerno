import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login({ callback = false }: { callback?: boolean }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (callback) {
      // Handle auth callback - session should be automatically handled by Supabase
      const handleAuthCallback = async () => {
        try {
          const { data, error } = await supabase.auth.getSession()
          if (data.session && !error) {
            navigate('/dashboard', { replace: true })
          }
        } catch (err) {
          console.error('Auth callback error:', err)
        }
      }
      handleAuthCallback()
    }
  }, [callback, navigate])

  async function signInOAuth(provider: 'google'|'github') {
    try {
      const redirectTo = new URL('/auth/callback', window.location.origin).toString()
      const { error } = await supabase.auth.signInWithOAuth({ 
        provider, 
        options: { redirectTo } 
      })
      if (error) {
        console.error('OAuth error:', error)
        alert('Se enredó la cosa 😅')
      }
    } catch (err) {
      console.error('OAuth error:', err)
      alert('Se enredó la cosa 😅')
    }
  }

  async function signInMagic() {
    const email = prompt('Correo para magic link:')
    if (!email) return
    try {
      const redirectTo = new URL('/auth/callback', window.location.origin).toString()
      const { error } = await supabase.auth.signInWithOtp({ 
        email, 
        options: { emailRedirectTo: redirectTo } 
      })
      if (error) {
        console.error('Magic link error:', error)
        alert('Se enredó la cosa 😅')
      } else {
        alert('Revisa tu correo 📬')
      }
    } catch (err) {
      console.error('Magic link error:', err)
      alert('Se enredó la cosa 😅')
    }
  }

  if (callback) {
    return <div className="min-h-screen grid place-items-center p-6">Procesando...</div>
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold">Entrar</h1>
        <button onClick={() => signInOAuth('google')} className="w-full py-2 rounded bg-emerald-600 text-white">Entrar con Google</button>
        <button onClick={() => signInOAuth('github')} className="w-full py-2 rounded bg-gray-900 text-white dark:bg-white dark:text-gray-900">Entrar con GitHub</button>
        <button onClick={signInMagic} className="w-full py-2 rounded bg-blue-600 text-white">Magic Link</button>
      </div>
    </div>
  )
}

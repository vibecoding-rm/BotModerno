import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Navbar({ session }: { session: any }) {
  const [email, setEmail] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  
  useEffect(() => {
    if (session?.user?.email) {
      setEmail(session.user.email)
    } else {
      setEmail('')
    }
  }, [session])

  async function signOut() {
    if (loading) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Sign out error:', error)
      }
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('Sign out error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Don't render if no session
  if (!session) {
    return null
  }

  return (
    <header className="border-b bg-white/50 backdrop-blur dark:bg-gray-800/50">
      <div className="max-w-6xl mx-auto flex items-center justify-between p-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link to="/dashboard" className="hover:text-blue-600 transition-colors">Dashboard</Link>
          <Link to="/moderation" className="hover:text-blue-600 transition-colors">Moderación</Link>
          <Link to="/reports" className="hover:text-blue-600 transition-colors">Reportes</Link>
          <Link to="/profile" className="hover:text-blue-600 transition-colors">Perfil</Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-300">{email || 'Usuario'}</span>
          <button 
            onClick={signOut} 
            disabled={loading}
            className="px-3 py-1.5 rounded bg-gray-900 text-white dark:bg-white dark:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saliendo...' : 'Salir'}
          </button>
        </div>
      </div>
    </header>
  )
}

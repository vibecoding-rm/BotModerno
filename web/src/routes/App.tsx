import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Login from '../pages/login'
import Dashboard from '../pages/dashboard'
import Moderation from '../pages/moderation'
import Reports from '../pages/reports'
import Profile from '../pages/profile'
import Navbar from '../ui/Navbar'

function ProtectedLayout() {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<any>(null)
  const location = useLocation()

  useEffect(() => {
    let ignore = false
    supabase.auth.getSession().then(({ data, error }) => {
      if (!ignore) {
        if (error) {
          console.error('Session error:', error)
        }
        setSession(data.session)
        setLoading(false)
      }
    }).catch(err => {
      if (!ignore) {
        console.error('Session fetch error:', err)
        setLoading(false)
      }
    })
    
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'SIGNED_OUT') {
        setSession(null)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSession(sess)
      }
    })
    return () => { ignore = true; sub.subscription.unsubscribe() }
  }, [])

  if (loading) return <div className="p-6">Cargando…</div>
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return (
    <div className="min-h-screen">
      <Navbar session={session} />
      <div className="max-w-6xl mx-auto p-4">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<Login callback />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  )
}

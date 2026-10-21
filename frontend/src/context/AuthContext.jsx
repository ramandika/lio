import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { auth } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // The front-end bootstraps role-dependent UI from /auth/me — it never
  // reads or stores its own user/auth state in localStorage.
  useEffect(() => {
    let alive = true
    auth
      .me()
      .then(({ user }) => alive && setUser(user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo(
    () => ({
      loading,
      user,
      async login(email, password) {
        const { user: next } = await auth.login(email, password)
        setUser(next)
        return next
      },
      async logout() {
        try {
          await auth.logout()
        } finally {
          setUser(null)
        }
      },
    }),
    [loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../routes'
import { Field, TextInput, Btn } from '../components/ui'

const DEMO_ACCOUNTS = [
  { email: 'ana@example.com', label: 'Requestor' },
  { email: 'tom@example.com', label: 'Procurement' },
  { email: 'pranamulia@example.com', label: 'Requestor' },
  { email: 'kim@example.com', label: 'Procurement' },
  { email: 'admin@example.com', label: 'Admin' },
]

export default function Login() {
  const { user, login, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to={roleHome(user)} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await login(email.trim(), password)
      const from = location.state?.from
      navigate(from && from !== '/login' && from !== '/' ? from : roleHome(next), {
        replace: true,
      })
    } catch (err) {
      setError(err.payload?.detail ?? 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login__card card">
        <h1 className="login__title">Sign In</h1>
        <p className="login__standfirst">
          Procurement requests, handled here — from intake to a closed, auditable trail.
        </p>
        <form onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="login-email">
            <TextInput
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <TextInput
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {error && (
            <p className="login__error" role="alert">
              {error}
            </p>
          )}
          <Btn type="submit" className="login__submit" disabled={busy}>
            {busy ? 'Signing In…' : 'Sign In'}
          </Btn>
        </form>
        <div className="login__demo">
          <p className="login__demo-title">Demo accounts — password “demo”</p>
          <ul>
            {DEMO_ACCOUNTS.map((acc) => (
              <li key={acc.email}>
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setEmail(acc.email)
                    setPassword('demo')
                  }}
                >
                  <span>{acc.email}</span>
                  <span className="login__demo-role">{acc.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
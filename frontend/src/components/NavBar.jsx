import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const ROLE_LABEL = { requestor: 'Requestor', procurement: 'Procurement', admin: 'Admin' }

const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' }

export default function NavBar() {
  const { user, logout } = useAuth()
  const { theme, cycle } = useTheme()
  const navigate = useNavigate()

  return (
    <header className="nav">
      <div className="nav__inner">
        <Link to={user ? '/' : '/login'} className="nav__brand" aria-label="askLio home">
          askLio
        </Link>
        <div className="nav__actions">
          <button
            type="button"
            className="nav__theme"
            onClick={cycle}
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}`}
          >
            {THEME_ICON[theme]}
          </button>
          {user && (
            <>
              <span className="nav__user">
                <span className="nav__role">{ROLE_LABEL[user.role]}</span>
                {user.display_name}
              </span>
              <button
                type="button"
                className="btn btn--ghost nav__logout"
                onClick={async () => {
                  await logout()
                  navigate('/login', { replace: true })
                }}
              >
                Sign Out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import NavBar from './components/NavBar'
import Login from './views/Login'
import Workbench from './views/Workbench'
import NotFound from './views/NotFound'

function Guard({ children }) {
  const { loading, user } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading" aria-busy="true" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

/*
 * The app is a single workbench page ("/"). The old per-view routes
 * (/requests, /requests/new, /requests/:id) remain as redirects so old
 * links keep working.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <Workbench />
          </Guard>
        }
      />
      <Route path="/requests" element={<Navigate to="/" replace />} />
      <Route path="/requests/new" element={<Navigate to="/?selected=new" replace />} />
      <Route path="/requests/:id" element={<LegacyDetail />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function LegacyDetail() {
  const { id } = useParams()
  return <Navigate to={`/?selected=${encodeURIComponent(id)}`} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="app">
          <NavBar />
          <main className="app__main">
            <AppRoutes />
          </main>
          <footer className="app__footer">
            <p>askLio — procurement requests, kept in order.</p>
          </footer>
        </div>
      </AuthProvider>
    </ThemeProvider>
  )
}
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import NavBar from './components/NavBar'
import Login from './views/Login'
import NewRequest from './views/NewRequest'
import Overview from './views/Overview'
import RequestDetail from './views/RequestDetail'
import NotFound from './views/NotFound'
import { roleHome } from './routes'

function Guard({ children }) {
  const { loading, user } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading" aria-busy="true" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <HomeRedirect />
          </Guard>
        }
      />
      <Route
        path="/requests"
        element={
          <Guard>
            <Overview />
          </Guard>
        }
      />
      <Route
        path="/requests/new"
        element={
          <Guard>
            <NewRequest />
          </Guard>
        }
      />
      <Route
        path="/requests/:id"
        element={
          <Guard>
            <RequestDetail />
          </Guard>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={roleHome(user)} replace />
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
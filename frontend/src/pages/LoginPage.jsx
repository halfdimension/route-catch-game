import { Link, Navigate, useNavigate } from 'react-router-dom'
import AuthPanel from '../components/AuthPanel'
import { useAuth } from '../context/authContextCore'

function LoginPage() {
  const { isAuthenticated, loadingAuth } = useAuth()
  const navigate = useNavigate()

  if (!loadingAuth && isAuthenticated) {
    return <Navigate to="/home" replace />
  }

  return (
    <main className="auth-page">
      <div className="auth-page-card">
        <AuthPanel
          initialMode="login"
          isPage
          onAuthenticated={() => navigate('/home', { replace: true })}
        />
        <p className="auth-page-switch">
          Need an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </main>
  )
}

export default LoginPage

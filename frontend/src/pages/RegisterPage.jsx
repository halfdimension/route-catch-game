import { Link, Navigate, useNavigate } from 'react-router-dom'
import AuthPanel from '../components/AuthPanel'
import { useAuth } from '../context/authContextCore'

function RegisterPage() {
  const { isAuthenticated, loadingAuth } = useAuth()
  const navigate = useNavigate()

  if (!loadingAuth && isAuthenticated) {
    return <Navigate to="/home" replace />
  }

  return (
    <main className="auth-page">
      <div className="auth-page-card">
        <AuthPanel
          initialMode="register"
          isPage
          onAuthenticated={() => navigate('/home', { replace: true })}
        />
        <p className="auth-page-switch">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </div>
    </main>
  )
}

export default RegisterPage

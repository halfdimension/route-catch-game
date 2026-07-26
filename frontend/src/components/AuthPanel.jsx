import { useState } from 'react'
import { useAuth } from '../context/authContextCore'

const EMPTY_LOGIN_FORM = {
  usernameOrEmail: '',
  password: '',
}

const EMPTY_REGISTER_FORM = {
  username: '',
  email: '',
  displayName: '',
  password: '',
}

function AuthPanel({
  initialMode = 'login',
  isPage = false,
  onAuthenticated,
}) {
  const {
    currentUser,
    isAuthenticated,
    loadingAuth,
    login,
    register,
    logout,
  } = useAuth()
  const [isAuthOverlayOpen, setIsAuthOverlayOpen] = useState(false)
  const [isAccountOverlayOpen, setIsAccountOverlayOpen] = useState(false)
  const [mode, setMode] = useState(initialMode)
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN_FORM)
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  function updateLoginField(event) {
    setLoginForm((currentForm) => ({
      ...currentForm,
      [event.target.name]: event.target.value,
    }))
  }

  function updateRegisterField(event) {
    setRegisterForm((currentForm) => ({
      ...currentForm,
      [event.target.name]: event.target.value,
    }))
  }

  function toggleMode() {
    if (isPage) {
      return
    }

    setMode((currentMode) =>
      currentMode === 'login' ? 'register' : 'login',
    )
    setErrorMessage('')
  }

  function openAuthOverlay() {
    setIsAuthOverlayOpen(true)
    setErrorMessage('')
  }

  function closeAuthOverlay() {
    setIsAuthOverlayOpen(false)
    setErrorMessage('')
  }

  function openAccountOverlay() {
    setIsAccountOverlayOpen(true)
  }

  function closeAccountOverlay() {
    setIsAccountOverlayOpen(false)
  }

  function handleLogout() {
    logout()
    closeAccountOverlay()
  }

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      await login({
        usernameOrEmail: loginForm.usernameOrEmail.trim(),
        password: loginForm.password,
      })
      setLoginForm(EMPTY_LOGIN_FORM)
      closeAuthOverlay()
      onAuthenticated?.()
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      await register({
        username: registerForm.username.trim(),
        email: registerForm.email,
        displayName: registerForm.displayName.trim(),
        password: registerForm.password,
      })
      setRegisterForm(EMPTY_REGISTER_FORM)
      closeAuthOverlay()
      onAuthenticated?.()
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loadingAuth) {
    return (
      <section
        className={isPage ? 'auth-page-panel' : 'auth-panel'}
        aria-label="Account"
      >
        <p className="auth-muted">Checking account...</p>
      </section>
    )
  }

  if (isAuthenticated) {
    if (isPage) {
      return (
        <section className="auth-page-panel" aria-label="Account">
          <p className="auth-muted">You are already signed in.</p>
        </section>
      )
    }

    return (
      <section className="auth-panel" aria-label="Account">
        <button
          type="button"
          className="auth-account-button"
          onClick={openAccountOverlay}
          aria-expanded={isAccountOverlayOpen}
        >
          <span>{currentUser.displayName}</span>
        </button>

        {isAccountOverlayOpen && (
          <div className="account-overlay" role="presentation">
            <div className="account-dialog" role="dialog" aria-modal="true">
              <div className="account-dialog-header">
                <div>
                  <strong>{currentUser.displayName}</strong>
                  <span>@{currentUser.username}</span>
                </div>
                <button type="button" onClick={closeAccountOverlay}>
                  Close
                </button>
              </div>
              <button
                type="button"
                className="account-logout-button"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  const isLoginMode = mode === 'login'
  const submitLabel = isSubmitting
    ? isLoginMode
      ? 'Signing in...'
      : 'Creating...'
    : isLoginMode
      ? 'Login'
      : 'Register'
  const authForm = isLoginMode ? (
    <form className="auth-form" onSubmit={handleLoginSubmit}>
      <label>
        <span>Username or email</span>
        <input
          name="usernameOrEmail"
          type="text"
          value={loginForm.usernameOrEmail}
          onChange={updateLoginField}
          autoComplete="username"
          required
          disabled={isSubmitting}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type="password"
          value={loginForm.password}
          onChange={updateLoginField}
          autoComplete="current-password"
          required
          disabled={isSubmitting}
        />
      </label>
      <button
        type="submit"
        className="primary-button"
        disabled={isSubmitting}
      >
        {submitLabel}
      </button>
    </form>
  ) : (
    <form className="auth-form" onSubmit={handleRegisterSubmit}>
      <label>
        <span>Username</span>
        <input
          name="username"
          type="text"
          value={registerForm.username}
          onChange={updateRegisterField}
          autoComplete="username"
          required
          disabled={isSubmitting}
        />
      </label>
      <label>
        <span>Email optional</span>
        <input
          name="email"
          type="email"
          value={registerForm.email}
          onChange={updateRegisterField}
          autoComplete="email"
          disabled={isSubmitting}
        />
      </label>
      <label>
        <span>Display name</span>
        <input
          name="displayName"
          type="text"
          value={registerForm.displayName}
          onChange={updateRegisterField}
          autoComplete="name"
          required
          disabled={isSubmitting}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type="password"
          value={registerForm.password}
          onChange={updateRegisterField}
          autoComplete="new-password"
          required
          disabled={isSubmitting}
        />
      </label>
      <button
        type="submit"
        className="primary-button"
        disabled={isSubmitting}
      >
        {submitLabel}
      </button>
    </form>
  )

  if (isPage) {
    return (
      <section className="auth-page-panel" aria-label="Account">
        <div className="auth-panel-header">
          <p className="auth-panel-title">
            {isLoginMode ? 'Login' : 'Register'}
          </p>
        </div>
        {authForm}
        {errorMessage && (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="auth-panel" aria-label="Account">
      <button
        type="button"
        className="auth-sign-in-button"
        onClick={openAuthOverlay}
      >
        Sign in
      </button>

      {isAuthOverlayOpen && (
        <div className="auth-overlay" role="presentation">
          <div className="auth-dialog" role="dialog" aria-modal="true">
            <div className="auth-panel-header">
              <p className="auth-panel-title">
                {isLoginMode ? 'Login' : 'Register'}
              </p>
              <div className="auth-dialog-actions">
                <button
                  type="button"
                  onClick={toggleMode}
                  disabled={isSubmitting}
                >
                  {isLoginMode ? 'Register' : 'Login'}
                </button>
                <button
                  type="button"
                  onClick={closeAuthOverlay}
                  disabled={isSubmitting}
                >
                  Close
                </button>
              </div>
            </div>

            {authForm}

            {errorMessage && (
              <p className="auth-error" role="alert">
                {errorMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default AuthPanel

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  AUTH_TOKEN_STORAGE_KEY,
  getCurrentUser,
  login as loginRequest,
  register as registerRequest,
} from '../api/authClient'
import { AuthContext } from './authContextCore'

function readStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

function storeToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

function clearStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStoredToken())
  const [currentUser, setCurrentUser] = useState(null)
  const [loadingAuth, setLoadingAuth] = useState(Boolean(token))

  const applyAuthResponse = useCallback((authResponse) => {
    storeToken(authResponse.token)
    setToken(authResponse.token)
    setCurrentUser(authResponse.user)
    return authResponse.user
  }, [])

  const login = useCallback(
    async (credentials) => {
      const authResponse = await loginRequest(credentials)
      return applyAuthResponse(authResponse)
    },
    [applyAuthResponse],
  )

  const register = useCallback(
    async (registration) => {
      const authResponse = await registerRequest(registration)
      return applyAuthResponse(authResponse)
    },
    [applyAuthResponse],
  )

  const logout = useCallback(() => {
    clearStoredToken()
    setToken(null)
    setCurrentUser(null)
  }, [])

  useEffect(() => {
    const storedToken = readStoredToken()

    if (!storedToken) {
      return undefined
    }

    let isMounted = true

    getCurrentUser(storedToken)
      .then((user) => {
        if (!isMounted) {
          return
        }

        setToken(storedToken)
        setCurrentUser(user)
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        clearStoredToken()
        setToken(null)
        setCurrentUser(null)
      })
      .finally(() => {
        if (isMounted) {
          setLoadingAuth(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const value = useMemo(
    () => ({
      currentUser,
      token,
      isAuthenticated: Boolean(token && currentUser),
      loadingAuth,
      login,
      register,
      logout,
    }),
    [currentUser, loadingAuth, login, logout, register, token],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

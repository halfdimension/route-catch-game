import { useAuth } from '../context/authContextCore'

function ProfilePage() {
  const { currentUser } = useAuth()

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Profile</h1>
        <p>Account and future route profile settings.</p>
      </div>
      <section className="page-panel profile-panel">
        <dl>
          <div>
            <dt>Display name</dt>
            <dd>{currentUser?.displayName || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>@{currentUser?.username || 'unknown'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{currentUser?.email || 'Not set'}</dd>
          </div>
        </dl>
        <div className="profile-placeholder">
          Vehicle and profile selection will live here in a later phase.
        </div>
      </section>
    </main>
  )
}

export default ProfilePage

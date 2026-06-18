import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import Avatar, {
  AVATAR_PALETTES,
  AVATAR_PATTERN_COUNT,
  avatarVariantFor,
  avatarToString,
  parseAvatarString,
  getAvatarOverride,
  setAvatarOverride,
  clearAvatarOverride,
  syncAvatarFromUser,
} from '../components/Avatar.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
    })
  } catch { return '—' }
}

function groupByPolicy(perms) {
  const m = new Map()
  for (const p of perms || []) {
    const k = p.policy || 'Other'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(p)
  }
  return [...m.entries()].map(([policy, perms]) => ({ policy, perms }))
}

export default function Profile() {
  const navigate = useNavigate()
  const [user, setUser] = useState(() => auth.getUser())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  // Password form
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [pwdErrors, setPwdErrors] = useState({})
  const [pwdBanner, setPwdBanner] = useState(null)
  const [savingPwd, setSavingPwd] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Profile icon (avatar) picker
  const [iconOpen, setIconOpen] = useState(false)
  const [iconSel, setIconSel] = useState(null)
  const [savingIcon, setSavingIcon] = useState(false)

  if (!user) { navigate('/signin', { replace: true }); return null }

  const avatarSeed = String(user.id ?? user.email ?? user.name)

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const resp = await api.me()
      const fresh = resp?.data || resp
      setUser(fresh)
      // Mirror the server-saved avatar into the local override so it renders.
      syncAvatarFromUser(fresh)
      // Keep the localStorage cache in sync so other pages see updates too.
      const stored = auth.getUser()
      if (stored) auth.setSession({
        access: auth.getAccess(),
        refresh: auth.getRefresh(),
        user: { ...stored, ...fresh },
        remember: auth.hasRememberFlag(),
      })
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : 'Failed to load profile.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Initialise the icon picker selection from the saved choice (or default).
  useEffect(() => {
    setIconSel(
      parseAvatarString(user.avatar) ||
      getAvatarOverride(avatarSeed) ||
      avatarVariantFor(avatarSeed),
    )
  }, [avatarSeed, user.avatar])

  function cacheAvatar(avatarStr) {
    setUser((u) => (u ? { ...u, avatar: avatarStr } : u))
    const stored = auth.getUser()
    if (stored) auth.setSession({
      access: auth.getAccess(),
      refresh: auth.getRefresh(),
      user: { ...stored, avatar: avatarStr },
      remember: auth.hasRememberFlag(),
    })
  }

  async function saveIcon() {
    if (!iconSel || savingIcon) return
    const str = avatarToString(iconSel)
    setSavingIcon(true)
    try {
      await api.updateMe({ avatar: str })
      setAvatarOverride(avatarSeed, iconSel) // live update everywhere
      cacheAvatar(str)
      setIconOpen(false)
      setToast({ type: 'success', text: 'Profile icon saved.' })
    } catch {
      setToast({ type: 'error', text: 'Could not save icon. Please try again.' })
    } finally {
      setSavingIcon(false)
    }
  }

  async function resetIcon() {
    if (savingIcon) return
    setSavingIcon(true)
    try {
      await api.updateMe({ avatar: '' })
      clearAvatarOverride(avatarSeed)
      cacheAvatar('')
      setIconSel(avatarVariantFor(avatarSeed))
      setIconOpen(false)
      setToast({ type: 'success', text: 'Icon reset to default.' })
    } catch {
      setToast({ type: 'error', text: 'Could not reset icon. Please try again.' })
    } finally {
      setSavingIcon(false)
    }
  }

  /* ----------------------- Password form ----------------------- */
  function setPwdField(k, v) {
    setPwd((s) => ({ ...s, [k]: v }))
    setPwdErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }
  function validatePwd() {
    const errs = {}
    if (!pwd.current) errs.current = 'Current password is required.'
    if (!pwd.next) errs.next = 'New password is required.'
    else if (pwd.next.length < 8) errs.next = 'At least 8 characters.'
    if (pwd.next && pwd.confirm !== pwd.next) errs.confirm = 'Passwords do not match.'
    if (pwd.current && pwd.next && pwd.current === pwd.next) {
      errs.next = 'New password must be different from the current one.'
    }
    setPwdErrors(errs)
    return Object.keys(errs).length === 0
  }
  async function submitPwd(e) {
    e.preventDefault()
    if (savingPwd) return
    setPwdBanner(null)
    if (!validatePwd()) return
    setSavingPwd(true)
    try {
      const resp = await api.changeMyPassword({
        currentPassword: pwd.current,
        newPassword: pwd.next,
      })
      setPwd({ current: '', next: '', confirm: '' })
      setToast({
        type: resp?.email_sent === false ? 'success' : 'success',
        text: resp?.message || 'Password changed successfully.',
      })
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(
          err,
          ['current', 'next'],
          { current_password: 'current', new_password: 'next' },
        )
        const fieldErrs = {}
        for (const k of Object.keys(parsed.fields)) {
          if (parsed.fields[k]?.length) fieldErrs[k] = parsed.fields[k][0]
        }
        setPwdErrors(fieldErrs)
        if (parsed.form.length) setPwdBanner({ type: 'error', text: parsed.form[0] })
        else if (!Object.keys(fieldErrs).length) {
          setPwdBanner({ type: 'error', text: err.message || 'Failed to change password.' })
        }
      } else {
        setPwdBanner({ type: 'error', text: 'Network error. Try again.' })
      }
    } finally {
      setSavingPwd(false)
    }
  }

  /* ----------------------- Derived ----------------------- */
  const roles = user?.roles || []
  const allPerms = useMemo(
    () => roles.flatMap((r) => r.permissions || []),
    [roles],
  )
  const uniquePerms = useMemo(() => {
    const seen = new Set()
    return allPerms.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  }, [allPerms])
  const policies = useMemo(() => groupByPolicy(uniquePerms), [uniquePerms])

  /* ----------------------- Render ----------------------- */
  return (
    <div className="kiosk-app">
      <TopBar />

      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1>Your Profile</h1>
            <p className="lede">View your account, update your details and change your password.</p>
          </div>
        </header>

        {error && <div className="admin-banner error">{error}</div>}

        {loading ? (
          <div className="admin-empty admin-loading">
            <span className="admin-spinner" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : (
          <>
            {/* ---------- Identity card ---------- */}
            <section className="profile-hero admin-card">
              <div className="profile-hero-avwrap">
                <Avatar
                  seed={avatarSeed}
                  size={84}
                  title={user.name || user.email}
                  className="profile-hero-av"
                />
                <button
                  type="button"
                  className="profile-av-edit"
                  onClick={() => setIconOpen((o) => !o)}
                  aria-label="Change profile icon"
                  title="Change icon"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M13.5 6.5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="profile-hero-body">
                <h2 className="profile-hero-name">
                  {user.name || '—'}
                </h2>
                <p className="profile-hero-sub">
                  {user.email || ''}{user.email && user.mobile ? ' · ' : ''}{user.mobile || ''}
                </p>
                {roles.length > 0 && (
                  <div className="profile-hero-roles">
                    {roles.map((r) => (
                      <span key={r.id} className="role-chip">{r.name}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ---------- Icon picker ---------- */}
            {iconOpen && iconSel && (
              <section className="admin-card profile-icon-picker">
                <div className="card-head">
                  <h3 className="card-title">Choose your icon</h3>
                  <button
                    type="button"
                    className="pip-close"
                    onClick={() => setIconOpen(false)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="pip-row">
                  <div className="pip-preview">
                    <Avatar seed={avatarSeed} variant={iconSel} size={88} title="Preview" />
                    <span className="pip-preview-cap">Preview</span>
                  </div>
                  <div className="pip-controls">
                    <div className="pip-label">Colour</div>
                    <div className="pip-swatches">
                      {AVATAR_PALETTES.map((pal, i) => (
                        <button
                          key={i}
                          type="button"
                          className={'pip-swatch' + (iconSel.p === i ? ' is-sel' : '')}
                          style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}
                          onClick={() => setIconSel((s) => ({ ...s, p: i }))}
                          aria-label={`Colour ${i + 1}`}
                        />
                      ))}
                    </div>
                    <div className="pip-label">Shape</div>
                    <div className="pip-shapes">
                      {Array.from({ length: AVATAR_PATTERN_COUNT }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={'pip-shape' + (iconSel.pat === i ? ' is-sel' : '')}
                          onClick={() => setIconSel((s) => ({ ...s, pat: i }))}
                          aria-label={`Shape ${i + 1}`}
                        >
                          <Avatar seed={avatarSeed} variant={{ p: iconSel.p, pat: i }} size={44} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="pip-foot">
                  <button type="button" className="pip-reset-btn" onClick={resetIcon} disabled={savingIcon}>
                    Reset to default
                  </button>
                  <button type="button" className="btn-primary" onClick={saveIcon} disabled={savingIcon} aria-busy={savingIcon}>
                    {savingIcon ? 'Saving…' : 'Save icon'}
                  </button>
                </div>
              </section>
            )}

            <div className="profile-grid">
              {/* ---------- Account details (read-only) ----------
                  Profile editing is admin-only — surface the values here
                  for the user to verify, but no form / submit button. */}
              <section className="admin-card">
                <div className="card-head">
                  <h3 className="card-title">Account details</h3>
                  <span className="card-count">Read only</span>
                </div>
                <div className="profile-meta-grid">
                  <ReadOnly label="Name"         value={user.name} />
                  <ReadOnly label="Email"        value={user.email} />
                  <ReadOnly label="Country code" value={user.country_code} />
                  <ReadOnly label="Mobile"       value={user.mobile} />
                  <ReadOnly label="Member since" value={formatDate(user.created_at)} full />
                </div>
                <p className="profile-readonly-note">
                  Need to update these? Contact an administrator — only your
                  password can be changed from this page.
                </p>
              </section>

              {/* ---------- Change password ---------- */}
              <section className="admin-card">
                <div className="card-head">
                  <h3 className="card-title">Change password</h3>
                </div>
                <form onSubmit={submitPwd} noValidate>
                  {pwdBanner && <div className={'admin-banner ' + pwdBanner.type}>{pwdBanner.text}</div>}
                  <PasswordField
                    label="Current password"
                    required
                    error={pwdErrors.current}
                    value={pwd.current}
                    onChange={(v) => setPwdField('current', v)}
                    show={showCurrent}
                    onToggle={() => setShowCurrent((s) => !s)}
                    autoComplete="current-password"
                    disabled={savingPwd}
                  />
                  <PasswordField
                    label="New password"
                    required
                    error={pwdErrors.next}
                    value={pwd.next}
                    onChange={(v) => setPwdField('next', v)}
                    show={showNext}
                    onToggle={() => setShowNext((s) => !s)}
                    autoComplete="new-password"
                    disabled={savingPwd}
                  />
                  <PasswordField
                    label="Confirm new password"
                    required
                    error={pwdErrors.confirm}
                    value={pwd.confirm}
                    onChange={(v) => setPwdField('confirm', v)}
                    show={showConfirm}
                    onToggle={() => setShowConfirm((s) => !s)}
                    autoComplete="new-password"
                    disabled={savingPwd}
                  />
                  <div className="profile-foot">
                    <button type="submit" className="btn-primary" disabled={savingPwd} aria-busy={savingPwd}>
                      {savingPwd ? 'Updating…' : 'Change password'}
                    </button>
                  </div>
                </form>
              </section>
            </div>

            {/* ---------- Permissions (read-only) ---------- */}
            <section className="admin-card">
              <div className="card-head">
                <h3 className="card-title">Permissions</h3>
                <span className="card-count">{uniquePerms.length}</span>
              </div>
              {policies.length === 0 ? (
                <p className="user-sub" style={{ margin: 0 }}>
                  No permissions are attached to your account yet.
                </p>
              ) : policies.map(({ policy, perms }) => (
                <div className="policy-group" key={policy}>
                  <div className="policy-name">{policy}</div>
                  <div className="perm-chips">
                    {perms.map((p) => (
                      <span key={p.id} className="perm-chip" title={p.short_name}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>

      {toast && (
        <div className={'toast toast-' + toast.type} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  )
}

/* ----------------------- shared bits ----------------------- */
function ReadOnly({ label, value, full }) {
  return (
    <div className={'profile-meta' + (full ? ' full' : '')}>
      <span className="profile-meta-label">{label}</span>
      <span className="profile-meta-value">{value || '—'}</span>
    </div>
  )
}

function Field({ label, error, children, full, required }) {
  return (
    <label className={'form-field' + (full ? ' full' : '') + (error ? ' has-error' : '')}>
      <span className="form-label">
        {label}
        {required && <span className="required-star" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && <span className="form-err">{error}</span>}
    </label>
  )
}

function PasswordField({ label, error, value, onChange, show, onToggle, autoComplete, disabled, required }) {
  return (
    <Field label={label} required={required} error={error} full>
      <div className="pwd-input-wrap">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="pwd-eye"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={onToggle}
          tabIndex={-1}
        >
          {show ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M3 3l18 18" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M10.6 6.2c.5-.1.9-.2 1.4-.2 5 0 9 5 9 7-.5 1.4-1.5 2.7-2.7 3.7M6.4 6.4C4.1 7.8 2.5 10.8 2 12c.7 1.9 4 7 10 7 1.8 0 3.3-.5 4.6-1.2" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" stroke="#6b6258" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="3" stroke="#6b6258" strokeWidth="1.7" />
            </svg>
          )}
        </button>
      </div>
    </Field>
  )
}

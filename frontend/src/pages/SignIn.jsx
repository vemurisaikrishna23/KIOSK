import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import SignInIllustration from '../components/SignInIllustration.jsx'
import { api, auth, ApiError, parseApiErrors } from '../lib/api.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Mobile: optional leading "+", then 6–15 digits (E.164-ish, flexible).
const MOBILE_RE = /^\+?[0-9]{6,15}$/

function classifyIdentifier(raw) {
  const v = raw.replace(/[\s-]/g, '')
  if (v.includes('@')) return { kind: 'email', value: raw.trim() }
  if (/^[+0-9]/.test(v)) return { kind: 'mobile', value: v }
  return { kind: 'unknown', value: raw.trim() }
}

/** Resolve a human-readable status message from any error the API throws. */
function resolveErrorMessage(err) {
  // Network / can't reach server
  if (err?.network) return 'Unable to connect to server. Please try again later.'

  const data = err?.data
  if (data == null) return 'Login failed. Please try again.'
  if (typeof data === 'string' && data.trim()) return data

  // DRF's "detail" is the primary top-level message
  if (data.detail != null) {
    const v = Array.isArray(data.detail) ? data.detail[0] : data.detail
    if (v != null && String(v).trim()) return String(v)
  }
  // non_field_errors
  if (Array.isArray(data.non_field_errors) && data.non_field_errors.length) {
    return String(data.non_field_errors[0])
  }
  // First field error (rare — client-side validation catches these first)
  for (const value of Object.values(data)) {
    const msgs = Array.isArray(value) ? value : [value]
    if (msgs.length && msgs[0]) return String(msgs[0])
  }
  return 'Login failed. Please try again.'
}

export default function SignIn() {
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)

  // Pre-fill identifier + Remember Me state from prior login.
  useEffect(() => {
    const saved = auth.getRememberedId()
    if (saved) {
      setEmail(saved)
      setRemember(true)
    } else if (auth.hasRememberFlag()) {
      // Flag without identifier (older session) — keep box checked.
      setRemember(true)
    }
  }, [])

  const [fieldErrors, setFieldErrors] = useState({ email: [], password: [] })
  const [submitting, setSubmitting] = useState(false)
  // status = null | { type: 'success' | 'error', text: string }
  const [status, setStatus] = useState(null)

  /** Client-side validation. Returns true if OK to submit. */
  function validate() {
    const next = { email: [], password: [] }
    const trimmed = email.trim()
    if (!trimmed) {
      next.email.push('Email or Mobile is required.')
    } else {
      const { kind, value } = classifyIdentifier(trimmed)
      if (kind === 'email' && !EMAIL_RE.test(value)) {
        next.email.push('Enter a valid email address.')
      } else if (kind === 'mobile' && !MOBILE_RE.test(value)) {
        next.email.push('Enter a valid mobile number.')
      } else if (kind === 'unknown') {
        next.email.push('Enter a valid email address or mobile number.')
      }
    }
    if (!password) next.password.push('Password is required.')
    setFieldErrors(next)
    return next.email.length === 0 && next.password.length === 0
  }

  function clearFieldError(field) {
    setFieldErrors((prev) =>
      prev[field].length ? { ...prev, [field]: [] } : prev,
    )
  }

  async function submit(e) {
    e.preventDefault()
    if (submitting) return
    setStatus(null)
    if (!validate()) return

    setSubmitting(true)
    try {
      const identifier = classifyIdentifier(email).value
      const resp = await api.login({ email: identifier, password })
      const payload = resp?.data ?? {}
      auth.setSession({
        access: payload.access,
        refresh: payload.refresh,
        user: payload.user,
        remember,
      })
      // Persist (or clear) the remembered identifier for next visit.
      auth.setRememberedId(remember ? identifier : '')
      setFieldErrors({ email: [], password: [] })
      setStatus({ type: 'success', text: resp?.message || 'Login successful' })
      // Brief pause so the green banner is visible, then go to the dashboard.
      setTimeout(() => navigate('/dashboard', { replace: true }), 600)
    } catch (err) {
      // Surface field-specific errors inline; reserve the banner for form-level
      // messages (non_field_errors / network) so we never show the same message
      // twice. Backend uses `email_or_mobile` → map it onto the UI's `email`.
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(
          err,
          ['email', 'password'],
          { email_or_mobile: 'email' },
        )
        setFieldErrors({
          email: parsed.fields.email || [],
          password: parsed.fields.password || [],
        })
        if (parsed.form.length) {
          setStatus({ type: 'error', text: parsed.form[0] })
        }
      } else {
        setStatus({ type: 'error', text: resolveErrorMessage(err) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const hasEmailError = fieldErrors.email.length > 0
  const hasPasswordError = fieldErrors.password.length > 0

  return (
    <div className="signin-v2">
      {/* Page-level brand mark (top-left of entire page) */}
      <Link to="/" className="signin-v2-brand" aria-label="myaccess home">
        <img src="/logos/myaccess.svg" alt="myaccess" className="logo-wordmark" />
      </Link>

      {/* ============ LEFT: form ============ */}
      <div className="signin-v2-left">
        <div className="form-wrap">
          <div className="form-card">
            <h1>Login</h1>

            <form onSubmit={submit} noValidate>
              <div className={'field-float' + (hasEmailError ? ' has-error' : '')}>
                <label htmlFor="email" className="float-label">
                  Email or Mobile
                </label>
                <input
                  id="email"
                  type="text"
                  inputMode="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (hasEmailError) clearFieldError('email')
                  }}
                  autoComplete="username"
                  aria-invalid={hasEmailError}
                  aria-describedby={hasEmailError ? 'email-err' : undefined}
                  disabled={submitting}
                />
                {hasEmailError && (
                  <p id="email-err" className="field-error">
                    {fieldErrors.email[0]}
                  </p>
                )}
              </div>

              <div className={'field-float' + (hasPasswordError ? ' has-error' : '')}>
                <label htmlFor="password" className="float-label">
                  Password
                </label>
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="••••••••••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (hasPasswordError) clearFieldError('password')
                  }}
                  autoComplete="current-password"
                  aria-invalid={hasPasswordError}
                  aria-describedby={hasPasswordError ? 'password-err' : undefined}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="float-eye"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <Icon name="eye" size={18} />
                </button>
                {hasPasswordError && (
                  <p id="password-err" className="field-error">
                    {fieldErrors.password[0]}
                  </p>
                )}
              </div>

              <div className="row-remember">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    disabled={submitting}
                  />
                  <span className="box">
                    <Icon name="check" size={12} stroke={3} />
                  </span>
                  Remember Me
                </label>
                <Link to="/forgot-password" className="forgot">
                  Forgot Password?
                </Link>
              </div>

              <button
                type="submit"
                className="btn-login"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? 'Logging in...' : 'LOG IN'}
              </button>
            </form>

            {/* API response status — below the button */}
            {status && (
              <div
                className={'api-status api-status-' + status.type}
                role={status.type === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <span className="api-status-ic" aria-hidden="true">
                  <Icon
                    name={status.type === 'success' ? 'check' : 'alert'}
                    size={14}
                    stroke={3}
                  />
                </span>
                <span>{status.text}</span>
              </div>
            )}
          </div>
        </div>

        <div className="signin-v2-foot">
          © 2026 myaccess Inc. · KIOSK IoT Platform
        </div>
      </div>

      {/* ============ RIGHT: illustration ============ */}
      <div className="signin-v2-right">
        <SignInIllustration />
      </div>
    </div>
  )
}

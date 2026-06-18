import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import KioskRightPanel from '../components/KioskRightPanel.jsx'
import { api, ApiError, parseApiErrors } from '../lib/api.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_RE = /^\+?[0-9]{6,15}$/

function classifyIdentifier(raw) {
  const v = raw.replace(/[\s-]/g, '')
  if (v.includes('@')) return { kind: 'email', value: raw.trim() }
  if (/^[+0-9]/.test(v)) return { kind: 'mobile', value: v }
  return { kind: 'unknown', value: raw.trim() }
}

/** Resolve a human-readable status message from any error the API throws. */
function resolveErrorMessage(err, fallback) {
  if (err?.network) return 'Unable to connect to server. Please try again later.'
  const data = err?.data
  if (data == null) return fallback
  if (typeof data === 'string' && data.trim()) return data
  if (data.detail != null) {
    const v = Array.isArray(data.detail) ? data.detail[0] : data.detail
    if (v != null && String(v).trim()) return String(v)
  }
  if (Array.isArray(data.non_field_errors) && data.non_field_errors.length) {
    return String(data.non_field_errors[0])
  }
  for (const value of Object.values(data)) {
    const msgs = Array.isArray(value) ? value : [value]
    if (msgs.length && msgs[0]) return String(msgs[0])
  }
  return fallback
}

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // step: 'request' (enter identifier) → 'reset' (enter token + new password)
  const [step, setStep] = useState('request')

  // Step 1 state
  const [identifier, setIdentifier] = useState('')
  const [requestErrors, setRequestErrors] = useState({ email: [] })

  // Step 2 state
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [resetErrors, setResetErrors] = useState({
    token: [],
    new_password: [],
    confirm_password: [],
  })

  // Dev-only: token surfaced by the backend in DEBUG so the user can copy it
  // into step 2 without an email/SMS provider configured.
  const [devToken, setDevToken] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState(null) // { type: 'success' | 'error', text }

  // Seconds left before the user is allowed to click "Resend Code" again.
  // Reset to 60 every time a code is dispatched (initial request or resend).
  const RESEND_COOLDOWN_SECONDS = 60
  const [cooldown, setCooldown] = useState(0)

  // Tick the cooldown down to 0 once per second.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  // If the user landed via a reset link from the email (e.g.
  // /forgot-password?token=abc), pre-fill the token and jump to step 2.
  useEffect(() => {
    const t = searchParams.get('token')
    if (t) {
      setToken(t)
      setStep('reset')
    }
  }, [searchParams])

  function clearError(stateSetter, errors, field) {
    if (errors[field]?.length) stateSetter({ ...errors, [field]: [] })
  }

  /* --------------------- Step 1: request reset token --------------------- */
  function validateRequest() {
    const next = { email: [] }
    const trimmed = identifier.trim()
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
    setRequestErrors(next)
    return next.email.length === 0
  }

  async function submitRequest(e) {
    e.preventDefault()
    if (submitting) return
    setStatus(null)
    if (!validateRequest()) return

    setSubmitting(true)
    try {
      const value = classifyIdentifier(identifier).value
      const resp = await api.forgotPassword({ email: value })
      setStatus({
        type: 'success',
        text:
          resp?.message ||
          'If an account exists for that email or mobile, a reset code has been sent.',
      })
      if (resp?.dev_token) setDevToken(resp.dev_token)
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setStep('reset')
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(
          err,
          ['email'],
          { email_or_mobile: 'email' },
        )
        setRequestErrors({ email: parsed.fields.email || [] })
        // Only surface a banner when there's a form-level message (non_field_errors,
        // network, or anything not bound to a known field). Field errors already
        // render inline under the input, so the banner would be a duplicate.
        if (parsed.form.length) {
          setStatus({ type: 'error', text: parsed.form[0] })
        }
      } else {
        setStatus({
          type: 'error',
          text: resolveErrorMessage(err, 'Could not start password reset. Please try again.'),
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Resend a fresh reset code to the identifier the user typed in step 1.
   * No re-entry required. Guarded by the 60s cooldown.
   */
  async function resendCode() {
    if (cooldown > 0 || submitting || !identifier) return
    setStatus(null)
    setSubmitting(true)
    try {
      const value = classifyIdentifier(identifier).value
      const resp = await api.forgotPassword({ email: value })
      setStatus({
        type: 'success',
        text: resp?.message || 'A new reset code has been sent.',
      })
      if (resp?.dev_token) setDevToken(resp.dev_token)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setStatus({
        type: 'error',
        text: resolveErrorMessage(err, 'Could not resend reset code. Please try again.'),
      })
    } finally {
      setSubmitting(false)
    }
  }

  /* --------------------- Step 2: submit token + password --------------------- */
  function validateReset() {
    const next = { token: [], new_password: [], confirm_password: [] }
    if (!token.trim()) next.token.push('Reset code is required.')
    if (!newPassword) next.new_password.push('New password is required.')
    else if (newPassword.length < 8) {
      next.new_password.push('Password must be at least 8 characters.')
    }
    if (newPassword && confirmPassword !== newPassword) {
      next.confirm_password.push('Passwords do not match.')
    }
    setResetErrors(next)
    return (
      next.token.length === 0 &&
      next.new_password.length === 0 &&
      next.confirm_password.length === 0
    )
  }

  async function submitReset(e) {
    e.preventDefault()
    if (submitting) return
    setStatus(null)
    if (!validateReset()) return

    setSubmitting(true)
    try {
      const resp = await api.resetPassword({
        token: token.trim(),
        newPassword,
      })
      setStatus({
        type: 'success',
        text: resp?.message || 'Password has been reset successfully.',
      })
      setTimeout(() => navigate('/signin'), 1200)
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['token', 'new_password'])
        setResetErrors((prev) => ({
          ...prev,
          token: parsed.fields.token || [],
          new_password: parsed.fields.new_password || [],
        }))
        // Banner only carries form-level messages — field errors render inline.
        if (parsed.form.length) {
          setStatus({ type: 'error', text: parsed.form[0] })
        }
      } else {
        setStatus({
          type: 'error',
          text: resolveErrorMessage(err, 'Reset failed. Please try again.'),
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* --------------------- Render --------------------- */
  const hasIdErr = requestErrors.email.length > 0
  const hasTokenErr = resetErrors.token.length > 0
  const hasNewPwdErr = resetErrors.new_password.length > 0
  const hasConfirmErr = resetErrors.confirm_password.length > 0

  return (
    <div className="signin-v2">
      <Link to="/" className="signin-v2-brand" aria-label="myaccess home">
        <img src="/logos/myaccess.svg" alt="myaccess" className="logo-wordmark" />
      </Link>

      <div className="signin-v2-left">
        <div className="form-wrap">
          <div className="form-card">
            <h1>{step === 'request' ? 'Forgot Password' : 'Reset Password'}</h1>

            {step === 'request' && (
              <form onSubmit={submitRequest} noValidate>
                <div className={'field-float' + (hasIdErr ? ' has-error' : '')}>
                  <label htmlFor="fp-id" className="float-label">Email or Mobile</label>
                  <input
                    id="fp-id"
                    type="text"
                    inputMode="text"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value)
                      clearError(setRequestErrors, requestErrors, 'email')
                    }}
                    autoComplete="username"
                    aria-invalid={hasIdErr}
                    aria-describedby={hasIdErr ? 'fp-id-err' : undefined}
                    disabled={submitting}
                  />
                  {hasIdErr && (
                    <p id="fp-id-err" className="field-error">
                      {requestErrors.email[0]}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-login"
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting ? 'SENDING...' : 'SEND RESET CODE'}
                </button>
              </form>
            )}

            {step === 'reset' && (
              <form onSubmit={submitReset} noValidate>
                {devToken && (
                  <div className="api-status api-status-success" role="status" aria-live="polite">
                    <span className="api-status-ic" aria-hidden="true">
                      <Icon name="check" size={14} stroke={3} />
                    </span>
                    <span>
                      Dev token: <code style={{ wordBreak: 'break-all' }}>{devToken}</code>
                    </span>
                  </div>
                )}

                <div className={'field-float' + (hasTokenErr ? ' has-error' : '')}>
                  <label htmlFor="fp-token" className="float-label">Reset Code</label>
                  <input
                    id="fp-token"
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value)
                      clearError(setResetErrors, resetErrors, 'token')
                    }}
                    autoComplete="one-time-code"
                    aria-invalid={hasTokenErr}
                    aria-describedby={hasTokenErr ? 'fp-token-err' : undefined}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="float-eye"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? 'Hide reset code' : 'Show reset code'}
                    tabIndex={-1}
                  >
                    <Icon name="eye" size={18} />
                  </button>
                  {hasTokenErr && (
                    <p id="fp-token-err" className="field-error">
                      {resetErrors.token[0]}
                    </p>
                  )}
                </div>

                <div className={'field-float' + (hasNewPwdErr ? ' has-error' : '')}>
                  <label htmlFor="fp-new" className="float-label">New Password</label>
                  <input
                    id="fp-new"
                    type={showPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      clearError(setResetErrors, resetErrors, 'new_password')
                    }}
                    autoComplete="new-password"
                    aria-invalid={hasNewPwdErr}
                    aria-describedby={hasNewPwdErr ? 'fp-new-err' : undefined}
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
                  {hasNewPwdErr && (
                    <p id="fp-new-err" className="field-error">
                      {resetErrors.new_password[0]}
                    </p>
                  )}
                </div>

                <div className={'field-float' + (hasConfirmErr ? ' has-error' : '')}>
                  <label htmlFor="fp-confirm" className="float-label">Confirm Password</label>
                  <input
                    id="fp-confirm"
                    type={showPwd ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      clearError(setResetErrors, resetErrors, 'confirm_password')
                    }}
                    autoComplete="new-password"
                    aria-invalid={hasConfirmErr}
                    aria-describedby={hasConfirmErr ? 'fp-confirm-err' : undefined}
                    disabled={submitting}
                  />
                  {hasConfirmErr && (
                    <p id="fp-confirm-err" className="field-error">
                      {resetErrors.confirm_password[0]}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-login"
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting ? 'RESETTING...' : 'RESET PASSWORD'}
                </button>
              </form>
            )}

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

            <div className="row-remember" style={{ marginTop: 18 }}>
              <Link to="/signin" className="forgot">← Back to Login</Link>
              {step === 'reset' && identifier && (
                <button
                  type="button"
                  className="forgot"
                  onClick={resendCode}
                  disabled={cooldown > 0 || submitting}
                  aria-disabled={cooldown > 0 || submitting}
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: cooldown > 0 || submitting ? 'not-allowed' : 'pointer',
                    opacity: cooldown > 0 || submitting ? 0.55 : 1,
                  }}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      <KioskRightPanel />
    </div>
  )
}

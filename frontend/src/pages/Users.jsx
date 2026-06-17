import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import Avatar from '../components/Avatar.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'
import { PermissionDenied } from './Cameras.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_RE = /^\+?[0-9]{6,15}$/

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
    })
  } catch { return '—' }
}

const EMPTY_FORM = {
  id: null,
  name: '',
  email: '',
  country_code: '',
  mobile: '',
  password: '',
  pwdMode: 'auto',  // 'auto' | 'custom' — applies on Create only
  roles: [],        // array of role IDs
}

export default function Users() {
  const navigate = useNavigate()
  const me = auth.getUser()
  if (!me) { navigate('/signin', { replace: true }); return null }

  // Permission gates — mirror the backend's HasCustomPermission rules.
  const canView    = auth.hasPerm('user_view')
  const canCreate  = auth.hasPerm('user_create')
  const canUpdate  = auth.hasPerm('user_update')
  const canDelete  = auth.hasPerm('user_delete')
  const canRestore = auth.hasPerm('user_restore')
  // Per-user Activity is hidden for now. Restore by switching this back to
  // auth.hasPerm('user_activity_view').
  const canViewActivity = false

  // Paginated server-side.
  //  - `results`     → visible page rows.
  //  - `viewCount`   → total rows that match the current view + search
  //                     (drives the pager: "Showing 1–10 of N").
  //  - `activeCount`/`deletedCount` → TRUE totals across the system,
  //                     unaffected by the search box, so the three
  //                     stat tiles never lie when a filter is active.
  const [results, setResults] = useState([])
  const [viewCount, setViewCount] = useState(0)
  const [activeCount, setActiveCount] = useState(0)
  const [deletedCount, setDeletedCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false) // softer indicator for incremental loads
  const [viewSwitching, setViewSwitching] = useState(false) // active ↔ deleted toggle
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  // Debounced version of `query` that actually drives the API request.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)

  // Guards against stale responses overwriting a newer search/page change.
  const reqIdRef = useRef(0)
  // Direct ref to the search input so the × button can refocus it on clear.
  const searchInputRef = useRef(null)
  // First successful list load only — used to decide between the bold
  // "Loading…" overlay (cold start) and the soft search-pulse indicator
  // (every subsequent fetch, including empty-result searches).
  const firstLoadDoneRef = useRef(false)

  // Modal state for create / edit
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create') // 'create' | 'edit'
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [formBanner, setFormBanner] = useState(null)
  const [saving, setSaving] = useState(false)

  // Toast for list-level actions
  const [toast, setToast] = useState(null)

  // In-app delete confirmation (replaces window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(null) // null | user object
  const [deleting, setDeleting] = useState(false)

  /* ----------------------- data load ----------------------- */
  // Debounce search input so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  // Whenever the search query or the active/deleted toggle changes, reset to
  // page 1 — otherwise we could end up on a page that no longer exists.
  useEffect(() => { setPage(1) }, [debouncedQuery, showDeleted])

  // Primary list fetch — the current page of whichever view is shown.
  // The first fetch (results empty) uses the bold "Loading…" overlay.
  // Subsequent fetches use the lightweight `searching` flag so the table
  // doesn't blank out on every keystroke.
  const loadList = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    const myReqId = ++reqIdRef.current
    setError(null)
    if (!firstLoadDoneRef.current) setLoading(true)
    else setSearching(true)
    try {
      const resp = await api.listUsers({
        showDeleted, page, pageSize, q: debouncedQuery,
      })
      if (myReqId !== reqIdRef.current) return  // stale response — newer query already in flight
      const list = resp?.results ?? (Array.isArray(resp) ? resp : [])
      const count = typeof resp?.count === 'number' ? resp.count : list.length
      setResults(list)
      setViewCount(count)
      // Only refresh the "true total" counts when there's no search active —
      // otherwise we'd overwrite them with a filtered subset and the three
      // stat tiles would mislead the admin.
      if (!debouncedQuery) {
        if (showDeleted) setDeletedCount(count)
        else setActiveCount(count)
      }
    } catch (e) {
      if (myReqId !== reqIdRef.current) return
      setError(e?.network ? 'Could not reach the server.' : 'Failed to load users.')
    } finally {
      if (myReqId === reqIdRef.current) {
        firstLoadDoneRef.current = true
        setLoading(false)
        setSearching(false)
        setViewSwitching(false)
      }
    }
  }, [showDeleted, page, pageSize, debouncedQuery, canView])

  useEffect(() => { loadList() }, [loadList])

  // On first mount only: prime BOTH counts so the stat tiles are right even
  // before the admin toggles to the other view, and load the roles catalog
  // for the role picker in the create / edit modal.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.listUsers({ showDeleted: false, page: 1, pageSize: 1 }),
      api.listUsers({ showDeleted: true,  page: 1, pageSize: 1 }),
      api.listRoles({ page: 1, pageSize: 100 }),
    ]).then(([a, d, r]) => {
      if (cancelled) return
      setActiveCount(typeof a?.count === 'number' ? a.count : (Array.isArray(a) ? a.length : 0))
      setDeletedCount(typeof d?.count === 'number' ? d.count : (Array.isArray(d) ? d.length : 0))
      setRoles(r?.results ?? (Array.isArray(r) ? r : []))
    }).catch(() => { /* surfaced by loadList if it also fails */ })
    return () => { cancelled = true }
  }, [])

  /* ----------------------- derived helpers ----------------------- */
  const stats = useMemo(() => ({
    total: activeCount + deletedCount,
    active: activeCount,
    deleted: deletedCount,
  }), [activeCount, deletedCount])

  // Backend already filtered + paginated, so the visible list is just `results`.
  const filtered = results

  // Pager works against the filtered view total (viewCount), not the
  // unfiltered system totals, so "Showing 1–N of M" reflects the search.
  const totalPages = Math.max(1, Math.ceil(viewCount / pageSize))
  const fromIdx = viewCount === 0 ? 0 : (page - 1) * pageSize + 1
  const toIdx = Math.min(page * pageSize, viewCount)

  /* ----------------------- modal helpers ----------------------- */
  function openCreate() {
    setModalMode('create')
    setForm(EMPTY_FORM)
    setFormErrors({})
    setFormBanner(null)
    setModalOpen(true)
  }
  function openEdit(u) {
    setModalMode('edit')
    setForm({
      id: u.id,
      name: u.name || '',
      email: u.email || '',
      country_code: u.country_code || '',
      mobile: u.mobile || '',
      password: '',
      pwdMode: 'auto',
      roles: (u.role_details || []).map((r) => r.id),
    })
    setFormErrors({}); setFormBanner(null)
    setModalOpen(true)
  }
  function closeModal() {
    if (saving) return
    setModalOpen(false)
  }

  function setFormField(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setFormErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }
  function toggleRole(id) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(id) ? f.roles.filter((x) => x !== id) : [...f.roles, id],
    }))
    setFormErrors((e) => (e.roles ? { ...e, roles: undefined } : e))
  }

  function validateForm() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required.'

    // Email — required and format-checked in both Create and Edit modes.
    if (!form.email.trim()) {
      errs.email = 'Email is required.'
    } else if (!EMAIL_RE.test(form.email.trim())) {
      errs.email = 'Enter a valid email.'
    }

    // Mobile — required and format-checked in both modes.
    const mobileStripped = form.mobile.replace(/[\s-]/g, '')
    if (!form.mobile.trim()) {
      errs.mobile = 'Mobile is required.'
    } else if (!MOBILE_RE.test(mobileStripped)) {
      errs.mobile = 'Enter a valid mobile (digits only).'
    }

    // Password rules
    if (modalMode === 'create') {
      // 'custom' mode: required and ≥ 8 chars. 'auto' mode: optional override.
      if (form.pwdMode === 'custom') {
        if (!form.password) errs.password = 'Password is required.'
        else if (form.password.length < 8) errs.password = 'At least 8 characters.'
      } else if (form.password && form.password.length < 8) {
        errs.password = 'At least 8 characters.'
      }
    } else if (form.password && form.password.length < 8) {
      errs.password = 'At least 8 characters.'
    }

    if (form.roles.length === 0) errs.roles = 'Assign at least one role.'
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  /* ----------------------- submit ----------------------- */
  async function submitForm(e) {
    e.preventDefault()
    if (saving) return
    setFormBanner(null)
    if (!validateForm()) return

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      country_code: form.country_code.trim() || null,
      mobile: form.mobile.replace(/[\s-]/g, '') || null,
      roles: form.roles,
    }
    // Password handling:
    //  - Create + custom mode  → typed value (required).
    //  - Create + auto mode    → typed value if any (it overrides auto-gen);
    //                            otherwise omit so backend generates one.
    //  - Edit                  → typed value if any; otherwise omit (keep current).
    if (form.password) payload.password = form.password

    setSaving(true)
    try {
      if (modalMode === 'create') {
        const resp = await api.createUser(payload)
        const created = resp?.data
        if (created) {
          // The new user is active and lives at the top of the active list.
          // If the admin is currently viewing the active list AND on page 1,
          // prepend it so it shows up without a refetch. Otherwise just bump
          // the count; the row will appear when they navigate there.
          setActiveCount((c) => c + 1)
          if (!showDeleted && page === 1) {
            setResults((prev) => [created, ...prev].slice(0, pageSize))
          }
        }
        setToast({
          type: resp?.credentials_emailed === false ? 'error' : 'success',
          text: resp?.message || `User “${payload.name}” created.`,
        })
        setModalOpen(false)
      } else {
        const resp = await api.updateUser(form.id, payload)
        // Patch the changed user in-place instead of refetching the whole list.
        const updated = resp?.data
        if (updated) {
          setResults((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
        }
        const emailFailed = resp?.password_changed && resp?.password_email_sent === false
        setToast({
          type: emailFailed ? 'error' : 'success',
          text: resp?.message || `User “${updated?.name || payload.name}” updated.`,
        })
        setModalOpen(false)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['name', 'email', 'mobile', 'password', 'roles', 'country_code'])
        const fieldErrs = {}
        for (const k of Object.keys(parsed.fields)) {
          if (parsed.fields[k]?.length) fieldErrs[k] = parsed.fields[k][0]
        }
        setFormErrors(fieldErrs)
        if (parsed.form.length) setFormBanner({ type: 'error', text: parsed.form[0] })
        else if (!Object.keys(fieldErrs).length) {
          setFormBanner({ type: 'error', text: err.message || 'Failed to save.' })
        }
      } else {
        setFormBanner({ type: 'error', text: 'Network error. Try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  // Opens the in-app confirmation modal. The actual delete fires from
  // `confirmDeleteUser` below once the admin clicks the "Delete user" CTA.
  function onDelete(u) {
    if (u.id === me.id) {
      setToast({ type: 'error', text: "You can't delete yourself." })
      return
    }
    setConfirmDelete(u)
  }

  async function confirmDeleteUser() {
    const u = confirmDelete
    if (!u || deleting) return
    setDeleting(true)
    try {
      await api.deleteUser(u.id)
      setResults((prev) => prev.filter((x) => x.id !== u.id))
      setActiveCount((c) => Math.max(0, c - 1))
      setDeletedCount((c) => c + 1)
      setToast({ type: 'success', text: `User “${u.name || u.email}” deleted.` })
      setConfirmDelete(null)
    } catch (e) {
      setToast({ type: 'error', text: 'Failed to delete user.' })
    } finally {
      setDeleting(false)
    }
  }
  async function onRestore(u) {
    try {
      await api.restoreUser(u.id)
      setResults((prev) => prev.filter((x) => x.id !== u.id))
      setDeletedCount((c) => Math.max(0, c - 1))
      setActiveCount((c) => c + 1)
      setToast({ type: 'success', text: `User “${u.name || u.email}” restored.` })
    } catch (e) {
      setToast({ type: 'error', text: 'Failed to restore user.' })
    }
  }

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  /* ----------------------- render ----------------------- */
  if (!canView) {
    return (
      <div className="kiosk-app">
        <TopBar />
        <div className="admin-page"><PermissionDenied resource="users" /></div>
      </div>
    )
  }

  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />

      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1>Users</h1>
            <p className="lede">Create, edit and assign roles to people in your organisation.</p>
          </div>
          <div className="admin-page-actions">
            <div className={'admin-search' + (searching ? ' is-searching' : '')}>
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name, email, mobile or role…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    setQuery('')
                  }
                }}
                aria-label="Search users"
              />
              {query && (
                <button
                  type="button"
                  className="admin-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('')
                    searchInputRef.current?.focus()
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <label className={'admin-toggle' + (viewSwitching ? ' is-busy' : '')}>
              <input
                type="checkbox"
                checked={showDeleted}
                disabled={viewSwitching}
                onChange={(e) => {
                  setShowDeleted(e.target.checked)
                  setViewSwitching(true)
                }}
              />
              <span>Show deleted</span>
              {viewSwitching && <span className="admin-spinner sm" aria-hidden="true" />}
            </label>
            {canCreate && (
              <button type="button" className="btn-primary" onClick={openCreate}>+ Add User</button>
            )}
          </div>
        </header>

        <section className="admin-stats">
          <div className="dash-stat"><div className="n">{stats.total}</div><div className="l">Total users</div></div>
          <div className="dash-stat"><div className="n">{stats.active}</div><div className="l">Active users</div></div>
          <div className="dash-stat"><div className="n">{stats.deleted}</div><div className="l">Soft-deleted users</div></div>
        </section>

        {error && <div className="admin-banner error">{error}</div>}

        <section className="admin-card list-card">
          <div className="user-table-head">
            <div>User</div>
            <div>Contact</div>
            <div>Roles</div>
            <div>Created</div>
            <div className="ta-right">Actions</div>
          </div>

          <div className="list-scroll">
          {!canView ? (
            <PermissionDenied resource="users" />
          ) : loading || viewSwitching ? (
            <div className="admin-empty admin-loading">
              <span className="admin-spinner" aria-hidden="true" />
              <span>
                {viewSwitching
                  ? (showDeleted ? 'Loading soft-deleted users…' : 'Loading active users…')
                  : 'Loading…'}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty">
              {debouncedQuery
                ? <>No users match <strong>"{debouncedQuery}"</strong>{showDeleted ? ' in soft-deleted users' : ' in active users'}.{' '}
                    <button type="button" className="link-btn" onClick={() => setQuery('')}>Clear search</button>
                  </>
                : (showDeleted
                    ? 'No soft-deleted users.'
                    : 'No active users yet.')}
            </div>
          ) : (
            filtered.map((u) => {
              const isDeleted = u.deleted_at != null
              return (
                <div className={'user-row' + (isDeleted ? ' is-deleted' : '')} key={u.id}>
                  <div className="user-cell" data-col="User">
                    <Avatar
                      seed={u.id ?? u.email ?? u.name}
                      size={36}
                      title={u.name || u.email || ''}
                      className="user-av-svg"
                    />
                    <div>
                      <div className="user-name">{u.name || '—'} {u.id === me.id && <span className="you-chip">you</span>}</div>
                    </div>
                  </div>
                  <div className="user-cell-mono" data-col="Contact">
                    <div>{u.email || '—'}</div>
                    <div className="user-sub">{u.mobile || ''}</div>
                  </div>
                  <div data-col="Roles">
                    {(u.role_details || []).length === 0
                      ? <span className="user-sub">—</span>
                      : (u.role_details || []).map((r) => (
                          <span className="role-chip" key={r.id}>{r.name}</span>
                        ))
                    }
                  </div>
                  <div className="user-sub" data-col="Created">{formatDate(u.created_at)}</div>
                  <div className="user-actions" data-col="Actions">
                    {canViewActivity && (
                      <button
                        type="button"
                        className="row-btn"
                        onClick={() => navigate(`/users/${u.id}/activity`)}
                        title={`View ${u.name || 'this user'}'s activity`}
                      >
                        Activity
                      </button>
                    )}
                    {isDeleted ? (
                      canRestore
                        ? <button type="button" className="row-btn" onClick={() => onRestore(u)}>Restore</button>
                        : (!canViewActivity && <span className="row-actions-none">View only</span>)
                    ) : (
                      <>
                        {canUpdate && (
                          <button type="button" className="row-btn" onClick={() => openEdit(u)}>Edit</button>
                        )}
                        {canDelete && (
                          <button type="button" className="row-btn danger" onClick={() => onDelete(u)}>Delete</button>
                        )}
                        {!canUpdate && !canDelete && !canViewActivity && (
                          <span className="row-actions-none">View only</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
          </div>{/* /list-scroll */}

          {viewCount > 0 && (
            <Pager
              page={page}
              totalPages={totalPages}
              fromIdx={fromIdx}
              toIdx={toIdx}
              total={viewCount}
              label={
                debouncedQuery
                  ? `matches for "${debouncedQuery}"`
                  : (showDeleted ? 'soft-deleted users' : 'active users')
              }
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading || searching}
            />
          )}
        </section>
      </div>

      {/* ---------- Create / Edit modal ---------- */}
      {modalOpen && (
        <Modal onClose={closeModal} title={modalMode === 'create' ? 'Add User' : 'Edit User'}>
          <form onSubmit={submitForm} noValidate>
            {formBanner && <div className={'admin-banner ' + formBanner.type}>{formBanner.text}</div>}

            <div className="form-grid-2">
              <Field label="Name" required error={formErrors.name}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setFormField('name', e.target.value)}
                  autoFocus
                  disabled={saving}
                />
              </Field>
              <Field label="Email" required error={formErrors.email}>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setFormField('email', e.target.value)}
                  autoComplete="off"
                  disabled={saving}
                />
              </Field>
              <Field label="Country code" error={formErrors.country_code}>
                <input
                  type="text"
                  value={form.country_code}
                  onChange={(e) => setFormField('country_code', e.target.value)}
                  placeholder="+91"
                  disabled={saving}
                />
              </Field>
              <Field label="Mobile" required error={formErrors.mobile}>
                <input
                  type="tel"
                  value={form.mobile}
                  onChange={(e) => setFormField('mobile', e.target.value)}
                  placeholder="99999 99999"
                  disabled={saving}
                />
              </Field>

              {/* Password section.
                  Create → segmented toggle (auto / custom). Auto-generate
                  hides the field entirely; Set custom reveals an input.
                  Edit   → single optional input ("leave blank to keep"). */}
              {modalMode === 'create' ? (
                <Field
                  label="Password"
                  required={form.pwdMode === 'custom'}
                  error={formErrors.password}
                  full
                >
                  <div className="pwd-mode-toggle" role="tablist" aria-label="Password mode">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={form.pwdMode === 'auto'}
                      className={'pwd-mode-opt' + (form.pwdMode === 'auto' ? ' is-active' : '')}
                      onClick={() => {
                        setFormField('pwdMode', 'auto')
                        // Drop any value typed in custom mode so it doesn't leak through.
                        setFormField('password', '')
                      }}
                      disabled={saving}
                    >
                      Auto-generate
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={form.pwdMode === 'custom'}
                      className={'pwd-mode-opt' + (form.pwdMode === 'custom' ? ' is-active' : '')}
                      onClick={() => setFormField('pwdMode', 'custom')}
                      disabled={saving}
                    >
                      Set custom
                    </button>
                  </div>
                  {form.pwdMode === 'custom' && (
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setFormField('password', e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      disabled={saving}
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label="New password (leave blank to keep)"
                  error={formErrors.password}
                  full
                >
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setFormField('password', e.target.value)}
                    autoComplete="new-password"
                    disabled={saving}
                  />
                </Field>
              )}
            </div>

            <Field group label="Roles" required error={formErrors.roles}>
              <div className="role-picker">
                {roles.length === 0 ? (
                  <p className="user-sub">No roles defined yet. Create one in <a href="/roles">Roles</a>.</p>
                ) : roles.map((r) => {
                  const on = form.roles.includes(r.id)
                  return (
                    <button
                      type="button"
                      key={r.id}
                      className={'role-chip is-picker' + (on ? ' is-on' : '')}
                      onClick={() => toggleRole(r.id)}
                      disabled={saving}
                    >
                      {on && <span className="tick" aria-hidden="true">✓</span>}
                      {r.name}
                    </button>
                  )
                })}
              </div>
            </Field>

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (modalMode === 'create' ? 'Create User' : 'Save Changes')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Delete confirmation ---------- */}
      {confirmDelete && (
        <Modal title="Delete user?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Are you sure you want to delete{' '}
              <strong>{confirmDelete.name || confirmDelete.email || `user #${confirmDelete.id}`}</strong>?
            </p>
            <p className="confirm-sub">
              The user is <em>soft-deleted</em> — they can be restored from
              the “Show deleted” list later. They won't be able to sign in
              until you restore them.
            </p>
          </div>
          <div className="modal-foot">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={confirmDeleteUser}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete user'}
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className={'toast toast-' + toast.type} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      <footer className="kiosk-foot">© 2026 myaccess Inc. · KIOSK IoT Platform</footer>
    </div>
  )
}

/* ----------------------- shared bits ----------------------- */
function Field({ label, error, children, full, required, group }) {
  // `group` renders a <div> instead of <label>. A <label> forwards empty-space
  // clicks to its first labelable descendant (e.g. the first role chip button),
  // which would wrongly toggle it. Use group for fields holding a set of
  // buttons/chips rather than a single input.
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className={'form-field' + (full ? ' full' : '') + (error ? ' has-error' : '')}>
      <span className="form-label">
        {label}
        {required && <span className="required-star" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && <span className="form-err">{error}</span>}
    </Tag>
  )
}

function Modal({ title, children, onClose }) {
  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="#6b6258" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="#6b6258" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function Pager({ page, totalPages, fromIdx, toIdx, total, label, onPrev, onNext, disabled }) {
  return (
    <div className="pager">
      <span className="pager-info">
        Showing <strong>{fromIdx}–{toIdx}</strong> of <strong>{total}</strong>
        {label ? ` ${label}` : ''}
      </span>
      <div className="pager-controls">
        <button
          type="button"
          className="pager-btn"
          onClick={onPrev}
          disabled={disabled || page <= 1}
        >
          ← Prev
        </button>
        <span className="pager-page">Page <strong>{page}</strong> of {totalPages}</span>
        <button
          type="button"
          className="pager-btn"
          onClick={onNext}
          disabled={disabled || page >= totalPages}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

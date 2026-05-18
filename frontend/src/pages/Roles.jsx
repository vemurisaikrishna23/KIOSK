import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { Pager } from './Users.jsx'
import { api, ApiError, auth, parseApiErrors } from '../lib/api.js'

// System-managed roles the API will refuse to delete — mirror the backend's
// RoleViewSet.PROTECTED_ROLE_NAMES so the UI never offers a Delete button
// for them in the first place.
const PROTECTED_ROLE_NAMES = new Set(['SuperAdmin', 'Default'])

function groupByPolicy(permissions) {
  const m = new Map()
  for (const p of permissions || []) {
    const k = p.policy || 'Other'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(p)
  }
  return [...m.entries()].map(([policy, perms]) => ({ policy, perms }))
}

const EMPTY_FORM = { id: null, name: '', description: '', permissions: [] /* ids */ }

export default function Roles() {
  const navigate = useNavigate()
  if (!auth.getUser()) { navigate('/signin', { replace: true }); return null }

  const [roles, setRoles] = useState([])
  const [rolesCount, setRolesCount] = useState(0)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [expanded, setExpanded] = useState(() => new Set())

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [formBanner, setFormBanner] = useState(null)
  const [saving, setSaving] = useState(false)

  const [toast, setToast] = useState(null)

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null)  // null | role
  const [deleting, setDeleting] = useState(false)

  // Debounce search → drives the server-side ?q= param.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])
  // Reset to page 1 whenever the search term changes.
  useEffect(() => { setPage(1) }, [debouncedQuery])

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r, p] = await Promise.all([
        api.listRoles({ page, pageSize, q: debouncedQuery }),
        api.listPermissions(),
      ])
      const rolesList = r?.results ?? (Array.isArray(r) ? r : [])
      setRoles(rolesList)
      setRolesCount(typeof r?.count === 'number' ? r.count : rolesList.length)
      setPermissions(Array.isArray(p) ? p : (p?.results || []))
    } catch (e) {
      setError(e?.network ? 'Could not reach the server.' : 'Failed to load roles.')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedQuery])
  useEffect(() => { reload() }, [reload])

  const permsByPolicy = useMemo(() => groupByPolicy(permissions), [permissions])

  // Server already filtered + paginated — just display the page.
  const filtered = roles

  const stats = useMemo(() => ({
    roles: rolesCount,
    permissions: permissions.length,
    policies: new Set(permissions.map((p) => p.policy || 'Other')).size,
  }), [rolesCount, permissions])

  const totalPages = Math.max(1, Math.ceil(rolesCount / pageSize))
  const fromIdx = rolesCount === 0 ? 0 : (page - 1) * pageSize + 1
  const toIdx = Math.min(page * pageSize, rolesCount)

  /* ---------- modal helpers ---------- */
  function openCreate() {
    setModalMode('create')
    setForm(EMPTY_FORM)
    setFormErrors({}); setFormBanner(null)
    setModalOpen(true)
  }
  function openEdit(r) {
    setModalMode('edit')
    setForm({
      id: r.id,
      name: r.name || '',
      description: r.description || '',
      permissions: (r.permission_details || []).map((p) => p.id),
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
  function togglePerm(id) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(id)
        ? f.permissions.filter((x) => x !== id)
        : [...f.permissions, id],
    }))
    setFormErrors((e) => (e.permissions ? { ...e, permissions: undefined } : e))
  }
  function selectAllInPolicy(policy) {
    const ids = permissions.filter((p) => (p.policy || 'Other') === policy).map((p) => p.id)
    const allSelected = ids.every((id) => form.permissions.includes(id))
    setForm((f) => ({
      ...f,
      permissions: allSelected
        ? f.permissions.filter((x) => !ids.includes(x))
        : [...new Set([...f.permissions, ...ids])],
    }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required.'
    if (form.permissions.length === 0) errs.permissions = 'Select at least one permission.'
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormBanner(null)
    if (!validate()) return

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      permissions: form.permissions,
    }

    setSaving(true)
    try {
      if (modalMode === 'create') {
        await api.createRole(payload)
        setToast({ type: 'success', text: `Role “${payload.name}” created.` })
      } else {
        await api.updateRole(form.id, payload)
        setToast({ type: 'success', text: `Role “${payload.name}” updated.` })
      }
      setModalOpen(false)
      await reload()
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = parseApiErrors(err, ['name', 'description', 'permissions'])
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

  function toggleExpand(id) {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onDelete(r) {
    if (PROTECTED_ROLE_NAMES.has(r.name)) {
      setToast({ type: 'error', text: `The “${r.name}” role is a system role and cannot be deleted.` })
      return
    }
    setConfirmDelete(r)
  }

  async function confirmDeleteRole() {
    const r = confirmDelete
    if (!r || deleting) return
    setDeleting(true)
    try {
      const resp = await api.deleteRole(r.id)
      // Drop the role from the list locally; count goes down by 1.
      setRoles((prev) => prev.filter((x) => x.id !== r.id))
      setRolesCount((c) => Math.max(0, c - 1))
      setToast({
        type: 'success',
        text: resp?.message || `Role “${r.name}” deleted.`,
      })
      setConfirmDelete(null)
    } catch (err) {
      const detail =
        (err instanceof ApiError && err?.data?.detail) ||
        err?.message ||
        'Failed to delete role.'
      setToast({ type: 'error', text: detail })
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------- render ---------- */
  return (
    <div className="kiosk-app kiosk-app-fixed">
      <TopBar />

      <div className="admin-page">
        <header className="admin-page-head">
          <div>
            <h1>Roles &amp; Permissions</h1>
            <p className="lede">Define roles and choose what each one can do across the platform.</p>
          </div>
          <div className="admin-page-actions">
            <div className="admin-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search roles or permissions…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search roles"
              />
            </div>
            <button type="button" className="btn-primary" onClick={openCreate}>+ Add Role</button>
          </div>
        </header>

        <section className="admin-stats">
          <div className="dash-stat"><div className="n">{stats.roles}</div><div className="l">Roles</div></div>
          <div className="dash-stat"><div className="n">{stats.permissions}</div><div className="l">Permissions</div></div>
          <div className="dash-stat"><div className="n">{stats.policies}</div><div className="l">{stats.policies === 1 ? 'Policy' : 'Policies'}</div></div>
        </section>

        {error && <div className="admin-banner error">{error}</div>}

        <div className="roles-layout">
          {/* ----- Left: roles list ----- */}
          <section className="admin-card list-card">
            <div className="card-head">
              <h3 className="card-title">Roles</h3>
              <span className="card-count">{filtered.length}</span>
            </div>
            <div className="list-scroll">
            {loading ? (
              <div className="admin-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="admin-empty">No roles match your filter.</div>
            ) : (
              <div className="role-list">
                {filtered.map((r) => {
                  const perms = r.permission_details || []
                  const policies = groupByPolicy(perms)
                  const isOpen = expanded.has(r.id)
                  return (
                    <article className="role-card" key={r.id}>
                      <header className="role-card-head" onClick={() => toggleExpand(r.id)}>
                        <div className="role-card-id">
                          <div className="role-icon" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" stroke="#F36A1E" strokeWidth="1.7" strokeLinejoin="round"/>
                              <path d="M9 12l2 2 4-4" stroke="#F36A1E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div>
                            <h4>{r.name}</h4>
                            <p className="role-desc">{r.description || 'No description.'}</p>
                          </div>
                        </div>
                        <div className="role-card-stats">
                          {/* Chip pills: wrap together so the chevron sits at the
                              end of THIS row, never below. The chevron and the
                              action row each get their own grid-area on mobile. */}
                          <div className="role-meta-pills">
                            <span className="kv"><b>{perms.length}</b> <span className="kv-label">permissions</span><span className="kv-label-short">perms</span></span>
                            <span className="kv"><b>{policies.length}</b> {policies.length === 1 ? 'policy' : 'policies'}</span>
                            {PROTECTED_ROLE_NAMES.has(r.name) && (
                              <span className="system-chip" title="System role — cannot be deleted">SYSTEM</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className={'expand-btn' + (isOpen ? ' is-open' : '')}
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="m6 9 6 6 6-6" stroke="#6b6258" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <div className="role-actions-group">
                            <button type="button" className="row-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>Edit</button>
                            {!PROTECTED_ROLE_NAMES.has(r.name) && (
                              <button
                                type="button"
                                className="row-btn danger"
                                onClick={(e) => { e.stopPropagation(); onDelete(r) }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </header>

                      {isOpen && (
                        <div className="role-card-body">
                          {policies.length === 0 ? (
                            <p className="user-sub" style={{ margin: 0 }}>This role has no permissions yet.</p>
                          ) : policies.map(({ policy, perms: ps }) => (
                            <div className="policy-group" key={policy}>
                              <div className="policy-name">{policy}</div>
                              <div className="perm-chips">
                                {ps.map((p) => (
                                  <span className="perm-chip" key={p.id} title={p.short_name}>
                                    {p.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
            </div>{/* /list-scroll */}

            {rolesCount > 0 && (
              <Pager
                page={page}
                totalPages={totalPages}
                fromIdx={fromIdx}
                toIdx={toIdx}
                total={rolesCount}
                label="roles"
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={loading}
              />
            )}
          </section>

          {/* ----- Right: permissions catalog ----- */}
          <aside className="admin-card list-card">
            <div className="card-head">
              <h3 className="card-title">Permission catalog</h3>
              <span className="card-count">{permissions.length}</span>
            </div>
            <div className="list-scroll">
            {loading ? (
              <div className="admin-empty">Loading…</div>
            ) : permsByPolicy.length === 0 ? (
              <div className="admin-empty">No permissions seeded yet.</div>
            ) : permsByPolicy.map(({ policy, perms }) => (
              <div className="policy-group" key={policy}>
                <div className="policy-name">{policy}</div>
                <div className="perm-chips">
                  {perms.map((p) => (
                    <span className="perm-chip" key={p.id} title={p.short_name}>
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            </div>{/* /list-scroll */}
          </aside>
        </div>
      </div>

      {/* ---------- Create / Edit role modal ---------- */}
      {modalOpen && (
        <Modal title={modalMode === 'create' ? 'Add Role' : 'Edit Role'} onClose={closeModal}>
          <form onSubmit={submit} noValidate>
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
              <Field label="Description" error={formErrors.description} full>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setFormField('description', e.target.value)}
                  placeholder="What does this role do?"
                  disabled={saving}
                />
              </Field>
            </div>

            <Field label={`Permissions (${form.permissions.length} selected)`} required error={formErrors.permissions}>
              {permsByPolicy.length === 0 ? (
                <p className="user-sub">No permissions available.</p>
              ) : (
                <div className="perm-picker">
                  {permsByPolicy.map(({ policy, perms }) => {
                    const policyIds = perms.map((p) => p.id)
                    const allOn = policyIds.every((id) => form.permissions.includes(id))
                    return (
                      <div className="perm-picker-group" key={policy}>
                        <div className="perm-picker-head">
                          <span className="policy-name">{policy}</span>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => selectAllInPolicy(policy)}
                            disabled={saving}
                          >
                            {allOn ? 'Clear' : 'Select all'}
                          </button>
                        </div>
                        <div className="perm-chips">
                          {perms.map((p) => {
                            const on = form.permissions.includes(p.id)
                            return (
                              <button
                                type="button"
                                key={p.id}
                                className={'perm-chip is-picker' + (on ? ' is-on' : '')}
                                onClick={() => togglePerm(p.id)}
                                disabled={saving}
                              >
                                {on && <span className="tick" aria-hidden="true">✓</span>}
                                {p.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Field>

            <div className="modal-foot">
              <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : (modalMode === 'create' ? 'Create Role' : 'Save Changes')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Delete role confirmation ---------- */}
      {confirmDelete && (
        <Modal title="Delete role?" onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-body">
            <div className="confirm-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"
                      stroke="#E0463D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="confirm-lead">
              Are you sure you want to delete the{' '}
              <strong>{confirmDelete.name}</strong> role?
            </p>
            <p className="confirm-sub">
              Any user who currently holds only this role will be reassigned to
              the <strong>Default</strong> role (read-only access to users,
              roles, cameras and applications). Users with multiple roles
              simply lose this one and keep the rest.
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
              onClick={confirmDeleteRole}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete role'}
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

/* ----- shared ----- */
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
function Modal({ title, children, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card modal-wide" onMouseDown={(e) => e.stopPropagation()}>
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

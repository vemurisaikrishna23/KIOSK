import { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/* =====================================================================
   Rich-text editing + rendering for application descriptions.

   Stored format is sanitized HTML. Older records were authored in
   Markdown, so the renderers fall back to <ReactMarkdown> when the value
   doesn't look like HTML — existing data keeps rendering correctly.

   Exports:
     • RichTextEditor  — WYSIWYG editor (contentEditable + toolbar)
     • RichTextInline  — one-line/clamped preview (cards)
     • RichTextBlock   — full formatted body (modals)
     • isHtml / sanitizeHtml — helpers
   ===================================================================== */

const ALLOWED = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'P', 'BR', 'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'H4',
  'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'DIV',
])

const escapeText = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Allow only safe URL schemes (http/https/mailto/tel) and relative links. */
function safeHref(href) {
  if (!href) return ''
  const v = String(href).trim()
  if (/^\s*javascript:/i.test(v) || /^\s*data:/i.test(v)) return ''
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(v)) return v
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return 'https://' + v   // bare domain
  return ''
}

/** True when the string contains real HTML tags (vs. plain text / markdown). */
export function isHtml(s) {
  return typeof s === 'string' && /<([a-z][a-z0-9]*)\b[^>]*>|<br\s*\/?>/i.test(s)
}

/** Recursively rebuild a DOM subtree keeping only whitelisted tags/attrs. */
function cleanNode(node) {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) { out += escapeText(child.nodeValue); return }
    if (child.nodeType !== 1) return
    const tag = child.tagName
    if (!ALLOWED.has(tag)) { out += cleanNode(child); return }   // unwrap unknown
    if (tag === 'BR') { out += '<br>'; return }
    const inner = cleanNode(child)
    if (tag === 'A') {
      const href = safeHref(child.getAttribute('href'))
      out += href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner
    } else {
      const t = tag.toLowerCase()
      out += `<${t}>${inner}</${t}>`
    }
  })
  return out
}

/** Strip a (possibly dirty) HTML string down to a safe whitelist. */
export function sanitizeHtml(dirty) {
  if (!dirty) return ''
  const doc = new DOMParser().parseFromString(String(dirty), 'text/html')
  return cleanNode(doc.body)
}

/** Flatten HTML to inline-only markup (for clamped card previews). */
function toInlineHtml(value) {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html')
  const walk = (node) => {
    let out = ''
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { out += escapeText(c.nodeValue); return }
      if (c.nodeType !== 1) return
      const tag = c.tagName
      const inner = walk(c)
      if (tag === 'B' || tag === 'STRONG') out += `<strong>${inner}</strong>`
      else if (tag === 'I' || tag === 'EM') out += `<em>${inner}</em>`
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') out += `<s>${inner}</s>`
      else if (tag === 'U') out += `<u>${inner}</u>`
      else if (tag === 'CODE') out += `<code>${inner}</code>`
      else if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4') out += `<strong>${inner}</strong> `
      else if (tag === 'A') out += inner                 // cards are clickable — no nested links
      else if (tag === 'BR') out += ' '
      else out += inner + ' '                            // block-ish → space separated
    })
    return out
  }
  return walk(doc.body).replace(/\s+/g, ' ').trim()
}

/** Best-effort Markdown → HTML for loading legacy values into the editor. */
function mdToHtml(md) {
  if (!md) return ''
  const lines = String(md).replace(/\r\n/g, '\n').split('\n')
  const html = []
  let listType = null
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null } }
  const inline = (t) => escapeText(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  for (const raw of lines) {
    const line = raw.trimEnd()
    let m
    if ((m = line.match(/^#{3}\s+(.*)$/))) { closeList(); html.push(`<h3>${inline(m[1])}</h3>`) }
    else if ((m = line.match(/^#{1,2}\s+(.*)$/))) { closeList(); html.push(`<h2>${inline(m[1])}</h2>`) }
    else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { if (listType !== 'ul') { closeList(); listType = 'ul'; html.push('<ul>') } html.push(`<li>${inline(m[1])}</li>`) }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (listType !== 'ol') { closeList(); listType = 'ol'; html.push('<ol>') } html.push(`<li>${inline(m[1])}</li>`) }
    else if (line === '') { closeList() }
    else { closeList(); html.push(`<p>${inline(line)}</p>`) }
  }
  closeList()
  return html.join('')
}

const INLINE_MD_COMPONENTS = {
  p: ({ children }) => <>{children}</>,
  h1: ({ children }) => <strong>{children}</strong>,
  h2: ({ children }) => <strong>{children}</strong>,
  h3: ({ children }) => <strong>{children}</strong>,
  h4: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => <span>{children}</span>,
  ol: ({ children }) => <span>{children}</span>,
  li: ({ children }) => <span>{children} </span>,
  blockquote: ({ children }) => <span>{children}</span>,
  pre: ({ children }) => <span>{children}</span>,
  hr: () => null,
  img: () => null,
  a: ({ children }) => <>{children}</>,
}

/* ----------------------- renderers ----------------------- */

/** Inline (clamp-friendly) preview — HTML flattened to inline, or inline MD. */
export function RichTextInline({ value }) {
  if (!value) return null
  if (isHtml(value)) {
    return <span className="rt-inline" dangerouslySetInnerHTML={{ __html: toInlineHtml(value) }} />
  }
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={INLINE_MD_COMPONENTS}>{value}</ReactMarkdown>
}

/** Full formatted body for modals/popups. */
export function RichTextBlock({ value, className }) {
  if (!value) return null
  if (isHtml(value)) {
    return <div className={(className || '') + ' rt-body'} dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }} />
  }
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

/* ----------------------- editor ----------------------- */

const TOOLS = [
  { cmd: 'bold', label: 'Bold', icon: 'B', style: { fontWeight: 800 } },
  { cmd: 'italic', label: 'Italic', icon: 'I', style: { fontStyle: 'italic' } },
  { cmd: 'underline', label: 'Underline', icon: 'U', style: { textDecoration: 'underline' } },
  { cmd: 'strikeThrough', label: 'Strikethrough', icon: 'S', style: { textDecoration: 'line-through' } },
]

export function RichTextEditor({ value, onChange, disabled, placeholder = 'Write a description…' }) {
  const ref = useRef(null)
  const lastEmitted = useRef(null)        // last HTML we sent up (avoid caret resets)
  const [active, setActive] = useState({})

  // Push external value into the editor only when it differs from what we last
  // emitted — keeps the caret stable while the user types.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value === lastEmitted.current) return
    const html = isHtml(value) ? sanitizeHtml(value) : mdToHtml(value || '')
    if (html !== el.innerHTML) { el.innerHTML = html; refreshEmpty(el) }
    lastEmitted.current = value
  }, [value])

  const refreshActive = useCallback(() => {
    if (disabled) return
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      })
    } catch { /* queryCommandState can throw if unfocused */ }
  }, [disabled])

  function refreshEmpty(el) {
    const empty = !el.textContent.trim() && !el.querySelector('img,li')
    el.classList.toggle('is-empty', empty)
  }

  function emit() {
    const el = ref.current
    if (!el) return
    if (el.innerHTML === '<br>' || el.innerHTML === '<div><br></div>') el.innerHTML = ''
    refreshEmpty(el)
    const html = sanitizeHtml(el.innerHTML)
    lastEmitted.current = html
    onChange?.(html)
    refreshActive()
  }

  function exec(cmd, arg) {
    if (disabled) return
    ref.current?.focus()
    try { document.execCommand(cmd, false, arg) } catch { /* noop */ }
    emit()
  }

  function onHeading() {
    if (disabled) return
    ref.current?.focus()
    // Toggle between H2 and normal paragraph.
    const isH = /^h[1-4]$/i.test(document.queryCommandValue('formatBlock'))
    try { document.execCommand('formatBlock', false, isH ? 'P' : 'H2') } catch { /* noop */ }
    emit()
  }

  function onLink() {
    if (disabled) return
    const url = window.prompt('Link URL')
    if (url == null) return
    const href = safeHref(url)
    if (!href) { if (url.trim()) window.alert('That link looks invalid.'); return }
    exec('createLink', href)
  }

  return (
    <div className={'rt-editor' + (disabled ? ' is-disabled' : '')}>
      <div className="rt-toolbar" role="toolbar" aria-label="Text formatting">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            className={'rt-btn' + (active[t.cmd] ? ' is-active' : '')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.cmd)}
            disabled={disabled}
            title={t.label}
            aria-label={t.label}
          >
            <span style={t.style}>{t.icon}</span>
          </button>
        ))}
        <span className="rt-sep" aria-hidden="true" />
        <button type="button" className="rt-btn" onMouseDown={(e) => e.preventDefault()} onClick={onHeading} disabled={disabled} title="Heading" aria-label="Heading">H</button>
        <button type="button" className={'rt-btn' + (active.insertUnorderedList ? ' is-active' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} disabled={disabled} title="Bulleted list" aria-label="Bulleted list">•≡</button>
        <button type="button" className={'rt-btn' + (active.insertOrderedList ? ' is-active' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} disabled={disabled} title="Numbered list" aria-label="Numbered list">1.</button>
        <button type="button" className="rt-btn" onMouseDown={(e) => e.preventDefault()} onClick={onLink} disabled={disabled} title="Insert link" aria-label="Insert link">🔗</button>
        <span className="rt-sep" aria-hidden="true" />
        <button type="button" className="rt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} disabled={disabled} title="Clear formatting" aria-label="Clear formatting">⌫</button>
      </div>
      <div
        ref={ref}
        className="rt-area is-empty"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        suppressContentEditableWarning
      />
    </div>
  )
}

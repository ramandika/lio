/*
 * Small design-system kit over design/tokens.css (see docs/DESIGN.md):
 * pill buttons, hairline inputs, cards, status pills, flat banners.
 */

export function Btn({ variant = 'primary', size, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={[
        'btn',
        `btn--${variant}`,
        size ? `btn--${size}` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

export function Card({ className = '', ...props }) {
  return <section className={`card ${className}`} {...props} />
}

export function Field({ label, hint, error, htmlFor, className = '', warn = false, confidence = null, children }) {
  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      {label && (
        <span className="field__labelrow">
          <label className="field__label" htmlFor={htmlFor}>
            {label}
          </label>
          {/* LLM-extraction-only cues: the model's self-scored per-field confidence
              (its low end as the yellow mark), never shown for L1/manual/saved values. */}
          {warn && (
            <span
              className="tag tag--warn"
              title="The LLM was unsure of this value — verify it against the document."
            >
              Low confidence{confidence != null ? ` · ${confidence}%` : ''}
            </span>
          )}
          {!warn && confidence != null && (
            <span
              className="tag tag--neutral"
              title="This value was extracted by the LLM — its self-reported confidence."
            >
              AI · {confidence}%
            </span>
          )}
        </span>
      )}
      {children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ invalid = false, className = '', ...props }) {
  return (
    <input
      type="text"
      className={`input ${invalid ? 'input--invalid' : ''} ${className}`}
      {...props}
    />
  )
}

export function Select({ invalid = false, className = '', children, ...props }) {
  return (
    <select className={`input input--select ${invalid ? 'input--invalid' : ''} ${className}`} {...props}>
      {children}
    </select>
  )
}

export function TextArea({ invalid = false, className = '', ...props }) {
  return <textarea className={`input input--area ${invalid ? 'input--invalid' : ''} ${className}`} rows={2} {...props} />
}

const STATUS_CLASS = {
  Open: 'pill--open',
  'In Progress': 'pill--progress',
  Closed: 'pill--closed',
}

export function StatusPill({ status }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? 'pill--open'}`}>{status}</span>
}

export function Banner({ kind = 'info', title, children, onDismiss }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <p className="banner__title">{title}</p>}
      {children && <div className="banner__body">{children}</div>}
      {onDismiss && (
        <button type="button" className="banner__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}

export function Tag({ tone = 'neutral', children }) {
  return <span className={`tag tag--${tone}`}>{children}</span>
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

export function PageLoading() {
  return <Spinner />
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}
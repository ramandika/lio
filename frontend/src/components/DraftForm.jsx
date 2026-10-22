import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, commodity, requests } from '../api'
import { useAuth } from '../context/AuthContext'
import { parseMoney, centsToDecimal } from '../utils/money'
import { validateForm, toPayload } from '../validation'
import { Field, TextInput, Btn, Card, Banner } from './ui'
import OrderLinesEditor from './OrderLinesEditor'
import CommoditySuggestion from './CommoditySuggestion'

const EMPTY_LINE = { description: '', unit: '', unit_price: '', amount: '', line_total: '', auto: true }

/*
 * The request form, living in the Extraction Layer pane: the user edits the
 * extracted values with the offer document readable in the center. Two uses —
 * an intake draft (prefilled by extraction results) and a saved request being
 * edited (`initial` carries the request view; it edits only while Open).
 * Provenance (which document, which layer) travels with the submission.
 */

function lineFromSaved(l) {
  return {
    description: l.position_description,
    unit: l.unit,
    unit_price: centsToDecimal(l.unit_price),
    amount: String(l.amount),
    line_total: centsToDecimal(l.total_price),
    auto: l.total_price === l.unit_price * l.amount,
  }
}

export default function DraftForm({ extraction, initial = null, onDone, onLeave }) {
  const { user } = useAuth()
  const saved = initial?.request ?? null // editing a saved request when present
  const [form, setForm] = useState(() =>
    saved
      ? {
          requestor_name: saved.requestor_name,
          title: saved.title,
          vendor_name: saved.vendor_name,
          vendor_vat_id: saved.vendor_vat_id,
          department: saved.department,
          order_lines: saved.order_lines.map(lineFromSaved),
          total_cost: centsToDecimal(saved.total_cost),
          total_auto: true,
        }
      : {
          requestor_name: user?.display_name ?? '',
          title: '',
          vendor_name: '',
          vendor_vat_id: '',
          department: '',
          order_lines: [{ ...EMPTY_LINE }],
          total_cost: '',
          total_auto: true,
        },
  )
  const [autoSuggestion, setAutoSuggestion] = useState(null) // latest suggestion, not necessarily selected
  const [selectedId, setSelectedId] = useState(() => saved?.commodity_group_id ?? null)
  // A saved request's group is treated like a manual choice, so the
  // auto-suggestion never silently replaces what was already submitted.
  const [selectedSource, setSelectedSource] = useState(() => (saved ? 'manual' : null))
  const [suggestionLoading, setSuggestionLoading] = useState(() => !saved)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [apiMessage, setApiMessage] = useState(null)
  // Acknowledgement that the last round of edits on this request was saved.
  // It goes away as soon as the user starts editing again, so it never sits
  // over unsaved changes.
  const [savedNote, setSavedNote] = useState(false)
  // Bumped whenever a submit fails validation: the effect below then scrolls
  // to and focuses the first erroring input (in document order) after the
  // renders that show the errors and banners have settled.
  const [errorFocusNonce, setErrorFocusNonce] = useState(0)
  const [source, setSource] = useState(() => (saved?.source ? { ...saved.source } : null)) // provenance
  // LLM-extraction-only doubt: keys whose model confidence fell below the
  // threshold (see extraction.js) get the yellow "Low confidence" mark until
  // the user edits them — an edited value is reviewed by construction, and
  // L1/manual/saved requests carry no model doubt at all.
  const [lowKeys, setLowKeys] = useState([])
  // The same model's full confidence map (L2 only, top-level fields): shown
  // as a per-field score like the low mark, cleared on edit for the same
  // reason — a scored value the user has since touched is no longer the
  // model's answer.
  const [confidences, setConfidences] = useState({})
  const suggestToken = useRef(0)
  // Mirror of `errors` for the focus effect without re-running it on every edit.
  const errorsRef = useRef({})
  errorsRef.current = errors
  // Set once by the button when its policy-driven answer applies over a
  // manual choice: the source change back to 'auto' would make the
  // auto-effect re-run and re-suggest with its plain path — the next run
  // consumes the flag and stands down (see the effect above).
  const suppressAutoRef = useRef(false)
  // Why the button decided NOT to change the current pick (the same-or-better
  // policy declined) — shown in the suggestion card until the next run/edit.
  const [resuggestNote, setResuggestNote] = useState(null)
  // Bumped when the apply-extraction effect changes the form underneath an
  // in-flight suggestion: the suggestion then recomputes from the new fields
  // (the token guard alone would discard the answer without ever re-asking).
  const [suggestionEpoch, setSuggestionEpoch] = useState(0)

  const itemsSignature = form.order_lines
    .map((l) => l.description)
    .filter(Boolean)
    .join('|')

  // Scroll to and focus the first erroring input in document order, once the
  // errors are on screen (hence after render, driven by errorFocusNonce).
  useEffect(() => {
    if (!errorFocusNonce) return
    const id = firstErrorId(errorsRef.current)
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }, [errorFocusNonce])

  // The confirmation lives with the buttons in the form's footer (it clears
  // on the first edit, and a fresh save restarts it), so no scrolling beyond.

  // Apply the latest extraction result from the side pane. `nonce` changes on
  // every upload, so re-uploading the same file re-applies deliberately.
  const extractNonce = extraction?.nonce
  useEffect(() => {
    if (!extractNonce || !extraction.result) return
    onExtracted(extraction.result)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractNonce])

  // Auto-suggest the commodity group from title/descriptions/department.
  // A manual override is never silently replaced.
  useEffect(() => {
    setResuggestNote(null)
    if (selectedSource === 'manual') return
    if (suppressAutoRef.current) {
      // The button's answer just applied itself over a manual choice; this
      // effect re-fired only because the source moved back to 'auto'. The
      // button ran the same-or-better policy — don't clobber it with the
      // plain heuristic-first path.
      suppressAutoRef.current = false
      return
    }
    const title = form.title
    const department = form.department
    if (!title.trim() && !itemsSignature && !department.trim()) {
      setAutoSuggestion(null)
      setSelectedId(null)
      setSelectedSource(null)
      setSuggestionLoading(false)
      return
    }
    const token = ++suggestToken.current
    setSuggestionLoading(true)
    const timer = setTimeout(async () => {
      try {
        const { suggestion } = await commodity.suggest({
          title,
          department,
          items: form.order_lines.map((l) => ({ position_description: l.description })),
        })
        if (token === suggestToken.current) {
          setAutoSuggestion(suggestion)
          setSelectedId(suggestion?.id ?? null)
          setSelectedSource(suggestion ? 'auto' : null)
        }
      } finally {
        if (token === suggestToken.current) setSuggestionLoading(false)
      }
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, form.department, itemsSignature, selectedSource, suggestionEpoch])

  // Explicit re-run of the suggestion (the button) through the same-or-better
  // policy (POST /commodity/resuggest): the click is the user's consent, so a
  // manual choice may be replaced — but only by advice that is the same group
  // or ranks strictly higher in confidence; otherwise the current pick stays
  // and the note says why. The auto-effect above is left to do what it always
  // does (a manual → auto transition is suppressed there once).
  const resuggest = async () => {
    const token = ++suggestToken.current
    setSuggestionLoading(true)
    setResuggestNote(null)
    try {
      const { suggestion, declined } = await commodity.resuggest({
        title: form.title,
        department: form.department,
        items: form.order_lines.map((l) => ({ position_description: l.description })),
        current_group_id: selectedId,
        current_confidence: selectedSource === 'manual' ? null : autoSuggestion?.confidence ?? null,
      })
      if (token !== suggestToken.current) return
      if (suggestion) {
        if (selectedSource === 'manual') suppressAutoRef.current = true
        setAutoSuggestion(suggestion)
        setSelectedId(suggestion.id)
        setSelectedSource('auto')
      } else if (declined?.alternative) {
        const alt = declined.alternative
        setResuggestNote(
          `The ${alt.source === 'llm' ? 'LLM' : 'heuristic'} suggestion “${alt.name}” ` +
            `(${alt.confidence} confidence) was not better than “${declined.kept.name}” — your choice is kept.`,
        )
      } else if (declined?.kept) {
        setResuggestNote(`Nothing better than “${declined.kept.name}” came back — your choice is kept.`)
      }
    } finally {
      if (token === suggestToken.current) setSuggestionLoading(false)
    }
  }

  const sum = useMemo(
    () => form.order_lines.reduce((acc, l) => acc + (parseMoney(l.line_total) ?? 0), 0),
    [form.order_lines],
  )

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setLowKeys((keys) => keys.filter((k) => k !== key)) // the user reviewed it
    setConfidences((c) => (key in c ? { ...c, [key]: undefined } : c)) // ...so the score retires with the mark
    setSavedNote(false)
  }

  const setLineTotalFromLines = (lines) => {
    setLowKeys((keys) => keys.filter((k) => k !== 'order_lines')) // edited lines are reviewed lines
    setConfidences((c) => ('order_lines' in c ? { ...c, order_lines: undefined } : c))
    setSavedNote(false)
    setForm((f) => {
      const complete = lines.length > 0 && lines.every((l) => (parseMoney(l.line_total) ?? 0) > 0)
      const next = { ...f, order_lines: lines }
      if (f.total_auto && complete) next.total_cost = centsToDecimal(sumOf(lines))
      return next
    })
  }

  const onExtracted = ({ fields, layer, detected, low_confidence, confidences, filename, document_id, commodity_suggestion: suggestion }) => {
    const extractedLines = (fields.order_lines ?? []).map((l) => ({
      description: l.position_description ?? '',
      unit: l.unit || 'pieces',
      unit_price: l.unit_price != null ? centsToDecimal(l.unit_price) : '',
      amount: l.amount != null ? String(l.amount) : '',
      line_total: l.total_price != null ? centsToDecimal(l.total_price) : '',
      auto: l.unit_price != null && l.total_price === l.unit_price * l.amount,
    }))
    setForm((f) => ({
      ...f,
      vendor_name: fields.vendor_name ?? f.vendor_name,
      vendor_vat_id: fields.vendor_vat_id ?? f.vendor_vat_id,
      department: fields.department ?? f.department,
      order_lines: extractedLines.length > 0 ? extractedLines : f.order_lines,
      total_cost:
        fields.total_cost != null ? centsToDecimal(fields.total_cost) : f.total_cost,
      total_auto: fields.total_cost != null,
    }))
    if (suggestion) {
      setAutoSuggestion(suggestion)
      setSelectedId(suggestion.id)
      setSelectedSource('auto')
    }
    if (filename) {
      setSource({
        filename,
        layer,
        // The stored upload rides along so the request can show the real document.
        ...(document_id ? { document_id } : {}),
        detected: detected ?? {},
      })
    }
    setSuggestionEpoch((e) => e + 1) // recompute the suggestion from the new fields
    setErrors({}) // field keys match, so stale inline errors disappear with the prefill
    // Yellow marks only for the LLM's own doubts (extraction.js computes the
    // keys; an L1 pull or a saved request yields none), and the full score
    // map rides along beside them — both reset wholesale on every extraction,
    // so the scores can never outlive the values they describe.
    setLowKeys(Array.isArray(low_confidence) ? low_confidence : [])
    setConfidences(confidences ?? {})
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setSavedNote(false)
    const formErrors = validateForm(form)
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors)
      setApiMessage({ kind: 'error', text: 'This request can’t be submitted yet — fix the highlighted fields.' })
      setErrorFocusNonce((n) => n + 1)
      return
    }
    setSubmitting(true)
    setErrors({})
    setApiMessage(null)
    try {
      const payload = toPayload(form)
      payload.commodity_group_id = selectedId ?? null
      if (source) payload.source = source // a PUT keeps its provenance as-is
      const { request, status_history: history } = saved
        ? await requests.update(saved.id, payload)
        : await requests.create(payload)
      // A saved edit stays on this form (the center and rail reload quietly),
      // so acknowledge the save here; a fresh draft hands over to the new
      // request view, which is feedback enough.
      if (saved) setSavedNote(true)
      onDone(request, history)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.payload?.errors) {
        setErrors(err.payload.errors)
        setApiMessage({ kind: 'error', text: 'The request needs attention before it can be saved.' })
        setErrorFocusNonce((n) => n + 1)
      } else {
        setApiMessage({ kind: 'error', text: err.payload?.detail ?? 'Saving failed — please retry.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="draftform">
      {apiMessage && (
        <Banner kind={apiMessage.kind} onDismiss={() => setApiMessage(null)}>
          <p>{apiMessage.text}</p>
        </Banner>
      )}
      {errors.order_lines && (
        <Banner kind="error">
          <p>{errors.order_lines}</p>
        </Banner>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Card className="block">
          <h3 className="block__title">Request Details</h3>
          <div className="grid grid--2">
            <Field label="Requestor Name" htmlFor="f-requestor" error={errors.requestor_name}>
              <TextInput
                id="f-requestor"
                value={form.requestor_name}
                onChange={(e) => setField('requestor_name', e.target.value)}
                invalid={!!errors.requestor_name}
              />
            </Field>
            <Field label="Department" htmlFor="f-department" warn={lowKeys.includes('department')} confidence={confidences.department} error={errors.department}>
              <TextInput
                id="f-department"
                value={form.department}
                onChange={(e) => setField('department', e.target.value)}
                invalid={!!errors.department}
                list="departments"
                placeholder="e.g. HR"
              />
              <datalist id="departments">
                <option value="HR" />
                <option value="Creative Marketing Department" />
                <option value="Information Technology" />
                <option value="Finance" />
                <option value="Operations" />
                <option value="Legal" />
              </datalist>
            </Field>
            <Field
              label="Title / Short Description"
              htmlFor="f-title"
              className="grid__span2"
              hint="A brief name for the request — it also feeds the commodity-group suggestion."
              error={errors.title}
            >
              <TextInput
                id="f-title"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                invalid={!!errors.title}
                placeholder="e.g. Adobe Creative Cloud Subscription"
              />
            </Field>
            <Field label="Vendor Name" htmlFor="f-vendor" warn={lowKeys.includes('vendor_name')} confidence={confidences.vendor_name} error={errors.vendor_name}>
              <TextInput
                id="f-vendor"
                value={form.vendor_name}
                onChange={(e) => setField('vendor_name', e.target.value)}
                invalid={!!errors.vendor_name}
                placeholder="e.g. Adobe Systems"
              />
            </Field>
            <Field
              label="VAT ID (Umsatzsteuer-Identifikationsnummer)"
              htmlFor="f-vat"
              warn={lowKeys.includes('vendor_vat_id')}
              confidence={confidences.vendor_vat_id}
              hint="German format: DE followed by 9 digits."
              error={errors.vendor_vat_id}
            >
              <TextInput
                id="f-vat"
                value={form.vendor_vat_id}
                onChange={(e) => setField('vendor_vat_id', e.target.value)}
                invalid={!!errors.vendor_vat_id}
                placeholder="DE123456789"
              />
            </Field>
          </div>
        </Card>

        <Card className="block" id="order-lines-block">
          <h3 className="block__title">
            Order Lines{' '}
            {lowKeys.includes('order_lines') ? (
              <span
                className="tag tag--warn"
                title="The LLM was unsure of these lines — verify them against the document."
              >
                Low confidence
                {confidences.order_lines != null ? ` · ${confidences.order_lines}%` : ''}
              </span>
            ) : confidences.order_lines != null ? (
              <span
                className="tag tag--neutral"
                title="These lines were extracted by the LLM — its self-reported confidence."
              >
                AI · {confidences.order_lines}%
              </span>
            ) : null}
          </h3>
          <OrderLinesEditor
            lines={form.order_lines}
            errors={errors}
            onChange={setLineTotalFromLines}
          />
        </Card>

        <Card className="block">
          <h3 className="block__title">Commodity Group</h3>
          <CommoditySuggestion
            suggestion={autoSuggestion}
            loading={suggestionLoading}
            manual={selectedSource === 'manual'}
            value={selectedId}
            onChange={(id) => {
              setSelectedId(id)
              setSelectedSource(id ? 'manual' : 'auto')
              setSavedNote(false)
            }}
            invalidMessage={errors.commodity_group_id}
            note={resuggestNote}
            onSuggest={resuggest}
            canSuggest={Boolean(form.title.trim() || form.department.trim() || itemsSignature)}
          />
        </Card>

        <Card className="block block--foot">
          <div className="totalrow">
            <Field
              label="Total Cost"
              htmlFor="f-total"
              className="field--inline"
              warn={lowKeys.includes('total_cost')}
              confidence={confidences.total_cost}
              error={errors.total_cost}
            >
              <TextInput
                id="f-total"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={form.total_cost}
                invalid={!!errors.total_cost}
                onChange={(e) => {
                  setForm((f) => ({ ...f, total_cost: e.target.value, total_auto: false }))
                  setLowKeys((keys) => keys.filter((k) => k !== 'total_cost'))
                  setConfidences((c) => ('total_cost' in c ? { ...c, total_cost: undefined } : c))
                  setSavedNote(false)
                }}
              />
            </Field>
            <p className="totalrow__sum" aria-live="polite">
              Line totals: <strong>{centsToDecimal(sum)} €</strong>
            </p>
          </div>
          {savedNote && (
            <p className="footnote footnote--saved" role="status">
              ✓ Changes saved — your edits are on record.
            </p>
          )}
          <div className="formfoot">
            <Btn type="submit" disabled={submitting} className={!saved ? '' : 'btn--block'}>
              {submitting
                ? saved
                  ? 'Saving…'
                  : 'Submitting…'
                : savedNote && saved
                  ? '✓ Saved — Save Changes'
                  : saved
                    ? 'Save Changes'
                    : 'Submit Request'}
            </Btn>
            {/* Cancel only belongs to a fresh draft — a saved request can't be
                "discarded" back, it just keeps its last saved state. */}
            {!saved && (
              <Btn variant="quiet" onClick={onLeave} disabled={submitting}>
                Cancel
              </Btn>
            )}
          </div>
        </Card>
      </form>
    </div>
  )
}

/*
 * First erroring input, in document order — the order the fields appear in
 * the form (NOT the order of validateForm's checks). Error keys intentionally
 * match the server's so an API 422 lands the same way. `order_lines` without
 * a line index means "no lines at all" and anchors to the whole lines block.
 */
const TOP_FIELD_IDS = {
  requestor_name: 'f-requestor',
  department: 'f-department',
  title: 'f-title',
  vendor_name: 'f-vendor',
  vendor_vat_id: 'f-vat',
}
const LINE_FIELD_ORDER = ['description', 'unit_price', 'amount', 'unit', 'line_total']

function firstErrorId(errors) {
  for (const key of Object.keys(TOP_FIELD_IDS)) {
    if (errors[key]) return TOP_FIELD_IDS[key]
  }
  if (errors['order_lines']) return 'order-lines-block'
  const lineIdx = Object.keys(errors)
    .map((k) => /^order_lines\.(\d+)\./.exec(k)?.[1])
    .filter((n) => n != null)
    .map(Number)
    .sort((a, b) => a - b)[0]
  if (lineIdx != null) {
    for (const field of LINE_FIELD_ORDER) {
      if (errors[`order_lines.${lineIdx}.${field}`]) return `line-${lineIdx}-${field}`
    }
  }
  if (errors['commodity_group_id']) return 'commodity-select'
  if (errors['total_cost']) return 'f-total'
  return null
}

function sumOf(lines) {
  return lines.reduce((acc, l) => acc + (parseMoney(l.line_total) ?? 0), 0)
}
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, commodity, requests } from '../api'
import { useAuth } from '../context/AuthContext'
import { parseMoney, centsToDecimal } from '../utils/money'
import { validateForm, toPayload } from '../validation'
import { Field, TextInput, Btn, Card, Banner } from '../components/ui'
import OrderLinesEditor from '../components/OrderLinesEditor'
import ExtractionPanel from '../components/ExtractionPanel'
import CommoditySuggestion from '../components/CommoditySuggestion'

const EMPTY_LINE = { description: '', unit: '', unit_price: '', amount: '', line_total: '', auto: true }

export default function NewRequest() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(() => ({
    requestor_name: user?.display_name ?? '',
    title: '',
    vendor_name: '',
    vendor_vat_id: '',
    department: '',
    order_lines: [{ ...EMPTY_LINE }],
    total_cost: '',
    total_auto: true,
  }))
  const [autoSuggestion, setAutoSuggestion] = useState(null) // latest suggestion, not necessarily selected
  const [selectedId, setSelectedId] = useState(null)
  const [selectedSource, setSelectedSource] = useState(null) // 'auto' | 'manual'
  const [suggestionLoading, setSuggestionLoading] = useState(true)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [apiMessage, setApiMessage] = useState(null)
  const suggestToken = useRef(0)

  const itemsSignature = form.order_lines
    .map((l) => l.description)
    .filter(Boolean)
    .join('|')

  // Auto-suggest the commodity group from title/descriptions/department.
  // A manual override is never silently replaced.
  useEffect(() => {
    if (selectedSource === 'manual') return
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
  }, [form.title, form.department, itemsSignature, selectedSource])

  const sum = useMemo(
    () => form.order_lines.reduce((acc, l) => acc + (parseMoney(l.line_total) ?? 0), 0),
    [form.order_lines],
  )

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const setLineTotalFromLines = (lines) => {
    setForm((f) => {
      const complete = lines.length > 0 && lines.every((l) => (parseMoney(l.line_total) ?? 0) > 0)
      const next = { ...f, order_lines: lines }
      if (f.total_auto && complete) next.total_cost = centsToDecimal(sumOf(lines))
      return next
    })
  }

  const onExtracted = ({ fields, commodity_suggestion: suggestion }) => {
    const extractedLines = (fields.order_lines ?? []).map((l) => ({
      description: l.position_description ?? '',
      unit: 'pieces',
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
    suggestToken.current += 1 // stale in-flight suggestions stay applied
    setErrors({}) // field keys match, so stale inline errors disappear with the prefill
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const formErrors = validateForm(form)
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors)
      setApiMessage({ kind: 'error', text: 'This request can’t be submitted yet — fix the highlighted fields.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSubmitting(true)
    setErrors({})
    setApiMessage(null)
    try {
      const payload = toPayload(form)
      payload.commodity_group_id = selectedId ?? null
      const { request } = await requests.create(payload)
      navigate(`/requests/${request.id}`, {
        state: { created: true },
        replace: true,
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.payload?.errors) {
        setErrors(mapApiErrors(err.payload.errors))
        setApiMessage({ kind: 'error', text: 'The request needs attention before it can be saved.' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setApiMessage({ kind: 'error', text: err.payload?.detail ?? 'Saving failed — please retry.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container container--narrow">
      <header className="page-head">
        <h1 className="page-head__title">New Request</h1>
        <p className="page-head__standfirst">
          Everything procurement needs to proceed — start from a vendor offer or from scratch.
        </p>
      </header>
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
        <ExtractionPanel onExtracted={onExtracted} />

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
            <Field label="Department" htmlFor="f-department" error={errors.department}>
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
            <Field label="Vendor Name" htmlFor="f-vendor" error={errors.vendor_name}>
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

        <Card className="block">
          <h3 className="block__title">Order Lines</h3>
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
            }}
            invalidMessage={errors.commodity_group_id}
          />
        </Card>

        <Card className="block block--foot">
          <div className="totalrow">
            <Field label="Total Cost" htmlFor="f-total" className="field--inline" error={errors.total_cost}>
              <TextInput
                id="f-total"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={form.total_cost}
                invalid={!!errors.total_cost}
                onChange={(e) => setForm((f) => ({ ...f, total_cost: e.target.value, total_auto: false }))}
              />
            </Field>
            <p className="totalrow__sum" aria-live="polite">
              Line totals: <strong>{centsToDecimal(sum)} €</strong>
            </p>
          </div>
          <div className="formfoot">
            <Btn type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </Btn>
            <Btn variant="quiet" onClick={() => navigate(-1)} disabled={submitting}>
              Cancel
            </Btn>
          </div>
        </Card>
      </form>
    </div>
  )
}

function sumOf(lines) {
  return lines.reduce((acc, l) => acc + (parseMoney(l.line_total) ?? 0), 0)
}

/** Flatten server error keys ({"order_lines.0.amount": …}) onto this form's error map. */
function mapApiErrors(apiErrors) {
  return apiErrors
}
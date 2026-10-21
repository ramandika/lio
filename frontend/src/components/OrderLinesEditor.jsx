import { Field, TextInput, Btn } from './ui'
import { parseMoney } from '../utils/money'

/*
 * Editable order lines. A line's total auto-follows unit price × amount
 * until the user edits the total directly — from then on it is an explicit
 * value and mismatches surface as inline errors (validation.js mirrors the
 * API rule).
 */

export default function OrderLinesEditor({ lines, errors = {}, onChange }) {
  const update = (i, patch) => {
    onChange(
      lines.map((line, j) => {
        if (j !== i) return line
        const next = { ...line, ...patch }
        if (('unit_price' in patch || 'amount' in patch) && line.auto) {
          const price = parseMoney(next.unit_price)
          const amount = Number(String(next.amount).trim())
          if (price != null && price > 0 && Number.isInteger(amount) && amount > 0) {
            next.line_total = decimal(price * amount)
          }
        }
        return next
      }),
    )
  }
  const setTotal = (i, value) => {
    onChange(
      lines.map((line, j) => (j !== i ? line : { ...line, line_total: value, auto: false })),
    )
  }
  const remove = (i) => onChange(lines.filter((_, j) => j !== i))
  const atLimit = lines.length >= 20
  const add = () =>
    onChange([
      ...lines,
      { description: '', unit: '', unit_price: '', amount: '', line_total: '', auto: true },
    ])

  const cell = (i, field, props) => (
    <Field className="field--bare" error={errors[`order_lines.${i}.${field}`]}>
      <TextInput
        id={`line-${i}-${field}`}
        aria-label={`Line ${i + 1} ${props.title}`}
        value={lines[i][field]}
        invalid={!!errors[`order_lines.${i}.${field}`]}
        onChange={(e) => (field === 'line_total' ? setTotal(i, e.target.value) : update(i, { [field]: e.target.value }))}
        {...props}
      />
    </Field>
  )

  return (
    <div className="lines">
      <div className="lines__grid" role="table" aria-label="Order lines">
        <div className="lines__head" role="row">
          <span role="columnheader">Description</span>
          <span role="columnheader">Unit Price (€)</span>
          <span role="columnheader">Amount</span>
          <span role="columnheader">Unit</span>
          <span role="columnheader">Line Total (€)</span>
          <span aria-hidden="true" />
        </div>
        {lines.length === 0 && (
          <p className="lines__empty">No order lines yet — add the first position below.</p>
        )}
        {lines.map((line, i) => (
          <div className="lines__row" key={i}>
            <span className="lines__cell lines__cell--desc">
              {cell(i, 'description', { placeholder: 'e.g. Adobe Photoshop License', title: 'Description' })}
            </span>
            <span className="lines__cell">
              {cell(i, 'unit_price', {
                type: 'number',
                step: '0.01',
                min: '0',
                inputMode: 'decimal',
                placeholder: '0.00',
                title: 'Unit Price',
              })}
            </span>
            <span className="lines__cell lines__cell--amount">
              {cell(i, 'amount', {
                type: 'number',
                min: '1',
                step: '1',
                placeholder: '1',
                title: 'Amount',
              })}
            </span>
            <span className="lines__cell">
              {cell(i, 'unit', { placeholder: 'licenses', title: 'Unit' })}
            </span>
            <span className="lines__cell">
              {cell(i, 'line_total', {
                type: 'number',
                step: '0.01',
                min: '0',
                inputMode: 'decimal',
                placeholder: '0.00',
                title: 'Line Total',
              })}
            </span>
            <span className="lines__cell lines__cell--remove">
              <button
                type="button"
                className="lines__remove"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 0}
                onClick={() => remove(i)}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
      <Btn variant="quiet" onClick={add} disabled={atLimit}>
        + Add Order Line
      </Btn>
      <p className="lines__note">
        Line totals follow price × amount automatically; edit a total by hand to override it.
      </p>
    </div>
  )
}

function decimal(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
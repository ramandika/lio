/*
 * Frontend mirror of the API-boundary validation rules — the authoritative
 * checks live in the backend (only the API decides what persists). This file
 * exists purely so the form can show inline errors before submission, per
 * docs/PROJECT_PLAN.md ("validation.js only mirrors the rules for inline UX").
 *
 * Works on raw form state (strings), unlike the server which works on the
 * parsed payload (cents/ints). Error keys intentionally match the server's
 * so API 422 errors land on the same fields.
 */

import { parseMoney } from './utils/money'

const VAT_RE = /^DE[0-9]{9}$/

/**
 * @param {object} form  raw form state (see components/DraftForm.jsx)
 * @returns {object} map of fieldKey → message (keyed `order_lines.<i>.<field>`)
 */
export function validateForm(form) {
  const errors = {}
  const err = (key, msg) => {
    if (!errors[key]) errors[key] = msg
  }

  const required = (key, label) => {
    if (!String(form[key] ?? '').trim()) err(key, `${label} is required.`)
  }
  required('requestor_name', 'Requestor name')
  required('title', 'Title')
  required('vendor_name', 'Vendor name')
  required('department', 'Department')

  const vat = String(form.vendor_vat_id ?? '').trim()
  if (!vat) err('vendor_vat_id', 'VAT ID is required.')
  else if (!VAT_RE.test(vat)) err('vendor_vat_id', 'VAT ID must match the DE123456789 format.')

  const lines = form.order_lines ?? []
  if (lines.length === 0) err('order_lines', 'At least one order line is required.')

  let linesComplete = lines.length > 0
  let sum = 0
  lines.forEach((line, i) => {
    const at = (field, msg) => {
      err(`order_lines.${i}.${field}`, msg)
      linesComplete = false
    }
    if (!String(line.description ?? '').trim()) at('description', 'Description is required.')
    if (!String(line.unit ?? '').trim()) at('unit', 'Unit is required.')

    const price = parseMoney(line.unit_price)
    if (line.unit_price === '' || price == null || price <= 0) {
      at('unit_price', 'Unit price must be a number greater than 0.')
    }
    const amount = Number(String(line.amount ?? '').trim())
    if (line.amount === '' || !Number.isInteger(amount) || amount <= 0) {
      at('amount', 'Amount must be a whole number greater than 0.')
    }
    const total = parseMoney(line.line_total)
    if (line.line_total === '' || total == null || total <= 0) {
      at('line_total', 'Line total must be a number greater than 0.')
    } else if (price != null && price > 0 && Number.isInteger(amount) && amount > 0 && total !== price * amount) {
      at('line_total', 'Line total must equal unit price × amount.')
    }
    if (total != null && total > 0) sum += total
  })

  const totalCost = parseMoney(form.total_cost)
  if (form.total_cost === '' || totalCost == null || totalCost <= 0) {
    err('total_cost', 'Total cost must be a number greater than 0.')
  } else if (linesComplete && totalCost !== sum) {
    err('total_cost', 'Total cost must equal the sum of the line totals.')
  }

  return errors
}

/** Raw form state → API payload (prices as integer cents, amount as int). */
export function toPayload(form) {
  return {
    requestor_name: form.requestor_name,
    title: form.title,
    vendor_name: form.vendor_name,
    vendor_vat_id: form.vendor_vat_id,
    department: form.department,
    commodity_group_id: form.commodity_group_id ?? null,
    total_cost: parseMoney(form.total_cost),
    order_lines: form.order_lines.map((line) => ({
      position_description: line.description,
      unit: line.unit,
      unit_price: parseMoney(line.unit_price),
      amount: Number(String(line.amount).trim()) || null,
      total_price: parseMoney(line.line_total),
    })),
  }
}
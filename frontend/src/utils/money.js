/*
 * Exact money arithmetic — NUMERIC at the API boundary, never floats here.
 * Amounts are handled as integer cents end to end.
 */

/** Parse a money string ("€1,500.50", "1500,5", "1.500") into integer cents, or null. */
export function parseMoney(input) {
  if (input == null || input === '') return null
  let s = String(input).replace(/[€\s]/g, '')
  if (!/^[+-]?[\d.,]+$/.test(s)) return null
  const neg = s.startsWith('-')
  s = s.replace(/[+-]/g, '')
  const dotCount = (s.match(/\./g) || []).length
  const commaCount = (s.match(/,/g) || []).length

  let intPart, frac
  const toCents = () => {
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null
    const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0').slice(0, 2))
    return neg ? -cents : cents
  }

  if (dotCount && commaCount) {
    // Mixed: the right-most separator is decimal, the other one groups thousands.
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const th = dec === '.' ? ',' : '.'
    if (!new RegExp(`^\\d{1,3}(?:\\${th}\\d{3})*\\${dec}\\d{1,2}$`).test(s)) return null
    const last = s.lastIndexOf(dec)
    intPart = s.slice(0, last).replace(new RegExp(`\\${th}`, 'g'), '')
    frac = Number(last) === s.length - 1 ? '' : s.slice(last + 1)
  } else if (dotCount || commaCount) {
    const sep = dotCount ? '.' : ','
    const parts = s.split(sep)
    if (parts.length === 1) {
      intPart = parts[0]
      frac = ''
    } else if (parts.length > 2 || parts[parts.length - 1].length === 3) {
      // Repeated separators or a 3-digit tail → thousands grouping ("1.500", "1,234,567").
      intPart = s.replace(new RegExp(`\\${sep}`, 'g'), '')
      frac = ''
    } else {
      // Exactly one separator with a 1–2 digit tail → decimal ("1.5", "1,50").
      intPart = parts[0]
      frac = parts[1]
    }
  } else {
    intPart = s
    frac = ''
  }
  return toCents()
}

/** Integer cents → decimal string "1500.00". */
export function centsToDecimal(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Integer cents → display "€1,500.00". */
const euroFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(cents) {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return euroFmt.format(cents / 100)
}
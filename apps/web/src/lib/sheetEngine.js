// 🧮 mini spreadsheet engine — real Excel-style formulas over the CRDT cells.
// Supports =SUM/AVG/COUNT/MIN/MAX with A1:B9 ranges, cell refs in arithmetic
// (=B2*C2), the legacy '=sum' (adds numeric cells above), circular-reference
// guard, and number formats (₹ / % / 0.00). Pure functions over a Y.Map so
// the UI AND the csv export resolve identically.

export function colName(c) {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(String(ref).trim())
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

export function numOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/[₹,\s]/g, '')
  if (!t) return null
  const pct = t.endsWith('%')
  const n = Number(pct ? t.slice(0, -1) : t)
  return Number.isFinite(n) ? n : null
}

const round = (n) => Math.round(n * 1e6) / 1e6

// gather numeric values from "A1:B3, C5, 12" style argument lists
function collectVals(sheet, args, seen) {
  const vals = []
  for (const part of String(args).split(',')) {
    const p = part.trim()
    if (!p) continue
    if (p.includes(':')) {
      const pa = parseRef(p.split(':')[0])
      const pb = parseRef(p.split(':')[1])
      if (!pa || !pb) return null
      for (let r = Math.min(pa.r, pb.r); r <= Math.max(pa.r, pb.r); r++) {
        for (let c = Math.min(pa.c, pb.c); c <= Math.max(pa.c, pb.c); c++) {
          const n = numOf(evalCell(sheet, r, c, seen))
          if (n !== null) vals.push(n)
        }
      }
    } else if (/^\$?[A-Za-z]+\d+$/.test(p)) {
      const pa = parseRef(p)
      const n = numOf(evalCell(sheet, pa.r, pa.c, seen))
      if (n !== null) vals.push(n)
    } else {
      const n = numOf(p)
      if (n === null) return null
      vals.push(n)
    }
  }
  return vals
}

// resolved value of a cell — formulas evaluated recursively (cycle-safe)
export function evalCell(sheet, r, c, seen) {
  const raw = sheet.get(`${r},${c}`)
  if (typeof raw !== 'string' || raw[0] !== '=') return raw ?? ''
  const s = seen || new Set()
  const key = `${r},${c}`
  if (s.has(key)) return '#CYCLE!'
  s.add(key)

  let expr = raw.slice(1).trim()

  // legacy magic: bare '=sum' adds the numeric cells above in this column
  if (/^sum$/i.test(expr)) {
    let t = 0
    for (let i = 0; i < r; i++) {
      const n = numOf(evalCell(sheet, i, c, s))
      if (n !== null) t += n
    }
    return String(round(t))
  }

  // functions first: SUM(...) AVERAGE(...) etc → number literal
  expr = expr.replace(/([A-Za-z]+)\(([^()]*)\)/g, (_w, name, args) => {
    const vals = collectVals(sheet, args, s)
    if (vals === null) return '#REF!'
    switch (name.toUpperCase()) {
      case 'SUM':
      case 'TOTAL':
        return String(round(vals.reduce((a, b) => a + b, 0)))
      case 'AVG':
      case 'AVERAGE':
        return String(vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0)
      case 'COUNT':
        return String(vals.length)
      case 'MIN':
        return String(vals.length ? round(Math.min(...vals)) : 0)
      case 'MAX':
        return String(vals.length ? round(Math.max(...vals)) : 0)
      default:
        return '#NAME?'
    }
  })

  // remaining bare cell refs → their numeric values
  expr = expr.replace(/\$?[A-Za-z]+\$?\d+/g, (ref) => {
    const p = parseRef(ref)
    if (!p) return '#REF!'
    const n = numOf(evalCell(sheet, p.r, p.c, s))
    return n === null ? '0' : String(n)
  })

  if (expr.includes('#')) return expr.slice(0, expr.search(/#[A-Z]+!?/)) || expr
  if (!/^[-+*/().\d\s]+$/.test(expr)) return '#ERR'
  try {
    return String(round(Function(`"use strict";return (${expr})`)()))
  } catch {
    return '#ERR'
  }
}

// display string with the cell's number format applied
export function formatVal(v, nf) {
  const n = numOf(v)
  if (n === null || !nf || nf === 'gen') return typeof v === 'string' ? v : String(v ?? '')
  switch (nf) {
    case 'cur':
      return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'pct':
      return `${round(n * 100) / 100}%`
    case 'num':
      return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    default:
      return String(v)
  }
}

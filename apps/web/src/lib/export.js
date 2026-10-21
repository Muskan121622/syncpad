// 💾 "give me MY copy" — export builders + download helpers for every tool.
// Everything is already autosaved (CRDT + IndexedDB + server snapshots);
// these produce a portable file the user can own: .md / .txt / .csv / .png.

import { evalCell } from './sheetEngine.js'

export function downloadText(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  fireDownload(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadDataUrl(name, dataUrl) {
  fireDownload(dataUrl, name)
}

function fireDownload(href, name) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
}

const stamp = () => new Date().toISOString().slice(0, 10)

// ── pad → markdown ────────────────────────────────────────────────────────
// TipTap stores the doc as a YXmlFragment; do a light tag→markdown pass.
export function padMarkdown(ydoc, padId) {
  const xml = ydoc.getXmlFragment('syncpad').toString()
  const md = xml
    .replace(/<heading[^>]*level="(\d)"[^>]*>/g, (_, n) => `${'#'.repeat(Number(n))} `)
    .replace(/<code[^>]*>/g, '```\n')
    .replace(/<listItem>/g, '- ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `# ${padId} — synced from SyncPad (${stamp()})\n\n${md}\n`
}

// ── tasks → checklist txt (WhatsApp-pasteable) ────────────────────────────
export function tasksText(tasksArray, padId) {
  const lines = [`✅ ${padId} — room tasks (${stamp()})`, '']
  tasksArray.forEach((tm) => {
    const t = tm.toJSON()
    lines.push(`${t.done ? '[x]' : '[ ]'} ${t.text}  — ${t.by}${t.done && t.doneBy ? ` ✔ ${t.doneBy}` : ''}`)
  })
  const done = tasksArray.map((t) => t.get('done')).filter(Boolean).length
  lines.push('', `${done}/${tasksArray.length} done — SyncPad`)
  return lines.join('\n') + '\n'
}

// ── stickies → txt brain-dump ─────────────────────────────────────────────
export function stickiesText(stickies, padId) {
  const notes = [...stickies.values()].sort((a, b) => (a.get('t') || 0) - (b.get('t') || 0))
  const lines = [`📌 ${padId} — sticky wall (${stamp()})`, '']
  notes.forEach((sm) => {
    const n = sm.toJSON()
    lines.push(`• ${n.text || '(blank note)'}  — ${n.emoji || ''} ${n.by}`)
  })
  if (!notes.length) lines.push('(the wall was empty… like my ex 🫠)')
  return lines.join('\n') + '\n'
}

// ── sheet → CSV (opens in Excel / Google Sheets) ──────────────────────────
export function sheetCsv(sheet) {
  const rows = sheet.get('rows') || 50
  const cols = sheet.get('cols') || 26
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) row.push(esc(String(evalCell(sheet, r, c))))
    if (row.some((x) => x !== '')) lines.push(row.join(','))
  }
  return `\uFEFF${lines.join('\n')}\n` // BOM → Excel opens UTF-8 happily
}

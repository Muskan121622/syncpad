// 🧮 The sheet — a REAL spreadsheet, not a demo grid. Excel-style ribbon
// (font / bold-italic-underline / colors / align / number formats / AutoSum),
// a formula bar with name box, keyboard navigation (arrows/Tab/Enter, type-to-
// replace, Ctrl+B/I/U/C/X/V, Delete), insert/delete rows & cols, and a File
// menu (New / Save .csv / Save .json / Print). All state — cells, styles,
// sheet name — lives in the shared Y.Map, so every peer sees every edit.
// Formula resolution lives in lib/sheetEngine.js.

import { memo, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { colName, parseRef, evalCell, formatVal, numOf } from '../lib/sheetEngine.js'
import { downloadText, sheetCsv } from '../lib/export.js'

const DEFAULT_ROWS = 50
const DEFAULT_COLS = 26

const FONTS = [
  { id: 'sans', label: 'Calibri', css: "'Segoe UI', system-ui, sans-serif" },
  { id: 'head', label: 'Grotesk', css: "'Space Grotesk', sans-serif" },
  { id: 'serif', label: 'Georgia', css: "Georgia, serif" },
  { id: 'mono', label: 'Courier', css: "'Courier New', monospace" },
]
const SIZES = [10, 12, 14, 16, 18, 22, 28]
const SWATCHES = [null, '#ff6b81', '#ffb26b', '#ffe66d', '#7de8a8', '#33e0ff', '#8b7cff', '#ff6ad5', '#ffffff', '#0d1023']
const NFORMATS = [
  { id: 'gen', label: 'General' },
  { id: 'cur', label: '₹ Currency' },
  { id: 'pct', label: '% Percent' },
  { id: 'num', label: '0.00 Number' },
]

const sk = (r, c) => `s:${r},${c}`

export default function SheetPanel({ sheet }) {
  const [ver, force] = useState(0)
  const [sel, setSel] = useState({ r: 0, c: 0 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [nameBox, setNameBox] = useState('A1')
  const [menu, setMenu] = useState(false) // File dropdown
  const [picker, setPicker] = useState(null) // 'fc' | 'bg' color popover
  const [toast, setToast] = useState(null)
  const clipRef = useRef(null) // single-cell clipboard { raw, style }
  const wrapRef = useRef(null)

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    sheet.observe(obs)
    return () => sheet.unobserve(obs)
  }, [sheet])

  useEffect(() => setNameBox(`${colName(sel.c)}${sel.r + 1}`), [sel])

  useEffect(() => {
    if (!menu && !picker) return
    const close = () => {
      setMenu(false)
      setPicker(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu, picker])

  const rows = sheet.get('rows') || DEFAULT_ROWS
  const cols = sheet.get('cols') || DEFAULT_COLS
  const sheetName = sheet.get('name') || 'Sheet1'

  const rawOf = (r, c) => sheet.get(`${r},${c}`) ?? ''
  const styleOf = (r, c) => {
    try {
      return JSON.parse(sheet.get(sk(r, c)) || '{}')
    } catch {
      return {}
    }
  }
  const valueOf = (r, c) => evalCell(sheet, r, c)
  const dispOf = (r, c) => formatVal(valueOf(r, c), styleOf(r, c).nf)

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 1900)
  }

  function setCell(r, c, v) {
    sheet.set(`${r},${c}`, String(v).slice(0, 500))
  }

  function patchStyle(patch) {
    const cur = styleOf(sel.r, sel.c)
    const next = { ...cur, ...patch }
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k]
    sheet.set(sk(sel.r, sel.c), JSON.stringify(next))
  }

  // ── editing ────────────────────────────────────────────────────────────
  function beginEdit(seed) {
    setEditing(true)
    setDraft(seed ?? rawOf(sel.r, sel.c))
  }

  function commitEdit(moveR = 0, moveC = 0) {
    if (!editing) return
    setCell(sel.r, sel.c, draft)
    setEditing(false)
    if (moveR || moveC) moveSel(moveR, moveC)
    wrapRef.current?.focus()
  }

  const clamp = (r, c) => ({
    r: Math.min(rows - 1, Math.max(0, r)),
    c: Math.min(cols - 1, Math.max(0, c)),
  })

  function moveSel(dr, dc) {
    setSel((s) => clamp(s.r + dr, s.c + dc))
  }

  function onGridKey(e) {
    if (editing) return
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    if (mod) {
      const lower = k.toLowerCase()
      if (lower === 'b' || lower === 'i' || lower === 'u') {
        e.preventDefault()
        const key = { b: 'bold', i: 'italic', u: 'underline' }[lower]
        patchStyle({ [key]: styleOf(sel.r, sel.c)[key] ? null : 1 })
        return
      }
      if (lower === 'c') {
        clipRef.current = { raw: rawOf(sel.r, sel.c), style: styleOf(sel.r, sel.c) }
        return
      }
      if (lower === 'x') {
        clipRef.current = { raw: rawOf(sel.r, sel.c), style: styleOf(sel.r, sel.c) }
        setCell(sel.r, sel.c, '')
        return
      }
      if (lower === 'v' && clipRef.current) {
        setCell(sel.r, sel.c, clipRef.current.raw)
        sheet.set(sk(sel.r, sel.c), JSON.stringify(clipRef.current.style))
        return
      }
      return
    }
    switch (k) {
      case 'ArrowUp': e.preventDefault(); moveSel(-1, 0); return
      case 'ArrowDown': e.preventDefault(); moveSel(1, 0); return
      case 'ArrowLeft': e.preventDefault(); moveSel(0, -1); return
      case 'ArrowRight': e.preventDefault(); moveSel(0, 1); return
      case 'Tab': e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); return
      case 'Enter': e.preventDefault(); beginEdit(); return
      case 'F2': e.preventDefault(); beginEdit(); return
      case 'Delete':
      case 'Backspace': e.preventDefault(); setCell(sel.r, sel.c, ''); return
      default:
        if (k.length === 1) {
          e.preventDefault()
          beginEdit(k) // Excel-style type-to-replace
        }
    }
  }

  // ── structure: insert / delete rows & cols (atomic shifts) ─────────────
  function shiftRow(r, c, dr) {
    const from = `${r},${c}`
    const to = `${r + dr},${c}`
    const fs = sk(r, c)
    const ts = sk(r + dr, c)
    if (sheet.has(fs)) { sheet.set(ts, sheet.get(fs)); sheet.delete(fs) } else sheet.delete(ts)
    if (sheet.has(from)) { sheet.set(to, sheet.get(from)); sheet.delete(from) } else sheet.delete(to)
  }

  function shiftCol(r, c, dc) {
    const from = `${r},${c}`
    const to = `${r},${c + dc}`
    const fs = sk(r, c)
    const ts = sk(r, c + dc)
    if (sheet.has(fs)) { sheet.set(ts, sheet.get(fs)); sheet.delete(fs) } else sheet.delete(ts)
    if (sheet.has(from)) { sheet.set(to, sheet.get(from)); sheet.delete(from) } else sheet.delete(to)
  }

  function insertRow() {
    Y.transact(sheet.doc, () => {
      for (let r = rows - 1; r >= sel.r; r--) for (let c = 0; c < cols; c++) shiftRow(r, c, 1)
      sheet.set('rows', rows + 1)
    })
  }

  function deleteRow() {
    if (rows <= 1) return
    Y.transact(sheet.doc, () => {
      for (let r = sel.r; r < rows - 1; r++) for (let c = 0; c < cols; c++) shiftRow(r, c, -1)
      for (let c = 0; c < cols; c++) { sheet.delete(`${rows - 1},${c}`); sheet.delete(sk(rows - 1, c)) }
      sheet.set('rows', rows - 1)
    })
    setSel((s) => clamp(s.r, s.c))
  }

  function insertCol() {
    Y.transact(sheet.doc, () => {
      for (let c = cols - 1; c >= sel.c; c--) for (let r = 0; r < rows; r++) shiftCol(r, c, 1)
      sheet.set('cols', cols + 1)
    })
  }

  function deleteCol() {
    if (cols <= 1) return
    Y.transact(sheet.doc, () => {
      for (let c = sel.c; c < cols - 1; c++) for (let r = 0; r < rows; r++) shiftCol(r, c, -1)
      for (let r = 0; r < rows; r++) { sheet.delete(`${r},${cols - 1}`); sheet.delete(sk(r, cols - 1)) }
      sheet.set('cols', cols - 1)
    })
    setSel((s) => clamp(s.r, s.c))
  }

  // ── ribbon actions ──────────────────────────────────────────────────────
  function autoSum() {
    const { r, c } = sel
    if (r === 0) return
    let start = r - 1
    while (start > 0 && numOf(valueOf(start - 1, c)) !== null) start--
    const hasNum = numOf(valueOf(r - 1, c)) !== null
    setCell(r, c, hasNum ? `=SUM(${colName(c)}${start + 1}:${colName(c)}${r})` : '=sum')
    moveSel(1, 0)
  }

  function clearSheet() {
    Y.transact(sheet.doc, () => {
      for (const k of [...sheet.keys()]) {
        if (k !== 'rows' && k !== 'cols' && k !== 'name') sheet.delete(k)
      }
    })
  }

  function newSheet() {
    if (!window.confirm('start a fresh sheet? everything in here clears (for everyone)')) return
    clearSheet()
    sheet.set('rows', DEFAULT_ROWS)
    sheet.set('cols', DEFAULT_COLS)
    flash('new sheet ✨')
  }

  function saveCsv() {
    try {
      downloadText(
        `syncpad-${sheetName.toLowerCase().replace(/\s+/g, '-')}.csv`,
        sheetCsv(sheet),
        'text/csv;charset=utf-8',
      )
      flash('saved bhai ✅')
    } catch {
      flash('failed yaar 😅')
    }
    setMenu(false)
  }

  function saveJson() {
    const cells = {}
    for (const [k, v] of sheet) cells[k] = v
    downloadText(
      `syncpad-${sheetName.toLowerCase().replace(/\s+/g, '-')}.json`,
      JSON.stringify({ app: 'syncpad-sheet', name: sheetName, rows, cols, cells }, null, 2),
      'application/json',
    )
    flash('backup saved ✅')
    setMenu(false)
  }

  function renameSheet(v) {
    sheet.set('name', v.slice(0, 30) || 'Sheet1')
  }

  // ── status bar column stats (Excel-style) ───────────────────────────────
  const colNums = []
  for (let r = 0; r < rows; r++) {
    const n = numOf(valueOf(r, sel.c))
    if (n !== null) colNums.push(n)
  }
  const colSum = colNums.reduce((a, b) => a + b, 0)
  const filled = [...sheet.keys()].filter((k) => !/^(rows|cols|name|s:)/.test(k)).length

  // ── grid ────────────────────────────────────────────────────────────────
  // rows are memoized: typing only re-renders the selected row, not 1300
  // cells. apiRef carries fresh closures while keeping prop identity stable.
  const apiRef = useRef({})
  Object.assign(apiRef.current, {
    styleOf,
    dispOf,
    rawOf,
    beginEdit,
    pick: (r, c) => {
      setEditing(false)
      setSel({ r, c })
      wrapRef.current?.focus()
    },
    pickRow: (r) => {
      setEditing(false)
      setSel((s) => ({ r, c: s.c }))
      wrapRef.current?.focus()
    },
    commitEdit,
    setDraft,
    setEditing,
    wrapRef,
  })

  return (
    <div className="sheet-panel">
      {/* ── tabs row ── */}
      <div className="sheet-tabs">
        <span className="sheet-app">🧮</span>
        <div className="file-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`sheet-tab is-file${menu ? ' is-open' : ''}`}
            onClick={() => setMenu((v) => !v)}
          >
            File
          </button>
          {menu && (
            <div className="file-menu">
              <button type="button" onClick={newSheet}>🆕 New</button>
              <button type="button" onClick={saveCsv}>💾 Save (.csv)</button>
              <button type="button" onClick={saveJson}>🥞 Save as JSON (backup)</button>
              <button type="button" onClick={() => { setMenu(false); window.print() }}>🖨 Print</button>
              <div className="file-sep" />
              <button type="button" className="is-danger" onClick={() => { clearSheet(); flash('cleared 🧹'); setMenu(false) }}>
                🧹 Clear cells
              </button>
            </div>
          )}
        </div>
        <button type="button" className="sheet-tab is-active">Home</button>
        <span className="sheet-tabs-hint">all tools live in the ribbon ↑</span>
      </div>

      {/* ── ribbon ── */}
      <div className="sheet-ribbon" onPointerDown={(e) => e.stopPropagation()}>
        <div className="rb-group">
          <div className="rb-row">
            <select
              className="rb-select rb-font"
              value={styleOf(sel.r, sel.c).ff || 'sans'}
              onChange={(e) => patchStyle({ ff: e.target.value })}
              title="font family"
            >
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select
              className="rb-select rb-size"
              value={styleOf(sel.r, sel.c).fs || ''}
              onChange={(e) => patchStyle({ fs: e.target.value ? Number(e.target.value) : null })}
              title="font size"
            >
              <option value="">12</option>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="rb-row">
            {[['B', 'bold'], ['I', 'italic'], ['U', 'underline']].map(([lbl, key]) => (
              <button
                key={key}
                type="button"
                className={`rb-btn${styleOf(sel.r, sel.c)[key] ? ' is-on' : ''}`}
                style={{ fontWeight: key === 'bold' ? 800 : undefined, fontStyle: key === 'italic' ? 'italic' : undefined, textDecoration: key === 'underline' ? 'underline' : undefined }}
                onClick={() => patchStyle({ [key]: styleOf(sel.r, sel.c)[key] ? null : 1 })}
                title={`${key} (Ctrl+${lbl})`}
              >
                {lbl}
              </button>
            ))}
            <div className="rb-color-wrap">
              <button type="button" className="rb-btn rb-color" onClick={() => setPicker(picker === 'fc' ? null : 'fc')} title="text color">
                A<i style={{ background: styleOf(sel.r, sel.c).fc || '#33e0ff' }} />
              </button>
              {picker === 'fc' && (
                <div className="rb-pop">
                  {SWATCHES.map((p, i) => (
                    <button key={i} type="button" className="rb-swatch" style={{ background: p || 'transparent' }} title={p || 'reset'}
                      onClick={() => { patchStyle({ fc: p }); setPicker(null) }} />
                  ))}
                </div>
              )}
            </div>
            <div className="rb-color-wrap">
              <button type="button" className="rb-btn rb-color" onClick={() => setPicker(picker === 'bg' ? null : 'bg')} title="fill color">
                ▨<i style={{ background: styleOf(sel.r, sel.c).bg || '#8b7cff' }} />
              </button>
              {picker === 'bg' && (
                <div className="rb-pop">
                  {SWATCHES.map((p, i) => (
                    <button key={i} type="button" className="rb-swatch" style={{ background: p || 'transparent' }} title={p || 'reset'}
                      onClick={() => { patchStyle({ bg: p }); setPicker(null) }} />
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="rb-btn" onClick={() => sheet.delete(sk(sel.r, sel.c))} title="clear formatting">
              🧽
            </button>
          </div>
          <span className="rb-label">font</span>
        </div>

        <div className="rb-group">
          <div className="rb-row">
            {[['l', '≡'], ['c', '≣'], ['r', '≡']].map(([a, glyph], i) => (
              <button
                key={a}
                type="button"
                className={`rb-btn${(styleOf(sel.r, sel.c).al || (i === 0 ? 'l' : '')) === a ? ' is-on' : ''}`}
                style={{ textAlign: 'center' }}
                onClick={() => patchStyle({ al: a })}
                title={`align ${a === 'l' ? 'left' : a === 'c' ? 'center' : 'right'}`}
              >
                {['⬅', '⬌', '➡'][i]}
              </button>
            ))}
          </div>
          <span className="rb-label">align</span>
        </div>

        <div className="rb-group">
          <div className="rb-row">
            <select
              className="rb-select rb-nf"
              value={styleOf(sel.r, sel.c).nf || 'gen'}
              onChange={(e) => patchStyle({ nf: e.target.value === 'gen' ? null : e.target.value })}
              title="number format"
            >
              {NFORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button type="button" className="rb-btn rb-sum" onClick={autoSum} title="AutoSum — adds the numbers above the selected cell">
              Σ AutoSum
            </button>
          </div>
          <span className="rb-label">numbers</span>
        </div>

        <div className="rb-group">
          <div className="rb-row">
            <button type="button" className="rb-btn" onClick={insertRow} title="insert row above selection">＋row</button>
            <button type="button" className="rb-btn" onClick={deleteRow} title="delete selected row">－row</button>
            <button type="button" className="rb-btn" onClick={insertCol} title="insert column left of selection">＋col</button>
            <button type="button" className="rb-btn" onClick={deleteCol} title="delete selected column">－col</button>
          </div>
          <span className="rb-label">rows & columns</span>
        </div>

        <div className="rb-group rb-grow">
          <div className="rb-row">
            <span className="sheet-dim">{rows}×{cols} · {filled} filled</span>
          </div>
          <span className="rb-label">sheet</span>
        </div>
      </div>

      {/* ── formula bar ── */}
      <div className="formula-bar">
        <input
          className="name-box"
          value={nameBox}
          onChange={(e) => setNameBox(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const p = parseRef(nameBox)
            if (p) { setEditing(false); setSel(clamp(p.r, p.c)); wrapRef.current?.focus() }
            else setNameBox(`${colName(sel.c)}${sel.r + 1}`)
          }}
          onBlur={() => setNameBox(`${colName(sel.c)}${sel.r + 1}`)}
          title="jump to cell — type B7 and hit Enter"
        />
        <span className="fx">ƒx</span>
        <input
          className="formula-input"
          value={editing ? draft : rawOf(sel.r, sel.c)}
          placeholder={filled ? 'selected cell is empty — type a value or =SUM(A1:A5)' : 'type here, or click any cell and just start typing…'}
          onFocus={() => beginEdit()}
          onChange={(e) => { if (!editing) beginEdit(e.target.value); else setDraft(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit(1, 0)
            else if (e.key === 'Escape') { setEditing(false); wrapRef.current?.focus() }
          }}
          onBlur={() => commitEdit()}
        />
      </div>

      {/* ── the grid ── */}
      <div
        className="sheet-scroll"
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onGridKey}
      >
        <div
          className="sheet-grid"
          style={{ gridTemplateColumns: `46px repeat(${cols}, 96px)` }}
        >
          <div className="sheet-corner">🧮</div>
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={`h${c}`}
              className={`sheet-colhead${sel.c === c ? ' is-active' : ''}`}
              onMouseDown={() => { setEditing(false); setSel((s) => ({ r: s.r, c })); wrapRef.current?.focus() }}
            >
              {colName(c)}
            </div>
          ))}
          {Array.from({ length: rows }, (_, r) => (
            <SheetRow
              key={r}
              r={r}
              ver={ver}
              cols={cols}
              selKey={sel.r === r ? sel.c : -1}
              editing={editing && sel.r === r}
              draft={editing && sel.r === r ? draft : ''}
              api={apiRef}
            />
          ))}
        </div>
      </div>

      {/* ── status bar ── */}
      <footer className="sheet-status">
        <span className="st-ref">{colName(sel.c)}{sel.r + 1}</span>
        <span className="st-val" title="resolved value of selected cell">
          {editing ? draft || '—' : dispOf(sel.r, sel.c) || 'empty'}
        </span>
        {colNums.length > 0 && (
          <>
            <span className="sheet-pill">Σ {colName(sel.c)} = <b>{Math.round(colSum * 100) / 100}</b></span>
            <span className="sheet-pill">avg <b>{Math.round((colSum / colNums.length) * 100) / 100}</b></span>
            <span className="sheet-pill">n <b>{colNums.length}</b></span>
          </>
        )}
        <span className="st-grow" />
        <span className="st-sync">✏️ <b>{sheetName}</b></span>
        <span className="st-sync">auto-saved ✓ synced live</span>
        {toast && <span className="sheet-toast">{toast}</span>}
      </footer>
    </div>
  )
}

// one memoized grid row: row header + its cells
const SheetRow = memo(function SheetRow({ r, cols, selKey, editing, draft, api }) {
  const a = api.current
  return (
    <>
      <div
        className={`sheet-rowhead${selKey >= 0 ? ' is-active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          a.pickRow(r)
        }}
      >
        {r + 1}
      </div>
      {Array.from({ length: cols }, (_, c) => {
        const st = a.styleOf(r, c)
        const v = a.dispOf(r, c)
        const isNum = numOf(v) !== null
        const isSel = selKey === c
        const raw = a.rawOf(r, c)
        const css = {
          fontWeight: st.bold ? 700 : undefined,
          fontStyle: st.italic ? 'italic' : undefined,
          textDecoration: st.underline ? 'underline' : undefined,
          background: st.bg || undefined,
          color: st.fc || undefined,
          fontFamily: st.ff ? FONTS.find((f) => f.id === st.ff)?.css : undefined,
          fontSize: st.fs ? `${st.fs}px` : undefined,
          justifyContent: st.al
            ? { l: 'flex-start', c: 'center', r: 'flex-end' }[st.al]
            : isNum
              ? 'flex-end' // Excel default: numbers hug the right edge
              : 'flex-start',
        }
        return (
          <div
            key={c}
            className={`sheet-cell${isSel ? ' is-sel' : ''}${raw.startsWith('=') ? ' is-formula' : ''}`}
            style={css}
            onMouseDown={(e) => {
              e.preventDefault() // keep focus on the wrapper → keyboard works
              a.pick(r, c)
            }}
            onDoubleClick={() => isSel && a.beginEdit()}
            title={raw}
          >
            {isSel && editing ? (
              <input
                className="cell-edit"
                value={draft}
                autoFocus
                onChange={(e) => a.setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') a.commitEdit(1, 0)
                  else if (e.key === 'Tab') { e.preventDefault(); a.commitEdit(0, 1) }
                  else if (e.key === 'Escape') { a.setEditing(false); a.wrapRef.current?.focus() }
                  e.stopPropagation()
                }}
                onBlur={() => a.commitEdit()}
              />
            ) : (
              v
            )}
          </div>
        )
      })}
    </>
  )
})

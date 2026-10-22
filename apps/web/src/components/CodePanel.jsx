// 💻 Group code — a two-phase tool.
//   Phase 1 (setup): paste a problem statement → "generate workspace".
//   Phase 2 (studio): the coding IDE opens — problem + editor + live scoreboard.
// The PROBLEM + RESULTS live in the Y.Doc (shared + persisted); each person's
// source buffer is LOCAL (submissions are per-person). Judging runs through our
// server's /code proxy so the provider key never touches this public bundle.
//
// codeprep contract (verified live):
//   generate → { problemId, problem:{title,description}, templates:{python3,…} }
//   submit   → { verdict, passed, total, timeMs, memoryKb, results[] }

import { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { cpp } from '@codemirror/lang-cpp'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { EditorView } from '@codemirror/view'
import { generateProblem, submitCode } from '../lib/pad.js'

const FALLBACK_LANGS = ['python3']
// template key (from codeprep) → CodeMirror language extension
const LANG_EXT = {
  cpp: cpp(), cpp14: cpp(), cpp17: cpp(), cpp20: cpp(),
  python: python(), python3: python(),
  java: java(),
}
const LANG_LABEL = {
  cpp17: 'C++17', cpp20: 'C++20', cpp14: 'C++14', cpp: 'C++',
  python3: 'Python 3', python: 'Python', java: 'Java',
}
const isAC = (r) =>
  (r?.total > 0 && r?.passed === r?.total) || /^ace?$|accept/i.test(r?.verdict || '')
// judge returns terse codes (AC / ACE / WA / TLE / RE …) — show friendly words
const VERDICT_LABEL = {
  AC: 'Accepted', ACE: 'Accepted', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded',
  MLE: 'Memory Limit Exceeded', OLE: 'Output Limit Exceeded', RE: 'Runtime Error',
  CE: 'Compilation Error', OE: 'Output Error', IE: 'Internal Error',
}
const verdictLabel = (v) => VERDICT_LABEL[String(v || '').toUpperCase()] || v || '?'

export default function CodePanel({ code, identity, myClientId }) {
  const [, force] = useState(0)
  const [statement, setStatement] = useState('')
  const [source, setSource] = useState('')
  const [language, setLanguage] = useState('python3')
  const [busy, setBusy] = useState(null) // 'gen' | 'submit' | 'run' | null
  const [err, setErr] = useState(null)
  const [myResult, setMyResult] = useState(null)
  const [openTests, setOpenTests] = useState({}) // which per-test rows are expanded
  const [split, setSplit] = useState(() => {
    const v = Number(localStorage.getItem('syncpad-code-split'))
    return Number.isFinite(v) && v >= 12 && v <= 88 ? v : 58
  }) // editor's share (%) of the vertical space
  const [draggingV, setDraggingV] = useState(false)
  const bodyRef = useRef(null)

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    code.observe(obs)
    return () => code.unobserve(obs)
  }, [code])

  // ── shared problem (re-read every render; observe() bumps us on change) ──
  let problem = null
  try {
    problem = code.get('problem') ? JSON.parse(code.get('problem')) : null
  } catch {
    problem = null
  }
  const langs = problem?.templates ? Object.keys(problem.templates) : FALLBACK_LANGS

  // keep the selected language valid for the current problem's templates
  useEffect(() => {
    if (problem?.templates && !problem.templates[language]) {
      setLanguage(Object.keys(problem.templates)[0] || 'python3')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.problemId])

  // restore this problem+language draft (survives refresh); seed from template
  useEffect(() => {
    const pid = problem?.problemId
    if (!pid) return
    const saved = localStorage.getItem(`syncpad-code-${pid}-${language}`)
    setSource(saved ?? problem?.templates?.[language] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.problemId, language])

  // ── leaderboard (r:<clientId> → result) ──────────────────────────────────
  const results = []
  code.forEach((v, k) => {
    if (!k.startsWith('r:')) return
    try {
      results.push({ clientId: Number(k.slice(2)), ...JSON.parse(v) })
    } catch {
      /* ignore junk */
    }
  })
  results.sort((a, b) => {
    const sa = (a.passed || 0) - (b.passed || 0)
    if (sa !== 0) return -sa
    return (a.ts || 0) - (b.ts || 0) // first to reach a score wins the tie
  })

  async function onGenerate() {
    const text = statement.trim()
    if (!text) return
    setBusy('gen')
    setErr(null)
    try {
      const p = await generateProblem(text)
      code.set(
        'problem',
        JSON.stringify({
          problemId: p.problemId,
          title: p.problem?.title || text.split('\n')[0].slice(0, 80),
          statement: p.problem?.description || text,
          templates: p.templates || {},
          by: identity.name,
          at: Date.now(),
        }),
      )
      setStatement('')
      setMyResult(null)
      setOpenTests({})
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function onRun(mode) {
    if (!problem?.problemId || !source.trim()) return
    setBusy(mode)
    setErr(null)
    try {
      const r = await submitCode({
        problemId: problem.problemId,
        language,
        sourceCode: source,
        mode, // 'submit' = judged (incl. hidden tests) · 'run' = visible examples
        style: 'stdin',
      })
      const rec = {
        name: identity.name,
        emoji: identity.emoji,
        verdict: r.verdict,
        passed: r.passed,
        total: r.total,
        language,
        mode,
        ts: Date.now(),
      }
      // record on the shared board for BOTH run and submit so it's never blank
      code.set(`r:${myClientId}`, JSON.stringify(rec))
      const results = r.results || []
      setMyResult({ mode, ...rec, timeMs: r.timeMs, memoryKb: r.memoryKb, results })
      // give the verdict room to be seen without dragging the divider
      setSplit((s) => Math.min(s, 45))
      // expand the first visible test so the in/exp/got layout is obvious
      const first = results.find((t) => t.visible !== false)
      setOpenTests(first ? { [first.testCaseId ?? first.testNo ?? 0]: true } : {})
    } catch (e) {
      setErr(e.message)
      setSplit((s) => Math.min(s, 45)) // reveal the error box without dragging
    } finally {
      setBusy(null)
    }
  }

  function onSource(v) {
    setSource(v)
    if (problem?.problemId) localStorage.setItem(`syncpad-code-${problem.problemId}-${language}`, v)
  }

  function toggleTest(key) {
    setOpenTests((o) => ({ ...o, [key]: !o[key] }))
  }

  // drag the divider to resize editor vs output (vertical split)
  function onSplitDown(e) {
    e.preventDefault()
    const body = bodyRef.current
    if (!body) return
    const rect = body.getBoundingClientRect()
    let latest = split
    function move(ev) {
      const cy = ev.clientY != null ? ev.clientY : ev.touches && ev.touches[0] && ev.touches[0].clientY
      if (cy == null) return
      const pct = ((cy - rect.top) / rect.height) * 100
      latest = Math.min(88, Math.max(12, pct))
      setSplit(latest)
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
      document.body.style.userSelect = ''
      try {
        localStorage.setItem('syncpad-code-split', String(Math.round(latest)))
      } catch {
        /* ignore */
      }
      setDraggingV(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    document.body.style.userSelect = 'none'
    setDraggingV(true)
  }

  // ══ PHASE 1 — setup: only the generator, nothing else ══════════════════
  if (!problem) {
    return (
      <div className="code-panel code-setup">
        <header className="code-head">
          <h2>💻 group code</h2>
          <span className="code-sub">paste a problem statement to spin up a shared workspace</span>
        </header>
        <section className="code-card code-gen-card">
          <div className="code-card-title">📋 new problem</div>
          <form
            className="code-gen"
            onSubmit={(e) => {
              e.preventDefault()
              onGenerate()
            }}
          >
            <textarea
              value={statement}
              placeholder={
                'structured statement parses best, e.g.\n\nTwo Sum\nInput: space-separated integers, then a target on the next line\nOutput: the two indices that sum to the target\n\nExample:\nInput:\n2 7 11 15\n9\nOutput:\n0 1'
              }
              onChange={(e) => setStatement(e.target.value)}
              rows={12}
            />
            <button type="submit" disabled={!statement.trim() || busy === 'gen'}>
              {busy === 'gen' ? 'generating workspace… ⚙️' : 'generate workspace ✨'}
            </button>
          </form>
          {err && <p className="code-err">⚠️ {err}</p>}
        </section>
      </div>
    )
  }

  // ══ PHASE 2 — studio: problem + editor + scoreboard ════════════════════
  const solved = results.filter((r) => isAC(r)).length
  const draftKey = `syncpad-code-${problem.problemId}-${language}`

  // peak runtime / memory across the judged tests (for the submit stat cards)
  const tResults = myResult?.results || []
  const cachedCount = tResults.filter((t) => t.cached).length
  const tTimes = tResults.map((t) => t.timeMs).filter((n) => typeof n === 'number')
  const tMems = tResults.map((t) => t.memoryKb).filter((n) => typeof n === 'number')
  const peakTime = tTimes.length ? Math.max(...tTimes) : myResult?.timeMs
  const peakMemKb = tMems.length ? Math.max(...tMems) : myResult?.memoryKb

  return (
    <div className="code-panel code-studio">
      <header className="code-head">
        <h2>💻 group code</h2>
        <span className="code-sub">
          {results.length
            ? `${solved}/${results.length} AC — ab tumhari baari 🔥`
            : 'problem live hai — pehla AC maaro 🏆'}
        </span>
        <button type="button" className="code-regen" onClick={() => code.delete('problem')}>
          ↺ new problem
        </button>
      </header>

      <div className="code-grid">
        {/* ── LEFT: problem + scoreboard ─────────────────────────────── */}
        <div className="code-col">
          <section className="code-card code-problem">
            <div className="code-card-title">📋 problem</div>
            <article className="code-statement">
              <div className="code-statement-top">
                <h3>{problem.title}</h3>
                <small>
                  by {problem.by} · <code>{problem.problemId}</code>
                </small>
              </div>
              <pre>{problem.statement}</pre>
            </article>
          </section>

          <section className="code-card code-board">
            <div className="code-card-title">🏆 room scoreboard</div>
            {results.length ? (
              <ol>
                {results.map((r, i) => (
                  <li key={r.clientId} className={isAC(r) ? 'is-ac' : ''}>
                    <span className="code-rank">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span className="code-who">
                      {r.emoji} {r.name}
                      {r.clientId === myClientId ? ' (you)' : ''}
                    </span>
                    <span className="code-res">
                      {verdictLabel(r.verdict)} · {r.passed}/{r.total}
                      {r.mode === 'run' ? ' · run' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="code-empty">abhi koi submit nahi kiya — be the first 🚀</p>
            )}
          </section>
        </div>

        {/* ── RIGHT: editor + verdict ────────────────────────────────── */}
        <div className="code-col">
          <section className="code-card code-editor">
            <div className="code-toolbar">
              <div className="code-lang-tabs">
                {langs.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`code-lang-tab${l === language ? ' is-active' : ''}`}
                    onClick={() => setLanguage(l)}
                  >
                    {LANG_LABEL[l] || l}
                  </button>
                ))}
              </div>
              <div className="code-actions">
                <button
                  type="button"
                  className="code-run"
                  disabled={!source.trim() || busy != null}
                  onClick={() => onRun('run')}
                  title="run on the visible example tests"
                >
                  {busy === 'run' ? 'running…' : '▶ run'}
                </button>
                <button
                  type="button"
                  className="code-submit"
                  disabled={!source.trim() || busy != null}
                  onClick={() => onRun('submit')}
                >
                  {busy === 'submit' ? 'judging… 🧪' : 'submit 🚀'}
                </button>
              </div>
            </div>
            <div className={`code-body${draggingV ? ' is-dragging' : ''}`} ref={bodyRef}>
            <div className="code-area" style={{ flex: `0 0 ${split}%` }}>
              <CodeMirror
                value={source}
                theme={oneDark}
                height="100%"
                style={{ height: '100%', fontSize: '0.86rem' }}
                extensions={[...(LANG_EXT[language] ? [LANG_EXT[language]] : []), EditorView.lineWrapping]}
                placeholder="// your solution…"
                onChange={onSource}
              />
            </div>
            <div
              className="code-vsplit"
              role="separator"
              aria-orientation="horizontal"
              title="drag to resize editor / output"
              onMouseDown={onSplitDown}
              onTouchStart={onSplitDown}
            >
              <span className="code-vsplit-grip" />
            </div>
            <div className="code-output">
              {err && (
                <div className="code-err-box">
                  <span className="code-err-msg">⚠️ {err}</span>
                  <button
                    type="button"
                    className="code-close"
                    title="dismiss"
                    onClick={() => setErr(null)}
                  >
                    ✕
                  </button>
                </div>
              )}

              {myResult && (
                <div className={`code-result${isAC(myResult) ? ' is-ac' : ' is-fail'}`}>
                  <div className="code-verdict-bar">
                    <span className="code-verdict-main">
                      <span className="code-verdict-badge">{isAC(myResult) ? '✓' : '✗'}</span>
                      <strong>{verdictLabel(myResult.verdict)}</strong>
                      <span className="code-verdict-score">
                        {myResult.passed}/{myResult.total}
                      </span>
                      <span className="code-verdict-hint">
                        {myResult.mode === 'run'
                          ? 'examples passed — press Submit to run the full hidden pool'
                          : 'testcases passed (full pool)'}
                      </span>
                      {myResult.mode === 'submit' && cachedCount > 0 && (
                        <span className="code-cached-chip">⚡ {cachedCount} cached</span>
                      )}
                    </span>
                    <span className="code-verdict-right">
                      {myResult.mode === 'run' && peakTime != null && (
                        <em className="code-verdict-time">{peakTime} ms</em>
                      )}
                      <button
                        type="button"
                        className="code-close"
                        title="close result"
                        onClick={() => setMyResult(null)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>

                  {myResult.mode === 'submit' && (peakTime != null || peakMemKb != null) && (
                    <div className="code-stats">
                      <div className="code-stat">
                        <div className="code-stat-title">⏱ Runtime</div>
                        <div className="code-stat-value">{peakTime ?? 0} ms</div>
                        <div className="code-stat-sub">
                          slowest of {myResult.total} tests · percentile appears after 3+ accepted runs
                        </div>
                      </div>
                      <div className="code-stat">
                        <div className="code-stat-title">💾 Memory</div>
                        <div className="code-stat-value">
                          {peakMemKb != null ? (peakMemKb / 1024).toFixed(2) : '?'} MB
                        </div>
                        <div className="code-stat-sub">
                          peak across {myResult.total} tests · percentile appears after 3+ accepted runs
                        </div>
                      </div>
                    </div>
                  )}

                  {myResult.results?.length > 0 && (
                    <ul className="code-tests">
                      {myResult.results.map((t, i) => {
                        const key = t.testCaseId ?? t.testNo ?? i
                        const passed = isAC({ verdict: t.verdict })
                        const hidden = t.visible === false
                        const isOpen = !!openTests[key]
                        return (
                          <li
                            key={key}
                            className={`code-test${hidden ? ' is-hidden' : passed ? ' is-ac' : ' is-fail'}`}
                          >
                            <button
                              type="button"
                              className="code-test-head"
                              disabled={hidden}
                              onClick={() => toggleTest(key)}
                            >
                              <span className="code-test-title">
                                {hidden
                                  ? `Test Case ${i + 1}`
                                  : `${passed ? '✓' : '✗'} Test #${t.testNo ?? i + 1} — ${verdictLabel(t.verdict)}`}
                                {t.cached && <span className="code-test-cached">(cached)</span>}
                              </span>
                              {hidden ? (
                                <span className="code-hidden">hidden</span>
                              ) : (
                                <span className="code-test-meta">
                                  {t.timeMs != null && <em>{t.timeMs} ms</em>}
                                  <span className="code-caret">{isOpen ? '▲' : '▼'}</span>
                                </span>
                              )}
                            </button>
                            {isOpen && !hidden && (
                              <div className="code-test-body">
                                <div className="code-io-label">INPUT:</div>
                                <pre className="code-io">{t.input || '—'}</pre>
                                <div className="code-io-row">
                                  <div>
                                    <div className="code-io-label exp">EXPECTED OUTPUT:</div>
                                    <pre className="code-io code-io-exp">{t.expected || '—'}</pre>
                                  </div>
                                  <div>
                                    <div className="code-io-label got">YOUR OUTPUT:</div>
                                    <pre
                                      className={`code-io code-io-got${passed ? ' is-match' : ''}`}
                                    >
                                      {t.actual || '(nothing)'}
                                    </pre>
                                  </div>
                                </div>
                                {t.stderr && (
                                  <>
                                    <div className="code-io-label err">
                                      {/ce|compil/i.test(t.verdict || '')
                                        ? 'COMPILER OUTPUT:'
                                        : 'RUNTIME ERROR (stderr):'}
                                    </div>
                                    <pre className="code-io code-io-err">{t.stderr}</pre>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
              <small className="code-draft" key={draftKey}>
                draft auto-saved locally · {language}
              </small>
            </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

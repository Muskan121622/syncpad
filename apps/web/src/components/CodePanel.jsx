// 💻 Group code — one shared problem, everyone solves it in their own editor,
// submit → a live room leaderboard. The PROBLEM + RESULTS live in the Y.Doc
// (so they sync + persist across the room), but each person's source buffer is
// LOCAL (submissions are per-person anyway). Judging runs through our server's
// /code proxy so the provider key never touches this public bundle.
//
// codeprep contract (verified live):
//   generate → { problemId, problem:{title,description}, templates:{python3,…} }
//   submit   → { verdict, passed, total, timeMs, memoryKb, results[] }

import { useEffect, useRef, useState } from 'react'
import { generateProblem, submitCode } from '../lib/pad.js'

const FALLBACK_LANGS = ['python3']
const isAC = (r) =>
  (r?.total > 0 && r?.passed === r?.total) || /^ac$|accept/i.test(r?.verdict || '')

export default function CodePanel({ code, identity, myClientId }) {
  const [, force] = useState(0)
  const [statement, setStatement] = useState('')
  const [source, setSource] = useState('')
  const [language, setLanguage] = useState('python3')
  const [busy, setBusy] = useState(null) // 'gen' | 'submit' | 'run' | null
  const [err, setErr] = useState(null)
  const [myResult, setMyResult] = useState(null)
  const [open, setOpen] = useState(false) // per-test breakdown toggle
  const areaRef = useRef(null)

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
      const templates = p.templates || {}
      code.set(
        'problem',
        JSON.stringify({
          problemId: p.problemId,
          title: p.problem?.title || text.split('\n')[0].slice(0, 80),
          statement: p.problem?.description || text,
          templates,
          by: identity.name,
          at: Date.now(),
        }),
      )
      setStatement('')
      setMyResult(null)
      setOpen(false)
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
        ts: Date.now(),
      }
      if (mode === 'submit') code.set(`r:${myClientId}`, JSON.stringify(rec))
      setMyResult({ mode, ...rec, results: r.results || [] })
      setOpen(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  function onSource(v) {
    setSource(v)
    if (problem?.problemId) localStorage.setItem(`syncpad-code-${problem.problemId}-${language}`, v)
  }

  const solved = results.filter((r) => isAC(r)).length
  const draftKey = `syncpad-code-${problem?.problemId || 'x'}-${language}`

  return (
    <div className="code-panel">
      <header className="code-head">
        <h2>💻 group code</h2>
        <span className="code-sub">
          {problem ? (
            results.length
              ? `${solved}/${results.length} AC — ab tumhari baari 🔥`
              : 'problem live hai — pehla AC maaro 🏆'
          ) : (
            'paste a statement, generate a workspace'
          )}
        </span>
      </header>

      {/* ── problem ────────────────────────────────────────────────────── */}
      <section className="code-problem">
        {problem ? (
          <article className="code-statement">
            <div className="code-statement-top">
              <h3>{problem.title}</h3>
              <small>
                by {problem.by} · <code>{problem.problemId}</code>
              </small>
            </div>
            <pre>{problem.statement}</pre>
          </article>
        ) : (
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
              rows={6}
            />
            <button type="submit" disabled={!statement.trim() || busy === 'gen'}>
              {busy === 'gen' ? 'generating… ⚙️' : 'generate problem ✨'}
            </button>
          </form>
        )}
        {problem && (
          <button
            type="button"
            className="code-regen"
            onClick={() => code.delete('problem')}
            title="clear and generate a new one"
          >
            ↺ new problem
          </button>
        )}
      </section>

      {/* ── editor ─────────────────────────────────────────────────────── */}
      <section className="code-editor">
        <div className="code-toolbar">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {langs.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <div className="code-actions">
            <button
              type="button"
              className="code-run"
              disabled={!problem || !source.trim() || busy != null}
              onClick={() => onRun('run')}
              title="run on the visible example tests"
            >
              {busy === 'run' ? 'running…' : '▶ run'}
            </button>
            <button
              type="button"
              className="code-submit"
              disabled={!problem || !source.trim() || busy != null}
              onClick={() => onRun('submit')}
            >
              {busy === 'submit' ? 'judging… 🧪' : 'submit 🚀'}
            </button>
          </div>
        </div>
        <textarea
          ref={areaRef}
          className="code-area"
          value={source}
          spellCheck={false}
          placeholder={problem ? '// your solution…' : '// generate a problem first ☝️'}
          onChange={(e) => onSource(e.target.value)}
        />
        {err && <p className="code-err">⚠️ {err}</p>}

        {myResult && (
          <div className={`code-result${isAC(myResult) ? ' is-ac' : ''}`}>
            <button type="button" className="code-verdict-bar" onClick={() => setOpen((o) => !o)}>
              <span>
                {myResult.mode} → <strong>{myResult.verdict || '?'}</strong> · {myResult.passed}/
                {myResult.total}
                {myResult.timeMs != null && <em> {myResult.timeMs}ms</em>}
              </span>
              {myResult.results?.length > 0 && <span className="code-caret">{open ? '▾' : '▸'}</span>}
            </button>
            {open && myResult.results?.length > 0 && (
              <ul className="code-tests">
                {myResult.results.map((t) => (
                  <li key={t.testCaseId || t.testNo} className={isAC({ verdict: t.verdict }) ? 'is-ac' : ''}>
                    <span className="code-tno">#{t.testNo}</span>
                    <span className="code-tv">{t.verdict}</span>
                    {t.visible === false ? (
                      <span className="code-hidden">hidden test</span>
                    ) : (
                      <pre className="code-tio">
                        <b>in</b> {t.input}
                        {'\n'}
                        <b>exp</b> {t.expected}
                        {'\n'}
                        <b>got</b> {t.actual || '(nothing)'}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <small className="code-draft" key={draftKey}>
          draft auto-saved locally · {language}
        </small>
      </section>

      {/* ── leaderboard ─────────────────────────────────────────────────── */}
      <section className="code-board">
        <h4>🏆 room scoreboard</h4>
        {results.length ? (
          <ol>
            {results.map((r, i) => (
              <li key={r.clientId} className={isAC(r) ? 'is-ac' : ''}>
                <span className="code-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                <span className="code-who">
                  {r.emoji} {r.name}
                  {r.clientId === myClientId ? ' (you)' : ''}
                </span>
                <span className="code-res">
                  {r.verdict} · {r.passed}/{r.total}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="code-empty">abhi koi submit nahi kiya — be the first 🚀</p>
        )}
      </section>
    </div>
  )
}

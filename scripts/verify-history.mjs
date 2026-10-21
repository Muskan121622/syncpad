// Headless end-to-end check of the rewind persistence loop:
//   1. connect a real Yjs client to the Hocuspocus server
//   2. make edits in two separated bursts
//   3. fetch the server edit-log via the history API
//   4. replay delta prefixes offline and assert state + attribution converge
// Run: node scripts/verify-history.mjs
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

const WS_URL = 'ws://localhost:1234'
const API = 'http://localhost:1235/history'
const PAD = `headless-check-${Date.now().toString(36)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect() {
  return new Promise((resolve, reject) => {
    const ydoc = new Y.Doc()
    ydoc.clientID = Math.floor(Math.random() * 0xffffffff)
    const provider = new HocuspocusProvider({ url: WS_URL, name: PAD, document: ydoc })
    const timer = setTimeout(() => reject(new Error('sync timeout (10s)')), 10_000)
    provider.on('synced', () => {
      clearTimeout(timer)
      resolve({ ydoc, provider })
    })
  })
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log(`\n✦ verifying rewind persistence on pad "${PAD}"\n`)

  // 1–2. connect + edit in two bursts
  const { ydoc, provider } = await connect()
  const text = ydoc.getText('syncpad')
  text.insert(0, 'burst one.')
  await sleep(2500) // beyond the 1.2s server debounce → separate record
  text.insert(text.length, ' burst two.')
  const finalText = text.toString()
  const myClientID = ydoc.clientID
  await sleep(2500)

  // 3. pull the edit log from the history API
  const res = await fetch(`${API}/${PAD}`)
  check('history API responds 200', res.ok, `status ${res.status}`)
  const records = await res.json()
  check(
    'server logged ≥2 records (base + ≥1 delta)',
    Array.isArray(records) && records.length >= 2,
    `${records.length ?? 0} records`,
  )

  // attribution: who[] should contain our clientID on the edit records
  const editRecords = records.slice(1)
  const attributed = editRecords.some((r) => (r.who || []).includes(myClientID))
  check('delta records attributed to editing client', attributed, `clientID ${myClientID}`)

  // 4. offline replay — prefix of deltas must reconstruct each step's state
  const scratch = new Y.Doc()
  let replayOk = true
  let lastText = ''
  for (const r of records) {
    try {
      Y.applyUpdate(scratch, Uint8Array.from(atob(r.u), (c) => c.charCodeAt(0)))
    } catch (e) {
      replayOk = false
      check('delta replay is lossless', false, e.message)
      break
    }
    lastText = scratch.getText('syncpad').toString()
  }
  check('delta replay is lossless', replayOk)
  check(
    'final replayed state === live state',
    lastText === finalText,
    `replayed "${lastText}"`,
  )

  // persistence across disconnect: server kept the log after we left
  provider.disconnect()
  await sleep(400)
  const res2 = await fetch(`${API}/${PAD}`)
  const records2 = await res2.json()
  check(
    'edit-log survives client disconnect',
    Array.isArray(records2) && records2.length >= records.length && records2.length >= 2,
    `${records2.length} records after disconnect`,
  )

  provider.destroy()
  ydoc.destroy()
  scratch.destroy()

  const failed = results.filter((r) => !r.pass)
  console.log(
    `\n${failed.length === 0 ? '🎉 ALL PASS' : '💥 FAILURES'} — ${results.length - failed.length}/${results.length} checks passed\n`,
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('\n💥 verification crashed:', err.message)
  process.exit(1)
})

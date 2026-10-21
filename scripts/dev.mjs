// Runs server + web together with tagged output.
import { spawn } from 'node:child_process'

const tasks = [
  { tag: 'server', cmd: 'npm', args: ['run', 'dev', '-w', '@syncpad/server'] },
  { tag: 'web', cmd: 'npm', args: ['run', 'dev', '-w', '@syncpad/web'] },
]

const colors = { server: '\x1b[95m', web: '\x1b[96m' }

function run({ tag, cmd, args }) {
  const child = spawn(cmd, args, { shell: true })
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop()
      for (const line of lines) {
        out.write(`${colors[tag]}[${tag}]\x1b[0m ${line}\n`)
      }
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    console.log(`${colors[tag]}[${tag}]\x1b[0m exited with code ${code}`)
    process.exit(code ?? 0)
  })
}

tasks.forEach(run)
console.log('\x1b[95m[syncpad]\x1b[0m starting server (:1234) + web (:5173)…')

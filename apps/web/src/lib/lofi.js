// 🎧 Ambient lo-fi room — synthesized entirely with WebAudio, no mp3s.
// Recipe: looping brown-noise "rain" + slowly drifting minor-7th chord pads
// + sparse vinyl crackle. Everything sits behind one lowpass at ~900Hz so
// it reads as warm background furniture, not a melody you can hum.

const CHORDS = [
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 349.23], // G7-ish warmth
  [164.81, 196.0, 246.94, 293.66], // Em7
]

function brownNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 4
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  return buf
}

export function createLofi() {
  let ctx = null
  let master = null
  let chordTimer = null
  let crackleTimer = null
  let running = false

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0
    const warmth = ctx.createBiquadFilter()
    warmth.type = 'lowpass'
    warmth.frequency.value = 900
    master.connect(warmth)
    warmth.connect(ctx.destination)

    // rain: looping brown noise, half a step quieter than the pads
    const rain = ctx.createBufferSource()
    rain.buffer = brownNoiseBuffer(ctx)
    rain.loop = true
    const rainGain = ctx.createGain()
    rainGain.gain.value = 0.16
    rain.connect(rainGain)
    rainGain.connect(master)
    rain.start()

    // vinyl crackle: random tiny impulses
    crackleTimer = setInterval(() => {
      if (Math.random() > 0.55) return
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = 3000 + Math.random() * 4000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.006 + Math.random() * 0.012, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + 0.05)
    }, 90)
  }

  function playChord() {
    const notes = CHORDS[Math.floor(Math.random() * CHORDS.length)]
    const t = ctx.currentTime
    const bar = 9 + Math.random() * 4 // seconds this chord drifts
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator()
      osc.type = i % 2 ? 'sine' : 'triangle'
      osc.frequency.value = f / 2 // one octave down = mellower
      osc.detune.value = Math.random() * 8 - 4 // tape wobble
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.05, t + 2.2) // slow swell in
      g.gain.setValueAtTime(0.05, t + bar - 2.5)
      g.gain.exponentialRampToValueAtTime(0.0001, t + bar) // slow fade out
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + bar + 0.2)
    })
  }

  async function start() {
    if (running) return
    if (!ctx) build()
    await ctx.resume() // may reject until a real user gesture exists
    running = true
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
    master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2) // fade in
    playChord()
    chordTimer = setInterval(playChord, 10_500)
  }

  function stop() {
    if (!running) return
    running = false
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(master.gain.value, t)
    master.gain.linearRampToValueAtTime(0, t + 1.2) // fade out
    clearInterval(chordTimer)
    chordTimer = null
  }

  function destroy() {
    stop()
    clearInterval(crackleTimer)
    setTimeout(() => ctx?.close().catch(() => {}), 1500)
  }

  return { start, stop, destroy, isRunning: () => running }
}

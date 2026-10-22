// Per-user identity: fun gen-z style name, emoji status, cursor color.
// Persisted locally — one identity per browser, shared with the room via awareness.

const ADJECTIVES = [
  'Neon', 'Cosmic', 'Hyper', 'Glitch', 'Turbo', 'Midnight',
  'Quantum', 'Lunar', 'Static', 'Velvet', 'Chrome', 'Feral',
]
const NOUNS = [
  'Penguin', 'Capybara', 'Dragon', 'Raccoon', 'Ghost', 'Otter',
  'Falcon', 'Yeti', 'Heron', 'Salamander', 'Moth', 'Axolotl',
]

export const COLORS = [
  '#a78bfa', '#22d3ee', '#f472b6', '#a6e86b',
  '#ff9e6d', '#ff5d8f', '#3ddc97', '#ffd166',
]

export const REACTION_EMOJIS = ['✨', '🔥', '💀', '😭', '🫶', '👀', '🧠', '⚡']

const KEY = 'syncpad-identity'
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

export function randomIdentity() {
  return {
    id: Math.random().toString(36).slice(2, 8),
    name: `${pick(ADJECTIVES)}${pick(NOUNS)}`,
    emoji: pick(['😴', '🔥', '✨', '🫠', '👻', '🐧', '🎧', '💀', '🌙', '⚡']),
    color: pick(COLORS),
    claimed: false,
  }
}

export function loadIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    // Identities saved before the claim flow lack `claimed` — show the
    // claim screen once so the user can swap the random name for a real one.
    if (saved?.id && saved?.name && saved?.color) return saved
  } catch {
    /* corrupted entry → regenerate */
  }
  return randomIdentity()
}

export function saveIdentity(identity) {
  const final = { ...identity, claimed: true }
  localStorage.setItem(KEY, JSON.stringify(final))
  return final
}

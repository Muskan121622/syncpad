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
  '#8b7cff', '#33e0ff', '#ff6ad5', '#b6ff3d',
  '#ffb26b', '#ff5d7a', '#4dff9e', '#ffe14d',
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

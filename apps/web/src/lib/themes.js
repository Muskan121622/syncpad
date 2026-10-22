// Vibe system — each pad has one synced theme, shared by everyone in the room.
// Themes are pure CSS-variable swaps driven by the data-vibe attribute.

export const VIBES = [
  { id: 'midnight', label: 'Midnight', swatch: 'linear-gradient(135deg,#8b7cff,#33e0ff)' },
  { id: 'coquette', label: 'Coquette', swatch: 'linear-gradient(135deg,#ff8fab,#ffd6e3)' },
  { id: 'lavender', label: 'Lavender', swatch: 'linear-gradient(135deg,#c4b5fd,#a5b4fc)' },
  { id: 'peach', label: 'Peach', swatch: 'linear-gradient(135deg,#ffb08f,#ffd9c2)' },
  { id: 'vaporwave', label: 'Vaporwave', swatch: 'linear-gradient(135deg,#ff6ad5,#00f5ff)' },
  { id: 'sage', label: 'Sage', swatch: 'linear-gradient(135deg,#9dc88d,#d8f3dc)' },
  { id: 'matcha', label: 'Matcha', swatch: 'linear-gradient(135deg,#b4d38f,#e7f0c8)' },
  { id: 'butter', label: 'Butter', swatch: 'linear-gradient(135deg,#ffd166,#fff0b0)' },
  { id: 'cherry', label: 'Cherry', swatch: 'linear-gradient(135deg,#ff4d5e,#ff8fa3)' },
  { id: 'berry', label: 'Berry', swatch: 'linear-gradient(135deg,#c86bd6,#7c3a6a)' },
  { id: 'teal', label: 'Teal', swatch: 'linear-gradient(135deg,#2dd4bf,#22d3ee)' },
  { id: 'mocha', label: 'Mocha', swatch: 'linear-gradient(135deg,#c79b6d,#8a5a3c)' },
  { id: 'terminal', label: 'Terminal', swatch: 'linear-gradient(135deg,#00ff9c,#b6ff3d)' },
  { id: 'lofi', label: 'Lo-fi', swatch: 'linear-gradient(135deg,#ffb26b,#ff8a8a)' },
]

export const DEFAULT_VIBE = 'midnight'

export function normalizeVibe(id) {
  return VIBES.some((v) => v.id === id) ? id : DEFAULT_VIBE
}

export function applyVibe(id) {
  document.documentElement.setAttribute('data-vibe', normalizeVibe(id))
}

// Vibe system — each pad has one synced theme, shared by everyone in the room.
// Themes are pure CSS-variable swaps driven by the data-vibe attribute.

export const VIBES = [
  { id: 'midnight', label: 'Midnight', swatch: 'linear-gradient(135deg,#8b7cff,#33e0ff)' },
  { id: 'vaporwave', label: 'Vaporwave', swatch: 'linear-gradient(135deg,#ff6ad5,#00f5ff)' },
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

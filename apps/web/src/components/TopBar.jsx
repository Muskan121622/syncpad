// Header strip: brand, pad id + Google-style share popcard, reaction emoji
// selector, vibe picker, presence, and the live/ghost connection pill.

import { REACTION_EMOJIS } from '../lib/identity.js'
import PresenceBar from './PresenceBar.jsx'
import SharePop from './SharePop.jsx'
import VibePicker from './VibePicker.jsx'

export default function TopBar({
  padId,
  status,
  peers,
  vibe,
  onPickVibe,
  reaction,
  onPickReaction,
  onNewPad,
}) {
  const live = status === 'connected'
  const connecting = status === 'connecting'

  return (
    <header className="topbar">
      <div className="brand">
        <h1>
          Sync<span>Pad</span> <i className="spark">✦</i>
        </h1>
        <span className="pad-tag" title="Pad id — anyone with the link lands here">
          #{padId}
        </span>
        <SharePop padId={padId} />
        <button type="button" className="ghost-btn" onClick={onNewPad} title="Start a fresh pad">
          ✚ new pad
        </button>
      </div>

      <div className="react-strip" title="Pick your reaction, then double-click anywhere on the pad">
        {REACTION_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className={`react-btn${reaction === e ? ' is-active' : ''}`}
            onClick={() => onPickReaction(e)}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="top-right">
        <VibePicker vibe={vibe} onPick={onPickVibe} />
        <PresenceBar peers={peers} />
        <span className={`status-pill ${live ? 'is-live' : connecting ? 'is-wip' : 'is-ghost'}`}>
          {live ? '● live' : connecting ? '◌ syncing' : '👻 ghost mode'}
        </span>
      </div>
    </header>
  )
}

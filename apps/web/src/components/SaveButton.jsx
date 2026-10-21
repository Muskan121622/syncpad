// 💾 SaveButton — one tiny button, one satisfying toast. `make()` returns
// either { name, text } or { name, dataUrl }; the right download fires and
// the button reassures you in your own language.

import { useState } from 'react'
import { downloadText, downloadDataUrl } from '../lib/export.js'

export default function SaveButton({ make, icon = '💾', label, title = 'download my copy' }) {
  const [toast, setToast] = useState(null)

  function onClick() {
    let t
    try {
      const out = make()
      if (out?.dataUrl) downloadDataUrl(out.name, out.dataUrl)
      else downloadText(out.name, out.text)
      t = 'saved bhai ✅'
    } catch {
      t = 'failed yaar 😅 retry'
    }
    setToast(t)
    setTimeout(() => setToast(null), 1800)
  }

  return (
    <span className="save-wrap">
      <button type="button" className="save-btn" onClick={onClick} title={title}>
        {icon}
        {label && <span> {label}</span>}
      </button>
      {toast && <span className="save-toast">{toast}</span>}
    </span>
  )
}

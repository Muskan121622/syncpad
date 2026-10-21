// The pad itself: TipTap bound to the shared Y.Doc via y-prosemirror.
// Local history is delegated to the CRDT (StarterKit history disabled), so
// Cmd/Ctrl+Z undoes ONLY your own last edits — the collab-correct behavior.
//
// Two modes:
//   live      — full collab: provider cursors, toolbar, typing
//   readOnly  — frozen snapshot view (no provider, no toolbar) for time-rewind

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { createMoodEngine } from '../lib/moods.js'
import { COLORS } from '../lib/identity.js'
import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

import Toolbar from './Toolbar.jsx'

// 👤 Authorship: every paragraph remembers who LAST typed in it. The name
// lives in a node attribute → it travels inside the CRDT itself, so it syncs
// live, persists across reloads, and even shows up in rewind snapshots.
// (Same trick Google Docs uses for suggestion attribution.)
const AuthorParagraph = Paragraph.extend({
  addAttributes() {
    return {
      author: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-author') || null,
        renderHTML: (attrs) => (attrs.author ? { 'data-author': attrs.author } : {}),
      },
    }
  },
})

// Stamping runs as a ProseMirror appendTransaction, NOT an editor 'update'
// listener: 'update' also fires for REMOTE sync transactions, whose caret
// would re-claim paragraphs nobody typed in (chips would lie on every reload).
// y-prosemirror tags remote-origin transactions with the 'y-sync$' meta, so
// only genuine local edits (typing/paste in THIS browser) claim a line.
const AuthorStamp = Extension.create({
  name: 'authorStamp',
  addOptions() {
    return { getName: () => null }
  },
  addProseMirrorPlugins() {
    const { getName } = this.options
    return [
      new Plugin({
        key: new PluginKey('syncpad-author-stamp'),
        appendTransaction(trs, _old, state) {
          const typed = trs.some(
            (tr) => tr.docChanged && !tr.getMeta('y-sync$')?.isChangeOrigin,
          )
          if (!typed) return
          const name = getName()
          if (!name) return
          const { $head } = state.selection
          const parent = $head.parent
          if (!parent.type.spec.attrs?.author) return // only AuthorParagraph has it
          if (parent.attrs.author === name) return // already mine — no churn
          return state.tr.setNodeMarkup($head.before(), undefined, {
            ...parent.attrs,
            author: name,
          })
        },
      }),
    ]
  },
})

export default function Editor({ ydoc, provider, identity, readOnly = false, onMood, active = true }) {
  // live identity for the stamp plugin (renames / claims apply without re-creating the editor)
  const identityRef = useRef(identity)
  identityRef.current = identity

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        history: false, // CRDT handles undo/redo per-user
        paragraph: false, // replaced by AuthorParagraph below
      }),
      AuthorParagraph,
      AuthorStamp.configure({ getName: () => identityRef.current?.name }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      ...(readOnly
        ? []
        : [
            Placeholder.configure({
              placeholder:
                "Start typing… this pad is live ✦ try double-clicking to react",
            }),
          ]),
      Collaboration.configure({
        document: ydoc,
        field: 'syncpad',
      }),
      ...(provider && !readOnly
        ? [
            CollaborationCursor.configure({
              provider,
              user: { name: identity.name, color: identity.color },
            }),
          ]
        : []),
    ],
    editorProps: {
      attributes: {
        class: readOnly ? 'pad-body is-frozen-body' : 'pad-body',
        spellcheck: 'true',
      },
    },
  })

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // NOTE: awareness 'user' field (incl. lastActive) is owned by App.jsx —
  // don't set it here or we'd clobber the idle-detection timestamp.

  useEffect(() => () => editor?.destroy(), [editor])

  // ── typing-mood engine: watches keystrokes, swaps the cursor emoji and
  // occasionally mutters a Hinglish roast through the name chip.
  const [mood, setMood] = useState(null)
  const onMoodRef = useRef(onMood)
  onMoodRef.current = onMood

  useEffect(() => {
    if (!editor || readOnly || !provider) return
    const engine = createMoodEngine({
      name: identity.name,
      onChange: (m) => {
        setMood(m)
        onMoodRef.current?.(m) // → App publishes it on awareness for the room
      },
    })
    const dom = editor.view.dom
    const onKey = (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') engine.del()
      else if (e.key.length === 1) engine.key() // printable characters
    }
    dom.addEventListener('keydown', onKey)
    return () => {
      dom.removeEventListener('keydown', onKey)
      engine.destroy()
    }
  }, [editor, readOnly, provider, identity.name])

  // ── self cursor name tag: your own name rides next to your caret ──────
  // TipTap only renders labels for REMOTE cursors — we add ours locally.
  // It stays glued to the caret the whole time the pad is focused (popping
  // in on click/focus, hiding on blur) so the mood emoji + roast lines
  // always appear right where you're writing.
  const [caretTag, setCaretTag] = useState(null) // {x, y} viewport coords

  // pad hidden behind another rail tool → the chip must NOT haunt the room
  // (display:none doesn't reliably fire blur, so clear it explicitly)
  useEffect(() => {
    if (!active) setCaretTag(null)
  }, [active])

  // chip color auto-cycles through the palette — no permanent pink era
  const startHue = Math.max(0, COLORS.indexOf(identity.color))
  const [tagHue, setTagHue] = useState(startHue)
  useEffect(() => {
    if (readOnly || !provider) return
    const id = setInterval(() => setTagHue((i) => (i + 1) % COLORS.length), 5000)
    return () => clearInterval(id)
  }, [readOnly, provider])

  useEffect(() => {
    if (!editor || readOnly || !provider) return

    const showTag = () => {
      try {
        const rect = editor.view.coordsAtPos(editor.state.selection.head)
        // anchor to the caret's right edge → chip sits BESIDE the cursor,
        // vertically centered on the text line. Near the window's right
        // margin, flip it to the caret's left so the roast never clips off.
        setCaretTag({
          x: rect.right,
          y: (rect.top + rect.bottom) / 2,
          flip: rect.right > window.innerWidth - 340,
        })
      } catch {
        /* position not visible (e.g. off-screen block) → skip this tick */
      }
    }
    const hideTag = () => setCaretTag(null)

    editor.on('focus', showTag)
    editor.on('selectionUpdate', showTag)
    editor.on('update', showTag)
    editor.on('blur', hideTag)
    document.addEventListener('scroll', showTag, true)
    if (editor.isFocused) showTag()
    return () => {
      editor.off('focus', showTag)
      editor.off('selectionUpdate', showTag)
      editor.off('update', showTag)
      editor.off('blur', hideTag)
      document.removeEventListener('scroll', showTag, true)
    }
  }, [editor, readOnly, provider])

  return (
    <section className={`pad-card${readOnly ? ' is-frozen' : ''}`}>
      {!readOnly && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {!readOnly &&
        active &&
        caretTag &&
        // Portal to <body>: .pad-card's backdrop-filter would otherwise
        // hijack position:fixed coords and fling the chip off the caret.
        createPortal(
          <span
            className={`self-caret-tag${mood?.line ? ' has-line' : ''}${caretTag.flip ? ' is-flipped' : ''}`}
            style={{ left: caretTag.x, top: caretTag.y, '--tag-color': COLORS[tagHue] }}
          >
            {mood?.emoji || identity.emoji} {identity.name}
            {mood?.line && <em className="caret-line">· {mood.line}</em>}
          </span>,
          document.body,
        )}
    </section>
  )
}

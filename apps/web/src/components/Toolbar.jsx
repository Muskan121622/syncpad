// Minimal, chunky formatting bar. Text glyphs only — no icon deps.

function Btn({ editor, label, title, isActive, onClick }) {
  const active = isActive ?? false
  return (
    <button
      type="button"
      className={`tool-btn${active ? ' is-active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep selection while clicking
      onClick={onClick}
      disabled={!editor}
    >
      {label}
    </button>
  )
}

export default function Toolbar({ editor }) {
  if (!editor) return null
  const chain = () => editor.chain().focus()

  const groups = [
    [
      { label: '𝐁', title: 'Bold (Ctrl+B)', active: editor.isActive('bold'), run: () => chain().toggleBold().run() },
      { label: '𝐼', title: 'Italic (Ctrl+I)', active: editor.isActive('italic'), run: () => chain().toggleItalic().run() },
      { label: 'S̶', title: 'Strike', active: editor.isActive('strike'), run: () => chain().toggleStrike().run() },
      { label: '</>', title: 'Inline code', active: editor.isActive('code'), run: () => chain().toggleCode().run() },
    ],
    [
      { label: 'H1', title: 'Heading 1', active: editor.isActive('heading', { level: 1 }), run: () => chain().toggleHeading({ level: 1 }).run() },
      { label: 'H2', title: 'Heading 2', active: editor.isActive('heading', { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
      { label: '❝', title: 'Quote', active: editor.isActive('blockquote'), run: () => chain().toggleBlockquote().run() },
    ],
    [
      { label: '•', title: 'Bullet list', active: editor.isActive('bulletList'), run: () => chain().toggleBulletList().run() },
      { label: '☑', title: 'Checklist', active: editor.isActive('taskList'), run: () => chain().toggleTaskList().run() },
      { label: '▒', title: 'Highlight', active: editor.isActive('highlight'), run: () => chain().toggleHighlight().run() },
      { label: '⌫', title: 'Clear formatting', active: false, run: () => chain().unsetAllMarks().clearNodes().run() },
    ],
  ]

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((group, i) => (
        <div className="tool-group" key={i}>
          {group.map((btn) => (
            <Btn
              key={btn.title}
              editor={editor}
              label={btn.label}
              title={btn.title}
              isActive={btn.active}
              onClick={btn.run}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

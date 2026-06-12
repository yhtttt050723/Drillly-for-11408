import type { PracticeMode } from '../pages/PracticePage'

const MODES: { id: PracticeMode; label: string }[] = [
  { id: 'normal', label: '普通练习' },
  { id: 'wrong_review', label: '刷错题' },
  { id: 'word_dictation', label: '默写单词' },
]

export function PracticeModeTabs({
  value,
  onChange,
}: {
  value: PracticeMode
  onChange: (mode: PracticeMode) => void
}) {
  return (
    <div className="toolbar-section practice-mode-tabs">
      <span className="toolbar-label">模式</span>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`btn${value === m.id ? ' btn-primary' : ''}`}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

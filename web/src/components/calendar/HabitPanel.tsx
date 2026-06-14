import { useState } from 'react'
import type { HabitItem, HabitStore } from '../../lib/planHabits'
import {
  countHabitsDone,
  habitStreak,
  isHabitDone,
  newHabitId,
  removeHabit,
  toggleHabit,
  upsertHabit,
  weekDatesContaining,
} from '../../lib/planHabits'

type Props = {
  habits: HabitStore
  selectedDate: string
  onChange: (next: HabitStore) => void
}

export function HabitPanel({ habits, selectedDate, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftHint, setDraftHint] = useState('')

  const week = weekDatesContaining(selectedDate)
  const doneToday = countHabitsDone(habits, selectedDate)

  const startEdit = (h: HabitItem) => {
    setEditingId(h.id)
    setDraftTitle(h.title)
    setDraftHint(h.hint)
  }

  const saveEdit = () => {
    if (!editingId) return
    onChange(
      upsertHabit(habits, {
        ...habits.habits.find((x) => x.id === editingId)!,
        title: draftTitle.trim() || '新习惯',
        hint: draftHint.trim(),
      }),
    )
    setEditingId(null)
  }

  const addHabit = () => {
    const item: HabitItem = {
      id: newHabitId(),
      title: '新习惯',
      hint: '',
      color: '#1b5e6b',
    }
    onChange(upsertHabit(habits, item))
    startEdit(item)
  }

  return (
    <div className="cal-habit-panel card">
      <div className="cal-habit-head">
        <h3>习惯培养</h3>
        <span className="cal-habit-meta">
          {selectedDate} · 完成 {doneToday}/{habits.habits.length}
        </span>
      </div>

      <div className="cal-habit-week">
        {week.map((d) => {
          const n = countHabitsDone(habits, d)
          const active = d === selectedDate
          return (
            <div key={d} className={`cal-habit-week-cell ${active ? 'active' : ''}`} title={d}>
              <span className="cal-habit-week-d">{d.slice(8)}</span>
              <span className="cal-habit-week-n">{n}</span>
            </div>
          )
        })}
      </div>

      <ul className="cal-habit-list">
        {habits.habits.map((h) => {
          const done = isHabitDone(habits, selectedDate, h.id)
          const streak = habitStreak(habits, h.id, selectedDate)
          const editing = editingId === h.id
          return (
            <li key={h.id} className={`cal-habit-item ${done ? 'done' : ''}`}>
              <button
                type="button"
                className="cal-habit-check"
                style={{ borderColor: h.color, background: done ? h.color : 'transparent' }}
                onClick={() => onChange(toggleHabit(habits, selectedDate, h.id))}
                aria-label={done ? '已完成' : '未完成'}
              />
              <div className="cal-habit-body">
                {editing ? (
                  <>
                    <input
                      className="cal-habit-input"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="习惯名称"
                    />
                    <input
                      className="cal-habit-input cal-habit-input--sm"
                      value={draftHint}
                      onChange={(e) => setDraftHint(e.target.value)}
                      placeholder="说明"
                    />
                    <div className="cal-habit-edit-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={saveEdit}>
                        保存
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button type="button" className="cal-habit-title" onClick={() => startEdit(h)}>
                      {h.title}
                    </button>
                    {h.hint && <span className="cal-habit-hint">{h.hint}</span>}
                    {streak > 0 && <span className="cal-habit-streak">连续 {streak} 天</span>}
                  </>
                )}
              </div>
              {!editing && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(removeHabit(habits, h.id))}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <button type="button" className="btn btn-secondary btn-sm cal-habit-add" onClick={addHabit}>
        + 添加习惯
      </button>
    </div>
  )
}

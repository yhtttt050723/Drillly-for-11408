import { useCallback, useEffect, useRef, useState } from 'react'
import type { Question } from '../api'
import { questionListPreview, questionSource } from '../utils/questionSource'

const ROW_HEIGHT = 58
const OVERSCAN = 6

type Props = {
  questions: Question[]
  activeId: number | null
  onSelect: (id: number) => void
}

export function QuestionSidebar({ questions, activeId, onSelect }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight || 480))
    ro.observe(el)
    setViewportH(el.clientHeight || 480)
    return () => ro.disconnect()
  }, [questions.length])

  useEffect(() => {
    if (activeId == null || !listRef.current) return
    const idx = questions.findIndex((q) => q.id === activeId)
    if (idx < 0) return
    const top = idx * ROW_HEIGHT
    const el = listRef.current
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - ROW_HEIGHT * 2)
      setScrollTop(el.scrollTop)
    }
  }, [activeId, questions])

  const totalH = questions.length * ROW_HEIGHT
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(questions.length, start + visibleCount)
  const slice = questions.slice(start, end)

  return (
    <ul
      ref={listRef}
      className="question-sidebar-list question-sidebar-list--virtual"
      onScroll={onScroll}
    >
      <li className="question-sidebar-spacer" style={{ height: totalH }} aria-hidden="true">
        <div
          className="question-sidebar-window"
          style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
        >
          {slice.map((q) => {
            const { pdf } = questionSource(q)
            const pr = q.practice
            return (
              <div key={q.id} className="question-sidebar-row">
                <button
                  type="button"
                  className={q.id === activeId ? 'q-item active' : 'q-item'}
                  onClick={() => onSelect(q.id)}
                >
                  <span className="q-item-id">
                    #{q.id}
                    {pr?.round1 ? ' ·1✓' : ''}
                    {pr?.round2 ? ' ·2✓' : ''}
                  </span>
                  <span className="q-item-title">{questionListPreview(q)}</span>
                  {pdf ? <span className="q-item-pdf">{pdf}</span> : null}
                </button>
              </div>
            )
          })}
        </div>
      </li>
    </ul>
  )
}

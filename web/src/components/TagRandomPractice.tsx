import { useCallback, useEffect, useState } from 'react'
import type { PracticeSubmitEvent, Question, TagTreeGroup } from '../api'
import { QuestionCard } from './QuestionCard'
import type { PracticeMode } from '../pages/PracticePage'

type Props = {
  questions: Question[]
  filterLabel: string
  practiceRound: 1 | 2
  practiceMode: PracticeMode
  tagTree: TagTreeGroup[]
  roundStatus: '' | 'pending' | 'done'
  selfMarkFilter: '' | 'unmarked' | 'wrong' | 'correct'
  onSubmitted: (evt?: PracticeSubmitEvent) => void
  onExit: () => void
  poolTotal: number
  sessionKey: number
  onActiveQuestionChange?: (q: Question | null) => void
  onEdit?: (q: Question) => void
  onDelete?: (q: Question) => void
}

function pickRandomId(pool: Question[], excludeId: number | null): number {
  if (pool.length === 0) return 0
  if (pool.length === 1) return pool[0].id
  let tries = 0
  while (tries < 12) {
    const q = pool[Math.floor(Math.random() * pool.length)]
    if (q.id !== excludeId) return q.id
    tries++
  }
  return pool[Math.floor(Math.random() * pool.length)].id
}

export function TagRandomPractice({
  questions,
  filterLabel,
  practiceRound,
  practiceMode,
  tagTree,
  roundStatus,
  selfMarkFilter,
  onSubmitted,
  onExit,
  poolTotal,
  sessionKey,
  onActiveQuestionChange,
  onEdit,
  onDelete,
}: Props) {
  const [pool, setPool] = useState<Question[]>(questions)
  const [activeId, setActiveId] = useState<number | null>(null)

  useEffect(() => {
    setPool(questions)
    setActiveId(questions.length ? pickRandomId(questions, null) : null)
  }, [sessionKey])

  useEffect(() => {
    const fresh = new Map(questions.map((q) => [q.id, q]))
    setPool((prev) => {
      const next = prev
        .map((q) => fresh.get(q.id) ?? q)
        .filter((q) => fresh.has(q.id))
      if (next.length !== prev.length || next.some((q, i) => q !== prev[i])) {
        setActiveId((aid) => {
          if (aid && next.some((q) => q.id === aid)) return aid
          return next.length ? pickRandomId(next, null) : null
        })
      }
      return next
    })
  }, [questions])

  const current = pool.find((q) => q.id === activeId) ?? pool[0]

  useEffect(() => {
    onActiveQuestionChange?.(current ?? null)
  }, [current, onActiveQuestionChange])

  const nextRandom = useCallback(() => {
    setActiveId((prev) => (pool.length ? pickRandomId(pool, prev) : null))
  }, [pool])

  const handleSubmitted = (evt?: PracticeSubmitEvent) => {
    const qid = evt?.questionId
    const practice = evt?.practice

    if (qid && practice) {
      const doneForRound = practiceRound === 1 ? practice.round1 : practice.round2
      const dropsFromRound = roundStatus === 'pending' && doneForRound
      const dropsFromSelfMark =
        practiceMode === 'wrong_review' &&
        selfMarkFilter === 'unmarked' &&
        Boolean(qid)

      if (dropsFromRound || dropsFromSelfMark) {
        setPool((prev) => {
          const next = prev.filter((q) => q.id !== qid)
          setActiveId((aid) => {
            if (aid !== qid) return aid
            return next.length ? pickRandomId(next, null) : null
          })
          return next
        })
      } else {
        setPool((prev) =>
          prev.map((q) => (q.id === qid ? { ...q, practice } : q)),
        )
      }
    }

    onSubmitted(evt)

    if (evt?.autoAdvance) {
      const done = practice ? (practiceRound === 1 ? practice.round1 : practice.round2) : false
      const dropsRound = roundStatus === 'pending' && done
      const dropsMark =
        practiceMode === 'wrong_review' &&
        selfMarkFilter === 'unmarked' &&
        Boolean(qid)
      if (!dropsRound && !dropsMark) {
        window.setTimeout(() => nextRandom(), 400)
      }
    }
  }

  if (!pool.length) {
    return (
      <div className="wf-practice-empty card">
        <p>当前筛选下没有可刷题目。</p>
        <button type="button" className="wf-btn-ghost" onClick={onExit}>
          返回列表
        </button>
      </div>
    )
  }

  return (
    <div className="wf-random-practice tag-random-practice">
      <div className="wf-random-bar">
        <span className="wf-random-mode" title={filterLabel}>
          随机刷题 · {filterLabel || '全部题目'}
        </span>
        <span className="tag-random-pool muted">
          池内 {pool.length}
          {poolTotal > pool.length ? ` / 共 ${poolTotal}` : ''} 题
        </span>
        <button type="button" className="wf-btn-ghost" onClick={nextRandom}>
          换一题
        </button>
        <button type="button" className="wf-btn-ghost" onClick={onExit}>
          返回列表
        </button>
      </div>
      {poolTotal > pool.length && (
        <p className="tag-random-cap muted">
          已载入前 {pool.length} 题（题库共 {poolTotal} 题，超出部分未纳入本次随机池）
        </p>
      )}
      {current && (
        <QuestionCard
          key={current.id}
          q={current}
          tagGroups={tagTree}
          practiceRound={practiceRound}
          onSubmitted={handleSubmitted}
          onEdit={onEdit ? () => onEdit(current) : undefined}
          onDelete={onDelete ? () => onDelete(current) : undefined}
        />
      )}
    </div>
  )
}

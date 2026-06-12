import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PracticeSubmitEvent, Question, TagTreeGroup } from '../../api'
import { QuestionCard } from '../QuestionCard'
import { buildWordDeck, drawNextWordId } from '../../utils/wordRandomPool'
import type { DictationDirection } from './WordForestSidebar.types'

type Props = {
  questions: Question[]
  direction: DictationDirection
  onSubmitted: (evt?: PracticeSubmitEvent) => void
  onExit: () => void
  practiceRound: 1 | 2
  tagTree: TagTreeGroup[]
}

export function WordRandomPractice({
  questions,
  direction,
  onSubmitted,
  onExit,
  practiceRound,
  tagTree,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(null)
  const idsRef = useRef<number[]>([])
  const deckRef = useRef<number[]>([])

  const idsKey = useMemo(
    () =>
      questions
        .map((q) => q.id)
        .sort((a, b) => a - b)
        .join(','),
    [questions],
  )

  const initPool = useCallback((ids: number[]) => {
    idsRef.current = ids
    if (!ids.length) {
      deckRef.current = []
      setActiveId(null)
      return
    }
    const fresh = buildWordDeck(ids, null)
    deckRef.current = fresh.slice(1)
    setActiveId(fresh[0] ?? ids[0])
  }, [])

  // 仅词库 ID 集合或默写方向变化时重洗；单次提交刷新题目内容不应换词
  useEffect(() => {
    initPool(
      idsKey
        ? idsKey.split(',').map((s) => Number(s))
        : [],
    )
  }, [idsKey, direction, initPool])

  const current = questions.find((q) => q.id === activeId) ?? questions[0]

  const nextRandom = useCallback(() => {
    const ids = idsRef.current
    if (!ids.length) return
    setActiveId((currentId) => {
      const { nextId, nextDeck } = drawNextWordId(ids, deckRef.current, currentId)
      deckRef.current = nextDeck
      return nextId
    })
  }, [])

  const handleSubmitted = (evt?: PracticeSubmitEvent) => {
    onSubmitted(evt)
    if (evt?.autoAdvance === true && evt.isCorrect === true) {
      nextRandom()
    }
  }

  const handleManualNext = () => {
    nextRandom()
  }

  if (!questions.length) {
    return (
      <div className="wf-practice-empty card">
        <p>词库为空，请先在右侧导入错词。</p>
        <button type="button" className="wf-btn-ghost" onClick={onExit}>
          返回看板
        </button>
      </div>
    )
  }

  return (
    <div className="wf-random-practice">
      <div className="wf-random-bar">
        <span className="wf-random-mode">
          随机默写 · {direction === 'zh2en' ? '看中写英' : '看英写中'}
        </span>
        <button type="button" className="wf-btn-ghost" onClick={handleManualNext}>
          换一词
        </button>
        <button type="button" className="wf-btn-ghost" onClick={onExit}>
          返回看板
        </button>
      </div>
      {current && (
        <QuestionCard
          key={`${current.id}-${direction}`}
          q={current}
          tagGroups={tagTree}
          practiceRound={practiceRound}
          onSubmitted={handleSubmitted}
          dictationDirection={direction}
          wordForestMinimal
          autoFocusWordInput
        />
      )}
    </div>
  )
}

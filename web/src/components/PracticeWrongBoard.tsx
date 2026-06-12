import { memo, useCallback, useEffect, useState } from 'react'
import { api, type WrongBoardItem } from '../api'
import { ListPager } from './ListPager'

const PAGE_SIZE = 60

type Props = {
  sourcePdf?: string
  tagFilter?: string
  refreshKey?: number
  onQuestionClick: (questionId: number) => void
  onExit: () => void
}

const BoardCard = memo(function BoardCard({
  item,
  onClick,
}: {
  item: WrongBoardItem
  onClick: (id: number) => void
}) {
  const tagLine = item.tags
    .map((t) => (t.name.includes('/') ? t.name.split('/').pop()! : t.name))
    .filter((n) => !n.startsWith('来源·'))
    .slice(0, 3)
    .join(' · ')

  return (
    <li>
      <button type="button" className="wf-board-card practice-wrong-card" onClick={() => onClick(item.question_id)}>
        <span className="wf-board-card-no">#{item.question_id}</span>
        <span className="wf-board-card-word practice-wrong-card-title">{item.title}</span>
        <span className="wf-board-card-meaning">{item.stem_preview || item.chapter || '—'}</span>
        {tagLine && (
          <span className="practice-wrong-card-tags" title={item.tags.map((t) => t.name).join(', ')}>
            {tagLine}
          </span>
        )}
        <span className="wf-board-badge wf-board-badge--wrong">
          错×{item.wrong_count}
          {item.last_answer ? ` · ${item.last_answer}` : ''}
        </span>
      </button>
    </li>
  )
})

export function PracticeWrongBoard({
  sourcePdf,
  tagFilter,
  refreshKey = 0,
  onQuestionClick,
  onExit,
}: Props) {
  const [days, setDays] = useState<1 | 7>(1)
  const [items, setItems] = useState<WrongBoardItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    api
      .practiceWrongBoard({
        days,
        sourcePdf,
        tags: tagFilter,
        limit: PAGE_SIZE,
        offset,
      })
      .then((r) => {
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setBusy(false))
  }, [days, sourcePdf, tagFilter, offset])

  useEffect(() => {
    setOffset(0)
  }, [days, sourcePdf, tagFilter])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  return (
    <div className="card wf-unit-board practice-wrong-board">
      <header className="wf-unit-board-head">
        <div>
          <h2 className="wf-unit-board-title">错题看板</h2>
          <p className="wf-unit-board-meta muted">
            {busy ? '加载中…' : `共 ${total} 题有做错记录`}
            {sourcePdf ? ` · ${sourcePdf.replace(/\.pdf$/i, '')}` : ''}
          </p>
        </div>
        <button type="button" className="wf-btn-ghost" onClick={onExit}>
          ← 返回刷题
        </button>
      </header>

      <div className="wf-board-tabs" role="tablist" aria-label="错题时间范围">
        <button
          type="button"
          role="tab"
          aria-selected={days === 1}
          className={days === 1 ? 'wf-board-tab active' : 'wf-board-tab'}
          onClick={() => setDays(1)}
        >
          今日
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={days === 7}
          className={days === 7 ? 'wf-board-tab active' : 'wf-board-tab'}
          onClick={() => setDays(7)}
        >
          近 7 天
        </button>
      </div>

      {err && <p className="practice-alert">{err}</p>}

      {!busy && items.length === 0 && (
        <p className="wf-board-empty muted">
          {days === 1 ? '今日暂无做错记录，继续保持。' : '近 7 天暂无做错记录。'}
        </p>
      )}

      <ul className="wf-board-grid">
        {items.map((item, i) => (
          <BoardCard key={item.question_id} item={item} onClick={onQuestionClick} />
        ))}
      </ul>

      <ListPager
        className="wf-board-pager"
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
      />

      <p className="wf-board-hint muted">点击卡片回到该题继续练；标签与右侧筛选一致。</p>
    </div>
  )
}

import { memo, useCallback, useEffect, useState } from 'react'
import { api, type WordItem } from '../../api'
import { ListPager } from '../ListPager'

const PAGE_SIZE = 50

type Props = {
  book: string
  unit: string
  search?: string
  wrongOnly?: '' | 'wrong' | 'correct' | 'unmarked'
  onWordClick: (wordId: number) => void
  onTotalChange?: (total: number) => void
  refreshKey?: number
}

function statusBadge(w: WordItem): { label: string; className: string } | null {
  if (w.has_wrong_tag || w.last_mark === 'wrong') {
    return { label: '错', className: 'wf-board-badge wf-board-badge--wrong' }
  }
  if (w.round2) return { label: '二刷', className: 'wf-board-badge wf-board-badge--r2' }
  if (w.round1) return { label: '一刷', className: 'wf-board-badge wf-board-badge--r1' }
  if ((w.practice_history_count ?? 0) > 0) {
    return { label: '曾刷', className: 'wf-board-badge wf-board-badge--hist' }
  }
  if (w.last_mark === 'correct') {
    return { label: '对', className: 'wf-board-badge wf-board-badge--ok' }
  }
  return null
}

const BoardCard = memo(function BoardCard({
  w,
  index,
  onWordClick,
}: {
  w: WordItem
  index: number
  onWordClick: (id: number) => void
}) {
  const badge = statusBadge(w)
  return (
    <li>
      <button type="button" className="wf-board-card" onClick={() => onWordClick(w.id)}>
        <span className="wf-board-card-no">{index}</span>
        <span className="wf-board-card-word">{w.word}</span>
        <span className="wf-board-card-meaning">{w.meaning || '—'}</span>
        {badge && <span className={badge.className}>{badge.label}</span>}
      </button>
    </li>
  )
})

export function WordUnitBoard({
  book,
  unit,
  search = '',
  wrongOnly = '',
  onWordClick,
  onTotalChange,
  refreshKey = 0,
}: Props) {
  const [items, setItems] = useState<WordItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [tagFilter, setTagFilter] = useState('')
  const [unitTags, setUnitTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!unit) {
      setUnitTags([])
      return
    }
    api.listWordUnitTags({ book, unit }).then((r) => setUnitTags(r.tags || [])).catch(() => setUnitTags([]))
  }, [book, unit, refreshKey])

  useEffect(() => {
    setOffset(0)
    setTagFilter('')
  }, [book, unit])

  const load = useCallback(() => {
    if (!unit) {
      setItems([])
      setTotal(0)
      onTotalChange?.(0)
      return
    }
    setBusy(true)
    setErr('')
    const tag = tagFilter ? (tagFilter.includes('/') ? tagFilter : `${book}/${tagFilter}`) : ''
    api
      .listWords({
        q: debouncedSearch.trim(),
        book,
        unit,
        tag: tag || undefined,
        wrong_only: wrongOnly || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((r) => {
        setItems(r.items)
        setTotal(r.total)
        onTotalChange?.(r.total)
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : '加载失败')
        setItems([])
        setTotal(0)
        onTotalChange?.(0)
      })
      .finally(() => setBusy(false))
  }, [book, unit, debouncedSearch, wrongOnly, tagFilter, offset, onTotalChange])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (!unit) {
    return (
      <div className="card wf-unit-board wf-unit-board--empty">
        <p>
          <strong>单元单词看板</strong>
        </p>
        <p className="muted">请在右侧选择词书与 Unit，查看本单元全部单词并背诵。</p>
      </div>
    )
  }

  return (
    <div className="card wf-unit-board">
      <header className="wf-unit-board-head">
        <div>
          <h2 className="wf-unit-board-title">
            {book ? `${book} · ` : ''}Unit {unit}
          </h2>
          <p className="wf-unit-board-meta muted">
            {busy ? '加载中…' : `共 ${total} 词`}
            {tagFilter ? ` · 标签「${tagFilter}」` : ''}
          </p>
        </div>
      </header>

      {unitTags.length > 0 && (
        <div className="wf-board-tabs" role="tablist" aria-label="单词标签">
          <button
            type="button"
            role="tab"
            aria-selected={!tagFilter}
            className={!tagFilter ? 'wf-board-tab active' : 'wf-board-tab'}
            onClick={() => {
              setTagFilter('')
              setOffset(0)
            }}
          >
            全部
          </button>
          {unitTags.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tagFilter === t}
              className={tagFilter === t ? 'wf-board-tab active' : 'wf-board-tab'}
              onClick={() => {
                setTagFilter(t)
                setOffset(0)
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {err && (
        <p className="practice-alert">
          {err.includes('fetch') || err.includes('Failed') || err.includes('ECONNREFUSED')
            ? '无法连接 API（端口 5213）— 请运行 Start-Drillly-API.bat'
            : err}
        </p>
      )}

      <ul className="wf-board-grid">
        {items.map((w, i) => (
          <BoardCard key={w.id} w={w} index={offset + i + 1} onWordClick={onWordClick} />
        ))}
      </ul>

      {!busy && items.length === 0 && (
        <p className="wf-board-empty muted">本单元暂无匹配单词。</p>
      )}

      <ListPager
        className="wf-board-pager"
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
      />

      <p className="wf-board-hint muted">点击单词进入默写；长按 Shift 显示答案；右侧可开始随机默写。</p>
    </div>
  )
}

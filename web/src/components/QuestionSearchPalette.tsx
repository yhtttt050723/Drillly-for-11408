import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Question } from '../api'
import { questionListPreview, questionSource } from '../utils/questionSource'

type Props = {
  open: boolean
  onClose: () => void
  /** 与练习页一致的筛选（不含 search） */
  filterParams: URLSearchParams
  onSelect: (question: Question, query: string) => void
}

export function QuestionSearchPalette({ open, onClose, filterParams, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Question[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActiveIdx(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  const filterKey = filterParams.toString()

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const t = window.setTimeout(() => {
      setLoading(true)
      const p = new URLSearchParams(filterParams)
      if (q) p.set('search', q)
      p.set('limit', '50')
      p.set('order', 'id')
      api
        .listPracticeQuestions(p)
        .then((rows) => {
          setResults(Array.isArray(rows) ? rows : rows.items)
          setActiveIdx(0)
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => window.clearTimeout(t)
  }, [open, query, filterKey, filterParams])

  const pick = useCallback(
    (q: Question) => {
      onSelect(q, query.trim())
      onClose()
    },
    [onSelect, onClose, query],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => (results.length ? (i + 1) % results.length : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) =>
          results.length ? (i - 1 + results.length) % results.length : 0,
        )
        return
      }
      if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault()
        pick(results[activeIdx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, activeIdx, pick, onClose])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIdx, results.length])

  if (!open) return null

  return (
    <div
      className="search-palette-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="搜索题目"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-palette-input-row">
          <span className="search-palette-kbd">Ctrl</span>
          <span className="search-palette-kbd">Q</span>
          <input
            ref={inputRef}
            type="search"
            className="search-palette-input"
            placeholder="输入题干或选项中的部分文字…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索关键词"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="search-palette-close" onClick={onClose} aria-label="关闭">
            Esc
          </button>
        </div>
        <div className="search-palette-hint muted">
          {loading
            ? '搜索中…'
            : query.trim()
              ? `共 ${results.length} 条（↑↓ 选择 · Enter 跳转 · Esc 关闭）`
              : '输入关键词筛选；留空显示当前筛选下前 50 题'}
        </div>
        <ul className="search-palette-results" ref={listRef}>
          {results.map((q, i) => {
            const { pdf } = questionSource(q)
            return (
              <li key={q.id}>
                <button
                  type="button"
                  className={i === activeIdx ? 'palette-item active' : 'palette-item'}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pick(q)}
                >
                  <span className="palette-item-id">#{q.id}</span>
                  <span className="palette-item-title">{questionListPreview(q)}</span>
                  {pdf ? <span className="palette-item-pdf">{pdf}</span> : null}
                </button>
              </li>
            )
          })}
          {!loading && query.trim() && results.length === 0 && (
            <li className="search-palette-empty">无匹配题目</li>
          )}
        </ul>
      </div>
    </div>
  )
}

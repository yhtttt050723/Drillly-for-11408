import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'

type Props = {
  book: string
  unit: string
  onBookChange: (v: string) => void
  onUnitChange: (v: string) => void
  onUnitPractice: () => void
  onJumpToQuestion: (questionId: number) => void
  onWordAdded: () => void
  practiceCount: number
  onResetUnit?: () => void
  resetBusy?: boolean
}

export function WordPracticeTools({
  book,
  unit,
  onBookChange,
  onUnitChange,
  onUnitPractice,
  onJumpToQuestion,
  onWordAdded,
  practiceCount,
  onResetUnit,
  resetBusy,
}: Props) {
  const [books, setBooks] = useState<string[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<{ id: number; word: string; meaning: string }[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [quickWord, setQuickWord] = useState('')
  const [quickMeaning, setQuickMeaning] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const loadMeta = useCallback(() => {
    Promise.all([api.listWordBooks(), api.listWordUnits()]).then(([b, u]) => {
      setBooks(b.books.length ? b.books : ['基础词', '必考词'])
      setUnits(u.units)
    })
  }, [])

  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 1) {
      setSearchHits([])
      setSearchOpen(false)
      return
    }
    const t = window.setTimeout(() => {
      api
        .listWords({ q, book, unit, limit: 12 })
        .then((r) => {
          setSearchHits(
            r.items.map((w) => ({ id: w.id, word: w.word, meaning: w.meaning })),
          )
          setSearchOpen(true)
        })
        .catch(() => setSearchHits([]))
    }, 250)
    return () => window.clearTimeout(t)
  }, [searchQ, book, unit])

  const quickAdd = async () => {
    const w = quickWord.trim()
    if (!w) {
      setMsg('请填写英文')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      await api.createWord({
        word: w,
        meaning: quickMeaning.trim(),
        unit: unit.trim(),
        book: book.trim() || '基础词',
      })
      setQuickWord('')
      setQuickMeaning('')
      setQuickOpen(false)
      setMsg(`已添加 ${w}`)
      onWordAdded()
      loadMeta()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wf-practice-tools">
      <p className="wf-random-title">按单元 / 搜词 / 添加</p>

      <div className="wf-filter-row">
        <select
          className="wf-unit-select"
          value={book}
          onChange={(e) => onBookChange(e.target.value)}
          aria-label="词书"
        >
          <option value="">全部词书</option>
          {books.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          className="wf-unit-select"
          value={unit}
          onChange={(e) => onUnitChange(e.target.value)}
          aria-label="Unit"
        >
          <option value="">全部 Unit</option>
          {units.map((u) => (
            <option key={u} value={u}>
              Unit {u}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="wf-btn-unit"
        disabled={!unit || practiceCount < 1}
        onClick={onUnitPractice}
        title="按所选 Unit 顺序默写（非随机）"
      >
        {unit ? `按 Unit ${unit} 刷（${practiceCount}）` : '请先选择 Unit'}
      </button>

      {onResetUnit && (
        <button
          type="button"
          className="wf-btn-reset"
          disabled={!unit || resetBusy}
          onClick={onResetUnit}
          title="清零本单元一刷/二刷标记；历次进度归档保留，提交记录不删"
        >
          {resetBusy ? '重刷中…' : '重刷本单元'}
        </button>
      )}

      <div className="wf-search-wrap">
        <input
          type="search"
          className="wf-search"
          placeholder="搜索单词跳转…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onFocus={() => searchHits.length && setSearchOpen(true)}
        />
        {searchOpen && searchHits.length > 0 && (
          <ul className="wf-search-dropdown">
            {searchHits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJumpToQuestion(h.id)
                    setSearchQ(h.word)
                    setSearchOpen(false)
                  }}
                >
                  <strong>{h.word}</strong>
                  {h.meaning ? <span className="muted"> — {h.meaning.slice(0, 40)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="wf-btn-ghost wf-btn-quick-toggle"
        onClick={() => setQuickOpen((v) => !v)}
      >
        {quickOpen ? '收起添加' : '+ 快捷添加单词'}
      </button>
      {quickOpen && (
        <div className="wf-quick-add">
          <input
            placeholder="英文 *"
            value={quickWord}
            onChange={(e) => setQuickWord(e.target.value)}
          />
          <input
            placeholder="释义"
            value={quickMeaning}
            onChange={(e) => setQuickMeaning(e.target.value)}
          />
          <button type="button" className="wf-btn-ghost" disabled={busy} onClick={quickAdd}>
            保存
          </button>
        </div>
      )}
      {msg && <p className="wf-msg">{msg}</p>}
    </div>
  )
}

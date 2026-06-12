import { useCallback, useEffect, useState } from 'react'
import { api, type WordItem, type WordPatchBody } from '../../api'
import { ListPager } from '../ListPager'
import { WordTagPanel } from './WordTagPanel'

const LIB_PAGE_SIZE = 50

type Props = {
  onChanged: () => void
}

const emptyForm = (): WordPatchBody & { word: string } => ({
  word: '',
  meaning: '',
  unit: '',
  book: '',
  phonetic: '',
  hint: '',
  source_label: '',
})

function parseApiError(e: unknown): string {
  if (!(e instanceof Error)) return '操作失败'
  try {
    const j = JSON.parse(e.message) as { detail?: string }
    if (typeof j.detail === 'string') return j.detail
  } catch {
    /* ignore */
  }
  return e.message || '操作失败'
}

function MeaningCell({ text }: { text: string }) {
  if (!text) return <>—</>
  const parts = text.split(/(\b(?:n|v|adj|adv|prep|conj|pron|art|num|int)\.\s*)/gi)
  return (
    <>
      {parts.map((p, i) =>
        /^(n|v|adj|adv|prep|conj|pron|art|num|int)\.\s*$/i.test(p) ? (
          <span key={i} className="wf-pos">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function WordLibraryTab({ onChanged }: Props) {
  const [items, setItems] = useState<WordItem[]>([])
  const [total, setTotal] = useState(0)
  const [units, setUnits] = useState<string[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [wrongFilter, setWrongFilter] = useState<'' | 'wrong'>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<WordItem | null>(null)
  const [tagWord, setTagWord] = useState<WordItem | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [listOffset, setListOffset] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ), 300)
    return () => window.clearTimeout(t)
  }, [searchQ])

  useEffect(() => {
    setListOffset(0)
  }, [debouncedQ, bookFilter, unitFilter, wrongFilter])

  const load = useCallback(() => {
    setBusy(true)
    Promise.all([
      api.listWords({
        q: debouncedQ.trim(),
        book: bookFilter,
        unit: unitFilter,
        wrong_only: wrongFilter || undefined,
        limit: LIB_PAGE_SIZE,
        offset: listOffset,
      }),
      api.listWordUnits(),
    ])
      .then(([list, u]) => {
        setItems(list.items)
        setTotal(list.total)
        setUnits(u.units)
      })
      .catch(() => {
        setItems([])
        setTotal(0)
      })
      .finally(() => setBusy(false))
  }, [debouncedQ, bookFilter, unitFilter, wrongFilter, listOffset])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setTagWord(null)
    setForm(emptyForm())
    setFormOpen(true)
    setMsg('')
  }

  const openEdit = (w: WordItem) => {
    setEditing(w)
    setTagWord(null)
    setForm({
      word: w.word,
      meaning: w.meaning,
      unit: w.unit,
      book: w.book,
      phonetic: w.phonetic,
      hint: w.hint,
      source_label: w.source_label,
    })
    setFormOpen(true)
    setMsg('')
  }

  const saveForm = async () => {
    if (!form.word?.trim()) {
      setMsg('请填写英文单词')
      return
    }
    setBusy(true)
    try {
      if (editing) await api.updateWord(editing.id, form)
      else await api.createWord(form)
      setFormOpen(false)
      setEditing(null)
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (w: WordItem) => {
    if (!window.confirm(`移除「${w.word}」？`)) return
    setBusy(true)
    try {
      await api.deleteWord(w.id)
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  const markWrong = async (w: WordItem) => {
    setBusy(true)
    try {
      await api.markWordWrong(w.id)
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  const clearWrong = async (w: WordItem) => {
    setBusy(true)
    try {
      await api.clearWordWrong(w.id)
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wf-library">
      <div className="wf-library-toolbar">
        <input
          type="search"
          className="wf-search"
          placeholder="搜索单词…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <select
          className="wf-unit-select"
          value={bookFilter}
          onChange={(e) => setBookFilter(e.target.value)}
        >
          <option value="">全部词书</option>
          <option value="基础词">基础词</option>
          <option value="必考词">必考词</option>
        </select>
        <select
          className="wf-unit-select"
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
        >
          <option value="">全部 Unit</option>
          {units.map((u) => (
            <option key={u} value={u}>
              Unit {u}
            </option>
          ))}
        </select>
        <label className="wf-filter-wrong">
          <input
            type="checkbox"
            checked={wrongFilter === 'wrong'}
            onChange={(e) => setWrongFilter(e.target.checked ? 'wrong' : '')}
          />
          仅错词
        </label>
        <button type="button" className="wf-btn-ghost" onClick={openCreate}>
          + 添加
        </button>
      </div>

      <p className="wf-library-meta">
        共 <strong>{total}</strong> 词
        <button type="button" className="wf-btn-ghost wf-btn-refresh" onClick={load} disabled={busy}>
          刷新
        </button>
      </p>

      {formOpen && (
        <div className="wf-inline-form">
          <input
            placeholder="单词 *"
            value={form.word}
            onChange={(e) => setForm({ ...form, word: e.target.value })}
          />
          <input
            placeholder="释义"
            value={form.meaning || ''}
            onChange={(e) => setForm({ ...form, meaning: e.target.value })}
          />
          <select value={form.book || ''} onChange={(e) => setForm({ ...form, book: e.target.value })}>
            <option value="">词书</option>
            <option value="基础词">基础词</option>
            <option value="必考词">必考词</option>
          </select>
          <input
            placeholder="Unit"
            value={form.unit || ''}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
          />
          <div className="wf-inline-form-actions">
            <button type="button" className="wf-btn-ghost" onClick={saveForm} disabled={busy}>
              保存
            </button>
            <button
              type="button"
              className="wf-btn-ghost"
              onClick={() => {
                setFormOpen(false)
                setEditing(null)
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {tagWord && (
        <WordTagPanel
          word={tagWord}
          onClose={() => setTagWord(null)}
          onSaved={() => {
            load()
            onChanged()
          }}
        />
      )}

      <div className="wf-table-head">
        <span className="wf-col-no">#</span>
        <span className="wf-col-word">单词</span>
        <span className="wf-col-meaning">释义</span>
        <span className="wf-col-op">操作</span>
      </div>

      <ul className="wf-word-list">
        {items.length === 0 && (
          <li className="wf-word-empty">{busy ? '加载中…' : '暂无单词'}</li>
        )}
        {items.map((w, idx) => (
          <li key={w.id} className="wf-word-row">
            <span className="wf-col-no">{listOffset + idx + 1}</span>
            <div className="wf-col-word">
              <button type="button" className="wf-word-link" onClick={() => openEdit(w)}>
                {w.word}
              </button>
              {(w.has_wrong_tag || (w.wrong_count ?? 0) > 0) && (
                <span className="wf-wrong-badge">错×{w.wrong_count || 1}</span>
              )}
              {(w.book || w.unit) && (
                <div className="wf-phonetic">
                  {[w.book, w.unit ? `Unit ${w.unit}` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
              {w.phonetic && <div className="wf-phonetic">{w.phonetic}</div>}
            </div>
            <div className="wf-col-meaning" title={w.meaning}>
              <MeaningCell text={w.meaning} />
            </div>
            <span className="wf-col-op wf-col-op-stack">
              <button type="button" className="wf-btn-ghost wf-btn-tiny" onClick={() => setTagWord(w)}>
                标签
              </button>
              {w.has_wrong_tag ? (
                <button type="button" className="wf-btn-ghost wf-btn-tiny" onClick={() => clearWrong(w)}>
                  移出错本
                </button>
              ) : (
                <button type="button" className="wf-btn-ghost wf-btn-tiny" onClick={() => markWrong(w)}>
                  记入错词
                </button>
              )}
              <button type="button" className="wf-remove" onClick={() => remove(w)}>
                移除
              </button>
            </span>
          </li>
        ))}
      </ul>

      <ListPager
        className="wf-library-pager"
        total={total}
        limit={LIB_PAGE_SIZE}
        offset={listOffset}
        onChange={setListOffset}
      />

      {msg && <p className="wf-msg">{msg}</p>}
    </div>
  )
}

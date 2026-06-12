import { useCallback, useEffect, useState } from 'react'
import { api, type WordItem, type WordPatchBody } from '../api'

type Props = {
  onChanged: () => void
}

const emptyForm = (): WordPatchBody & { word: string } => ({
  word: '',
  meaning: '',
  unit: '',
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
    /* plain text */
  }
  return e.message || '操作失败'
}

export function WordManagePanel({ onChanged }: Props) {
  const [open, setOpen] = useState(true)
  const [items, setItems] = useState<WordItem[]>([])
  const [total, setTotal] = useState(0)
  const [units, setUnits] = useState<string[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [editing, setEditing] = useState<WordItem | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ), 300)
    return () => window.clearTimeout(t)
  }, [searchQ])

  const load = useCallback(() => {
    setBusy(true)
    Promise.all([
      api.listWords({ q: debouncedQ.trim(), unit: unitFilter, limit: 300 }),
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
  }, [debouncedQ, unitFilter])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
    setMsg('')
  }

  const openEdit = (w: WordItem) => {
    setEditing(w)
    setForm({
      word: w.word,
      meaning: w.meaning,
      unit: w.unit,
      phonetic: w.phonetic,
      hint: w.hint,
      source_label: w.source_label,
    })
    setFormOpen(true)
    setMsg('')
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
  }

  const saveForm = async () => {
    if (!form.word?.trim()) {
      setMsg('请填写英文单词')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      if (editing) {
        await api.updateWord(editing.id, form)
        setMsg(`已更新：${form.word}`)
      } else {
        await api.createWord(form)
        setMsg(`已添加：${form.word}`)
      }
      closeForm()
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (w: WordItem) => {
    if (!window.confirm(`确定删除「${w.word}」？相关练习记录会一并清除。`)) return
    setBusy(true)
    setMsg('')
    try {
      await api.deleteWord(w.id)
      setMsg(`已删除：${w.word}`)
      if (editing?.id === w.id) closeForm()
      load()
      onChanged()
    } catch (e) {
      setMsg(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="word-manage-panel card">
      <div className="word-manage-head">
        <button
          type="button"
          className="word-manage-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} 词库管理（增删改查）
        </button>
        <span className="word-manage-count">
          共 <strong>{total}</strong> 词
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate} disabled={busy}>
          添加单词
        </button>
      </div>

      {open && (
        <>
          <div className="word-manage-filters">
            <input
              type="search"
              className="word-manage-search"
              placeholder="搜索单词或释义…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
              <option value="">全部 Unit</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  Unit {u}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" onClick={load} disabled={busy}>
              刷新
            </button>
          </div>

          {formOpen && (
            <div className="word-manage-form">
              <h4>{editing ? `编辑 #${editing.id}` : '添加单词'}</h4>
              <div className="word-manage-form-grid">
                <label>
                  单词 *
                  <input
                    value={form.word}
                    onChange={(e) => setForm({ ...form, word: e.target.value })}
                    placeholder="inspect"
                  />
                </label>
                <label>
                  释义
                  <input
                    value={form.meaning || ''}
                    onChange={(e) => setForm({ ...form, meaning: e.target.value })}
                    placeholder="检查；视察"
                  />
                </label>
                <label>
                  Unit
                  <input
                    value={form.unit || ''}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="15"
                  />
                </label>
                <label>
                  音标
                  <input
                    value={form.phonetic || ''}
                    onChange={(e) => setForm({ ...form, phonetic: e.target.value })}
                  />
                </label>
                <label>
                  助记
                  <input
                    value={form.hint || ''}
                    onChange={(e) => setForm({ ...form, hint: e.target.value })}
                  />
                </label>
                <label>
                  出处
                  <input
                    value={form.source_label || ''}
                    onChange={(e) => setForm({ ...form, source_label: e.target.value })}
                  />
                </label>
              </div>
              <div className="word-manage-form-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={saveForm} disabled={busy}>
                  保存
                </button>
                <button type="button" className="btn btn-sm" onClick={closeForm}>
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="word-manage-table-wrap">
            <table className="word-manage-table">
              <thead>
                <tr>
                  <th>单词</th>
                  <th>释义</th>
                  <th>Unit</th>
                  <th>出处</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="word-manage-empty">
                      {busy ? '加载中…' : '暂无单词，可添加或从上方导入'}
                    </td>
                  </tr>
                )}
                {items.map((w) => (
                  <tr key={w.id} className={editing?.id === w.id ? 'word-manage-row-active' : ''}>
                    <td>
                      <strong>{w.word}</strong>
                      {w.phonetic && <span className="word-manage-phonetic"> {w.phonetic}</span>}
                    </td>
                    <td title={w.meaning}>{w.meaning || '—'}</td>
                    <td>{w.unit ? `U${w.unit}` : '—'}</td>
                    <td className="word-manage-source" title={w.source_label}>
                      {w.source_label || w.import_source || '—'}
                    </td>
                    <td className="word-manage-actions">
                      <button type="button" className="btn-link" onClick={() => openEdit(w)}>
                        编辑
                      </button>
                      <button type="button" className="btn-link btn-link-danger" onClick={() => remove(w)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {msg && <p className="word-import-msg">{msg}</p>}
        </>
      )}
    </div>
  )
}

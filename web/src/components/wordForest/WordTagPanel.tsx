import { useEffect, useState } from 'react'
import { api, type WordItem } from '../../api'

type Props = {
  word: WordItem
  onSaved: () => void
  onClose: () => void
}

export function WordTagPanel({ word, onSaved, onClose }: Props) {
  const [book, setBook] = useState(word.book || '')
  const [unit, setUnit] = useState(word.unit || '')
  const [extraTags, setExtraTags] = useState('')
  const [catalog, setCatalog] = useState<string[]>([])
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeTo, setMergeTo] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setBook(word.book || '')
    setUnit(word.unit || '')
    const small = word.small_tags || []
    const skip = new Set([word.book, word.unit ? `Unit${word.unit}`.replace(/ /g, '') : '', '错词'])
    setExtraTags(small.filter((t) => !skip.has(t)).join(', '))
  }, [word])

  useEffect(() => {
    api.listWordTagCatalog().then((c) => setCatalog(c.children)).catch(() => {})
  }, [])

  const saveTags = async () => {
    setBusy(true)
    setMsg('')
    try {
      const small = extraTags
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      await api.setWordTags(word.id, {
        book: book.trim(),
        unit: unit.trim(),
        small_tags: small,
        keep_wrong_tag: true,
      })
      setMsg('标签已保存')
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const runMergeTags = async () => {
    if (!mergeFrom.trim() || !mergeTo.trim()) return
    setBusy(true)
    try {
      const r = await api.mergeWordTags({
        from_name: mergeFrom.trim(),
        to_name: mergeTo.trim(),
      })
      setMsg(`已合并标签：${r.updated} 条词更新 → ${r.merged}`)
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '合并失败')
    } finally {
      setBusy(false)
    }
  }

  const runMergeEntry = async () => {
    const sid = Number(mergeTargetId)
    if (!sid) return
    if (!window.confirm(`将词 #${sid} 合并进「${word.word}」并删除 #${sid}？`)) return
    setBusy(true)
    try {
      await api.mergeWordEntries({ target_id: word.id, source_id: sid })
      setMsg('词条已合并')
      onSaved()
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '合并失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wf-tag-panel">
      <p className="wf-tag-panel-title">
        标签 · <strong>{word.word}</strong>
        {(word.wrong_count ?? 0) > 0 && (
          <span className="wf-wrong-badge">错 {word.wrong_count}</span>
        )}
      </p>
      <label className="wf-tag-field">
        词书
        <select value={book} onChange={(e) => setBook(e.target.value)}>
          <option value="">（无）</option>
          <option value="基础词">基础词</option>
          <option value="必考词">必考词</option>
          {book && book !== '基础词' && book !== '必考词' && (
            <option value={book}>{book}</option>
          )}
        </select>
      </label>
      <label className="wf-tag-field">
        Unit
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="15" />
      </label>
      <label className="wf-tag-field">
        额外小标签（逗号分隔）
        <input
          value={extraTags}
          onChange={(e) => setExtraTags(e.target.value)}
          placeholder="形近词, 易混"
        />
      </label>
      {catalog.length > 0 && (
        <p className="wf-tag-catalog muted">
          已有标签：{catalog.slice(0, 12).join(' · ')}
          {catalog.length > 12 ? '…' : ''}
        </p>
      )}
      <div className="wf-inline-form-actions">
        <button type="button" className="wf-btn-ghost" disabled={busy} onClick={saveTags}>
          保存标签
        </button>
        <button type="button" className="wf-btn-ghost" onClick={onClose}>
          关闭
        </button>
      </div>

      <details className="wf-tag-advanced">
        <summary>合并标签名（全库）</summary>
        <div className="wf-tag-merge-row">
          <input
            placeholder="原标签 Unit15"
            value={mergeFrom}
            onChange={(e) => setMergeFrom(e.target.value)}
          />
          <span>→</span>
          <input
            placeholder="新标签 Unit16"
            value={mergeTo}
            onChange={(e) => setMergeTo(e.target.value)}
          />
          <button type="button" className="wf-btn-ghost" disabled={busy} onClick={runMergeTags}>
            合并
          </button>
        </div>
      </details>

      <details className="wf-tag-advanced">
        <summary>合并重复词条</summary>
        <div className="wf-tag-merge-row">
          <input
            placeholder="要删掉的词 ID"
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
          />
          <button type="button" className="wf-btn-ghost" disabled={busy} onClick={runMergeEntry}>
            并入当前词
          </button>
        </div>
      </details>

      {msg && <p className="wf-msg">{msg}</p>}
    </div>
  )
}

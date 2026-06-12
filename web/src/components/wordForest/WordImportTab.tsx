import { useEffect, useState } from 'react'
import { api, type WordImportPreview } from '../../api'

type Props = {
  pdfSources: { source_pdf: string; question_count: number }[]
  onImported: () => void
}

export function WordImportTab({ pdfSources, onImported }: Props) {
  const [preview, setPreview] = useState<WordImportPreview | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [unit, setUnit] = useState('')
  const [pdfSource, setPdfSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiProvider, setAiProvider] = useState('local')
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([])

  const refresh = () => {
    api.previewWordImport().then(setPreview).catch(() => setPreview(null))
  }

  useEffect(() => {
    refresh()
    api.providers().then((p) => {
      const avail = p.filter((x) => x.id !== 'mock' && x.available)
      setProviders(avail)
      const local = avail.find((x) => x.id === 'local')
      setAiProvider(local?.id || avail[0]?.id || 'local')
    })
  }, [])

  const run = async (fn: () => Promise<{ created: number; skipped?: number }>) => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fn()
      setMsg(`已导入 ${res.created}${res.skipped ? `，跳过 ${res.skipped}` : ''}`)
      refresh()
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wf-import">
      {preview && (
        <p className="wf-import-stats">
          库内 {preview.word_dictation_in_db} · Study 可导 {preview.study_new_count} /{' '}
          {preview.study_word_count}
        </p>
      )}

      <button
        type="button"
        className="wf-btn-block"
        disabled={busy}
        onClick={() => run(() => api.importWordStudy({}))}
      >
        导入 Study 错词笔记
      </button>

      <label className="wf-label">粘贴导入</label>
      <textarea
        className="wf-textarea"
        rows={3}
        placeholder="word, 释义"
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
      />
      <div className="wf-import-row">
        <input
          placeholder="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="wf-input-sm"
        />
        <button
          type="button"
          className="wf-btn-ghost"
          disabled={busy || !pasteText.trim()}
          onClick={() => run(() => api.importWordPaste({ text: pasteText, unit: unit.trim() }))}
        >
          导入
        </button>
      </div>

      <label className="wf-label">AI 补充</label>
      <textarea
        className="wf-textarea"
        rows={2}
        placeholder="再补 8 个形近词…"
        value={aiPrompt}
        onChange={(e) => setAiPrompt(e.target.value)}
      />
      <div className="wf-import-row">
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wf-btn-ghost"
          disabled={busy || !aiPrompt.trim()}
          onClick={() =>
            run(async () => {
              const r = await api.suggestWords({
                message: aiPrompt.trim(),
                provider: aiProvider,
                unit: unit.trim(),
                auto_import: true,
              })
              return r.imported || { created: r.words.length, skipped: 0 }
            })
          }
        >
          AI 导入
        </button>
      </div>

      {pdfSources.length > 0 && (
        <>
          <label className="wf-label">PDF 题提取</label>
          <div className="wf-import-row">
            <select value={pdfSource} onChange={(e) => setPdfSource(e.target.value)}>
              <option value="">全部</option>
              {pdfSources.map((s) => (
                <option key={s.source_pdf} value={s.source_pdf}>
                  {s.source_pdf}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="wf-btn-ghost"
              disabled={busy}
              onClick={() => run(() => api.importWordFromPdf({ source_pdf: pdfSource }))}
            >
              提取
            </button>
          </div>
        </>
      )}

      {msg && <p className="wf-msg">{msg}</p>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api, type WordImportPreview, type WordSuggestItem } from '../api'

type Props = {
  onImported: () => void
  pdfSources: { source_pdf: string; question_count: number }[]
}

export function WordImportPanel({ onImported, pdfSources }: Props) {
  const [preview, setPreview] = useState<WordImportPreview | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [unit, setUnit] = useState('')
  const [pdfSource, setPdfSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [aiPrompt, setAiPrompt] = useState('')
  const [aiContext, setAiContext] = useState('')
  const [aiProvider, setAiProvider] = useState('local')
  const [providers, setProviders] = useState<{ id: string; label: string; available: boolean }[]>([])
  const [aiPreview, setAiPreview] = useState<WordSuggestItem[] | null>(null)
  const [aiNote, setAiNote] = useState('')

  const refresh = () => {
    api.previewWordImport().then(setPreview).catch(() => setPreview(null))
  }

  useEffect(() => {
    refresh()
    api.providers().then((p) => {
      setProviders(p.filter((x) => x.id !== 'mock'))
      const local = p.find((x) => x.id === 'local' && x.available)
      const def = p.find((x) => x.available)
      setAiProvider(local?.id || def?.id || 'local')
    })
  }, [])

  const run = async (fn: () => Promise<{ created: number; skipped?: number }>) => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fn()
      setMsg(`已导入 ${res.created} 词${res.skipped ? `，跳过 ${res.skipped}（已存在）` : ''}`)
      refresh()
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const runAiSuggest = async (importNow: boolean) => {
    if (!aiPrompt.trim()) {
      setMsg('请先描述要补充的单词')
      return
    }
    setBusy(true)
    setMsg('')
    setAiPreview(null)
    setAiNote('')
    try {
      const ctx = (aiContext || pasteText).trim()
      const res = await api.suggestWords({
        message: aiPrompt.trim(),
        provider: aiProvider,
        unit: unit.trim(),
        context: ctx,
        auto_import: importNow,
      })
      setAiPreview(res.words)
      setAiNote(res.note || '')
      if (res.paste_preview) setPasteText(res.paste_preview)
      if (res.imported) {
        setMsg(
          `AI 已导入 ${res.imported.created} 词${res.imported.skipped ? `，跳过 ${res.imported.skipped}` : ''}`
        )
        refresh()
        onImported()
      } else {
        setMsg(`已生成 ${res.words.length} 个词，可核对后点「导入粘贴」或再次「补充并导入」`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'AI 补充失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="word-import-panel card">
      <h3 className="word-import-title">默写单词 · 导入</h3>
      {preview && (
        <p className="word-import-stats">
          库内 <strong>{preview.word_dictation_in_db}</strong> 词 · Study 可导入{' '}
          <strong>{preview.study_new_count}</strong> / {preview.study_word_count} · PDF 可提取{' '}
          <strong>{preview.pdf_new_count}</strong> / {preview.pdf_candidate_count}
        </p>
      )}

      <div className="word-import-block word-import-ai">
        <p className="word-import-label">AI 中途补充（本地 Ollama / 云端）</p>
        <p className="word-import-hint">
          描述要补的词（如「Unit15 错词里和 inspect 形近的再补 8 个」）。默认直接写入词库；也可只预览再手动导入。
        </p>
        <textarea
          className="word-import-textarea"
          rows={2}
          placeholder="例如：根据下面已有词，补充 10 个易混形近词"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
        />
        <textarea
          className="word-import-textarea word-import-context"
          rows={2}
          placeholder="已有词（可选，不填则用下方粘贴框内容作去重参考）"
          value={aiContext}
          onChange={(e) => setAiContext(e.target.value)}
        />
        <div className="word-import-row">
          <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
            {providers.length === 0 && <option value="local">本地模型</option>}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Unit（可选）"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="word-import-unit"
          />
        </div>
        <div className="word-import-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !aiPrompt.trim()}
            onClick={() => runAiSuggest(true)}
          >
            AI 补充并导入
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !aiPrompt.trim()}
            onClick={() => runAiSuggest(false)}
          >
            仅预览
          </button>
        </div>
        {aiPreview && aiPreview.length > 0 && (
          <ul className="word-ai-preview">
            {aiPreview.map((w) => (
              <li key={w.word}>
                <strong>{w.word}</strong>
                {w.meaning ? ` — ${w.meaning}` : ''}
              </li>
            ))}
          </ul>
        )}
        {aiNote && <p className="word-import-hint">{aiNote}</p>}
      </div>

      <div className="word-import-block">
        <label className="word-import-label">粘贴（每行：单词 或 单词,释义）</label>
        <textarea
          className="word-import-textarea"
          rows={4}
          placeholder={'inspect, 检查\nmerit, 优点\nrepel'}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <div className="word-import-row">
          <input
            type="text"
            placeholder="Unit 编号（可选）"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="word-import-unit"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !pasteText.trim()}
            onClick={() =>
              run(() => api.importWordPaste({ text: pasteText, unit: unit.trim() }))
            }
          >
            导入粘贴
          </button>
        </div>
      </div>

      <div className="word-import-block">
        <p className="word-import-label">从 Study 英语错词笔记导入</p>
        <p className="word-import-hint">
          扫描 <code>学习资料/笔记/英语/*默写错词*.md</code> 与英语错题总记录中的错词表。
        </p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(() => api.importWordStudy({}))}
        >
          导入 Study 错词
        </button>
      </div>

      <div className="word-import-block">
        <p className="word-import-label">从已入库 PDF 题目提取单词</p>
        <div className="word-import-row">
          <select value={pdfSource} onChange={(e) => setPdfSource(e.target.value)}>
            <option value="">全部英语相关 PDF 题</option>
            {pdfSources.map((s) => (
              <option key={s.source_pdf} value={s.source_pdf}>
                {s.source_pdf}（{s.question_count}）
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              run(() => api.importWordFromPdf({ source_pdf: pdfSource }))
            }
          >
            从 PDF 题提取
          </button>
        </div>
      </div>

      {msg && <p className="word-import-msg">{msg}</p>}
    </div>
  )
}

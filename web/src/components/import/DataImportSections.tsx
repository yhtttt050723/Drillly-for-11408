import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  type EnglishVocabInboxFile,
  type PublicSettings,
  type WordImportPreview,
  type WordSuggestItem,
} from '../../api'
import { WrongQuestionImportPanel } from '../WrongQuestionImportPanel'

type PdfProps = {
  providers: { id: string; label: string; available?: boolean }[]
  provider: string
  onProviderChange: (v: string) => void
}

function parseErr(e: unknown): string {
  if (!(e instanceof Error)) return '失败'
  try {
    const j = JSON.parse(e.message) as { detail?: string }
    if (typeof j.detail === 'string') return j.detail
  } catch {
    /* ignore */
  }
  return e.message
}

/** DeepSeek Key 快捷配置（与设置页共用） */
function ApiKeyBar({
  settings,
  onSaved,
}: {
  settings: PublicSettings | null
  onSaved: () => void
}) {
  const [deepseek, setDeepseek] = useState('')
  const [msg, setMsg] = useState('')

  const save = async () => {
    if (!deepseek.trim()) return
    setMsg('')
    try {
      await api.patchSettings({ deepseek_api_key: deepseek.trim() })
      setDeepseek('')
      setMsg('DeepSeek Key 已保存')
      onSaved()
    } catch (e) {
      setMsg(parseErr(e))
    }
  }

  return (
    <div className="data-apikey-bar">
      <strong>DeepSeek API Key</strong>
      <span className="muted">
        {settings?.deepseek_configured
          ? `已配置 ${settings.deepseek_api_key_masked}`
          : '未配置 — 英文 PDF 导入需要'}
      </span>
      <div className="data-import-actions">
        <input
          type="password"
          placeholder="sk-..."
          value={deepseek}
          onChange={(e) => setDeepseek(e.target.value)}
          className="data-apikey-input"
        />
        <button type="button" className="btn btn-primary" onClick={save} disabled={!deepseek.trim()}>
          保存 Key
        </button>
        <Link to="/settings" className="btn">
          设置页
        </Link>
      </div>
      {msg && <p className="data-import-msg">{msg}</p>}
    </div>
  )
}

/** 默写单词：Study / 粘贴 / AI / 英文 PDF（DeepSeek 分批解析） */
export function WordDataImportSection({ providers, provider, onProviderChange }: PdfProps) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [preview, setPreview] = useState<WordImportPreview | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [unit, setUnit] = useState('')
  const [pdfSource, setPdfSource] = useState('')
  const [pdfSources, setPdfSources] = useState<{ source_pdf: string; question_count: number }[]>([])
  const [pagesPerBatch, setPagesPerBatch] = useState(3)
  const [allowReimport, setAllowReimport] = useState(false)
  const [replacePdfSource, setReplacePdfSource] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [aiPrompt, setAiPrompt] = useState('')
  const [englishFile, setEnglishFile] = useState<File | null>(null)
  const [englishPreview, setEnglishPreview] = useState<{
    word_count: number
    words: WordSuggestItem[]
    pages: number
    logs?: string[]
  } | null>(null)
  const [vocabInboxDir, setVocabInboxDir] = useState('')
  const [vocabNamingHint, setVocabNamingHint] = useState('')
  const [vocabInboxFiles, setVocabInboxFiles] = useState<EnglishVocabInboxFile[]>([])
  const [defaultBook, setDefaultBook] = useState('基础词')

  const englishOpts = () => ({
    provider,
    pages_per_batch: pagesPerBatch,
    unit: unit.trim(),
    allow_reimport: allowReimport,
    replace_pdf_source: replacePdfSource,
    source_label: englishFile?.name,
  })

  const loadVocabInbox = () => {
    api
      .getEnglishVocabInbox()
      .then((r) => {
        setVocabInboxDir(r.inbox_dir)
        setVocabNamingHint(r.naming_hint)
        setVocabInboxFiles(r.files)
      })
      .catch(() => {
        setVocabInboxFiles([])
      })
  }

  const refresh = () => {
    api.previewWordImport().then(setPreview).catch(() => setPreview(null))
    api.listPdfSources().then(setPdfSources).catch(() => setPdfSources([]))
    api.getSettings().then(setSettings).catch(() => setSettings(null))
    loadVocabInbox()
    api.providers().then((p) => {
      const ds = p.find((x) => x.id === 'deepseek' && x.available)
      if (ds) onProviderChange('deepseek')
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  const run = async (fn: () => Promise<{ created: number; skipped?: number }>) => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fn()
      setMsg(`已导入 ${res.created} 词${res.skipped ? `，跳过 ${res.skipped}` : ''}`)
      refresh()
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  const previewEnglishPdf = async () => {
    if (!englishFile) return
    setBusy(true)
    setMsg('')
    setEnglishPreview(null)
    setLogs([])
    try {
      const r = await api.previewEnglishPdfWords(englishFile, englishOpts())
      setEnglishPreview({
        word_count: r.word_count,
        words: r.words,
        pages: r.pages,
        logs: r.logs,
      })
      setLogs(r.logs || [])
      setMsg(`预览（首批）：${r.pages} 页 · AI 识别 ${r.word_count} 词`)
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  const processVocabInboxAll = async () => {
    const pending = vocabInboxFiles.filter((f) => !f.imported)
    if (!pending.length && !vocabInboxFiles.length) {
      setMsg('收件箱为空，请先把 PDF 放入监听目录')
      return
    }
    setBusy(true)
    setMsg('')
    setLogs([])
    try {
      const r = await api.processEnglishVocabInboxAll({
        provider,
        pages_per_batch: pagesPerBatch,
        skip_imported: true,
        default_book: defaultBook,
      })
      setLogs(r.results.flatMap((x) => x.logs || []))
      setMsg(
        `收件箱：处理 ${r.processed} 个 · 跳过 ${r.skipped} · 失败 ${r.errors} / 共 ${r.total}`,
      )
      loadVocabInbox()
      refresh()
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  const processVocabInboxOne = async (f: EnglishVocabInboxFile, force = false) => {
    setBusy(true)
    setMsg('')
    try {
      const r = await api.processEnglishVocabInboxOne({
        filename: f.name,
        provider,
        pages_per_batch: pagesPerBatch,
        book: f.book || defaultBook,
        unit: f.unit,
        force,
      })
      if (r.logs?.length) setLogs(r.logs)
      if (r.skipped) {
        setMsg(`${f.name}：已导入过，跳过`)
      } else if (r.ok) {
        const imp = r.imported
        setMsg(
          `${f.name}（${r.book || ''} ${r.unit || ''}）· 新增 ${imp?.created ?? 0}` +
            (imp?.skipped ? ` · 去重跳过 ${imp.skipped}` : ''),
        )
      } else {
        setMsg(r.error || `${f.name} 处理失败`)
      }
      loadVocabInbox()
      refresh()
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  const resetVocabInboxFile = async (name: string) => {
    if (!window.confirm(`清除「${name}」的已导入记录？文件仍在收件箱，可强制重导。`)) return
    setBusy(true)
    try {
      await api.resetEnglishVocabInboxFile(name)
      setMsg(`已重置：${name}`)
      loadVocabInbox()
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  const importEnglishPdf = async () => {
    if (!englishFile) return
    setBusy(true)
    setMsg('')
    setLogs([])
    try {
      const r = await api.uploadEnglishPdfWords(englishFile, {
        ...englishOpts(),
        auto_import: true,
      })
      setLogs(r.logs || [])
      const imp = r.imported
      setMsg(
        `AI 解析 ${r.word_count} 词 · 新增 ${imp?.created ?? 0}` +
          (imp?.updated ? ` · 更新 ${imp.updated}` : '') +
          (imp?.skipped ? ` · 跳过 ${imp.skipped}` : '') +
          (imp?.removed ? ` · 覆盖删除 ${imp.removed}` : ''),
      )
      refresh()
    } catch (e) {
      setMsg(parseErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="data-import-section">
      <ApiKeyBar settings={settings} onSaved={refresh} />

      {preview && (
        <p className="data-import-meta">
          词库 {preview.word_dictation_in_db} 词 · Study 可导 {preview.study_new_count} /{' '}
          {preview.study_word_count}
        </p>
      )}

      <h4 className="data-import-sub">英文词汇 PDF 收件箱（推荐）</h4>
      <p className="data-import-hint">
        把各 Unit 的 PDF 放入下方目录，在此一键 AI 导入。词书（基础词/必考词）与 Unit 从<strong>文件名</strong>
        自动识别；每个 PDF 单独打标签（标签名=文件名不含 .pdf）。同一英文单词全局只入库一次。
        示例：<code>基础词 Unit15.pdf</code>、<code>必考词 Unit3.pdf</code>
      </p>
      <div className="data-import-actions">
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                '确定清空全部默写单词？\n将删除词库中所有单词、练习记录，并重置 PDF 收件箱导入记录（已处理文件夹中的 PDF 会移回收件箱）。',
              )
            )
              return
            setBusy(true)
            try {
              const r = await api.clearAllWords()
              setMsg(
                `已删除 ${r.deleted} 词` +
                  (r.ledger_cleared != null ? ` · 清除 ${r.ledger_cleared} 条收件箱记录` : '') +
                  (r.inbox_restore?.moved
                    ? ` · ${r.inbox_restore.moved} 个 PDF 已移回收件箱`
                    : ''),
              )
              loadVocabInbox()
              refresh()
            } catch (e) {
              setMsg(parseErr(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          清空词库（重新导入用）
        </button>
      </div>
      <p className="data-import-meta">
        监听目录：<code>{vocabInboxDir || settings?.english_vocab_inbox_dir || '…'}</code>
      </p>
      {vocabNamingHint && <p className="data-import-hint muted">{vocabNamingHint}</p>}
      <div className="data-import-actions">
        <label>
          未识别书名时默认{' '}
          <select value={defaultBook} onChange={(e) => setDefaultBook(e.target.value)}>
            <option value="基础词">基础词</option>
            <option value="必考词">必考词</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={loadVocabInbox}>
          刷新列表
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !vocabInboxFiles.length}
          onClick={processVocabInboxAll}
        >
          {busy
            ? '批量 AI 导入中…'
            : `一键处理全部（${vocabInboxFiles.filter((f) => !f.imported).length || vocabInboxFiles.length}）`}
        </button>
      </div>
      {vocabInboxFiles.length > 0 && (
        <ul className="data-vocab-inbox-list">
          {vocabInboxFiles.map((f) => (
            <li key={f.name} className="data-vocab-inbox-item">
              <span className="data-vocab-inbox-name">{f.name}</span>
              <span className="muted">
                {f.size_mb} MB
                {f.book ? ` · ${f.book}` : ''}
                {f.unit ? ` · Unit ${f.unit}` : ''}
              </span>
              {f.imported ? (
                <span className="data-vocab-inbox-done">
                  已导入
                  {f.created != null ? ` +${f.created}` : ''}
                  {f.skipped ? ` 去重${f.skipped}` : ''}
                </span>
              ) : (
                <span className="data-vocab-inbox-pending">待导入</span>
              )}
              <span className="data-vocab-inbox-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => processVocabInboxOne(f, f.imported)}
                >
                  {f.imported ? '强制重导' : '导入'}
                </button>
                {f.imported && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => resetVocabInboxFile(f.name)}
                  >
                    重置记录
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="data-import-sub">单文件上传（英文词汇 PDF · AI）</h4>
      <p className="data-import-hint">
        与「PDF 题目导入」相同：按页拆分 PDF，每批发送给 AI，专用提示词返回单词 JSON 后入库。扫描版 PDF 请选通义千问。
      </p>
      <p>
        <input
          type="file"
          accept=".pdf"
          onChange={(e) => {
            setEnglishFile(e.target.files?.[0] ?? null)
            setEnglishPreview(null)
            setLogs([])
          }}
        />
      </p>
      <div className="data-import-actions">
        <label>
          模型{' '}
          <select value={provider} onChange={(e) => onProviderChange(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.available === false ? '（未配置 Key）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          每批页数{' '}
          <input
            type="number"
            min={1}
            max={10}
            value={pagesPerBatch}
            onChange={(e) => setPagesPerBatch(Number(e.target.value))}
            style={{ width: 56 }}
          />
        </label>
        <input
          type="text"
          className="data-input-sm"
          placeholder="Unit（可选）"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="data-import-checks">
        <label>
          <input
            type="checkbox"
            checked={allowReimport}
            onChange={(e) => setAllowReimport(e.target.checked)}
          />
          二次导入：已存在词更新释义
        </label>
        <label>
          <input
            type="checkbox"
            checked={replacePdfSource}
            onChange={(e) => setReplacePdfSource(e.target.checked)}
          />
          覆盖：先删除本 PDF 上次 AI 导入的词
        </label>
      </div>
      <div className="data-import-actions">
        <button type="button" className="btn" disabled={busy || !englishFile} onClick={previewEnglishPdf}>
          预览首批
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !englishFile}
          onClick={importEnglishPdf}
        >
          {busy ? 'AI 解析中…' : '上传并 AI 导入'}
        </button>
      </div>
      {englishPreview && englishPreview.words.length > 0 && (
        <ul className="data-word-preview">
          {englishPreview.words.slice(0, 15).map((w) => (
            <li key={w.word}>
              <strong>{w.word}</strong>
              {w.meaning ? ` — ${w.meaning}` : ''}
            </li>
          ))}
          {englishPreview.word_count > 15 && (
            <li className="muted">… 预览共 {englishPreview.word_count} 词（完整导入会处理全部页）</li>
          )}
        </ul>
      )}
      {logs.length > 0 && (
        <pre className="data-import-log">{logs.join('\n')}</pre>
      )}

      <h4 className="data-import-sub">Study 错词笔记</h4>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => run(() => api.importWordStudy({ source_label: 'Study错词', small_tags: ['错词'] }))}
      >
        导入 Study 英语错词
      </button>

      <h4 className="data-import-sub">粘贴 / AI 补充</h4>
      <textarea
        className="data-textarea"
        rows={3}
        placeholder="word, 释义"
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !pasteText.trim()}
        onClick={() => run(() => api.importWordPaste({ text: pasteText, unit: unit.trim() }))}
      >
        导入粘贴
      </button>
      <textarea
        className="data-textarea"
        rows={2}
        placeholder="AI：再补 10 个形近词…"
        value={aiPrompt}
        onChange={(e) => setAiPrompt(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !aiPrompt.trim()}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await api.suggestWords({
              message: aiPrompt.trim(),
              provider,
              unit: unit.trim(),
              auto_import: true,
            })
            setMsg(`AI 已导入 ${r.imported?.created ?? r.words.length} 词`)
            refresh()
          } catch (e) {
            setMsg(parseErr(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        AI 补充入库
      </button>

      <h4 className="data-import-sub">从已入库 PDF 题目提取</h4>
      <div className="data-import-actions">
        <select value={pdfSource} onChange={(e) => setPdfSource(e.target.value)}>
          <option value="">全部英语相关题</option>
          {pdfSources.map((s) => (
            <option key={s.source_pdf} value={s.source_pdf}>
              {s.source_pdf}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(() => api.importWordFromPdf({ source_pdf: pdfSource }))}
        >
          提取单词
        </button>
      </div>

      <p className="data-import-hint">
        词库增删改查：<Link to="/">练习 · 默写单词</Link> 右侧「词库」。
      </p>
      {msg && <p className="data-import-msg">{msg}</p>}
    </div>
  )
}

export function WrongDataImportSection() {
  return (
    <div className="data-import-section">
      <WrongQuestionImportPanel onImported={() => {}} />
    </div>
  )
}

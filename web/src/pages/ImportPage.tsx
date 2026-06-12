import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ImportTask, type InboxFile, type InboxProcessResult } from '../api'
import {
  inboxStreamPercent,
  streamInboxProcessOne,
  streamInboxProcessAll,
  streamInboxRetryFailed,
  type InboxStreamEvent,
} from '../api/inboxStream'
import { importZh as t } from '../i18n/importZh'
import {
  WordDataImportSection,
  WrongDataImportSection,
} from '../components/import/DataImportSections'

type ImportTab = 'pdf' | 'wrong' | 'words'

const PROGRESS_STORAGE_KEY = 'drillly-import-progress-v1'

type ImportProgress = {
  active: boolean
  percent: number
  fileTotal: number
  fileIndex: number
  fileName: string
  batchTotal: number
  batchIndex: number
  pageLabel: string
  logs: string[]
}

export function ImportPage() {
  const [importTab, setImportTab] = useState<ImportTab>('pdf')
  const [providers, setProviders] = useState<
    { id: string; label: string; model: string; available?: boolean }[]
  >([])
  const [provider, setProvider] = useState('tongyi')
  const [pagesPerBatch, setPagesPerBatch] = useState(2)
  const [pdfTags, setPdfTags] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [task, setTask] = useState<ImportTask | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [inboxDir, setInboxDir] = useState('')
  const [inboxFiles, setInboxFiles] = useState<InboxFile[]>([])
  const [failedByFile, setFailedByFile] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<ImportProgress>({
    active: false,
    percent: 0,
    fileTotal: 0,
    fileIndex: 0,
    fileName: '',
    batchTotal: 0,
    batchIndex: 0,
    pageLabel: '',
    logs: [],
  })
  const abortRef = useRef<AbortController | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const loadInbox = useCallback(() => {
    api.getInbox().then((r) => {
      setInboxDir(r.inbox_dir)
      setInboxFiles(r.files)
    })
    api.getFailedBatches().then((r) => {
      setFailedByFile(r.count_by_file ?? {})
    }).catch(() => setFailedByFile({}))
  }, [])

  const persistProgress = useCallback((p: ImportProgress) => {
    try {
      localStorage.setItem(
        PROGRESS_STORAGE_KEY,
        JSON.stringify({ ...p, active: p.active }),
      )
    } catch {
      /* ignore quota */
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as ImportTab
    if (hash === 'pdf' || hash === 'wrong' || hash === 'words') {
      setImportTab(hash)
    }
  }, [])

  useEffect(() => {
    api.providers().then((p) => {
      setProviders(p)
      const tongyi = p.find((x) => x.id === 'tongyi')
      setProvider(tongyi?.available ? 'tongyi' : p[0]?.id || 'mock')
    })
    api.getSettings().then((s) => {
      if (s.pdf_pages_per_batch >= 1 && s.pdf_pages_per_batch <= 20) {
        setPagesPerBatch(s.pdf_pages_per_batch)
      }
    })
    loadInbox()

    try {
      const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as ImportProgress
        if (saved.logs?.length) {
          setProgress((p) => ({ ...p, ...saved, active: false }))
        }
      }
    } catch {
      /* ignore */
    }

    api.getImportJobState().then((job) => {
      if (job.logs?.length) {
        setProgress((p) => ({
          ...p,
          logs: [...job.logs, t.restoreProgress],
          active: Boolean(job.active),
          percent: job.progress?.percent ?? p.percent,
          fileIndex: job.progress?.file_index ?? 0,
          fileName: String(job.progress?.file_name ?? ''),
          batchIndex: job.progress?.batch_index ?? 0,
          batchTotal: job.progress?.batch_total ?? 0,
        }))
      }
    }).catch(() => {})
  }, [loadInbox])

  const upload = async () => {
    if (!file) return alert(t.selectPdf)
    setBusy(true)
    setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('tags', pdfTags)
      fd.append('pages_per_batch', String(pagesPerBatch))
      const res = await api.uploadPdf(fd)
      setTask(await api.getTask(res.task_id))
      setMsg(t.splitBatches(res.batches))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.uploadFail)
    } finally {
      setBusy(false)
    }
  }

  const parseBatch = async (batchId: number) => {
    if (!task) return
    setBusy(true)
    try {
      const res = await api.parseBatch(task.id, batchId, provider)
      setPreview(JSON.stringify(res.questions, null, 2))
      setTask(await api.getTask(task.id))
      setMsg(t.parsedMeta(res.count, res.pdf_tag, res.source_pdf))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.parseFail)
    } finally {
      setBusy(false)
    }
  }

  const confirmBatch = async (batchId: number) => {
    if (!task) return
    setBusy(true)
    try {
      const res = await api.confirmBatch(task.id, batchId)
      setMsg(t.confirmed(res.created_question_ids.join(', ')))
      setTask(await api.getTask(task.id))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.confirmFail)
    } finally {
      setBusy(false)
    }
  }

  const appendLog = useCallback((line: string) => {
    setProgress((p) => {
      const logs = [...p.logs, line]
      if (logs.length > 200) logs.shift()
      const next = { ...p, logs }
      persistProgress(next)
      return next
    })
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
  }, [persistProgress])

  const handleStreamEvent = (ev: InboxStreamEvent) => {
    switch (ev.type) {
      case 'plan':
        setProgress((p) => ({
          ...p,
          fileTotal: ev.pending_files,
          fileIndex: 0,
          percent: 0,
        }))
        appendLog(t.logPlan(ev.pending_files, ev.skipped_files))
        break
      case 'skip':
        appendLog(t.logSkip(ev.file, ev.reason))
        break
      case 'file_start':
        setProgress((p) => ({
          ...p,
          fileIndex: ev.file_index,
          fileTotal: ev.file_total,
          fileName: ev.file,
          batchTotal: 0,
          batchIndex: 0,
          pageLabel: '',
          percent: inboxStreamPercent(ev.file_index, ev.file_total, 0, 1),
        }))
        appendLog(t.logFileStart(ev.file, ev.file_index, ev.file_total))
        break
      case 'split_done':
        setProgress((p) => ({
          ...p,
          batchTotal: ev.batches,
          batchIndex: 0,
        }))
        appendLog(t.logSplit(ev.file, ev.batches, ev.total_pages))
        break
      case 'batch_start':
        setProgress((p) => ({
          ...p,
          batchIndex: ev.batch_index,
          batchTotal: ev.batch_total,
          pageLabel: t.pageRange(ev.page_start, ev.page_end),
          percent: inboxStreamPercent(p.fileIndex, p.fileTotal, ev.batch_index - 1, ev.batch_total),
        }))
        break
      case 'batch_done': {
        const mode =
          'extract_mode' in ev && ev.extract_mode
            ? ev.extract_mode === 'vision'
              ? '视觉'
              : ev.extract_mode === 'text'
                ? '文本'
                : String(ev.extract_mode)
            : undefined
        setProgress((p) => ({
          ...p,
          batchIndex: ev.batch_index,
          percent: inboxStreamPercent(p.fileIndex, p.fileTotal, ev.batch_index, ev.batch_total),
        }))
        if (ev.questions === 0 && 'zero_hint' in ev && ev.zero_hint) {
          appendLog(
            t.logBatchZero(ev.file, ev.batch_index, ev.batch_total, String(ev.zero_hint), mode),
          )
        } else {
          appendLog(t.logBatch(ev.file, ev.batch_index, ev.batch_total, ev.questions, mode))
        }
        break
      }
      case 'batch_error': {
        const pages =
          ev.page_start && ev.page_end
            ? t.pageRange(ev.page_start, ev.page_end)
            : undefined
        appendLog(
          ev.retry
            ? t.logBatchError(ev.file, ev.batch_index, ev.batch_total, ev.error, pages)
            : t.logBatchErrorSkip(ev.file, ev.batch_index, ev.batch_total, ev.error, pages),
        )
        break
      }
      case 'retry_plan':
        appendLog(
          t.logRetryPlan(
            ev.file,
            ev.batches,
            ev.batch_indices ?? [],
          ),
        )
        break
      case 'retry_done':
        appendLog(t.logRetryDone(ev.file, ev.questions_added))
        loadInbox()
        break
      case 'file_done':
        appendLog(
          t.logFileDone(
            ev.file,
            ev.result.questions_in_db ?? ev.result.parsed_questions,
            ev.result.pdf_tag ?? undefined,
          ) + (ev.result.partial ? '（部分批次失败，可清除后重导）' : ''),
        )
        loadInbox()
        break
      case 'file_error':
        appendLog(t.logFileError(ev.file, ev.error))
        loadInbox()
        break
      case 'fatal':
        appendLog(t.logFileError('—', ev.error))
        break
      default:
        break
    }
  }

  const runStream = async (
    runner: (
      body: Parameters<typeof streamInboxProcessAll>[0],
      onEvent: (ev: InboxStreamEvent) => void,
      signal?: AbortSignal,
    ) => Promise<void>,
    body: Parameters<typeof streamInboxProcessAll>[0],
    fileTotal: number,
  ) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setMsg('')
    setProgress({
      active: true,
      percent: 0,
      fileTotal,
      fileIndex: 0,
      fileName: '',
      batchTotal: 0,
      batchIndex: 0,
      pageLabel: '',
      logs: [],
    })

    let summary: InboxProcessResult | undefined
    try {
      await runner(body, (ev) => {
        handleStreamEvent(ev)
        if (ev.type === 'complete') {
          summary = {
            processed: ev.processed,
            skipped: ev.skipped,
            results: ev.results,
            skipped_files: ev.skipped_files,
            errors: ev.errors,
          }
        }
      }, ac.signal)

      if (summary) {
        const lines = summary.results.map((r) => t.batchItem(r.file, r.pdf_tag, r.source_path))
        setMsg(
          t.batchDone(summary.processed, summary.skipped ?? 0, summary.errors.length) +
            '\n' +
            t.practiceHint +
            (lines.length ? `\n${lines.join('\n')}` : ''),
        )
      }
      setProgress((p) => {
        const next = { ...p, percent: 100, active: false }
        persistProgress(next)
        return next
      })
      appendLog(t.progressDone)
      loadInbox()
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setMsg(t.cancelHint)
      } else {
        setMsg(e instanceof Error ? e.message : t.batchFail)
      }
      setProgress((p) => ({ ...p, active: false }))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const processInboxAll = async () => {
    const pending = inboxFiles.filter((f) => !f.imported)
    if (!pending.length && !inboxFiles.length) return alert(t.inboxEmpty)
    const n = pending.length || inboxFiles.length
    if (!confirm(t.confirmBatch(n))) return
    await runStream(
      streamInboxProcessAll,
      {
        provider,
        tags: pdfTags,
        pages_per_batch: pagesPerBatch,
        auto_confirm: true,
      },
      pending.length,
    )
  }

  const processOneFile = async (filename: string) => {
    if (!confirm(t.importOne + `: ${filename}？`)) return
    await runStream(
      streamInboxProcessOne,
      {
        provider,
        tags: pdfTags,
        pages_per_batch: pagesPerBatch,
        auto_confirm: true,
        filename,
      },
      1,
    )
  }

  const retryFailedFile = async (filename: string) => {
    const n = failedByFile[filename] ?? 0
    if (!n) return alert(t.retryNoPending)
    if (!confirm(t.confirmRetry(filename, n))) return
    await runStream(
      streamInboxRetryFailed,
      {
        provider,
        tags: pdfTags,
        pages_per_batch: pagesPerBatch,
        auto_confirm: true,
        filename,
      },
      1,
    )
  }

  const resetOneFile = async (filename: string) => {
    if (!confirm(`清除「${filename}」的导入记录与题库条目，然后可重新导入？`)) return
    setBusy(true)
    try {
      const r = await api.resetInboxFile(filename)
      setMsg(`已删除 ${r.questions_deleted} 题，可重新导入 ${filename}`)
      loadInbox()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  const cancelImport = () => {
    abortRef.current?.abort()
    api.cancelInboxImport().catch(() => {})
  }

  const renderParseSettings = () => (
    <>
      <p>
        <label>
          {t.pagesPerBatch}{' '}
          <input
            type="number"
            min={1}
            max={20}
            value={pagesPerBatch}
            onChange={(e) => setPagesPerBatch(Number(e.target.value))}
          />
        </label>
        <span style={{ marginLeft: 8, fontSize: '0.85rem', color: 'var(--muted)' }}>
          {t.pagesPerBatchHint}
        </span>
      </p>
      <p>
        <label>
          {t.model}{' '}
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.available === false ? t.noKey : ''}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          {t.pdfTags}{' '}
          <input
            value={pdfTags}
            onChange={(e) => setPdfTags(e.target.value)}
            style={{ width: 280 }}
          />
        </label>
      </p>
    </>
  )

  return (
    <div className="import-page">
      <h2>{t.title}</h2>
      <p className="import-page-lead">
        统一从此处导入：PDF 做题题、Study 错题截图、默写单词（含英文词汇 PDF 提取）。
      </p>

      <nav className="import-tabs" aria-label="导入类型">
        <button
          type="button"
          className={importTab === 'pdf' ? 'import-tab active' : 'import-tab'}
          onClick={() => setImportTab('pdf')}
        >
          {t.tabPdf}
        </button>
        <button
          type="button"
          className={importTab === 'wrong' ? 'import-tab active' : 'import-tab'}
          onClick={() => setImportTab('wrong')}
        >
          {t.tabWrong}
        </button>
        <button
          type="button"
          className={importTab === 'words' ? 'import-tab active' : 'import-tab'}
          onClick={() => setImportTab('words')}
        >
          {t.tabWords}
        </button>
      </nav>

      {importTab === 'wrong' && (
        <div className="card">
          <WrongDataImportSection />
        </div>
      )}

      {importTab === 'words' && (
        <div className="card">
          <WordDataImportSection
            providers={providers}
            provider={provider}
            onProviderChange={setProvider}
          />
        </div>
      )}

      {importTab === 'pdf' && (
        <>
      <div className="card">
        <h3>{t.parseSettingsTitle}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.parseSettingsNote}</p>
        {renderParseSettings()}
      </div>

      <div className="card inbox-card">
        <h3>{t.inboxTitle}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.inboxUsesSettings}</p>
        <p style={{ fontSize: '0.9rem' }}>
          {t.putPdf}
          <code style={{ marginLeft: 4 }}>{inboxDir || t.loading}</code>
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.inboxHint}</p>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={loadInbox} disabled={busy}>
            {t.refresh}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: 8 }}
            disabled={busy || !inboxFiles.length}
            onClick={processInboxAll}
          >
            {t.processAll(inboxFiles.filter((f) => !f.imported).length || inboxFiles.length)}
          </button>
          {(busy || progress.active) && (
            <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={cancelImport}>
              取消导入
            </button>
          )}
          {progress.logs.length > 0 && !busy && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={() => {
                setProgress((p) => ({ ...p, logs: [], percent: 0, active: false }))
                localStorage.removeItem(PROGRESS_STORAGE_KEY)
                api.clearImportJob().catch(() => {})
              }}
            >
              清空日志
            </button>
          )}
        </div>
        {(progress.active || progress.logs.length > 0) && (
          <div className="import-progress card" style={{ marginTop: 12 }}>
            <div className="import-progress-head">
              <strong>{t.progressTitle}</strong>
              <span>{progress.percent}%</span>
            </div>
            <div className="import-progress-bar" aria-hidden>
              <div className="import-progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="import-progress-detail">
              {progress.fileTotal > 0
                ? t.progressFiles(progress.fileIndex || 0, progress.fileTotal)
                : t.progressWaiting}
              {progress.fileName ? ` · ${progress.fileName}` : ''}
            </p>
            {progress.batchTotal > 0 && (
              <p className="import-progress-detail muted">
                {t.progressBatches(progress.batchIndex, progress.batchTotal, progress.pageLabel)}
              </p>
            )}
            <pre className="import-progress-log">
              {progress.logs.join('\n')}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
        {inboxFiles.length > 0 && (
          <ul style={{ marginTop: 12, fontSize: '0.9rem' }}>
            {inboxFiles.map((f) => (
              <li key={f.name} style={{ marginBottom: 6 }}>
                {f.name}（{f.size_mb} MB）
                {(f.questions_in_db ?? 0) > 0 ? (
                  <span style={{ marginLeft: 8, color: 'var(--success, #059669)' }}>
                    {t.questionsInDb(f.questions_in_db ?? 0)}
                  </span>
                ) : null}
                {f.imported ? (
                  <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{t.inboxImported}</span>
                ) : null}
                {(failedByFile[f.name] ?? 0) > 0 ? (
                  <span style={{ marginLeft: 8, color: '#b45309' }}>
                    待重导 {failedByFile[f.name]} 批
                  </span>
                ) : null}
                <span style={{ marginLeft: 8 }}>
                  {(failedByFile[f.name] ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => retryFailedFile(f.name)}
                    >
                      {t.retryFailed(failedByFile[f.name])}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: 4 }}
                    disabled={busy}
                    onClick={() => processOneFile(f.name)}
                  >
                    {t.importOne}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: 4 }}
                    disabled={busy}
                    onClick={() => resetOneFile(f.name)}
                  >
                    {t.resetFile}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>{t.manualTitle}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.uploadSizeHint}</p>
        <p>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={upload}>
          {t.upload}
        </button>
        {msg && <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{msg}</p>}
      </div>

      {task && (
        <div className="card">
          <h3>{t.taskHeader(task.id, task.original_name, task.total_pages)}</h3>
          <table className="import-table">
            <thead>
              <tr>
                <th>{t.colBatch}</th>
                <th>{t.colPages}</th>
                <th>{t.colStatus}</th>
                <th>{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {task.batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{t.pageRange(b.page_start, b.page_end)}</td>
                  <td>{b.status}</td>
                  <td>
                    <button type="button" className="btn" disabled={busy} onClick={() => parseBatch(b.id)}>
                      {t.parse}
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => confirmBatch(b.id)}>
                      {t.confirm}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="card">
          <h3>{t.previewJson}</h3>
          <pre style={{ overflow: 'auto', maxHeight: 360, fontSize: 12 }}>{preview}</pre>
        </div>
      )}
        </>
      )}
    </div>
  )
}

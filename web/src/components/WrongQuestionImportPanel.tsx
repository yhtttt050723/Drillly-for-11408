import { useEffect, useState } from 'react'
import { api, type WrongImportPreview, type WrongImportPreviewAll } from '../api'

type Props = {
  onImported: () => void
}

export function WrongQuestionImportPanel({ onImported }: Props) {
  const [subjects, setSubjects] = useState<string[]>([])
  const [tagGroups, setTagGroups] = useState<Record<string, string>>({})
  const [root, setRoot] = useState('')
  const [subject, setSubject] = useState('')
  const [tagGroup, setTagGroup] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [smallTags, setSmallTags] = useState('')
  const [preview, setPreview] = useState<WrongImportPreview | null>(null)
  const [previewAll, setPreviewAll] = useState<WrongImportPreviewAll | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api
      .listWrongSubjects()
      .then((r) => {
        setSubjects(r.subjects)
        setTagGroups(r.tag_groups || {})
        setRoot(r.root)
        if (r.subjects.length && !subject) {
          setSubject(r.subjects[0])
        }
      })
      .catch(() => {})
    api.previewWrongImportAll().then(setPreviewAll).catch(() => {})
  }, [])

  useEffect(() => {
    if (!subject) {
      setPreview(null)
      return
    }
    const group = tagGroups[subject] || `数学-${subject}`
    setTagGroup(group)
    setSourceLabel(`错题截图·${subject}`)
    api
      .previewWrongImport(subject)
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [subject, tagGroups])

  const refreshPreviewAll = () => {
    api.previewWrongImportAll().then(setPreviewAll).catch(() => {})
    if (subject) {
      api.previewWrongImport(subject).then(setPreview).catch(() => {})
    }
  }

  const runImport = async () => {
    if (!subject) return
    setBusy(true)
    setMsg('')
    try {
      const tags = smallTags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await api.importWrongScreenshots({
        subject,
        tag_group: tagGroup.trim(),
        source_label: sourceLabel.trim(),
        small_tags: tags,
      })
      setMsg(`已导入 ${res.created} 题${res.skipped ? `，跳过 ${res.skipped} 题（已存在）` : ''}`)
      refreshPreviewAll()
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const runImportAll = async () => {
    setBusy(true)
    setMsg('')
    try {
      const res = await api.importAllWrongScreenshots()
      setMsg(
        `全部科目：新导入 ${res.total_created} 题` +
          (res.images_repaired ? ` · 修复图片 ${res.images_repaired}` : '') +
          (res.tags_repaired ? ` · 修正标签 ${res.tags_repaired}` : ''),
      )
      refreshPreviewAll()
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const runRepair = async () => {
    setBusy(true)
    setMsg('')
    try {
      const img = await api.repairWrongImages()
      const tag = await api.repairWrongTags()
      setMsg(`已修复图片 ${img.fixed} 题 · 修正标签 ${tag.fixed} 题`)
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '修复失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrong-import-panel card">
      <div className="wrong-import-head">
        <strong>错题截图导入</strong>
        <span className="muted">从 Study 错题截图目录批量入库 · 图片即题目</span>
      </div>
      {root && (
        <p className="muted wrong-import-root" title={root}>
          目录：{root}
        </p>
      )}
      {previewAll && (
        <p className="wrong-import-preview wrong-import-preview--all">
          全部科目：<strong>{previewAll.subjects.length}</strong> 个文件夹 · 共{' '}
          <strong>{previewAll.total_files}</strong> 张截图 · 待导入{' '}
          <strong>{previewAll.new_count}</strong> · 已入库 {previewAll.skipped_count}
        </p>
      )}
      <div className="wrong-import-form">
        <label>
          科目文件夹
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">选择…</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          主题大标签
          <input
            type="text"
            value={tagGroup}
            onChange={(e) => setTagGroup(e.target.value)}
            placeholder="如 数学-线代"
          />
        </label>
        <label>
          出处说明
          <input
            type="text"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="如 660 Ch2 矩阵"
          />
        </label>
        <label>
          额外小标签
          <input
            type="text"
            value={smallTags}
            onChange={(e) => setSmallTags(e.target.value)}
            placeholder="逗号分隔，如 660,Ch2"
          />
        </label>
      </div>
      {preview && (
        <p className="wrong-import-preview">
          当前科目：共 <strong>{preview.total_files}</strong> 张 · 待导入{' '}
          <strong>{preview.new_count}</strong> · 已入库 {preview.skipped_count}
        </p>
      )}
      <div className="wrong-import-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !previewAll?.new_count}
          onClick={runImportAll}
        >
          {busy ? '处理中…' : `导入全部科目（${previewAll?.new_count ?? 0} 题）`}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !subject || !preview?.new_count}
          onClick={runImport}
        >
          {busy ? '导入中…' : `仅导入 ${subject || '…'}（${preview?.new_count ?? 0}）`}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={runRepair}>
          修复图片/标签
        </button>
        {msg && <span className="wrong-import-msg">{msg}</span>}
      </div>
    </div>
  )
}

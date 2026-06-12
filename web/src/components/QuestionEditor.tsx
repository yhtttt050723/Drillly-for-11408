import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Question } from '../api'
import {
  answerToText,
  codingTestCases,
  defaultStarterCode,
  defaultQuestionContent,
  normalizeCodingLanguage,
  questionImages,
  questionOptions,
  textToAnswer,
  type CodingTestCase,
  type QuestionType,
} from '../utils/questionContent'
import { questionChapter } from '../utils/questionSource'
import {
  clipboardImageFile,
  clipboardPasteIsImageOnly,
  imageFilesFromClipboard,
} from '../utils/clipboardImages'

type Props = {
  open: boolean
  /** null = 新建 */
  question: Question | null
  onClose: () => void
  onSaved: (q: Question) => void
}

export function QuestionEditor({ open, question, onClose, onSaved }: Props) {
  const isNew = question === null
  const [type, setType] = useState<QuestionType>('subjective')
  const [title, setTitle] = useState('')
  const [stem, setStem] = useState('')
  const [explanation, setExplanation] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [options, setOptions] = useState<{ key: string; content: string }[]>([])
  const [chapter, setChapter] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [language, setLanguage] = useState('cpp')
  const [starterCode, setStarterCode] = useState('')
  const [testCases, setTestCases] = useState<CodingTestCase[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const imagesFieldRef = useRef<HTMLFieldSetElement>(null)

  useEffect(() => {
    if (!open) return
    setErr('')
    setPendingFiles([])
    if (question) {
      const c = question.content
      setType((question.type as QuestionType) || 'subjective')
      setTitle(String(c.title || ''))
      setStem(String(c.stem || ''))
      setExplanation(String(c.explanation || ''))
      setOptions(questionOptions(c))
      setAnswerText(answerToText(c))
      setChapter(questionChapter(question))
      setImages(questionImages(question))
      setLanguage(normalizeCodingLanguage(c.language))
      setStarterCode(String(c.starterCode || ''))
      setTestCases(codingTestCases(c))
    } else {
      const d = defaultQuestionContent('subjective')
      setType('subjective')
      setTitle('')
      setStem('')
      setExplanation('')
      setOptions(questionOptions(d))
      setAnswerText('A')
      setChapter('')
      setImages([])
      setLanguage('cpp')
      setStarterCode(defaultStarterCode('cpp'))
      setTestCases([])
    }
  }, [open, question])

  const onTypeChange = (t: QuestionType) => {
    setType(t)
    if (t === 'single_choice' || t === 'multiple_choice') {
      if (!options.length) {
        setOptions([
          { key: 'A', content: '' },
          { key: 'B', content: '' },
          { key: 'C', content: '' },
          { key: 'D', content: '' },
        ])
      }
    }
  }

  const buildContent = (): Record<string, unknown> => {
    const prev = question?.content || defaultQuestionContent(type)
    const metadata = { ...((prev.metadata || {}) as Record<string, unknown>) }
    if (chapter.trim()) metadata.chapter = chapter.trim()
    else delete metadata.chapter

    const content: Record<string, unknown> = {
      ...prev,
      type,
      title: title.trim(),
      stem,
      explanation,
      images: [...images],
      metadata,
    }

    if (type === 'single_choice' || type === 'multiple_choice') {
      content.options = options.filter((o) => o.key.trim())
      content.answer = textToAnswer(answerText, type)
    } else if (type === 'coding') {
      content.language = language
      content.starterCode = starterCode
      content.testCases = testCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        ...(tc.note?.trim() ? { note: tc.note.trim() } : {}),
      }))
    } else {
      content.answer = []
      delete content.options
    }
    return content
  }

  const uploadPending = async (qid: number) => {
    for (const file of pendingFiles) {
      const res = await api.uploadQuestionImage(qid, file)
      setImages(res.images)
    }
    setPendingFiles([])
  }

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return
    setPendingFiles((prev) => [...prev, ...Array.from(files)])
  }

  const addPastedImages = useCallback(
    async (raw: File[]) => {
      if (!raw.length) return
      const files = raw.map((f, i) => clipboardImageFile(f, i))
      if (question) {
        setBusy(true)
        setErr('')
        try {
          for (const file of files) {
            const res = await api.uploadQuestionImage(question.id, file)
            setImages(res.images)
          }
        } catch (e) {
          setErr(e instanceof Error ? e.message : '粘贴上传失败')
        } finally {
          setBusy(false)
        }
        return
      }
      setPendingFiles((prev) => [...prev, ...files])
    },
    [question],
  )

  const handleImagesPaste = useCallback(
    (e: ClipboardEvent) => {
      const raw = imageFilesFromClipboard(e)
      if (!raw.length) return

      const t = e.target
      const inTextField =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)

      if (inTextField && !clipboardPasteIsImageOnly(e)) return

      e.preventDefault()
      void addPastedImages(raw)
    },
    [addPastedImages],
  )

  useEffect(() => {
    if (!open) return
    const onPaste = (e: ClipboardEvent) => {
      const root = editorRef.current
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return
      handleImagesPaste(e)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, handleImagesPaste])

  const onImagesPaste = (e: React.ClipboardEvent) => {
    handleImagesPaste(e.nativeEvent)
  }

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const removeImage = async (url: string) => {
    if (!question) {
      setImages((prev) => prev.filter((u) => u !== url))
      return
    }
    setBusy(true)
    try {
      const res = await api.deleteQuestionImage(question.id, url)
      setImages(res.images)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除图片失败')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!stem.trim()) {
      setErr('请填写题干')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const content = buildContent()
      let saved: Question
      if (isNew) {
        saved = await api.createQuestion({ type, content })
        if (pendingFiles.length) {
          for (const file of pendingFiles) {
            await api.uploadQuestionImage(saved.id, file)
          }
          saved = await api.getQuestion(saved.id)
        }
      } else {
        saved = await api.patchQuestion(question.id, { type, content })
        if (pendingFiles.length) await uploadPending(question.id)
        if (pendingFiles.length) saved = await api.getQuestion(question.id)
      }
      onSaved(saved)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const isChoice = type === 'single_choice' || type === 'multiple_choice'

  return (
    <div className="question-editor-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={editorRef}
        className="question-editor"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? '新建题目' : '编辑题目'}
      >
        <header className="question-editor-head">
          <h2>{isNew ? '新建题目' : `编辑题目 #${question?.id}`}</h2>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="question-editor-body">
          {err && <p className="practice-alert">{err}</p>}

          <label className="qe-field">
            题型
            <select value={type} onChange={(e) => onTypeChange(e.target.value as QuestionType)}>
              <option value="subjective">大题 / 主观</option>
              <option value="single_choice">单选</option>
              <option value="multiple_choice">多选</option>
              <option value="coding">代码</option>
            </select>
          </label>

          <label className="qe-field">
            标题（可选）
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 7. 【P9】" />
          </label>

          <label className="qe-field">
            章节编号
            <input
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="如 6.1.6、§7.2"
            />
          </label>

          <label className="qe-field">
            题干 <span className="qe-required">*</span>
            <textarea rows={5} value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题目正文，支持 LaTeX" />
          </label>

          {isChoice && (
            <fieldset className="qe-field">
              <legend>选项</legend>
              {options.map((o, i) => (
                <div key={o.key} className="qe-option-row">
                  <input
                    className="qe-option-key"
                    value={o.key}
                    onChange={(e) => {
                      const next = [...options]
                      next[i] = { ...o, key: e.target.value }
                      setOptions(next)
                    }}
                  />
                  <input
                    className="qe-option-content"
                    value={o.content}
                    onChange={(e) => {
                      const next = [...options]
                      next[i] = { ...o, content: e.target.value }
                      setOptions(next)
                    }}
                    placeholder="选项内容"
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  >
                    删
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setOptions([...options, { key: String.fromCharCode(65 + options.length), content: '' }])
                }
              >
                + 选项
              </button>
            </fieldset>
          )}

          {isChoice && (
            <label className="qe-field">
              参考答案（逗号分隔，如 A 或 A,C）
              <input value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
            </label>
          )}

          {type === 'coding' && (
            <>
              <label className="qe-field">
                默认语言
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                </select>
              </label>
              <label className="qe-field">
                初始代码模板（可选）
                <textarea
                  rows={4}
                  value={starterCode}
                  onChange={(e) => setStarterCode(e.target.value)}
                  placeholder="学生打开编辑器时的默认代码"
                  className="qe-code-area"
                />
              </label>
              <fieldset className="qe-field">
                <legend>测试数据（存档对照，不自动判题）</legend>
                <p className="muted qe-hint">每组可填 stdin / 期望 stdout，练习时仅作参考。</p>
                {testCases.map((tc, i) => (
                  <div key={i} className="qe-testcase-block">
                    <input
                      className="qe-testcase-note"
                      value={tc.note || ''}
                      onChange={(e) => {
                        const next = [...testCases]
                        next[i] = { ...tc, note: e.target.value }
                        setTestCases(next)
                      }}
                      placeholder={`用例 ${i + 1} 备注（可选）`}
                    />
                    <label className="qe-testcase-label">
                      输入
                      <textarea
                        rows={2}
                        value={tc.input}
                        onChange={(e) => {
                          const next = [...testCases]
                          next[i] = { ...tc, input: e.target.value }
                          setTestCases(next)
                        }}
                      />
                    </label>
                    <label className="qe-testcase-label">
                      期望输出
                      <textarea
                        rows={2}
                        value={tc.expectedOutput}
                        onChange={(e) => {
                          const next = [...testCases]
                          next[i] = { ...tc, expectedOutput: e.target.value }
                          setTestCases(next)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTestCases(testCases.filter((_, j) => j !== i))}
                    >
                      删除用例
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setTestCases([...testCases, { input: '', expectedOutput: '', note: '' }])
                  }
                >
                  + 测试用例
                </button>
              </fieldset>
            </>
          )}

          <label className="qe-field">
            解析（可选）
            <textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </label>

          <fieldset
            ref={imagesFieldRef}
            className="qe-field qe-images-field"
            tabIndex={0}
            onPaste={onImagesPaste}
            onClick={() => imagesFieldRef.current?.focus()}
          >
            <legend>题目附图</legend>
            <p className="muted qe-hint">
              支持 png / jpg / webp / gif · 编辑弹窗内 <strong>Ctrl+V</strong> 粘贴截图（优先识别剪贴板图片）
            </p>
            <div className="qe-images">
              {images.map((url) => (
                <figure key={url} className="qe-image-item">
                  <img src={url} alt="题目附图" />
                  <button type="button" className="btn" disabled={busy} onClick={() => removeImage(url)}>
                    删除
                  </button>
                </figure>
              ))}
              {pendingFiles.map((f, i) => (
                <figure key={`${f.name}-${i}`} className="qe-image-item qe-image-pending">
                  <span>{f.name}</span>
                  <span className="muted">待保存后上传</span>
                  <button type="button" className="btn" onClick={() => removePending(i)}>
                    移除
                  </button>
                </figure>
              ))}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(e) => {
                onPickFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </fieldset>
        </div>

        <footer className="question-editor-foot">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? '保存中…' : isNew ? '创建' : '保存'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
        </footer>
      </div>
    </div>
  )
}

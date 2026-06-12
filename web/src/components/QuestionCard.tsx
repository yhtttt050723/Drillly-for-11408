import { LazyCodeEditor } from './LazyCodeEditor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShiftPeekReveal } from '../hooks/useShiftPeekReveal'
import {
  api,
  type PracticeSubmitEvent,
  type Question,
  type Submission,
  type TagTreeGroup,
} from '../api'
import { LatexText } from './LatexText'
import {
  codingTestCases,
  defaultStarterCode,
  formatDurationMs,
  normalizeCodingLanguage,
  type CodingLanguage,
  isWordDictation,
  isWrongReview,
  questionImages,
  wordDictationMeta,
  wrongQuestionMeta,
} from '../utils/questionContent'
import { clipboardImageFile, imageFilesFromClipboard } from '../utils/clipboardImages'
import { questionSource, questionChapter } from '../utils/questionSource'
import { isPdfSourceTag, topicTagsFromQuestion } from '../utils/topicTags'
import {
  formatWordSubmissionDirection,
  formatWordSubmissionLabel,
  wordDictationSubStats,
} from '../utils/wordDictationStats'

export type DictationDirection = 'zh2en' | 'en2zh'

type Props = {
  q: Question
  tagGroups: TagTreeGroup[]
  practiceRound: 1 | 2
  onSubmitted: (evt?: PracticeSubmitEvent) => void
  onEdit?: () => void
  onDelete?: () => void
  /** 为 false 时（搜索/编辑弹窗打开）不拦截粘贴 */
  imagePasteEnabled?: boolean
  /** 默写方向：看中写英 / 看英写中 */
  dictationDirection?: DictationDirection
  /** WORD FOREST 极简卡片：隐藏章节、附图等 */
  wordForestMinimal?: boolean
  /** 切换单词后自动聚焦默写输入框 */
  autoFocusWordInput?: boolean
  onPrev?: () => void
  onNext?: () => void
  navIndex?: number
  navTotal?: number
}

function currentTopicGroup(q: Question): string {
  const meta = (q.content?.metadata || {}) as { tag_group?: string }
  if (meta.tag_group) return String(meta.tag_group)
  const g = topicTagsFromQuestion(q).find((t) => !t.name.includes('/'))
  return g?.name ?? ''
}

export function QuestionCard({
  q,
  tagGroups,
  practiceRound,
  onSubmitted,
  onEdit,
  onDelete,
  imagePasteEnabled = true,
  dictationDirection = 'zh2en',
  wordForestMinimal = false,
  autoFocusWordInput = false,
  onPrev,
  onNext,
  navIndex = 0,
  navTotal = 0,
}: Props) {
  const c = q.content
  const [selected, setSelected] = useState<string[]>([])
  const [code, setCode] = useState<CodingLanguage>(() => normalizeCodingLanguage(c.language))
  const [editorCode, setEditorCode] = useState(
    () => String(c.starterCode || '') || defaultStarterCode(normalizeCodingLanguage(c.language)),
  )
  const [showExp, setShowExp] = useState(false)
  const [subs, setSubs] = useState<Submission[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [runOut, setRunOut] = useState('')
  const [subjectiveText, setSubjectiveText] = useState('')
  const [runBusy, setRunBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [chapterDraft, setChapterDraft] = useState('')
  const [chapterBusy, setChapterBusy] = useState(false)
  const [chapterHint, setChapterHint] = useState('')
  const [imagePasteHint, setImagePasteHint] = useState('')
  const [imagePasteBusy, setImagePasteBusy] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(0)
  const [spelling, setSpelling] = useState('')
  const [meaningDraft, setMeaningDraft] = useState('')
  const [revealWord, setRevealWord] = useState(false)
  const [lastSpellOk, setLastSpellOk] = useState<boolean | null>(null)
  const [showTestCases, setShowTestCases] = useState(false)
  const spellInputRef = useRef<HTMLInputElement>(null)
  const meaningInputRef = useRef<HTMLTextAreaElement>(null)

  const wrongMode = isWrongReview(q)
  const wordMode = isWordDictation(q)
  const zh2en = !wordMode || dictationDirection === 'zh2en'
  const focusWordInput = useCallback(() => {
    if (!wordMode) return
    window.requestAnimationFrame(() => {
      if (zh2en) {
        spellInputRef.current?.focus()
      } else {
        meaningInputRef.current?.focus()
      }
    })
  }, [wordMode, zh2en])
  const { peeking, onSpellKeyDown, onSpellKeyUp } = useShiftPeekReveal(wordMode)
  const showAnswer = revealWord || peeking
  const wrongMeta = wrongMode ? wrongQuestionMeta(q) : null
  const wordMeta = wordMode ? wordDictationMeta(q) : null
  const wordSubStats = useMemo(
    () => (wordMode ? wordDictationSubStats(subs) : null),
    [wordMode, subs],
  )

  const loadSubs = () => {
    api.submissions(q.id).then(setSubs).catch(() => setSubs([]))
  }

  useEffect(() => {
    loadSubs()
    setSelected([])
    setSubjectiveText('')
    setShowExp(false)
    setChapterDraft(questionChapter(q))
    setChapterHint('')
    setImagePasteHint('')
    setStartedAt(Date.now())
    setElapsedMs(0)
    setSpelling('')
    setMeaningDraft('')
    setRevealWord(false)
    setLastSpellOk(null)
    setShowTestCases(false)
    if (q.type === 'coding') {
      const lang = normalizeCodingLanguage(c.language)
      const starter = String(c.starterCode || '')
      setCode(lang)
      setEditorCode(starter || defaultStarterCode(lang))
    }
    if (autoFocusWordInput && isWordDictation(q)) {
      focusWordInput()
    }
  }, [q.id, dictationDirection, q.type, autoFocusWordInput, focusWordInput, c.language, c.starterCode])

  useEffect(() => {
    const tick = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 1000)
    return () => window.clearInterval(tick)
  }, [startedAt, q.id])

  useEffect(() => {
    if (!imagePasteEnabled) return
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return
      }
      const raw = imageFilesFromClipboard(e)
      if (!raw.length) return
      e.preventDefault()
      setImagePasteBusy(true)
      setImagePasteHint('')
      try {
        for (let i = 0; i < raw.length; i++) {
          await api.uploadQuestionImage(q.id, clipboardImageFile(raw[i], i))
        }
        setImagePasteHint(`已粘贴 ${raw.length} 张附图`)
        onSubmitted()
      } catch (err) {
        setImagePasteHint(err instanceof Error ? err.message : '粘贴上传失败')
      } finally {
        setImagePasteBusy(false)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [q.id, imagePasteEnabled, onSubmitted])

  const src = questionSource(q)
  const badge =
    q.type === 'single_choice'
      ? 'badge-single'
      : q.type === 'multiple_choice'
        ? 'badge-multi'
        : q.type === 'subjective'
          ? 'badge-subjective'
          : q.type === 'wrong_review'
            ? 'badge-wrong'
            : q.type === 'word_dictation'
              ? 'badge-word'
              : 'badge-code'

  const toggle = (key: string) => {
    if (q.type === 'single_choice') setSelected([key])
    else {
      setSelected((prev) =>
        prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
      )
    }
  }

  const submit = async (selfMark?: 'correct' | 'wrong') => {
    setSubmitBusy(true)
    try {
      let answer: Record<string, unknown>
      if (wrongMode && selfMark) {
        answer = { self_mark: selfMark }
      } else if (wordMode && selfMark) {
        answer = {
          self_mark: selfMark,
          dictation_direction: dictationDirection,
        }
        const res = await api.submit({
          question_id: q.id,
          answer,
          duration_ms: Date.now() - startedAt,
          practice_round: practiceRound,
        })
        loadSubs()
        if (selfMark === 'correct') {
          setSpelling('')
          setMeaningDraft('')
          setRevealWord(false)
          setLastSpellOk(null)
        } else {
          focusWordInput()
        }
        onSubmitted({
          questionId: q.id,
          practice: res.practice ?? undefined,
          refreshQuestion: selfMark === 'correct',
          selfMark,
          isCorrect: selfMark === 'correct',
          autoAdvance: selfMark === 'correct',
        })
        setSubmitBusy(false)
        return
      } else if (wordMode && dictationDirection === 'en2zh') {
        answer = {
          value: meaningDraft.trim(),
          meaning: meaningDraft.trim(),
          dictation_direction: dictationDirection,
        }
      } else if (wordMode) {
        answer = {
          value: spelling.trim(),
          spelling: spelling.trim(),
          dictation_direction: dictationDirection,
        }
      } else if (q.type === 'coding') {
        answer = { value: editorCode, code: editorCode, language: code }
      } else if (q.type === 'subjective') {
        answer = { value: subjectiveText }
      } else if (q.type === 'single_choice') {
        answer = { value: selected[0] }
      } else {
        answer = { value: selected }
      }
      const res = await api.submit({
        question_id: q.id,
        answer,
        language: q.type === 'coding' ? code : undefined,
        duration_ms: Date.now() - startedAt,
        practice_round: practiceRound,
      })
      setShowExp(true)
      if (wordMode && !selfMark && dictationDirection === 'zh2en') {
        setLastSpellOk(res.submission.is_correct)
        if (!res.submission.is_correct) {
          setRevealWord(true)
          focusWordInput()
        }
      }
      if (wordMode && dictationDirection === 'en2zh' && !selfMark) {
        setRevealWord(true)
      }
      loadSubs()
      const ok = Boolean(res.submission.is_correct)
      const evt: PracticeSubmitEvent = {
        questionId: q.id,
        practice: res.practice ?? undefined,
        refreshQuestion: wordMode ? ok : true,
        selfMark,
        isCorrect: ok,
      }
      const advance =
        wordMode
          ? selfMark === 'correct' ||
            (!selfMark && ok && dictationDirection === 'zh2en')
          : (selfMark === 'correct' && wrongMode) ||
            (!selfMark &&
              ok &&
              (q.type === 'single_choice' || q.type === 'multiple_choice'))

      if (wordMode && !selfMark && ok && dictationDirection === 'zh2en') {
        setSpelling('')
        setRevealWord(false)
        setLastSpellOk(null)
      }

      if (evt.practice || evt.refreshQuestion || evt.selfMark) {
        onSubmitted({ ...evt, autoAdvance: advance })
      } else {
        onSubmitted({ questionId: q.id, isCorrect: res.submission.is_correct, autoAdvance: advance })
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitBusy(false)
    }
  }

  const setGroupTag = async (groupName: string) => {
    const pdfIds = q.tags.filter((t) => isPdfSourceTag(t.name)).map((t) => t.id)
    const childTags = topicTagsFromQuestion(q).filter((t) => t.name.includes('/'))
    let tagIds = childTags
      .filter((t) => !groupName || t.name.startsWith(`${groupName}/`))
      .map((t) => t.id)

    if (groupName) {
      let groupId = tagGroups.find((g) => g.name === groupName)?.id
      if (!groupId) {
        const created = await api.createTag({ name: groupName })
        groupId = created.id
      }
      tagIds = [groupId, ...tagIds]
    }

    await api.patchQuestion(q.id, { tag_ids: [...pdfIds, ...tagIds] })
    onSubmitted({ questionId: q.id, refreshQuestion: true })
  }

  const saveChapter = async () => {
    const trimmed = chapterDraft.trim()
    if (trimmed === questionChapter(q)) return
    setChapterBusy(true)
    setChapterHint('')
    try {
      const prevMeta = (q.content?.metadata || {}) as Record<string, unknown>
      const metadata = { ...prevMeta }
      if (trimmed) metadata.chapter = trimmed
      else delete metadata.chapter
      await api.patchQuestion(q.id, {
        content: { ...q.content, metadata },
      })
      setChapterDraft(trimmed)
      setChapterHint('已保存')
      onSubmitted({ questionId: q.id, refreshQuestion: true })
    } catch (e) {
      setChapterHint(e instanceof Error ? e.message : '保存失败')
    } finally {
      setChapterBusy(false)
    }
  }

  const markRound = async (round: 1 | 2, done: boolean) => {
    setSubmitBusy(true)
    try {
      const res = await api.setPracticeProgress(q.id, round, done)
      onSubmitted({ questionId: q.id, practice: res.practice })
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新进度失败')
    } finally {
      setSubmitBusy(false)
    }
  }

  const runCode = async () => {
    setRunBusy(true)
    try {
      const r = await api.runCode({ language: code, code: editorCode })
      setRunOut(
        [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, `exit: ${r.exit_code}`]
          .filter(Boolean)
          .join('\n'),
      )
    } catch (e) {
      setRunOut(e instanceof Error ? e.message : '运行失败')
    } finally {
      setRunBusy(false)
    }
  }

  const hideEnglishTitle = wordForestMinimal && wordMode && zh2en
  const unitLabel =
    wordMeta?.unit != null && String(wordMeta.unit).trim()
      ? String(wordMeta.unit).replace(/^.*[Uu]nit\s*/i, '').replace(/\D/g, '') ||
        String(wordMeta.unit)
      : ''

  return (
    <article className={`card question-card${wordForestMinimal ? ' question-card--wf' : ''}`}>
      <header className={`question-card-header${wordForestMinimal ? ' question-card-header--wf' : ''}`}>
        <span className={`badge ${badge}`}>
          {q.type === 'single_choice'
            ? '单选'
            : q.type === 'multiple_choice'
              ? '多选'
              : q.type === 'subjective'
                ? '大题/主观'
                : q.type === 'wrong_review'
                  ? '刷错题'
                  : q.type === 'word_dictation'
                    ? '默写单词'
                    : '代码'}
        </span>
        {hideEnglishTitle ? (
          unitLabel ? (
            <span className="wf-practice-unit-pill">Unit {unitLabel}</span>
          ) : (
            <span className="wf-practice-unit-pill wf-practice-unit-pill--muted">默写</span>
          )
        ) : (
          <strong className="question-card-title">{String(c.title || `题目 #${q.id}`)}</strong>
        )}
        {!wordForestMinimal && (
          <span className="question-admin-actions">
            {onEdit && (
              <button type="button" className="btn btn-sm" onClick={onEdit}>
                编辑
              </button>
            )}
            {onDelete && (
              <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
                删除
              </button>
            )}
          </span>
        )}
        {!wordForestMinimal && (
        <div className="question-card-tools">
          <select
            value={currentTopicGroup(q)}
            onChange={(e) => {
              setGroupTag(e.target.value).catch((err) =>
                alert(err instanceof Error ? err.message : '更新主题大标签失败'),
              )
            }}
            title="主题大标签（与 PDF 来源分开）"
          >
            <option value="">无主题大标签</option>
            {(() => {
              const cur = currentTopicGroup(q)
              const extra = cur && !tagGroups.some((g) => g.name === cur) ? [cur] : []
              return [...extra, ...tagGroups.map((g) => g.name)].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))
            })()}
          </select>
          {q.practice && (
            <span className="round-badges">
              <span className={q.practice.round1 ? 'badge round-done' : 'badge round-pending'}>
                一刷{q.practice.round1 ? '✓' : '○'}
              </span>
              <span className={q.practice.round2 ? 'badge round-done' : 'badge round-pending'}>
                二刷{q.practice.round2 ? '✓' : '○'}
              </span>
            </span>
          )}
          {topicTagsFromQuestion(q)
            .filter((t) => t.name.includes('/'))
            .map((t) => (
              <span key={t.id} className="badge badge-tag">
                {t.name.split('/').slice(1).join('/')}
              </span>
            ))}
        </div>
        )}
      </header>

      {!wordForestMinimal && (
      <div className="practice-timer" aria-live="polite">
        <span className="practice-timer-label">本题用时</span>
        <strong className="practice-timer-value">{formatDurationMs(elapsedMs)}</strong>
      </div>
      )}

      {wordMode && wordSubStats && (
        <div className="word-wrong-stats" aria-live="polite">
          <span>
            本题累计错 <strong>{wordSubStats.wrongTotal}</strong> 次
          </span>
          <span className="word-wrong-stats-detail">
            看中写英错 <strong>{wordSubStats.zh2enWrong}</strong> · 看英写中错{' '}
            <strong>{wordSubStats.en2zhWrong}</strong>
          </span>
        </div>
      )}

      {wordMeta && wordMode && (
        <div className={`word-dictation-prompt${wordForestMinimal ? ' word-dictation-prompt--wf' : ''}`}>
          {!wordForestMinimal && wordMeta.unit && (
            <span className="badge badge-tag">Unit {wordMeta.unit}</span>
          )}
          {zh2en ? (
            <>
              <p className="word-meaning">{wordMeta.meaning || String(c.stem || '（无释义）')}</p>
              {wordMeta.phonetic && <p className="word-phonetic">{wordMeta.phonetic}</p>}
            </>
          ) : (
            <>
              <p className="word-en-display">{wordMeta.word}</p>
              {wordMeta.phonetic && <p className="word-phonetic">{wordMeta.phonetic}</p>}
              {showAnswer && wordMeta.meaning && (
                <p className="word-meaning word-meaning--peek">{wordMeta.meaning}</p>
              )}
            </>
          )}
          {wordMeta.hint && <p className="word-hint muted">{wordMeta.hint}</p>}
          {wordForestMinimal && (
            <p className="word-space-hint muted">长按 Shift {zh2en ? '显示英文' : '显示释义'}</p>
          )}
        </div>
      )}

      {wordMode && zh2en && (
        <div className="word-spell-block">
          <label className="word-spell-label" htmlFor={`spell-${q.id}`}>
            默写英文（Enter 检查）
          </label>
          <input
            id={`spell-${q.id}`}
            ref={spellInputRef}
            className="word-spell-input"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={spelling}
            onChange={(e) => {
              setSpelling(e.target.value)
              setLastSpellOk(null)
            }}
            onKeyDown={(e) => {
              onSpellKeyDown(e)
              if (e.key === 'Enter' && !submitBusy) {
                e.preventDefault()
                submit()
              }
            }}
            onKeyUp={onSpellKeyUp}
            placeholder="输入英文单词"
          />
          {showAnswer && (
            <p className={`word-answer-reveal${peeking ? ' word-answer-reveal--peek' : ''}`}>
              正确答案：<strong>{wordMeta?.word}</strong>
            </p>
          )}
          {lastSpellOk !== null && (
            <p className={lastSpellOk ? 'word-result word-result--ok' : 'word-result word-result--bad'}>
              {lastSpellOk ? '拼写正确' : '拼写有误'}
            </p>
          )}
        </div>
      )}

      {wordMode && !zh2en && (
        <div className="word-spell-block">
          <label className="word-spell-label" htmlFor={`meaning-${q.id}`}>
            默写中文释义（对照后自评）
          </label>
          <textarea
            id={`meaning-${q.id}`}
            ref={meaningInputRef}
            className="word-meaning-input"
            rows={3}
            value={meaningDraft}
            onChange={(e) => setMeaningDraft(e.target.value)}
            onKeyDown={onSpellKeyDown}
            onKeyUp={onSpellKeyUp}
            placeholder="输入中文意思"
          />
        </div>
      )}

      {wrongMeta && (
        <div className="wrong-meta-row">
          {wrongMeta.questionNumber && (
            <span className="badge badge-wrong-num">题号 {wrongMeta.questionNumber}</span>
          )}
          {wrongMeta.book && <span className="badge badge-tag">{wrongMeta.book}</span>}
          {wrongMeta.extraTags.map((t) => (
            <span key={t} className="badge badge-tag">
              {t}
            </span>
          ))}
        </div>
      )}

      {!wordForestMinimal && (
      <>
      <div className="question-meta-row">
        <label className="question-chapter-label" title="写入题目 metadata.chapter，错题导出与左侧列表会显示">
          <span className="question-chapter-label-text">章节编号</span>
          <input
            className="question-chapter-input"
            type="text"
            value={chapterDraft}
            onChange={(e) => {
              setChapterDraft(e.target.value)
              setChapterHint('')
            }}
            onBlur={() => {
              saveChapter().catch(() => {})
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            placeholder="如 6.1.6、§7.2、第七章"
            disabled={chapterBusy}
            maxLength={64}
          />
        </label>
        {chapterHint ? (
          <span
            className={
              chapterHint === '已保存' ? 'question-chapter-hint question-chapter-hint--ok' : 'question-chapter-hint'
            }
          >
            {chapterHint}
          </span>
        ) : null}
      </div>
      {(src.pdf || src.path || wrongMeta?.sourceLabel) && (
        <p className="question-source" title={wrongMeta?.sourcePath || src.path || src.pdf}>
          出处：{wrongMeta?.sourceLabel || src.pdf || '（未知 PDF）'}
          {(wrongMeta?.sourcePath || src.path) ? ` · ${wrongMeta?.sourcePath || src.path}` : ''}
        </p>
      )}

      {wrongMode && questionImages(q).length === 0 && (
        <p className="question-image-missing muted">
          题目图片未加载。请点上方「修复图片/标签」或重新导入该科目。
        </p>
      )}

      {questionImages(q).length > 0 && (
        <div className={`question-images${wrongMode ? ' question-images--wrong' : ''}`}>
          {questionImages(q).map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="题目附图" />
            </a>
          ))}
        </div>
      )}
      {!wrongMode && (
        <p className="question-image-paste-hint muted">
          {imagePasteBusy
            ? '正在上传粘贴的截图…'
            : imagePasteHint || '题目附图：在此页 Ctrl+V 粘贴截图，或点「编辑」上传'}
        </p>
      )}
      </>
      )}

      {!wrongMode && !wordMode && (
        <div className="stem">
          <LatexText text={String(c.stem || '')} />
        </div>
      )}

      {q.type === 'subjective' && !wrongMode && (
        <textarea
          className="subjective-input"
          rows={6}
          style={{ width: '100%', marginTop: 8 }}
          placeholder="在此作答（主观题不自动判分，可对照解析后标记一刷/二刷完成）"
          value={subjectiveText}
          onChange={(e) => setSubjectiveText(e.target.value)}
        />
      )}

      {q.type !== 'coding' &&
        q.type !== 'subjective' &&
        q.type !== 'wrong_review' &&
        q.type !== 'word_dictation' && (
        <div className="options">
          {(c.options as { key: string; content: string }[] | undefined)?.map((o) => (
            <label key={o.key}>
              <input
                type={q.type === 'single_choice' ? 'radio' : 'checkbox'}
                name={`q-${q.id}`}
                checked={selected.includes(o.key)}
                onChange={() => toggle(o.key)}
              />{' '}
              <strong>{o.key}.</strong> <LatexText text={o.content} />
            </label>
          ))}
        </div>
      )}

      {q.type === 'coding' && (
        <>
          {(() => {
            const cases = codingTestCases(c)
            if (!cases.length) return null
            return (
              <section className="coding-testcases">
                <button
                  type="button"
                  className="btn coding-testcases-toggle"
                  onClick={() => setShowTestCases((v) => !v)}
                >
                  {showTestCases ? '收起' : '展开'} 测试数据（{cases.length} 组 · 仅对照）
                </button>
                {showTestCases && (
                  <div className="coding-testcases-list">
                    {cases.map((tc, i) => (
                      <details key={i} className="coding-testcase-item" open={i === 0}>
                        <summary>{tc.note?.trim() || `用例 ${i + 1}`}</summary>
                        <div className="coding-testcase-io">
                          <div>
                            <strong>输入</strong>
                            <pre>{tc.input || '（空）'}</pre>
                          </div>
                          <div>
                            <strong>期望输出</strong>
                            <pre>{tc.expectedOutput || '（空）'}</pre>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </section>
            )
          })()}
          <select
            value={code}
            onChange={(e) => setCode(normalizeCodingLanguage(e.target.value))}
            style={{ marginBottom: 8 }}
          >
            <option value="c">C</option>
            <option value="cpp">C++</option>
          </select>
          <LazyCodeEditor
            language={code === 'cpp' ? 'cpp' : code}
            value={editorCode}
            onChange={setEditorCode}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={runCode} disabled={runBusy}>
              {runBusy ? '运行中…' : '运行'}
            </button>
          </div>
          {runOut && <pre className="runner-out">{runOut}</pre>}
        </>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {wrongMode || wordMode ? (
          <>
            {wordMode && zh2en && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitBusy || !spelling.trim()}
                onClick={() => submit()}
              >
                {submitBusy ? '提交中…' : '检查拼写'}
              </button>
            )}
            {wordMode && !zh2en && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitBusy}
                onClick={() => setRevealWord(true)}
              >
                对照释义
              </button>
            )}
            <button
              type="button"
              className="btn btn-success"
              disabled={submitBusy}
              onClick={() => submit('correct')}
            >
              {submitBusy ? '记录中…' : wordMode ? '✓ 对了' : '✓ 做对了'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={submitBusy}
              onClick={() => submit('wrong')}
            >
              {submitBusy ? '记录中…' : wordMode ? '✗ 错了' : '✗ 又错了'}
            </button>
            {wordMode && !revealWord && (
              <button
                type="button"
                className="btn"
                disabled={submitBusy}
                onClick={() => setRevealWord(true)}
              >
                先看答案
              </button>
            )}
          </>
        ) : q.type === 'coding' ? (
          <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={submitBusy}>
            {submitBusy ? '提交中…' : `提交代码（记入${practiceRound === 1 ? '一刷' : '二刷'} · 不判对错）`}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={submitBusy}>
            {submitBusy ? '提交中…' : `提交（记入${practiceRound === 1 ? '一刷' : '二刷'}）`}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={submitBusy}
          onClick={() => markRound(1, !q.practice?.round1)}
        >
          {q.practice?.round1 ? '取消一刷' : '标记一刷完成'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={submitBusy}
          onClick={() => markRound(2, !q.practice?.round2)}
        >
          {q.practice?.round2 ? '取消二刷' : '标记二刷完成'}
        </button>
      </div>

      {showExp && Boolean(c.explanation) && (
        <div className="explanation">
          <strong>解析</strong>
          <div>
            <LatexText text={String(c.explanation)} />
          </div>
        </div>
      )}

      {navTotal > 1 && onPrev && onNext && (
        <nav className="question-seq-nav" aria-label="题目导航">
          <button type="button" className="btn" onClick={onPrev}>
            ← 上一题
          </button>
          <span className="question-seq-nav-counter">
            {navIndex + 1} / {navTotal}
          </span>
          <button type="button" className="btn btn-primary" onClick={onNext}>
            下一题 →
          </button>
        </nav>
      )}

      <section className={`sub-list${wordMode ? ' sub-list--word' : ''}`}>
        <strong>提交记录 ({subs.length})</strong>
        {subs.length === 0 && wordMode && (
          <p className="muted word-sub-empty">暂无记录，检查拼写或点「对了/错了」后会显示在这里。</p>
        )}
        {subs.map((s) => (
          <div key={s.id} className="sub-item">
            <button type="button" className="btn" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              {new Date(s.created_at).toLocaleString()} ·{' '}
              {wordMode ? (
                <>
                  {formatWordSubmissionDirection(s)} · {formatWordSubmissionLabel(s)}
                </>
              ) : q.type === 'coding' ? (
                `已提交 · ${String(s.answer.language || '—')}`
              ) : s.is_correct ? (
                '✓ 做对'
              ) : (
                '✗ 做错'
              )}{' '}
              · {s.duration_ms != null ? formatDurationMs(s.duration_ms) : '—'}
            </button>
            {expanded === s.id && wordMode && (
              <div className="word-sub-detail muted">
                {s.answer.spelling != null || s.answer.value != null ? (
                  <p>
                    作答：{String(s.answer.spelling ?? s.answer.value ?? s.answer.meaning ?? '—')}
                  </p>
                ) : null}
                {s.answer.self_mark ? <p>自评：{String(s.answer.self_mark)}</p> : null}
              </div>
            )}
            {expanded === s.id && q.type === 'coding' && (
              <>
                <pre className="runner-out" style={{ marginTop: 8 }}>
                  {String(s.answer.code || s.answer.value || '')}
                </pre>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const lang = normalizeCodingLanguage(s.answer.language)
                    setCode(lang)
                    setEditorCode(String(s.answer.code || s.answer.value || ''))
                  }}
                >
                  恢复此代码
                </button>
              </>
            )}
          </div>
        ))}
      </section>
    </article>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type PdfSource,
  type PracticeSubmitEvent,
  type ProgressSummary,
  type Question,
  type TagTreeGroup,
} from '../api'
import { QuestionCard } from '../components/QuestionCard'
import { QuestionSidebar } from '../components/QuestionSidebar'
import { QuestionEditor } from '../components/QuestionEditor'
import { QuestionSearchPalette } from '../components/QuestionSearchPalette'
import { PracticeControlsPanel } from '../components/PracticeControlsPanel'
import { PracticeModeTabs } from '../components/PracticeModeTabs'
import { canConvertToCoding } from '../utils/questionContent'
import {
  WordForestSidebar,
  type DictationDirection,
} from '../components/wordForest/WordForestSidebar'
import { WordRandomPractice } from '../components/wordForest/WordRandomPractice'
import { TagRandomPractice } from '../components/TagRandomPractice'
import { PracticeWrongBoard } from '../components/PracticeWrongBoard'
import { WordUnitBoard } from '../components/wordForest/WordUnitBoard'
import { ListPager } from '../components/ListPager'
import { useWordStudyTimer } from '../hooks/useWordStudyTimer'

export type PracticeMode = 'normal' | 'wrong_review' | 'word_dictation'

const WORD_PAGE_SIZE = 50
type WfPane = 'board' | 'dictation'
type NormalPane = 'practice' | 'wrong-board'

export function PracticePage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [pdfSources, setPdfSources] = useState<PdfSource[]>([])
  const [summary, setSummary] = useState<ProgressSummary | null>(null)
  const [tagTree, setTagTree] = useState<TagTreeGroup[]>([])
  const [pdfFilter, setPdfFilter] = useState('')
  const [tagGroupFilter, setTagGroupFilter] = useState('')
  const [tagChildFilter, setTagChildFilter] = useState('')
  const [practiceRound, setPracticeRound] = useState<1 | 2>(1)
  const [roundStatus, setRoundStatus] = useState<'' | 'pending' | 'done'>('')
  const [randomOrder, setRandomOrder] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorQuestion, setEditorQuestion] = useState<Question | null>(null)
  const [err, setErr] = useState('')
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('normal')
  const [selfMarkFilter, setSelfMarkFilter] = useState<'' | 'unmarked' | 'wrong' | 'correct'>('')
  const [dictationDirection, setDictationDirection] = useState<DictationDirection>('zh2en')
  const [randomDictation, setRandomDictation] = useState(false)
  const [wordWrongStats, setWordWrongStats] = useState({ last_mark_wrong: 0, total_words: 0 })
  const [wordBookFilter, setWordBookFilter] = useState('基础词')
  const [wordUnitFilter, setWordUnitFilter] = useState('')
  const [convertBusy, setConvertBusy] = useState(false)
  const [wfPane, setWfPane] = useState<WfPane>('board')
  const [practiceOffset, setPracticeOffset] = useState(0)
  const [practiceTotal, setPracticeTotal] = useState(0)
  const [unitWordTotal, setUnitWordTotal] = useState(0)
  const [boardRefreshKey, setBoardRefreshKey] = useState(0)
  const [resetBusy, setResetBusy] = useState(false)
  const [randomPractice, setRandomPractice] = useState(false)
  const [randomBusy, setRandomBusy] = useState(false)
  const [randomSessionKey, setRandomSessionKey] = useState(0)
  const [randomActiveQuestion, setRandomActiveQuestion] = useState<Question | null>(null)
  const [dailyStatsRefreshKey, setDailyStatsRefreshKey] = useState(0)
  const [normalPane, setNormalPane] = useState<NormalPane>('practice')
  const [wrongBoardRefreshKey, setWrongBoardRefreshKey] = useState(0)

  const hasTopicFilter = Boolean(tagGroupFilter || tagChildFilter)
  const hasSearch = Boolean(searchQuery)

  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchText.trim()), 300)
    return () => window.clearTimeout(t)
  }, [searchText])

  const buildFilterParams = useCallback(() => {
    const p = new URLSearchParams()
    if (pdfFilter) p.set('source_pdf', pdfFilter)
    const tag = tagChildFilter || tagGroupFilter
    if (tag) p.set('tags', tag)
    if (practiceRound) p.set('practice_round', String(practiceRound))
    if (roundStatus) p.set('round_status', roundStatus)
    if (practiceMode === 'wrong_review') {
      p.set('type', 'wrong_review')
      if (selfMarkFilter) p.set('self_mark_status', selfMarkFilter)
    }
    if (practiceMode === 'word_dictation') {
      p.set('type', 'word_dictation')
      if (selfMarkFilter) p.set('self_mark_status', selfMarkFilter)
      if (wordBookFilter && wordUnitFilter) {
        p.set('tags', `${wordBookFilter}/Unit${wordUnitFilter}`)
      } else if (wordBookFilter) {
        p.set('tags', wordBookFilter)
      }
    }
    return p
  }, [
    pdfFilter,
    tagGroupFilter,
    tagChildFilter,
    practiceRound,
    roundStatus,
    practiceMode,
    selfMarkFilter,
    wordBookFilter,
    wordUnitFilter,
  ])

  const buildParams = useCallback(() => {
    const p = buildFilterParams()
    if (searchQuery) p.set('search', searchQuery)
    if (randomOrder) p.set('order', 'random')
    return p
  }, [buildFilterParams, searchQuery, randomOrder])

  const wordWrongOnly = useMemo((): '' | 'wrong' | 'correct' | 'unmarked' => {
    if (selfMarkFilter === 'wrong') return 'wrong'
    if (selfMarkFilter === 'correct') return 'correct'
    if (selfMarkFilter === 'unmarked') return 'unmarked'
    return ''
  }, [selfMarkFilter])

  const randomFilterLabel = useMemo(() => {
    const parts: string[] = []
    if (pdfFilter) parts.push(pdfFilter.replace(/\.pdf$/i, ''))
    if (tagChildFilter) {
      const short = tagChildFilter.includes('/')
        ? tagChildFilter.split('/').pop()!
        : tagChildFilter
      parts.push(short)
    } else if (tagGroupFilter) {
      parts.push(tagGroupFilter)
    }
    parts.push(practiceRound === 1 ? '一刷' : '二刷')
    if (roundStatus === 'pending') parts.push('未完成')
    else if (roundStatus === 'done') parts.push('已完成')
    if (practiceMode === 'wrong_review') {
      if (selfMarkFilter === 'unmarked') parts.push('未刷')
      else if (selfMarkFilter === 'wrong') parts.push('又错了')
      else if (selfMarkFilter === 'correct') parts.push('做对了')
    }
    if (searchQuery) parts.push(`搜:${searchQuery}`)
    return parts.join(' · ')
  }, [
    pdfFilter,
    tagGroupFilter,
    tagChildFilter,
    practiceRound,
    roundStatus,
    practiceMode,
    selfMarkFilter,
    searchQuery,
  ])

  const load = useCallback(() => {
    if (randomPractice) return
    if (practiceMode === 'word_dictation' && wfPane === 'board') return

    const p = buildParams()
    if (practiceMode === 'word_dictation' && randomDictation) {
      p.set('order', 'random')
      p.set('limit', '500')
      p.set('offset', '0')
      api
        .listPracticeQuestions(p)
        .then((raw) => {
          const qs = Array.isArray(raw) ? raw : raw.items
          setQuestions(qs)
          setPracticeTotal(qs.length)
          setActiveId((prev) => {
            if (!qs.length) return null
            if (prev && qs.some((q) => q.id === prev)) return prev
            return qs[0].id
          })
        })
        .catch((e) => setErr(e.message))
      return
    }

    p.set('limit', String(WORD_PAGE_SIZE))
    p.set('offset', String(practiceOffset))
    if (randomOrder) p.set('order', 'random')

    api
      .listPracticeQuestionsPaged(p)
      .then((res) => {
        setQuestions(res.items)
        setPracticeTotal(res.total)
        setActiveId((prev) => {
          if (!res.items.length) return null
          if (prev && res.items.some((q) => q.id === prev)) return prev
          return res.items[0].id
        })
      })
      .catch((e) => setErr(e.message))
  }, [buildParams, practiceMode, wfPane, randomDictation, randomOrder, practiceOffset, randomPractice])

  const loadSummary = useCallback(() => {
    api.progressSummary(pdfFilter || undefined).then(setSummary).catch(() => setSummary(null))
    setDailyStatsRefreshKey((k) => k + 1)
    setWrongBoardRefreshKey((k) => k + 1)
  }, [pdfFilter])

  useEffect(() => {
    api.listTagTree().then(setTagTree).catch(() => {})
    api.listPdfSources().then(setPdfSources).catch(() => {})
    api.getWordWrongStats().then(setWordWrongStats).catch(() => {})
  }, [])

  const refreshWordWrongStats = useCallback(() => {
    api.getWordWrongStats().then(setWordWrongStats).catch(() => {})
  }, [])

  useEffect(() => {
    setPracticeOffset(0)
  }, [
    pdfFilter,
    tagGroupFilter,
    tagChildFilter,
    practiceRound,
    roundStatus,
    practiceMode,
    selfMarkFilter,
    wordBookFilter,
    wordUnitFilter,
    searchQuery,
    randomOrder,
  ])

  useEffect(() => {
    load()
    loadSummary()
  }, [load, loadSummary])

  useEffect(() => {
    let lastFocus = 0
    const onFocus = () => {
      const now = Date.now()
      if (now - lastFocus < 30_000) return
      lastFocus = now
      load()
      loadSummary()
      api.listPdfSources().then(setPdfSources).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, loadSummary])

  const clearFilters = () => {
    setPdfFilter('')
    setTagGroupFilter('')
    setTagChildFilter('')
    setRoundStatus('')
    setSearchText('')
    setSearchQuery('')
    setSelfMarkFilter('')
  }

  const startRandomPractice = useCallback(async () => {
    setRandomBusy(true)
    try {
      const p = buildFilterParams()
      if (searchQuery) p.set('search', searchQuery)
      p.set('limit', '500')
      p.set('offset', '0')
      const res = await api.listPracticeQuestionsPaged(p)
      if (!res.items.length) {
        alert('当前筛选下没有题目，请调整 PDF、大/小标签或其他条件。')
        return
      }
      setQuestions(res.items)
      setPracticeTotal(res.total)
      setRandomSessionKey((k) => k + 1)
      setRandomActiveQuestion(null)
      setRandomPractice(true)
      setPracticeOffset(0)
    } catch (e) {
      alert(e instanceof Error ? e.message : '加载失败')
    } finally {
      setRandomBusy(false)
    }
  }, [buildFilterParams, searchQuery])

  const exitRandomPractice = () => {
    setRandomPractice(false)
    setRandomActiveQuestion(null)
    setPracticeOffset(0)
  }

  const switchMode = (mode: PracticeMode) => {
    setPracticeMode(mode)
    setRandomPractice(false)
    setRandomDictation(false)
    setNormalPane('practice')
    setWfPane(mode === 'word_dictation' ? 'board' : 'dictation')
    setPracticeOffset(0)
    if (mode === 'wrong_review') {
      setRoundStatus('pending')
      setSelfMarkFilter('unmarked')
    } else if (mode === 'word_dictation') {
      setRoundStatus('')
      setSelfMarkFilter('')
    } else {
      setSelfMarkFilter('')
    }
  }

  const isWordForest = practiceMode === 'word_dictation'

  useEffect(() => {
    if (!isWordForest || !wordUnitFilter) {
      setUnitWordTotal(0)
      return
    }
    api
      .listWords({ book: wordBookFilter, unit: wordUnitFilter, limit: 1 })
      .then((r) => setUnitWordTotal(r.total))
      .catch(() => setUnitWordTotal(0))
  }, [isWordForest, wordBookFilter, wordUnitFilter, boardRefreshKey])

  const { recordWordDone } = useWordStudyTimer(isWordForest, {
    book: wordBookFilter,
    unit: wordUnitFilter,
  })

  const currentIdx = questions.findIndex((q) => q.id === activeId)
  const listCurrent = currentIdx >= 0 ? questions[currentIdx] : questions[0]
  const effectiveCurrent = randomPractice ? randomActiveQuestion : listCurrent

  const currentQuestionSummary = useMemo(() => {
    if (!effectiveCurrent) return null
    const c = effectiveCurrent.content || {}
    const raw = String(c.title || c.stem || `题目 #${effectiveCurrent.id}`)
      .replace(/\s+/g, ' ')
      .trim()
    return {
      id: effectiveCurrent.id,
      type: effectiveCurrent.type,
      title: raw.length > 56 ? `${raw.slice(0, 56)}…` : raw,
    }
  }, [effectiveCurrent])

  const convertCurrentToCoding = async () => {
    if (!effectiveCurrent || !canConvertToCoding(effectiveCurrent.type)) return
    if (
      !window.confirm(
        `将题目 #${effectiveCurrent.id} 转为代码题？\n· 题干、解析、附图保留\n· 选项将移除\n· 可在「编辑」中填写测试数据\n· 提交代码仅存档，不自动判对错`,
      )
    ) {
      return
    }
    setConvertBusy(true)
    try {
      const saved = await api.convertQuestionToCoding(effectiveCurrent.id)
      setQuestions((prev) => prev.map((q) => (q.id === saved.id ? { ...q, ...saved } : q)))
      if (randomPractice) {
        setRandomActiveQuestion((prev) => (prev?.id === saved.id ? { ...prev, ...saved } : prev))
      } else {
        setActiveId(saved.id)
      }
      loadSummary()
    } catch (e) {
      alert(e instanceof Error ? e.message : '转换失败')
    } finally {
      setConvertBusy(false)
    }
  }

  const goPrev = useCallback(() => {
    if (questions.length < 2) return
    const i = currentIdx <= 0 ? questions.length - 1 : currentIdx - 1
    setActiveId(questions[i].id)
  }, [questions, currentIdx])

  const goNext = useCallback(() => {
    if (questions.length < 2) return
    const i = currentIdx < 0 || currentIdx >= questions.length - 1 ? 0 : currentIdx + 1
    setActiveId(questions[i].id)
  }, [questions, currentIdx])

  const jumpToWrongQuestion = useCallback(
    async (questionId: number) => {
      setNormalPane('practice')
      if (!questions.some((q) => q.id === questionId)) {
        try {
          const q = await api.getQuestion(questionId)
          setQuestions((prev) => (prev.some((x) => x.id === questionId) ? prev : [q, ...prev]))
        } catch {
          /* ignore */
        }
      }
      setActiveId(questionId)
    },
    [questions],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (paletteOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext, paletteOpen])

  const paletteFilterParams = useMemo(() => buildFilterParams(), [buildFilterParams])

  const onPaletteSelect = (q: Question, query: string) => {
    setSearchText(query)
    setSearchQuery(query)
    setActiveId(q.id)
  }

  const openCreate = () => {
    setEditorQuestion(null)
    setEditorOpen(true)
  }

  const openEdit = (q: Question) => {
    setEditorQuestion(q)
    setEditorOpen(true)
  }

  const onEditorSaved = (q: Question) => {
    setQuestions((prev) => prev.map((item) => (item.id === q.id ? { ...item, ...q } : item)))
    if (randomPractice) {
      setRandomActiveQuestion((prev) => (prev?.id === q.id ? { ...prev, ...q } : prev))
    } else {
      load()
      setActiveId(q.id)
    }
    loadSummary()
  }

  const deleteQuestion = async (q: Question) => {
    if (!window.confirm(`确定删除题目 #${q.id}？提交记录将一并删除，不可恢复。`)) return
    try {
      await api.deleteQuestion(q.id)
      if (randomPractice) {
        setQuestions((prev) => prev.filter((item) => item.id !== q.id))
        setRandomActiveQuestion((prev) => (prev?.id === q.id ? null : prev))
      }
      load()
      loadSummary()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  const deleteCurrent = () => {
    if (effectiveCurrent) void deleteQuestion(effectiveCurrent)
  }

  const onSubmitted = useCallback(
    (evt?: PracticeSubmitEvent) => {
      if (randomPractice) {
        if (evt?.fullReload) {
          void startRandomPractice()
          loadSummary()
          return
        }
        if (evt?.refreshQuestion && evt.questionId) {
          api
            .getQuestion(evt.questionId)
            .then((fresh) => {
              setQuestions((prev) =>
                prev.map((q) => (q.id === fresh.id ? { ...q, ...fresh } : q)),
              )
            })
            .catch(() => {})
        }
        loadSummary()
        return
      }

      if (practiceMode === 'word_dictation') {
        if (evt?.questionId) recordWordDone()
        if (evt?.fullReload) {
          load()
          loadSummary()
          return
        }
        if (evt?.questionId && evt.practice) {
          setQuestions((prev) =>
            prev.map((q) => (q.id === evt.questionId ? { ...q, practice: evt.practice! } : q)),
          )
        }
        if (evt?.refreshQuestion && evt.questionId) {
          api
            .getQuestion(evt.questionId)
            .then((fresh) => {
              setQuestions((prev) =>
                prev.map((q) => (q.id === fresh.id ? { ...q, ...fresh } : q)),
              )
            })
            .catch(() => {})
        }
        loadSummary()
        refreshWordWrongStats()
        setBoardRefreshKey((k) => k + 1)
        if (evt?.autoAdvance === true && evt.isCorrect === true && !randomDictation) {
          window.setTimeout(() => goNext(), 400)
        }
        return
      }

      if (evt?.fullReload) {
        load()
        loadSummary()
        return
      }

      const applyPractice = (practice: NonNullable<PracticeSubmitEvent['practice']>) => {
        const doneForRound = practiceRound === 1 ? practice.round1 : practice.round2
        const dropsFromFilter =
          (roundStatus === 'pending' && doneForRound) ||
          (roundStatus === 'done' && !doneForRound)

        setQuestions((prev) => {
          if (!evt?.questionId) return prev
          if (dropsFromFilter) {
            const next = prev.filter((q) => q.id !== evt.questionId)
            setActiveId((aid) => {
              if (aid !== evt.questionId) return aid
              if (!next.length) return null
              const idx = prev.findIndex((q) => q.id === evt.questionId)
              const pick = idx >= 0 && idx < next.length ? next[idx] : next[Math.min(idx, next.length - 1)]
              return pick?.id ?? next[0].id
            })
            return next
          }
          return prev.map((q) =>
            q.id === evt.questionId ? { ...q, practice } : q,
          )
        })
      }

      const dropsFromSelfMark =
        practiceMode === 'wrong_review' &&
        selfMarkFilter === 'unmarked' &&
        evt?.questionId

      if (dropsFromSelfMark) {
        setQuestions((prev) => {
          const next = prev.filter((q) => q.id !== evt!.questionId)
          setActiveId((aid) => {
            if (aid !== evt!.questionId) return aid
            if (!next.length) return null
            const idx = prev.findIndex((q) => q.id === evt!.questionId)
            const pick = idx >= 0 && idx < next.length ? next[idx] : next[Math.min(idx, next.length - 1)]
            return pick?.id ?? next[0].id
          })
          return next
        })
      } else if (evt?.practice) {
        applyPractice(evt.practice)
      }

      if (evt?.refreshQuestion && evt.questionId) {
        api
          .getQuestion(evt.questionId)
          .then((fresh) => {
            setQuestions((prev) =>
              prev.map((q) => (q.id === fresh.id ? { ...q, ...fresh } : q)),
            )
          })
          .catch(() => {})
      }
      loadSummary()

      if (evt?.autoAdvance === true && evt.isCorrect === true) {
        const p = evt.practice
        const done = p ? (practiceRound === 1 ? p.round1 : p.round2) : false
        const dropsRound = roundStatus === 'pending' && done
        const dropsMark =
          practiceMode === 'wrong_review' &&
          selfMarkFilter === 'unmarked' &&
          Boolean(evt.questionId)
        if (!dropsRound && !dropsMark) {
          window.setTimeout(() => goNext(), 400)
        }
      }
    },
    [
      load,
      loadSummary,
      practiceRound,
      roundStatus,
      practiceMode,
      selfMarkFilter,
      refreshWordWrongStats,
      recordWordDone,
      goNext,
      randomPractice,
      randomDictation,
      startRandomPractice,
    ],
  )

  const startWrongWordPractice = () => {
    setSelfMarkFilter('wrong')
    setRandomDictation(true)
    setWfPane('dictation')
    setPracticeOffset(0)
  }

  const startUnitWordPractice = () => {
    if (!wordUnitFilter) return
    setSelfMarkFilter('')
    setRandomDictation(false)
    setWfPane('dictation')
    setPracticeOffset(0)
  }

  const returnToWordBoard = () => {
    setRandomDictation(false)
    setWfPane('board')
  }

  const resetUnitPractice = async () => {
    if (!wordUnitFilter) return
    if (
      !window.confirm(
        `重刷「${wordBookFilter || '词书'} · Unit ${wordUnitFilter}」？\n· 一刷/二刷标记将清零以便再练\n· 历次重刷记录会归档保留\n· 提交记录与错词标签不删除`,
      )
    ) {
      return
    }
    setResetBusy(true)
    try {
      await api.resetWordPractice({ book: wordBookFilter, unit: wordUnitFilter })
      setBoardRefreshKey((k) => k + 1)
      load()
      loadSummary()
      refreshWordWrongStats()
    } catch (e) {
      alert(e instanceof Error ? e.message : '重刷失败')
    } finally {
      setResetBusy(false)
    }
  }

  const jumpToWordQuestion = useCallback(
    (questionId: number) => {
      setRandomDictation(false)
      setWfPane('dictation')
      if (questions.some((q) => q.id === questionId)) {
        setActiveId(questionId)
        return
      }
      const p = buildFilterParams()
      p.set('limit', '500')
      api.listPracticeQuestions(p).then((raw) => {
        const qs = Array.isArray(raw) ? raw : raw.items
        setQuestions(qs)
        setPracticeTotal(qs.length)
        setActiveId(questionId)
      })
    },
    [questions, buildFilterParams],
  )

  const exportMd = (zip: boolean) => {
    const p = buildParams()
    p.set('include_answers', 'true')
    p.set('include_submissions', 'true')
    p.set('format', zip ? 'zip' : 'single')
    window.open(api.exportUrl(p), '_blank')
  }

  return (
    <div className={`practice-layout${isWordForest ? ' practice-layout--wf' : ''}`}>
      <QuestionSearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        filterParams={paletteFilterParams}
        onSelect={onPaletteSelect}
      />
      <QuestionEditor
        open={editorOpen}
        question={editorQuestion}
        onClose={() => setEditorOpen(false)}
        onSaved={onEditorSaved}
      />
      {!isWordForest && !randomPractice && (questions.length > 0 || practiceTotal > 0) && (
        <aside className="question-sidebar">
          <div className="question-sidebar-head">
            <strong>题目列表</strong>
            <span className="muted">{practiceTotal || questions.length} 题</span>
          </div>
          <QuestionSidebar
            questions={questions}
            activeId={listCurrent?.id ?? null}
            onSelect={setActiveId}
          />
          <ListPager
            className="question-sidebar-pager"
            total={practiceTotal}
            limit={WORD_PAGE_SIZE}
            offset={practiceOffset}
            onChange={setPracticeOffset}
          />
        </aside>
      )}

      <main className={`practice-main${isWordForest ? ' practice-main--wf' : ''}`}>
        {err && (
          <p className="practice-alert">
            无法连接 API：{err} — 请先启动 drillly/api（端口 5213）
          </p>
        )}

        <div className={`practice-work${isWordForest ? ' practice-work--wf' : ''}`}>
          <div className="practice-question-pane">
            {isWordForest && (
              <div className="practice-toolbar practice-toolbar--wf practice-toolbar--compact">
                <PracticeModeTabs value={practiceMode} onChange={switchMode} />
                <div className="toolbar-section wf-toolbar-mini">
                  <select
                    value={wordBookFilter}
                    onChange={(e) => setWordBookFilter(e.target.value)}
                    title="词书"
                  >
                    <option value="">全部词书</option>
                    <option value="基础词">基础词</option>
                    <option value="必考词">必考词</option>
                  </select>
                  <input
                    type="search"
                    className="filter-search wf-toolbar-search"
                    placeholder="搜索单词…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                  <label className="filter-check">
                    <input
                      type="checkbox"
                      checked={randomOrder}
                      onChange={(e) => setRandomOrder(e.target.checked)}
                    />
                    随机
                  </label>
                  <select
                    value={selfMarkFilter}
                    onChange={(e) =>
                      setSelfMarkFilter(e.target.value as '' | 'unmarked' | 'wrong' | 'correct')
                    }
                  >
                    <option value="">全部</option>
                    <option value="unmarked">未刷</option>
                    <option value="wrong">错词本</option>
                    <option value="correct">做对了</option>
                  </select>
                  <button type="button" className="btn" onClick={load}>
                    刷新
                  </button>
                </div>
              </div>
            )}

            <div className={isWordForest ? 'wf-practice-row' : undefined}>
              <div className={isWordForest ? 'wf-practice-col' : undefined}>
                {isWordForest && wfPane === 'board' && !randomDictation ? (
                  <WordUnitBoard
                    book={wordBookFilter}
                    unit={wordUnitFilter}
                    search={searchQuery}
                    wrongOnly={wordWrongOnly}
                    refreshKey={boardRefreshKey}
                    onTotalChange={setUnitWordTotal}
                    onWordClick={jumpToWordQuestion}
                  />
                ) : isWordForest && randomDictation ? (
                  <WordRandomPractice
                    questions={questions}
                    direction={dictationDirection}
                    onSubmitted={onSubmitted}
                    onExit={returnToWordBoard}
                    practiceRound={practiceRound}
                    tagTree={tagTree}
                  />
                ) : !isWordForest && normalPane === 'wrong-board' && practiceMode === 'normal' ? (
                  <PracticeWrongBoard
                    sourcePdf={pdfFilter || undefined}
                    tagFilter={tagChildFilter || tagGroupFilter || undefined}
                    refreshKey={wrongBoardRefreshKey}
                    onQuestionClick={(id) => void jumpToWrongQuestion(id)}
                    onExit={() => setNormalPane('practice')}
                  />
                ) : randomPractice ? (
                  <TagRandomPractice
                    key={randomSessionKey}
                    sessionKey={randomSessionKey}
                    questions={questions}
                    filterLabel={randomFilterLabel}
                    practiceRound={practiceRound}
                    practiceMode={practiceMode}
                    tagTree={tagTree}
                    roundStatus={roundStatus}
                    selfMarkFilter={selfMarkFilter}
                    onSubmitted={onSubmitted}
                    onExit={exitRandomPractice}
                    poolTotal={practiceTotal}
                    onActiveQuestionChange={setRandomActiveQuestion}
                    onEdit={openEdit}
                    onDelete={deleteQuestion}
                  />
                ) : listCurrent ? (
                  <>
                    {isWordForest && (
                      <div className="wf-dictation-bar">
                        <button type="button" className="wf-btn-ghost" onClick={returnToWordBoard}>
                          ← 返回看板
                        </button>
                        <span className="muted">
                          {wordBookFilter && wordUnitFilter
                            ? `${wordBookFilter} · Unit ${wordUnitFilter}`
                            : '默写练习'}
                        </span>
                      </div>
                    )}
                    <QuestionCard
                      q={listCurrent}
                      tagGroups={tagTree}
                      practiceRound={practiceRound}
                      onSubmitted={onSubmitted}
                      onEdit={isWordForest ? () => openEdit(listCurrent) : undefined}
                      onDelete={isWordForest ? deleteCurrent : undefined}
                      imagePasteEnabled={!paletteOpen && !editorOpen}
                      dictationDirection={isWordForest ? dictationDirection : 'zh2en'}
                      wordForestMinimal={isWordForest}
                      autoFocusWordInput={isWordForest}
                      onPrev={questions.length > 1 ? goPrev : undefined}
                      onNext={questions.length > 1 ? goNext : undefined}
                      navIndex={
                        isWordForest
                          ? practiceOffset + Math.max(0, currentIdx)
                          : practiceOffset + Math.max(0, currentIdx)
                      }
                      navTotal={practiceTotal || questions.length}
                    />
                    {isWordForest && practiceTotal > WORD_PAGE_SIZE && (
                      <ListPager
                        className="wf-practice-pager"
                        total={practiceTotal}
                        limit={WORD_PAGE_SIZE}
                        offset={practiceOffset}
                        onChange={setPracticeOffset}
                      />
                    )}
                  </>
                ) : isWordForest ? (
                  <div className="card practice-empty wf-practice-empty">
                    <p>
                      <strong>当前没有可练习的单词</strong>
                    </p>
                    <ul>
                      <li>右侧选择 Unit 后可在看板浏览本单元单词</li>
                      <li>点「开始随机默写」或「按 Unit 刷」进入默写</li>
                      {selfMarkFilter && <li>筛选过严时可改为「全部」</li>}
                    </ul>
                    <button type="button" className="wf-btn-ghost" onClick={returnToWordBoard}>
                      返回看板
                    </button>
                  </div>
                ) : (
                  <div className="card practice-empty">
                    <p>
                      <strong>没有匹配的题目</strong>
                    </p>
                    <p className="muted">请调整右侧筛选，或前往导入页添加题目。</p>
                  </div>
                )}
              </div>

              {isWordForest && (
                <WordForestSidebar
                  dictationDirection={dictationDirection}
                  onDirectionChange={setDictationDirection}
                  onRandomStart={() => {
                    setSelfMarkFilter('')
                    setRandomDictation(true)
                    setWfPane('dictation')
                    setPracticeOffset(0)
                  }}
                  onWrongPracticeStart={startWrongWordPractice}
                  onUnitPractice={startUnitWordPractice}
                  onJumpToQuestion={jumpToWordQuestion}
                  wordBook={wordBookFilter}
                  wordUnit={wordUnitFilter}
                  onWordBookChange={setWordBookFilter}
                  onWordUnitChange={setWordUnitFilter}
                  wrongCount={wordWrongStats.last_mark_wrong}
                  randomBusy={false}
                  wordCount={
                    wfPane === 'board' ? unitWordTotal : practiceTotal || questions.length
                  }
                  onResetUnit={resetUnitPractice}
                  resetBusy={resetBusy}
                  dailyStatsRefreshKey={dailyStatsRefreshKey}
                  onDataChanged={() => {
                    setBoardRefreshKey((k) => k + 1)
                    load()
                    loadSummary()
                    refreshWordWrongStats()
                  }}
                />
              )}
            </div>
          </div>

          {!isWordForest && (
            <PracticeControlsPanel
              practiceMode={practiceMode}
              onModeChange={switchMode}
              summary={summary}
              pdfFilter={pdfFilter}
              onPdfFilter={setPdfFilter}
              pdfSources={pdfSources}
              tagTree={tagTree}
              tagGroupFilter={tagGroupFilter}
              onTagGroupFilter={setTagGroupFilter}
              tagChildFilter={tagChildFilter}
              onTagChildFilter={setTagChildFilter}
              practiceRound={practiceRound}
              onPracticeRound={setPracticeRound}
              roundStatus={roundStatus}
              onRoundStatus={setRoundStatus}
              selfMarkFilter={selfMarkFilter}
              onSelfMarkFilter={setSelfMarkFilter}
              randomOrder={randomOrder}
              onRandomOrder={setRandomOrder}
              searchText={searchText}
              onSearchText={setSearchText}
              hasTopicFilter={hasTopicFilter}
              hasSearch={hasSearch}
              onClearFilters={clearFilters}
              onRefresh={load}
              onCreate={openCreate}
              onEdit={() => effectiveCurrent && openEdit(effectiveCurrent)}
              onDelete={deleteCurrent}
              onConvertToCoding={convertCurrentToCoding}
              canConvertToCoding={Boolean(
                effectiveCurrent && canConvertToCoding(effectiveCurrent.type),
              )}
              convertBusy={convertBusy}
              currentQuestion={currentQuestionSummary}
              onExportMd={() => exportMd(false)}
              onExportZip={() => exportMd(true)}
              questionCount={
                randomPractice ? questions.length : practiceTotal || questions.length
              }
              currentIdx={randomPractice ? -1 : currentIdx}
              onPrev={goPrev}
              onNext={goNext}
              randomPractice={randomPractice}
              onStartRandomPractice={startRandomPractice}
              onExitRandomPractice={exitRandomPractice}
              randomBusy={randomBusy}
              randomFilterLabel={randomFilterLabel}
              dailyStatsRefreshKey={dailyStatsRefreshKey}
              normalPane={normalPane}
              onNormalPaneChange={setNormalPane}
            />
          )}
        </div>
      </main>
    </div>
  )
}

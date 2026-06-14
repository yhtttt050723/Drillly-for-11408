import { useCallback, useMemo, useState } from 'react'
import { DayPlanEditor } from '../components/calendar/DayPlanEditor'
import { HabitPanel } from '../components/calendar/HabitPanel'
import { TemplatePanel } from '../components/calendar/TemplatePanel'
import {
  countExamReviewDays,
  generatedEndDate,
  insertTemplateOnDate,
  mergeExamScheduleIntoStore,
  parseDayPlanTag,
  type ExamGeneratePattern,
} from '../lib/examYearSchedule'
import {
  SUBJECT_TRACKS,
  TRACK_LABELS,
  clonePlanToDate,
  countQualifiedStudySegments,
  countStudySegments,
  dayTrackMinutes,
  formatMinutesShort,
  getDayPlan,
  loadPlanStore,
  monthGridCells,
  monthTrackMinutes,
  offsetYmd,
  parseYmd,
  savePlanStore,
  setDayPlan,
  ymd,
  type DayPlan,
  type IntensivePlanStore,
} from '../lib/intensivePlan'
import { loadHabitStore, saveHabitStore, type HabitStore } from '../lib/planHabits'
import {
  getTemplateById,
  loadTemplateStore,
  saveTemplateStore,
  type DayPlanTemplate,
  type PlanTemplateStore,
} from '../lib/planTemplates'
import '../styles/calendar.css'

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function CalendarPage() {
  const today = ymd(new Date())
  const [viewDate, setViewDate] = useState(() => new Date())
  const [store, setStore] = useState<IntensivePlanStore>(() => loadPlanStore())
  const [tplStore, setTplStore] = useState<PlanTemplateStore>(() => loadTemplateStore())
  const [habits, setHabits] = useState<HabitStore>(() => loadHabitStore())
  const [selectedDate, setSelectedDate] = useState<string | null>(today)
  const [sidebarTab, setSidebarTab] = useState<'gen' | 'tpl' | 'copy'>('gen')

  const [genStart, setGenStart] = useState('2025-10-01')
  const [genYearFrom, setGenYearFrom] = useState(2009)
  const [genYearTo, setGenYearTo] = useState(2026)
  const [genPattern, setGenPattern] = useState<ExamGeneratePattern>('alternate')
  const [genPreserve, setGenPreserve] = useState(true)
  const [insertYear, setInsertYear] = useState(2009)
  const [msg, setMsg] = useState('')

  const [copyFromDate, setCopyFromDate] = useState(() => offsetYmd(today, -1))
  const [copyToDate, setCopyToDate] = useState(today)

  const viewYear = viewDate.getFullYear()
  const viewMonth = viewDate.getMonth()
  const cells = useMemo(() => monthGridCells(viewYear, viewMonth), [viewYear, viewMonth])

  const flash = (text: string) => {
    setMsg(text)
    window.setTimeout(() => setMsg(''), 4000)
  }

  const persistPlan = useCallback((next: IntensivePlanStore) => {
    setStore(next)
    savePlanStore(next)
  }, [])

  const persistHabits = useCallback((next: HabitStore) => {
    setHabits(next)
    saveHabitStore(next)
  }, [])

  const selectedPlan = selectedDate ? getDayPlan(store, selectedDate) : null
  const activeDate = selectedDate ?? today

  const handlePlanChange = (plan: DayPlan) => {
    persistPlan(setDayPlan(store, plan))
  }

  const handleSelectDate = (dateKey: string) => {
    setSelectedDate(dateKey)
    setCopyToDate(dateKey)
  }

  const handleGenerate = () => {
    const examTpl = getTemplateById(tplStore, tplStore.examTemplateId)
    const reviewTpl = getTemplateById(tplStore, tplStore.reviewTemplateId)
    if (!examTpl || !reviewTpl) {
      flash('请选择有效的真题/订正模板')
      return
    }
    if (!genPreserve) {
      const end = generatedEndDate(genStart, genYearFrom, genYearTo, genPattern)
      const ok = window.confirm(`将覆盖 ${genStart}—${end} 区间内已有计划（不保留），继续？`)
      if (!ok) return
    }
    const { store: merged, added, skipped } = mergeExamScheduleIntoStore(store, {
      startDate: genStart,
      yearFrom: genYearFrom,
      yearTo: genYearTo,
      pattern: genPattern,
      examTemplate: examTpl,
      reviewTemplate: reviewTpl,
      preserveExisting: genPreserve,
    })
    persistPlan(merged)
    setViewDate(parseYmd(genStart))
    setSelectedDate(genStart)
    flash(
      genPreserve
        ? `已生成 ${added} 天，跳过已有 ${skipped} 天`
        : `已重新生成 ${added} 天`,
    )
  }

  const handleInsertTemplate = (template: DayPlanTemplate, mode: 'exam' | 'review') => {
    if (!selectedDate) {
      flash('请先在日历选择日期')
      return
    }
    const existing = getDayPlan(store, selectedDate)
    if (existing.segments.length > 0) {
      const ok = window.confirm(`${selectedDate} 已有内容，覆盖？`)
      if (!ok) return
    }
    persistPlan(insertTemplateOnDate(store, selectedDate, template, insertYear, mode, true))
    flash(`已插入「${template.name}」→ ${selectedDate}`)
  }

  const copyPlanTo = (fromDate: string, toDate: string) => {
    if (fromDate === toDate) return flash('来源与目标不能相同')
    const source = getDayPlan(store, fromDate)
    if (!source.segments.length) return flash(`${fromDate} 无计划`)
    const target = getDayPlan(store, toDate)
    if (target.segments.length && !window.confirm(`${toDate} 已有安排，覆盖？`)) return
    persistPlan(setDayPlan(store, clonePlanToDate(source, toDate)))
    setSelectedDate(toDate)
    flash(`已复制 ${source.segments.length} 段`)
  }

  const monthTracks = useMemo(
    () => monthTrackMinutes(store, viewYear, viewMonth),
    [store, viewYear, viewMonth],
  )
  const dayTracks = useMemo(
    () => dayTrackMinutes(getDayPlan(store, activeDate)),
    [store, activeDate],
  )
  const examStats = useMemo(() => countExamReviewDays(store), [store])
  const genEndPreview = generatedEndDate(genStart, genYearFrom, genYearTo, genPattern)

  return (
    <div className="cal-page cal-page--wide">
      <aside className="cal-sidebar card">
        <h2>强化规划</h2>
        <div className="cal-sidebar-tabs">
          {(['gen', 'tpl', 'copy'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`cal-sidebar-tab ${sidebarTab === t ? 'active' : ''}`}
              onClick={() => setSidebarTab(t)}
            >
              {t === 'gen' ? '批量生成' : t === 'tpl' ? '模板' : '复制'}
            </button>
          ))}
        </div>

        {sidebarTab === 'gen' && (
          <div className="cal-gen-panel">
            <label className="cal-field cal-field--full">
              <span>起始日期</span>
              <input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
            </label>
            <div className="cal-gen-years">
              <label className="cal-field">
                <span>年份起</span>
                <input
                  type="number"
                  value={genYearFrom}
                  onChange={(e) => setGenYearFrom(Number(e.target.value))}
                />
              </label>
              <label className="cal-field">
                <span>年份止</span>
                <input
                  type="number"
                  value={genYearTo}
                  onChange={(e) => setGenYearTo(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="cal-field cal-field--full">
              <span>节奏</span>
              <select
                value={genPattern}
                onChange={(e) => setGenPattern(e.target.value as ExamGeneratePattern)}
              >
                <option value="alternate">一天真题 · 一天订正</option>
                <option value="exam-only">仅真题（连续）</option>
              </select>
            </label>
            <label className="cal-check">
              <input
                type="checkbox"
                checked={genPreserve}
                onChange={(e) => setGenPreserve(e.target.checked)}
              />
              跳过已有内容的日期
            </label>
            <p className="muted cal-gen-preview">
              预计 {genStart} → {genEndPreview} · 真题 {examStats.exam} 天 · 订正 {examStats.review} 天
            </p>
            <button type="button" className="btn btn-primary cal-copy-btn" onClick={handleGenerate}>
              按模板连续生成
            </button>
          </div>
        )}

        {sidebarTab === 'tpl' && (
          <TemplatePanel
            tplStore={tplStore}
            onStoreChange={(s) => {
              setTplStore(s)
              saveTemplateStore(s)
            }}
            onInsert={handleInsertTemplate}
            insertYear={insertYear}
            onInsertYearChange={setInsertYear}
          />
        )}

        {sidebarTab === 'copy' && (
          <div className="cal-copy-block">
            <div className="cal-copy-row">
              <label className="cal-field">
                <span>从</span>
                <input type="date" value={copyFromDate} onChange={(e) => setCopyFromDate(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm cal-copy-swap"
                onClick={() => {
                  setCopyFromDate(copyToDate)
                  setCopyToDate(copyFromDate)
                }}
              >
                ⇄
              </button>
              <label className="cal-field">
                <span>到</span>
                <input type="date" value={copyToDate} onChange={(e) => setCopyToDate(e.target.value)} />
              </label>
            </div>
            <button type="button" className="btn btn-primary btn-sm cal-copy-btn" onClick={() => copyPlanTo(copyFromDate, copyToDate)}>
              复制计划
            </button>
          </div>
        )}

        {msg && <p className="cal-copy-msg">{msg}</p>}

        <div className="cal-track-board">
          <h3>四科计划（本月）</h3>
          <div className="cal-track-grid">
            {SUBJECT_TRACKS.map((track) => (
              <div key={track} className={`cal-track-card cal-track-card--${track}`}>
                <span className="cal-track-label">{TRACK_LABELS[track]}</span>
                <span className="cal-track-value">{formatMinutesShort(monthTracks[track])}</span>
                {dayTracks[track] > 0 && (
                  <span className="cal-track-day">选中日 {formatMinutesShort(dayTracks[track])}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="cal-workspace">
        <section className="cal-calendar-area card">
          <div className="cal-toolbar">
            <button type="button" className="btn btn-ghost" onClick={() => setViewDate(new Date(viewYear, viewMonth - 1, 1))}>
              ←
            </button>
            <h1 className="cal-month-title">
              {viewYear} 年 {viewMonth + 1} 月
            </h1>
            <button type="button" className="btn btn-ghost" onClick={() => setViewDate(new Date(viewYear, viewMonth + 1, 1))}>
              →
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setViewDate(new Date())
                setSelectedDate(today)
              }}
            >
              今天
            </button>
          </div>

          <div className="cal-weekdays">
            {WEEK_LABELS.map((w) => (
              <div key={w} className="cal-weekday">
                {w}
              </div>
            ))}
          </div>
          <div className="cal-grid cal-grid--large">
            {cells.map((dateKey, i) => {
              if (!dateKey) return <div key={`p-${i}`} className="cal-cell cal-cell--pad" />
              const plan = getDayPlan(store, dateKey)
              const dayTag = parseDayPlanTag(plan.dayNote)
              const qualified = countQualifiedStudySegments(plan)
              const studyCount = countStudySegments(plan)
              const habitsDone = habits.habits.filter((h) => habits.log[dateKey]?.[h.id]).length

              return (
                <button
                  key={dateKey}
                  type="button"
                  className={[
                    'cal-cell',
                    dayTag ? `cal-cell--${dayTag}` : '',
                    dateKey === today ? 'cal-cell--today' : '',
                    dateKey === selectedDate ? 'cal-cell--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => handleSelectDate(dateKey)}
                >
                  <span className="cal-cell-day">{parseYmd(dateKey).getDate()}</span>
                  {dayTag && (
                    <span className={`cal-cell-tag cal-cell-tag--${dayTag}`}>
                      {dayTag === 'exam' ? '真题' : '订正'}
                    </span>
                  )}
                  {plan.dayNote && !dayTag && (
                    <span className="cal-cell-note">{plan.dayNote.slice(0, 8)}</span>
                  )}
                  {studyCount > 0 && (
                    <span className="cal-cell-meta">
                      {qualified}/{studyCount} 段
                    </span>
                  )}
                  {habitsDone > 0 && (
                    <span className="cal-cell-habit">习惯 {habitsDone}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        <section className="cal-right-panel">
          {selectedPlan ? (
            <DayPlanEditor plan={selectedPlan} onChange={handlePlanChange} compact />
          ) : (
            <div className="cal-editor card cal-editor--placeholder">
              <p className="muted">点击日历中的日期编辑计划</p>
            </div>
          )}
          <HabitPanel habits={habits} selectedDate={activeDate} onChange={persistHabits} />
        </section>
      </div>
    </div>
  )
}

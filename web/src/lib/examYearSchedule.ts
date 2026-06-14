import type { IntensivePlanStore } from './intensivePlan'
import type { DayPlanTemplate } from './planTemplates'
import { applyTemplateToDay } from './planTemplates'
import { offsetYmd, setDayPlan } from './intensivePlan'

export type ExamGeneratePattern = 'alternate' | 'exam-only'

export type ExamGenerateOptions = {
  startDate: string
  yearFrom: number
  yearTo: number
  pattern: ExamGeneratePattern
  examTemplate: DayPlanTemplate
  reviewTemplate: DayPlanTemplate
  preserveExisting: boolean
}

export function parseDayPlanTag(dayNote: string): 'exam' | 'review' | null {
  if (dayNote.includes('订正')) return 'review'
  if (dayNote.includes('真题')) return 'exam'
  return null
}

export function mergeExamScheduleIntoStore(
  store: IntensivePlanStore,
  options: ExamGenerateOptions,
): { store: IntensivePlanStore; added: number; skipped: number } {
  let next = store
  let added = 0
  let skipped = 0
  let dayOffset = 0

  const yFrom = Math.min(options.yearFrom, options.yearTo)
  const yTo = Math.max(options.yearFrom, options.yearTo)

  for (let year = yFrom; year <= yTo; year++) {
    const modes: Array<{ mode: 'exam' | 'review'; tpl: DayPlanTemplate }> =
      options.pattern === 'exam-only'
        ? [{ mode: 'exam', tpl: options.examTemplate }]
        : [
            { mode: 'exam', tpl: options.examTemplate },
            { mode: 'review', tpl: options.reviewTemplate },
          ]

    for (const { mode, tpl } of modes) {
      const date = offsetYmd(options.startDate, dayOffset)
      const existing = next.days[date]
      if (options.preserveExisting && existing && existing.segments.length > 0) {
        skipped += 1
        dayOffset += 1
        continue
      }
      next = setDayPlan(next, applyTemplateToDay(tpl, date, year, mode))
      added += 1
      dayOffset += 1
    }
  }

  return { store: next, added, skipped }
}

export function countGeneratedDays(
  yearFrom: number,
  yearTo: number,
  pattern: ExamGeneratePattern,
): number {
  const years = Math.abs(yearTo - yearFrom) + 1
  return years * (pattern === 'alternate' ? 2 : 1)
}

export function generatedEndDate(
  startDate: string,
  yearFrom: number,
  yearTo: number,
  pattern: ExamGeneratePattern,
): string {
  const total = countGeneratedDays(yearFrom, yearTo, pattern)
  if (total <= 0) return startDate
  return offsetYmd(startDate, total - 1)
}

export function countExamReviewDays(store: IntensivePlanStore): { exam: number; review: number } {
  let exam = 0
  let review = 0
  for (const plan of Object.values(store.days)) {
    const tag = parseDayPlanTag(plan.dayNote)
    if (tag === 'exam') exam += 1
    if (tag === 'review') review += 1
  }
  return { exam, review }
}

export function insertTemplateOnDate(
  store: IntensivePlanStore,
  date: string,
  template: DayPlanTemplate,
  year: number,
  mode: 'exam' | 'review',
  overwrite: boolean,
): IntensivePlanStore {
  const existing = store.days[date]
  if (existing?.segments.length && !overwrite) return store
  return setDayPlan(store, applyTemplateToDay(template, date, year, mode))
}

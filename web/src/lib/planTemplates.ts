import type { DayPlan, PlanSegment } from './intensivePlan'
import { newSegmentId } from './intensivePlan'

export type PlanSegmentTemplate = {
  slot: 1 | 2 | 3 | 4
  kind: 'study' | 'class'
  subject: string
  startTime: string
  endTime: string
  plannedMinutes: number
  /** 支持 {year} {yy} {prefix} */
  topicPattern: string
  notePattern: string
}

export type DayPlanTemplate = {
  id: string
  name: string
  /** 支持 {year} {yy} {prefix} {mode} */
  dayNotePattern: string
  segments: PlanSegmentTemplate[]
}

export type PlanTemplateStore = {
  version: 1
  templates: DayPlanTemplate[]
  /** 批量生成默认选用的模板 id */
  examTemplateId: string
  reviewTemplateId: string
}

const STORAGE_KEY = 'drillly-plan-templates-v1'

export const TEMPLATE_VARS_HELP =
  '{year} 完整年 · {yy} 两位年 · {prefix} 订正时为「订正·」否则空 · {mode} 真题/订正'

function tplId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export const DEFAULT_EXAM_DAY_TEMPLATE: DayPlanTemplate = {
  id: 'tpl-exam-default',
  name: '真题日（四科）',
  dayNotePattern: '{year}年·真题',
  segments: [
    {
      slot: 1,
      kind: 'study',
      subject: '数学真题',
      startTime: '08:30',
      endTime: '11:30',
      plannedMinutes: 180,
      topicPattern: '{prefix}数学{yy}年真题',
      notePattern: '{prefix}数学{yy}年真题',
    },
    {
      slot: 2,
      kind: 'study',
      subject: '408真题',
      startTime: '14:00',
      endTime: '17:00',
      plannedMinutes: 180,
      topicPattern: '{prefix}408 {yy}年真题',
      notePattern: '{prefix}408 {yy}年真题',
    },
    {
      slot: 3,
      kind: 'study',
      subject: '英语真题',
      startTime: '19:00',
      endTime: '22:00',
      plannedMinutes: 180,
      topicPattern: '{prefix}英语{yy}年真题',
      notePattern: '{prefix}英语{yy}年真题',
    },
    {
      slot: 4,
      kind: 'study',
      subject: '政治真题',
      startTime: '22:30',
      endTime: '00:30',
      plannedMinutes: 120,
      topicPattern: '{prefix}政治{yy}年真题',
      notePattern: '{prefix}政治{yy}年真题',
    },
  ],
}

export const DEFAULT_REVIEW_DAY_TEMPLATE: DayPlanTemplate = {
  id: 'tpl-review-default',
  name: '订正日（四科）',
  dayNotePattern: '{year}年·订正',
  segments: [
    {
      slot: 1,
      kind: 'study',
      subject: '数学真题',
      startTime: '08:30',
      endTime: '11:30',
      plannedMinutes: 180,
      topicPattern: '订正·数学{yy}年真题',
      notePattern: '订正·数学{yy}年真题',
    },
    {
      slot: 2,
      kind: 'study',
      subject: '408真题',
      startTime: '14:00',
      endTime: '17:00',
      plannedMinutes: 180,
      topicPattern: '订正·408 {yy}年真题',
      notePattern: '订正·408 {yy}年真题',
    },
    {
      slot: 3,
      kind: 'study',
      subject: '英语真题',
      startTime: '19:00',
      endTime: '22:00',
      plannedMinutes: 180,
      topicPattern: '订正·英语{yy}年真题',
      notePattern: '订正·英语{yy}年真题',
    },
    {
      slot: 4,
      kind: 'study',
      subject: '政治真题',
      startTime: '22:30',
      endTime: '00:30',
      plannedMinutes: 120,
      topicPattern: '订正·政治{yy}年真题',
      notePattern: '订正·政治{yy}年真题',
    },
  ],
}

function defaultStore(): PlanTemplateStore {
  return {
    version: 1,
    templates: [DEFAULT_EXAM_DAY_TEMPLATE, DEFAULT_REVIEW_DAY_TEMPLATE],
    examTemplateId: DEFAULT_EXAM_DAY_TEMPLATE.id,
    reviewTemplateId: DEFAULT_REVIEW_DAY_TEMPLATE.id,
  }
}

export function loadTemplateStore(): PlanTemplateStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as PlanTemplateStore
    if (parsed?.version !== 1 || !Array.isArray(parsed.templates) || parsed.templates.length === 0) {
      return defaultStore()
    }
    return parsed
  } catch {
    return defaultStore()
  }
}

export function saveTemplateStore(store: PlanTemplateStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function getTemplateById(store: PlanTemplateStore, id: string): DayPlanTemplate | undefined {
  return store.templates.find((t) => t.id === id)
}

type ApplyVars = {
  year: number
  mode: 'exam' | 'review'
}

function fillPattern(pattern: string, vars: ApplyVars): string {
  const yy = String(vars.year % 100).padStart(2, '0')
  const prefix = vars.mode === 'review' ? '订正·' : ''
  const modeLabel = vars.mode === 'review' ? '订正' : '真题'
  return pattern
    .replace(/\{year\}/g, String(vars.year))
    .replace(/\{yy\}/g, yy)
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{mode\}/g, modeLabel)
}

export function applyTemplateToDay(
  template: DayPlanTemplate,
  date: string,
  year: number,
  mode: 'exam' | 'review',
): DayPlan {
  const vars: ApplyVars = { year, mode }
  const segments: PlanSegment[] = template.segments.map((t) => ({
    id: newSegmentId(),
    slot: t.slot,
    kind: t.kind,
    subject: t.subject,
    startTime: t.startTime,
    endTime: t.endTime,
    plannedMinutes: t.plannedMinutes,
    topic: fillPattern(t.topicPattern, vars),
    note: fillPattern(t.notePattern, vars),
  }))
  return {
    date,
    dayNote: fillPattern(template.dayNotePattern, vars),
    segments: segments.sort((a, b) => a.slot - b.slot),
  }
}

export function upsertTemplate(store: PlanTemplateStore, template: DayPlanTemplate): PlanTemplateStore {
  const idx = store.templates.findIndex((t) => t.id === template.id)
  const templates =
    idx >= 0 ? store.templates.map((t, i) => (i === idx ? template : t)) : [...store.templates, template]
  return { ...store, templates }
}

export function deleteTemplate(store: PlanTemplateStore, id: string): PlanTemplateStore {
  if (store.templates.length <= 1) return store
  const templates = store.templates.filter((t) => t.id !== id)
  let examTemplateId = store.examTemplateId
  let reviewTemplateId = store.reviewTemplateId
  if (examTemplateId === id) examTemplateId = templates[0].id
  if (reviewTemplateId === id) reviewTemplateId = templates[Math.min(1, templates.length - 1)].id
  return { ...store, templates, examTemplateId, reviewTemplateId }
}

export function createBlankTemplate(name: string): DayPlanTemplate {
  return {
    id: tplId('tpl'),
    name,
    dayNotePattern: '{year}年·{mode}',
    segments: [
      {
        slot: 1,
        kind: 'study',
        subject: '数学真题',
        startTime: '08:30',
        endTime: '11:30',
        plannedMinutes: 180,
        topicPattern: '{prefix}数学{yy}年真题',
        notePattern: '',
      },
    ],
  }
}

export function duplicateTemplate(template: DayPlanTemplate): DayPlanTemplate {
  return {
    ...template,
    id: tplId('tpl'),
    name: `${template.name}（副本）`,
    segments: template.segments.map((s) => ({ ...s })),
  }
}

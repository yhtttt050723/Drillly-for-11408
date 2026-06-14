export type PlanSegmentKind = 'study' | 'class'

export type PlanSegment = {
  id: string
  slot: 1 | 2 | 3 | 4
  kind: PlanSegmentKind
  subject: string
  topic: string
  startTime: string
  endTime: string
  plannedMinutes: number
  note: string
}

export type DayPlan = {
  date: string
  segments: PlanSegment[]
  dayNote: string
}

export type IntensivePlanStore = {
  version: 1
  days: Record<string, DayPlan>
}

const STORAGE_KEY = 'drillly-intensive-plan-v1'

export const SUBJECT_PRESETS = [
  '数学-高数',
  '数学-线代',
  '数学-概率',
  '数学真题',
  '408-操作系统',
  '408-计网',
  '408-数据结构',
  '408-计组',
  '408真题',
  '英语',
  '英语真题',
  '政治真题',
  '课内',
  '其他',
] as const

export const INTENSIVE_RULES = {
  minSegmentMinutes: 180,
  minSegmentsPerDay: 2,
  maxSegmentsPerDay: 4,
} as const

export type SubjectTrack = 'english' | 'math1' | 'cs408' | 'politics'

export const SUBJECT_TRACKS: SubjectTrack[] = ['english', 'math1', 'cs408', 'politics']

export const TRACK_LABELS: Record<SubjectTrack, string> = {
  english: '英语',
  math1: '数学一',
  cs408: '408',
  politics: '政治',
}

export type TrackMinutes = Record<SubjectTrack, number>

export function emptyTrackMinutes(): TrackMinutes {
  return { english: 0, math1: 0, cs408: 0, politics: 0 }
}

export function subjectToTrack(subject: string): SubjectTrack | null {
  if (subject.startsWith('英语')) return 'english'
  if (subject.startsWith('数学')) return 'math1'
  if (subject.startsWith('408')) return 'cs408'
  if (subject.startsWith('政治')) return 'politics'
  return null
}

export function accumulateTrackMinutes(plan: DayPlan, into: TrackMinutes): void {
  for (const seg of plan.segments) {
    const track = subjectToTrack(seg.subject)
    if (!track) continue
    into[track] += Math.max(0, seg.plannedMinutes)
  }
}

export function dayTrackMinutes(plan: DayPlan): TrackMinutes {
  const m = emptyTrackMinutes()
  accumulateTrackMinutes(plan, m)
  return m
}

export function monthTrackMinutes(
  store: IntensivePlanStore,
  viewYear: number,
  viewMonth: number,
): TrackMinutes {
  const m = emptyTrackMinutes()
  for (const [date, plan] of Object.entries(store.days)) {
    const d = parseYmd(date)
    if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth) continue
    accumulateTrackMinutes(plan, m)
  }
  return m
}

export function offsetYmd(date: string, days: number): string {
  const d = parseYmd(date)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

export function clonePlanToDate(source: DayPlan, targetDate: string): DayPlan {
  return {
    date: targetDate,
    dayNote: source.dayNote,
    segments: source.segments.map((s) => ({
      ...s,
      id: newSegmentId(),
    })),
  }
}

export function formatMinutesShort(m: number): string {
  if (m <= 0) return '0 h'
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h === 0) return `${min} min`
  if (min === 0) return `${h} h`
  return `${h} h ${min} min`
}

export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function loadPlanStore(): IntensivePlanStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, days: {} }
    const parsed = JSON.parse(raw) as IntensivePlanStore
    if (parsed?.version !== 1 || !parsed.days) return { version: 1, days: {} }
    return parsed
  } catch {
    return { version: 1, days: {} }
  }
}

export function savePlanStore(store: IntensivePlanStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function getDayPlan(store: IntensivePlanStore, date: string): DayPlan {
  return store.days[date] ?? { date, segments: [], dayNote: '' }
}

export function setDayPlan(store: IntensivePlanStore, plan: DayPlan): IntensivePlanStore {
  const next = { ...store, days: { ...store.days } }
  if (plan.segments.length === 0 && !plan.dayNote.trim()) {
    delete next.days[plan.date]
  } else {
    next.days[plan.date] = plan
  }
  return next
}

export function newSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSegment(slot: 1 | 2 | 3 | 4): PlanSegment {
  return {
    id: newSegmentId(),
    slot,
    kind: 'study',
    subject: '数学-高数',
    topic: '',
    startTime: '',
    endTime: '',
    plannedMinutes: 180,
    note: '',
  }
}

export function countStudySegments(plan: DayPlan): number {
  return plan.segments.filter((s) => s.kind === 'study').length
}

export function countQualifiedStudySegments(plan: DayPlan): number {
  return plan.segments.filter(
    (s) => s.kind === 'study' && s.plannedMinutes >= INTENSIVE_RULES.minSegmentMinutes,
  ).length
}

export function dayPlanStatus(plan: DayPlan): 'empty' | 'under' | 'ok' | 'full' | 'over' {
  const q = countQualifiedStudySegments(plan)
  if (q === 0 && plan.segments.length === 0) return 'empty'
  if (q < INTENSIVE_RULES.minSegmentsPerDay) return 'under'
  if (q === INTENSIVE_RULES.maxSegmentsPerDay) return 'full'
  if (q > INTENSIVE_RULES.maxSegmentsPerDay) return 'over'
  return 'ok'
}

export function monthGridCells(viewYear: number, viewMonth: number): (string | null)[] {
  const first = new Date(viewYear, viewMonth, 1)
  const startPad = first.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(ymd(new Date(viewYear, viewMonth, d)))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  if (min === 0) return `${h} h`
  return `${h} h ${min} min`
}

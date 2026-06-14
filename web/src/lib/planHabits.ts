const STORAGE_KEY = 'drillly-habits-v1'

export type HabitItem = {
  id: string
  title: string
  /** 每日目标描述，如「07:30 起床」 */
  hint: string
  color: string
}

export type HabitStore = {
  version: 1
  habits: HabitItem[]
  /** date YYYY-MM-DD -> habitId -> done */
  log: Record<string, Record<string, boolean>>
}

const DEFAULT_HABITS: HabitItem[] = [
  { id: 'h-wake', title: '早起', hint: '07:30 前起床', color: '#1b5e6b' },
  { id: 'h-review', title: '睡前复盘', hint: '10 分钟日报/错题', color: '#6366f1' },
  { id: 'h-phone', title: '专注时段禁机', hint: '学习段手机远离', color: '#c45c26' },
  { id: 'h-sleep', title: '按时睡觉', hint: '00:30 前睡', color: '#2d6a4f' },
]

function defaultStore(): HabitStore {
  return { version: 1, habits: DEFAULT_HABITS, log: {} }
}

export function loadHabitStore(): HabitStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as HabitStore
    if (parsed?.version !== 1 || !Array.isArray(parsed.habits)) return defaultStore()
    return { ...defaultStore(), ...parsed, habits: parsed.habits.length ? parsed.habits : DEFAULT_HABITS }
  } catch {
    return defaultStore()
  }
}

export function saveHabitStore(store: HabitStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function newHabitId(): string {
  return `habit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function toggleHabit(store: HabitStore, date: string, habitId: string): HabitStore {
  const dayLog = { ...(store.log[date] ?? {}) }
  dayLog[habitId] = !dayLog[habitId]
  return {
    ...store,
    log: { ...store.log, [date]: dayLog },
  }
}

export function isHabitDone(store: HabitStore, date: string, habitId: string): boolean {
  return Boolean(store.log[date]?.[habitId])
}

export function countHabitsDone(store: HabitStore, date: string): number {
  const dayLog = store.log[date]
  if (!dayLog) return 0
  return store.habits.filter((h) => dayLog[h.id]).length
}

export function weekDatesContaining(dateStr: string): string[] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = dt.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(dt)
  monday.setDate(dt.getDate() + mondayOffset)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    out.push(
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

export function habitStreak(store: HabitStore, habitId: string, untilDate: string): number {
  const [y, m, d] = untilDate.split('-').map(Number)
  let streak = 0
  const cursor = new Date(y, m - 1, d)
  for (let i = 0; i < 365; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (!store.log[key]?.[habitId]) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function upsertHabit(store: HabitStore, habit: HabitItem): HabitStore {
  const idx = store.habits.findIndex((h) => h.id === habit.id)
  const habits =
    idx >= 0 ? store.habits.map((h, i) => (i === idx ? habit : h)) : [...store.habits, habit]
  return { ...store, habits }
}

export function removeHabit(store: HabitStore, habitId: string): HabitStore {
  const habits = store.habits.filter((h) => h.id !== habitId)
  const log: HabitStore['log'] = {}
  for (const [date, dayLog] of Object.entries(store.log)) {
    const next = { ...dayLog }
    delete next[habitId]
    log[date] = next
  }
  return { ...store, habits, log }
}

/**
 * 生成 2025-10-01 起 · 2009—2026 隔天真题/订正排期 JSON
 * 运行: node scripts/generate-exam-schedule.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

function yearShort(year) {
  return String(year % 100).padStart(2, '0')
}

function segId(i, y, mode, slot) {
  return `seg-${y}-${mode}-${slot}-${i}`
}

function makeSegment(slot, subject, startTime, endTime, plannedMinutes, topic, note, id) {
  return {
    id,
    slot,
    kind: 'study',
    subject,
    topic,
    startTime,
    endTime,
    plannedMinutes,
    note,
  }
}

function buildDay(date, year, mode) {
  const yy = yearShort(year)
  const prefix = mode === 'review' ? '订正·' : ''
  const modeLabel = mode === 'exam' ? '真题' : '订正'
  return {
    date,
    dayNote: `${year}年·${modeLabel}`,
    segments: [
      makeSegment(1, '数学真题', '08:30', '11:30', 180, `${prefix}数学${yy}年真题`, `${prefix}数学${yy}年真题`, segId(0, year, mode, 1)),
      makeSegment(2, '408真题', '14:00', '17:00', 180, `${prefix}408 ${yy}年真题`, `${prefix}408 ${yy}年真题`, segId(0, year, mode, 2)),
      makeSegment(3, '英语真题', '19:00', '21:00', 120, `${prefix}英语${yy}年真题`, `${prefix}英语${yy}年真题`, segId(0, year, mode, 3)),
      makeSegment(4, '政治真题', '21:30', '23:30', 120, `${prefix}政治${yy}年真题`, `${prefix}政治${yy}年真题`, segId(0, year, mode, 4)),
    ],
  }
}

function offsetYmd(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

const startDate = '2025-10-01'
const yearFrom = 2009
const yearTo = 2026
const days = {}
let offset = 0

for (let year = yearFrom; year <= yearTo; year++) {
  for (const mode of ['exam', 'review']) {
    const date = offsetYmd(startDate, offset)
    days[date] = buildDay(date, year, mode)
    offset += 1
  }
}

const store = { version: 1, days }
const outDir = path.join(root, '../public/plans')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'exam-2009-2026.json')
fs.writeFileSync(outPath, JSON.stringify(store, null, 2), 'utf8')

const endDate = offsetYmd(startDate, offset - 1)
console.log(`Wrote ${Object.keys(days).length} days (${startDate} .. ${endDate})`)
console.log(outPath)

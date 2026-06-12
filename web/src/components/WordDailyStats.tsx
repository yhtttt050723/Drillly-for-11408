import { useCallback, useEffect, useState } from 'react'
import { api, type DailyWordStats } from '../api'

type Props = {
  refreshKey?: number
  compact?: boolean
}

export function WordDailyStats({ refreshKey = 0, compact = false }: Props) {
  const [stats, setStats] = useState<DailyWordStats | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api
      .dailyWordStats(14)
      .then(setStats)
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'))
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  useEffect(() => {
    const t = window.setInterval(load, 30000)
    return () => window.clearInterval(t)
  }, [load])

  if (err) {
    return (
      <div className="practice-daily-stats word-daily-stats">
        <span className="toolbar-label">每日背词</span>
        <p className="muted practice-daily-stats-err">{err}</p>
      </div>
    )
  }

  if (!stats) return null

  const today = stats.today_stats
  const recent = stats.daily.filter((d) => d.date !== stats.today).slice(0, compact ? 4 : 6)

  return (
    <div className="practice-daily-stats word-daily-stats">
      <span className="toolbar-label">每日背词统计</span>
      <div className="kpi-strip kpi-strip--side practice-daily-kpi">
        <div className="kpi-card">
          <div className="kpi-label">今日默写</div>
          <div className="kpi-value">{today.submissions}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">今日词数</div>
          <div className="kpi-value">{today.words}</div>
        </div>
        {today.study_minutes > 0 && (
          <div className="kpi-card">
            <div className="kpi-label">背词时长</div>
            <div className="kpi-value">{today.study_minutes}′</div>
          </div>
        )}
        {(today.correct > 0 || today.wrong > 0) && (
          <div className="kpi-card">
            <div className="kpi-label">对 / 错</div>
            <div className="kpi-value">
              {today.correct}/{today.wrong}
            </div>
          </div>
        )}
      </div>
      {today.by_unit.length > 0 && (
        <ul className="practice-daily-sources">
          {today.by_unit.map((u) => (
            <li key={u.unit}>
              <span className="practice-daily-src" title={u.unit}>
                {u.unit}
              </span>
              <span className="muted">
                {u.words} 词 · {u.submissions} 次
                {(u.correct > 0 || u.wrong > 0) && ` · ${u.correct}/${u.wrong}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <table className="practice-daily-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>词数</th>
              <th>默写</th>
              {!compact && <th>背词</th>}
            </tr>
          </thead>
          <tbody>
            {recent.map((d) => (
              <tr key={d.date}>
                <td>{d.date.slice(5)}</td>
                <td>{d.words}</td>
                <td>{d.submissions}</td>
                {!compact && <td>{d.study_minutes > 0 ? `${d.study_minutes}′` : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted practice-daily-hint">默写提交 + 背词时长 · 重启不丢</p>
    </div>
  )
}

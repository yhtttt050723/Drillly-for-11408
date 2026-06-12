import { useCallback, useEffect, useState } from 'react'
import { api, type DailyPracticeStats } from '../api'

type Props = {
  sourcePdf?: string
  refreshKey?: number
}

function shortPdf(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/做题本/g, '').trim() || name
}

export function PracticeDailyStats({ sourcePdf, refreshKey = 0 }: Props) {
  const [stats, setStats] = useState<DailyPracticeStats | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api
      .dailyPracticeStats(sourcePdf, 14)
      .then(setStats)
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'))
  }, [sourcePdf])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (err) {
    return (
      <div className="practice-daily-stats">
        <span className="toolbar-label">每日刷题</span>
        <p className="muted practice-daily-stats-err">{err}</p>
      </div>
    )
  }

  if (!stats) return null

  const today = stats.today_stats
  const recent = stats.daily.filter((d) => d.date !== stats.today).slice(0, 6)

  return (
    <div className="practice-daily-stats">
      <span className="toolbar-label">每日刷题统计</span>
      <div className="kpi-strip kpi-strip--side practice-daily-kpi">
        <div className="kpi-card">
          <div className="kpi-label">今日题次</div>
          <div className="kpi-value">{today.submissions}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">今日题数</div>
          <div className="kpi-value">{today.questions}</div>
        </div>
        {today.correct > 0 && (
          <div className="kpi-card">
            <div className="kpi-label">客观正确</div>
            <div className="kpi-value">{today.correct}</div>
          </div>
        )}
      </div>
      {today.by_source.length > 0 && (
        <ul className="practice-daily-sources">
          {today.by_source.map((s) => (
            <li key={s.source_pdf}>
              <span className="practice-daily-src" title={s.source_pdf}>
                {shortPdf(s.source_pdf)}
              </span>
              <span className="muted">
                {s.questions} 题 · {s.submissions} 次
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
              <th>题数</th>
              <th>题次</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((d) => (
              <tr key={d.date}>
                <td>{d.date.slice(5)}</td>
                <td>{d.questions}</td>
                <td>{d.submissions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted practice-daily-hint">提交记录存 SQLite · 重启不丢</p>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'

export function WordStudyTimeBar() {
  const [todayMin, setTodayMin] = useState(0)
  const [active, setActive] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(() => {
    api
      .getWordStudyToday()
      .then((r) => {
        setTodayMin(r.today_minutes)
        setActive(r.active)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 20000)
    return () => window.clearInterval(t)
  }, [refresh])

  const syncJournal = async () => {
    setMsg('')
    try {
      const r = await api.syncWordStudyJournal({})
      if (r.ok) setMsg(`已写入日报 · 合计 ${r.totalMinutes} min`)
      else setMsg(r.reason || '同步失败')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '同步失败')
    }
  }

  return (
    <div className="wf-study-time-bar">
      <p className="wf-study-time-line">
        今日背词 <strong>{todayMin}</strong> 分钟
        {active && <span className="wf-study-time-live"> · 计时中</span>}
      </p>
      <div className="wf-study-time-actions">
        <button type="button" className="wf-btn-ghost wf-btn-tiny" onClick={refresh}>
          刷新
        </button>
        <button type="button" className="wf-btn-ghost wf-btn-tiny" onClick={syncJournal}>
          写入今日日报
        </button>
      </div>
      <p className="wf-study-time-hint muted">
        数据同步至 <code>学习资料/学习数据看板/背词时长数据.md</code>，Reader 学习时长看板可汇总。
      </p>
      {msg && <p className="wf-msg">{msg}</p>}
    </div>
  )
}

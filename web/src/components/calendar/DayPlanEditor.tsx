import {
  INTENSIVE_RULES,
  SUBJECT_PRESETS,
  countQualifiedStudySegments,
  createSegment,
  dayPlanStatus,
  type DayPlan,
  type PlanSegment,
  type PlanSegmentKind,
} from '../../lib/intensivePlan'

function statusLabel(status: ReturnType<typeof dayPlanStatus>): string {
  switch (status) {
    case 'empty':
      return '未规划'
    case 'under':
      return '未达 2 段'
    case 'ok':
      return '达标'
    case 'full':
      return '满 4 段'
    case 'over':
      return '超出上限'
  }
}

type Props = {
  plan: DayPlan
  onChange: (p: DayPlan) => void
  compact?: boolean
}

export function DayPlanEditor({ plan, onChange, compact }: Props) {
  const updateSegment = (id: string, patch: Partial<PlanSegment>) => {
    onChange({
      ...plan,
      segments: plan.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })
  }

  const removeSegment = (id: string) => {
    onChange({ ...plan, segments: plan.segments.filter((s) => s.id !== id) })
  }

  const addSegment = () => {
    const used = new Set(plan.segments.map((s) => s.slot))
    const slot = ([1, 2, 3, 4] as const).find((n) => !used.has(n))
    if (!slot) return
    onChange({
      ...plan,
      segments: [...plan.segments, createSegment(slot)].sort((a, b) => a.slot - b.slot),
    })
  }

  const qualified = countQualifiedStudySegments(plan)
  const status = dayPlanStatus(plan)

  return (
    <div className={`cal-editor card ${compact ? 'cal-editor--compact' : ''}`}>
      <div className="cal-editor-head">
        <div>
          <h2>{plan.date}</h2>
          <p className="muted cal-editor-sub">
            {plan.dayNote || '无备注'} · 合格段 <strong>{qualified}</strong>/
            {INTENSIVE_RULES.maxSegmentsPerDay} ·{' '}
            <span className={`cal-status cal-status--${status}`}>{statusLabel(status)}</span>
          </p>
        </div>
      </div>

      <label className="cal-field cal-field--full">
        <span>当日备注</span>
        <input
          type="text"
          value={plan.dayNote}
          placeholder="如：2015年·真题"
          onChange={(e) => onChange({ ...plan, dayNote: e.target.value })}
        />
      </label>

      <div className="cal-segment-list">
        {plan.segments.length === 0 && (
          <p className="muted cal-empty-hint">用下方模板插入，或手动添加段</p>
        )}
        {plan.segments.map((seg) => (
          <div key={seg.id} className={`cal-segment cal-segment--${seg.kind}`}>
            <div className="cal-segment-head">
              <span className="cal-segment-badge">#{seg.slot}</span>
              <select
                value={seg.kind}
                onChange={(e) =>
                  updateSegment(seg.id, { kind: e.target.value as PlanSegmentKind })
                }
              >
                <option value="study">学习段</option>
                <option value="class">课内/实验</option>
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSegment(seg.id)}>
                删
              </button>
            </div>
            <div className="cal-segment-grid">
              <label className="cal-field">
                <span>科目</span>
                <select
                  value={seg.subject}
                  onChange={(e) => updateSegment(seg.id, { subject: e.target.value })}
                >
                  {SUBJECT_PRESETS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cal-field">
                <span>时长 min</span>
                <input
                  type="number"
                  min={0}
                  step={15}
                  value={seg.plannedMinutes}
                  disabled={seg.kind === 'class'}
                  onChange={(e) =>
                    updateSegment(seg.id, {
                      plannedMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </label>
              <label className="cal-field">
                <span>开始</span>
                <input
                  type="time"
                  value={seg.startTime}
                  onChange={(e) => updateSegment(seg.id, { startTime: e.target.value })}
                />
              </label>
              <label className="cal-field">
                <span>结束</span>
                <input
                  type="time"
                  value={seg.endTime}
                  onChange={(e) => updateSegment(seg.id, { endTime: e.target.value })}
                />
              </label>
              <label className="cal-field cal-field--wide">
                <span>内容</span>
                <input
                  type="text"
                  value={seg.topic}
                  onChange={(e) => updateSegment(seg.id, { topic: e.target.value })}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={plan.segments.length >= 4}
        onClick={addSegment}
      >
        + 手动加段
      </button>
    </div>
  )
}

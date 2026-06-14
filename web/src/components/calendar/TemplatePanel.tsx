import { useState } from 'react'
import { SUBJECT_PRESETS } from '../../lib/intensivePlan'
import type { DayPlanTemplate, PlanSegmentTemplate, PlanTemplateStore } from '../../lib/planTemplates'
import {
  TEMPLATE_VARS_HELP,
  createBlankTemplate,
  deleteTemplate,
  duplicateTemplate,
  saveTemplateStore,
  upsertTemplate,
} from '../../lib/planTemplates'

type Props = {
  tplStore: PlanTemplateStore
  onStoreChange: (s: PlanTemplateStore) => void
  onInsert: (template: DayPlanTemplate, mode: 'exam' | 'review') => void
  insertYear: number
  onInsertYearChange: (y: number) => void
}

export function TemplatePanel({
  tplStore,
  onStoreChange,
  onInsert,
  insertYear,
  onInsertYearChange,
}: Props) {
  const [editId, setEditId] = useState(tplStore.examTemplateId)
  const editing = tplStore.templates.find((t) => t.id === editId) ?? tplStore.templates[0]

  const persist = (next: PlanTemplateStore) => {
    onStoreChange(next)
    saveTemplateStore(next)
  }

  const patchTemplate = (patch: Partial<DayPlanTemplate>) => {
    if (!editing) return
    persist(upsertTemplate(tplStore, { ...editing, ...patch }))
  }

  const patchSegment = (slot: number, patch: Partial<PlanSegmentTemplate>) => {
    if (!editing) return
    const segments = editing.segments.map((s) => (s.slot === slot ? { ...s, ...patch } : s))
    persist(upsertTemplate(tplStore, { ...editing, segments }))
  }

  const addSegment = () => {
    if (!editing || editing.segments.length >= 4) return
    const used = new Set(editing.segments.map((s) => s.slot))
    const slot = ([1, 2, 3, 4] as const).find((n) => !used.has(n))!
    const segments = [
      ...editing.segments,
      {
        slot,
        kind: 'study' as const,
        subject: '数学真题',
        startTime: '08:30',
        endTime: '11:30',
        plannedMinutes: 180,
        topicPattern: '{prefix}数学{yy}年真题',
        notePattern: '',
      },
    ].sort((a, b) => a.slot - b.slot)
    persist(upsertTemplate(tplStore, { ...editing, segments }))
  }

  const removeSegment = (slot: number) => {
    if (!editing) return
    persist(
      upsertTemplate(tplStore, {
        ...editing,
        segments: editing.segments.filter((s) => s.slot !== slot),
      }),
    )
  }

  return (
    <div className="cal-template-panel">
      <h3>日计划模板</h3>
      <p className="muted cal-template-help">{TEMPLATE_VARS_HELP}</p>

      <div className="cal-template-toolbar">
        <select value={editId} onChange={(e) => setEditId(e.target.value)}>
          {tplStore.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const t = createBlankTemplate('新模板')
            persist(upsertTemplate(tplStore, t))
            setEditId(t.id)
          }}
        >
          新建
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!editing}
          onClick={() => {
            if (!editing) return
            const t = duplicateTemplate(editing)
            persist(upsertTemplate(tplStore, t))
            setEditId(t.id)
          }}
        >
          复制
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={tplStore.templates.length <= 1}
          onClick={() => {
            persist(deleteTemplate(tplStore, editId))
            setEditId(tplStore.templates[0]?.id ?? '')
          }}
        >
          删
        </button>
      </div>

      {editing && (
        <div className="cal-template-editor">
          <label className="cal-field cal-field--full">
            <span>模板名称</span>
            <input
              value={editing.name}
              onChange={(e) => patchTemplate({ name: e.target.value })}
            />
          </label>
          <label className="cal-field cal-field--full">
            <span>日备注模式</span>
            <input
              value={editing.dayNotePattern}
              onChange={(e) => patchTemplate({ dayNotePattern: e.target.value })}
            />
          </label>

          {editing.segments.map((seg) => (
            <div key={seg.slot} className="cal-tpl-seg">
              <div className="cal-tpl-seg-head">
                <strong>段 #{seg.slot}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSegment(seg.slot)}>
                  删段
                </button>
              </div>
              <div className="cal-tpl-seg-grid">
                <label className="cal-field">
                  <span>科目</span>
                  <select
                    value={seg.subject}
                    onChange={(e) => patchSegment(seg.slot, { subject: e.target.value })}
                  >
                    {SUBJECT_PRESETS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cal-field">
                  <span>min</span>
                  <input
                    type="number"
                    value={seg.plannedMinutes}
                    onChange={(e) =>
                      patchSegment(seg.slot, { plannedMinutes: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="cal-field">
                  <span>起</span>
                  <input
                    type="time"
                    value={seg.startTime}
                    onChange={(e) => patchSegment(seg.slot, { startTime: e.target.value })}
                  />
                </label>
                <label className="cal-field">
                  <span>止</span>
                  <input
                    type="time"
                    value={seg.endTime}
                    onChange={(e) => patchSegment(seg.slot, { endTime: e.target.value })}
                  />
                </label>
                <label className="cal-field cal-field--wide">
                  <span>内容模式</span>
                  <input
                    value={seg.topicPattern}
                    onChange={(e) => patchSegment(seg.slot, { topicPattern: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}

          {editing.segments.length < 4 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={addSegment}>
              + 加一段
            </button>
          )}
        </div>
      )}

      <div className="cal-template-insert">
        <label className="cal-field">
          <span>插入用年份</span>
          <input
            type="number"
            min={1990}
            max={2035}
            value={insertYear}
            onChange={(e) => onInsertYearChange(Number(e.target.value) || insertYear)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!editing}
          onClick={() => editing && onInsert(editing, 'exam')}
        >
          插入选中日（真题）
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!editing}
          onClick={() => editing && onInsert(editing, 'review')}
        >
          插入选中日（订正）
        </button>
      </div>

      <div className="cal-template-defaults">
        <label className="cal-field cal-field--full">
          <span>批量生成 · 真题模板</span>
          <select
            value={tplStore.examTemplateId}
            onChange={(e) => persist({ ...tplStore, examTemplateId: e.target.value })}
          >
            {tplStore.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cal-field cal-field--full">
          <span>批量生成 · 订正模板</span>
          <select
            value={tplStore.reviewTemplateId}
            onChange={(e) => persist({ ...tplStore, reviewTemplateId: e.target.value })}
          >
            {tplStore.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

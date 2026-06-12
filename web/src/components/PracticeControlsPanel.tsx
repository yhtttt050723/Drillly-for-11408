import { Link } from 'react-router-dom'
import type { PdfSource, ProgressSummary, TagTreeGroup } from '../api'
import type { PracticeMode } from '../pages/PracticePage'
import { PracticeModeTabs } from './PracticeModeTabs'
import { PracticeDailyStats } from './PracticeDailyStats'
import { WordDailyStats } from './WordDailyStats'

type Props = {
  practiceMode: PracticeMode
  onModeChange: (mode: PracticeMode) => void
  summary: ProgressSummary | null
  pdfFilter: string
  onPdfFilter: (v: string) => void
  pdfSources: PdfSource[]
  tagTree: TagTreeGroup[]
  tagGroupFilter: string
  onTagGroupFilter: (v: string) => void
  tagChildFilter: string
  onTagChildFilter: (v: string) => void
  practiceRound: 1 | 2
  onPracticeRound: (v: 1 | 2) => void
  roundStatus: '' | 'pending' | 'done'
  onRoundStatus: (v: '' | 'pending' | 'done') => void
  selfMarkFilter: '' | 'unmarked' | 'wrong' | 'correct'
  onSelfMarkFilter: (v: '' | 'unmarked' | 'wrong' | 'correct') => void
  randomOrder: boolean
  onRandomOrder: (v: boolean) => void
  searchText: string
  onSearchText: (v: string) => void
  hasTopicFilter: boolean
  hasSearch: boolean
  onClearFilters: () => void
  onRefresh: () => void
  onCreate: () => void
  onEdit: () => void
  onDelete: () => void
  onConvertToCoding?: () => void
  canConvertToCoding?: boolean
  convertBusy?: boolean
  currentQuestion: { id: number; title: string; type?: string } | null
  onExportMd: () => void
  onExportZip: () => void
  questionCount: number
  currentIdx: number
  onPrev: () => void
  onNext: () => void
  randomPractice?: boolean
  onStartRandomPractice?: () => void
  onExitRandomPractice?: () => void
  randomBusy?: boolean
  randomFilterLabel?: string
  dailyStatsRefreshKey?: number
  normalPane?: 'practice' | 'wrong-board'
  onNormalPaneChange?: (pane: 'practice' | 'wrong-board') => void
}

export function PracticeControlsPanel({
  practiceMode,
  onModeChange,
  summary,
  pdfFilter,
  onPdfFilter,
  pdfSources,
  tagTree,
  tagGroupFilter,
  onTagGroupFilter,
  tagChildFilter,
  onTagChildFilter,
  practiceRound,
  onPracticeRound,
  roundStatus,
  onRoundStatus,
  selfMarkFilter,
  onSelfMarkFilter,
  randomOrder,
  onRandomOrder,
  searchText,
  onSearchText,
  hasTopicFilter,
  hasSearch,
  onClearFilters,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
  onConvertToCoding,
  canConvertToCoding = false,
  convertBusy = false,
  currentQuestion,
  onExportMd,
  onExportZip,
  questionCount,
  currentIdx,
  onPrev,
  onNext,
  randomPractice = false,
  onStartRandomPractice,
  onExitRandomPractice,
  randomBusy = false,
  randomFilterLabel = '',
  dailyStatsRefreshKey = 0,
  normalPane = 'practice',
  onNormalPaneChange,
}: Props) {
  return (
    <aside className="practice-controls-pane" aria-label="练习设置">
      {summary && summary.total > 0 && (
        <div className="kpi-strip kpi-strip--side">
          <div className="kpi-card">
            <div className="kpi-label">一刷</div>
            <div className="kpi-value">
              {summary.round1_done}
              <span> / {summary.total}</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">二刷</div>
            <div className="kpi-value">
              {summary.round2_done}
              <span> / {summary.total}</span>
            </div>
          </div>
          {pdfFilter && (
            <div className="kpi-card kpi-card--full">
              <div className="kpi-label">来源</div>
              <div className="kpi-meta">{pdfFilter}</div>
            </div>
          )}
        </div>
      )}

      <div className="practice-toolbar practice-toolbar--side">
        <PracticeModeTabs value={practiceMode} onChange={onModeChange} />

        {practiceMode === 'normal' && onNormalPaneChange && (
          <div className="practice-pane-toggle" role="group" aria-label="练习视图">
            <button
              type="button"
              className={normalPane === 'practice' ? 'btn btn-primary' : 'btn'}
              onClick={() => onNormalPaneChange('practice')}
            >
              刷题
            </button>
            <button
              type="button"
              className={normalPane === 'wrong-board' ? 'btn btn-primary' : 'btn'}
              onClick={() => onNormalPaneChange('wrong-board')}
            >
              错题看板
            </button>
          </div>
        )}

        {practiceMode === 'wrong_review' && (
          <p className="practice-import-hint">
            错题 <Link to="/import#wrong">导入</Link>
          </p>
        )}

        <div className="toolbar-section">
          <span className="toolbar-label">筛选</span>
          <input
            type="search"
            className="filter-search filter-search--full"
            placeholder="搜索题干…（Ctrl+Q）"
            value={searchText}
            onChange={(e) => onSearchText(e.target.value)}
            aria-label="搜索题目"
          />
          <select className="filter-full" value={pdfFilter} onChange={(e) => onPdfFilter(e.target.value)}>
            <option value="">全部 PDF</option>
            {pdfSources.map((s) => (
              <option key={s.source_pdf} value={s.source_pdf}>
                {s.source_pdf}（{s.question_count}）
              </option>
            ))}
          </select>
          <select
            className="filter-full"
            value={tagGroupFilter}
            onChange={(e) => {
              onTagGroupFilter(e.target.value)
              onTagChildFilter('')
            }}
          >
            <option value="">全部大标签</option>
            {tagTree.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className="filter-full"
            value={tagChildFilter}
            onChange={(e) => onTagChildFilter(e.target.value)}
            disabled={!tagGroupFilter}
          >
            <option value="">全部小标签</option>
            {tagTree
              .find((g) => g.name === tagGroupFilter)
              ?.children.map((c) => (
                <option key={c.id} value={c.full_name}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            className="filter-full"
            value={practiceRound}
            onChange={(e) => onPracticeRound(Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>一刷模式</option>
            <option value={2}>二刷模式</option>
          </select>
          <select
            className="filter-full"
            value={roundStatus}
            onChange={(e) => onRoundStatus(e.target.value as '' | 'pending' | 'done')}
          >
            <option value="">全部进度</option>
            <option value="pending">未完成</option>
            <option value="done">已完成</option>
          </select>
          {practiceMode === 'wrong_review' && (
            <select
              className="filter-full"
              value={selfMarkFilter}
              onChange={(e) =>
                onSelfMarkFilter(e.target.value as '' | 'unmarked' | 'wrong' | 'correct')
              }
            >
              <option value="">全部自评</option>
              <option value="unmarked">未刷</option>
              <option value="wrong">又错了</option>
              <option value="correct">做对了</option>
            </select>
          )}
          <label className="filter-check">
            <input
              type="checkbox"
              checked={randomOrder}
              onChange={(e) => onRandomOrder(e.target.checked)}
              disabled={randomPractice}
            />
            随机顺序
          </label>
          {randomPractice ? (
            <>
              <p className="practice-random-active muted" title={randomFilterLabel}>
                随机刷题中 · {randomFilterLabel || '全部'}
              </p>
              <button
                type="button"
                className="btn filter-full"
                onClick={onExitRandomPractice}
              >
                退出随机刷题
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary filter-full"
              onClick={onStartRandomPractice}
              disabled={randomBusy || !onStartRandomPractice}
            >
              {randomBusy ? '载入中…' : '按标签随机刷题'}
            </button>
          )}
          {(pdfFilter || hasTopicFilter || roundStatus || hasSearch) && (
            <button type="button" className="btn filter-full" onClick={onClearFilters}>
              清除筛选
            </button>
          )}
        </div>

        <PracticeDailyStats sourcePdf={pdfFilter || undefined} refreshKey={dailyStatsRefreshKey} />
        <WordDailyStats refreshKey={dailyStatsRefreshKey} compact />

        <div className="toolbar-section practice-question-crud">
          <span className="toolbar-label">题目管理</span>
          {currentQuestion ? (
            <p className="practice-current-question muted" title={currentQuestion.title}>
              当前 #{currentQuestion.id} · {currentQuestion.title}
            </p>
          ) : (
            <p className="practice-current-question muted">当前无题目</p>
          )}
          <button type="button" className="btn btn-primary filter-full" onClick={onCreate}>
            新建题目
          </button>
          <button
            type="button"
            className="btn filter-full"
            onClick={onEdit}
            disabled={!currentQuestion}
          >
            编辑当前题
          </button>
          <button
            type="button"
            className="btn btn-danger filter-full"
            onClick={onDelete}
            disabled={!currentQuestion}
          >
            删除当前题
          </button>
          {canConvertToCoding && onConvertToCoding && (
            <button
              type="button"
              className="btn filter-full practice-convert-coding"
              onClick={onConvertToCoding}
              disabled={!currentQuestion || convertBusy}
              title="保留题干与解析，转为代码题并可在编辑里填写测试数据"
            >
              {convertBusy ? '转换中…' : '⇄ 转为代码题'}
            </button>
          )}
          {currentQuestion?.type === 'coding' && (
            <p className="practice-coding-hint muted">
              代码题：提交仅存档，不自动判对错；测试数据在「编辑」里维护。
            </p>
          )}
        </div>

        <div className="toolbar-section">
          <span className="toolbar-label">操作</span>
          <button type="button" className="btn filter-full" onClick={onRefresh}>
            刷新
          </button>
          {questionCount > 1 && !randomPractice && (
            <>
              <button type="button" className="btn filter-full" onClick={onPrev}>
                上一题
              </button>
              <button type="button" className="btn filter-full" onClick={onNext}>
                下一题
              </button>
              <span className="nav-counter nav-counter--side">
                {currentIdx + 1} / {questionCount}
              </span>
            </>
          )}
          {randomPractice && questionCount > 0 && (
            <span className="nav-counter nav-counter--side">随机池 {questionCount} 题</span>
          )}
          <button type="button" className="btn filter-full" onClick={onExportMd}>
            导出 MD
          </button>
          <button type="button" className="btn filter-full" onClick={onExportZip}>
            导出 ZIP
          </button>
        </div>
      </div>
    </aside>
  )
}

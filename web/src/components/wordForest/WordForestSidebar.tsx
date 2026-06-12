import { Link } from 'react-router-dom'
import { WordLibraryTab } from './WordLibraryTab'
import { WordPracticeTools } from './WordPracticeTools'
import { WordStudyTimeBar } from './WordStudyTimeBar'
import { WordDailyStats } from '../WordDailyStats'
import type { DictationDirection } from './WordForestSidebar.types'

export type { DictationDirection } from './WordForestSidebar.types'

type Props = {
  dictationDirection: DictationDirection
  onDirectionChange: (d: DictationDirection) => void
  onRandomStart: () => void
  onWrongPracticeStart: () => void
  onUnitPractice: () => void
  onJumpToQuestion: (questionId: number) => void
  wrongCount: number
  randomBusy: boolean
  wordCount: number
  wordBook: string
  wordUnit: string
  onWordBookChange: (v: string) => void
  onWordUnitChange: (v: string) => void
  onDataChanged: () => void
  onResetUnit?: () => void
  resetBusy?: boolean
  dailyStatsRefreshKey?: number
}

export function WordForestSidebar({
  dictationDirection,
  onDirectionChange,
  onRandomStart,
  onWrongPracticeStart,
  onUnitPractice,
  onJumpToQuestion,
  wrongCount,
  randomBusy,
  wordCount,
  wordBook,
  wordUnit,
  onWordBookChange,
  onWordUnitChange,
  onDataChanged,
  onResetUnit,
  resetBusy,
  dailyStatsRefreshKey = 0,
}: Props) {
  return (
    <aside className="wf-sidebar">
      <header className="wf-sidebar-head">
        <h2 className="wf-logo">WORD FOREST</h2>
        <p className="wf-tagline">默写单词 · 做题本</p>
      </header>

      <WordStudyTimeBar />

      <WordDailyStats refreshKey={dailyStatsRefreshKey} />

      <WordPracticeTools
        book={wordBook}
        unit={wordUnit}
        onBookChange={onWordBookChange}
        onUnitChange={onWordUnitChange}
        onUnitPractice={onUnitPractice}
        onJumpToQuestion={onJumpToQuestion}
        onWordAdded={onDataChanged}
        practiceCount={wordCount}
        onResetUnit={onResetUnit}
        resetBusy={resetBusy}
      />

      <div className="wf-random-block">
        <p className="wf-random-title">随机默写</p>
        <div className="wf-direction-toggle" role="group" aria-label="默写方向">
          <button
            type="button"
            className={dictationDirection === 'zh2en' ? 'wf-dir active' : 'wf-dir'}
            onClick={() => onDirectionChange('zh2en')}
          >
            看中写英
          </button>
          <button
            type="button"
            className={dictationDirection === 'en2zh' ? 'wf-dir active' : 'wf-dir'}
            onClick={() => onDirectionChange('en2zh')}
          >
            看英写中
          </button>
        </div>
        <button
          type="button"
          className="wf-btn-random"
          disabled={randomBusy || wordCount < 1}
          onClick={onRandomStart}
        >
          {randomBusy ? '准备中…' : '开始随机默写'}
        </button>
        <button
          type="button"
          className="wf-btn-wrong"
          disabled={randomBusy || wrongCount < 1}
          onClick={onWrongPracticeStart}
          title="只练最近一次标错/拼错的词，可反复刷直到点对"
        >
          刷错词 ({wrongCount})
        </button>
        <p className="wf-random-hint">
          词库 {wordCount} 词 · 错词本 {wrongCount} · 练习时点「错了」会记入
        </p>
      </div>

      <p className="wf-goto-import">
        <Link to="/import#words" className="wf-import-link">
          导入题目数据 →
        </Link>
        <span className="wf-import-link-hint">错词 / 英文 PDF / 粘贴 / AI</span>
      </p>

      <div className="wf-tab-panel wf-tab-panel--library">
        <p className="wf-library-title">词库</p>
        <WordLibraryTab onChanged={onDataChanged} />
      </div>
    </aside>
  )
}

import { useCallback, useEffect, useRef } from 'react'
import { api } from '../api'

const TICK_SEC = 15

type Meta = {
  book?: string
  unit?: string
}

/**
 * 默写单词模式计时：进入启用 start，定时 tick，离开 end 并同步看板。
 */
export function useWordStudyTimer(enabled: boolean, meta: Meta) {
  const metaRef = useRef(meta)
  metaRef.current = meta
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const tick = useCallback((wordsDoneDelta = 0) => {
    if (!enabledRef.current) return
    const m = metaRef.current
    api
      .tickWordStudySession({
        delta_sec: TICK_SEC,
        book: m.book,
        unit: m.unit,
        words_done_delta: wordsDoneDelta,
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!enabled) {
      api.endWordStudySession({ sync_journal: false }).catch(() => {})
      return
    }

    const m = metaRef.current
    api.startWordStudySession({ book: m.book, unit: m.unit }).catch(() => {})

    const interval = window.setInterval(() => tick(0), TICK_SEC * 1000)

    const onVis = () => {
      if (document.hidden) return
      tick(0)
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
      api.endWordStudySession({ sync_journal: false }).catch(() => {})
    }
  }, [enabled, meta.book, meta.unit, tick])

  const recordWordDone = useCallback(() => {
    tick(1)
  }, [tick])

  return { recordWordDone }
}

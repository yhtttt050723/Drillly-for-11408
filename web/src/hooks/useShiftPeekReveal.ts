import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

const HOLD_MS = 280

function isShiftKey(e: { code?: string; key?: string }) {
  return e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift'
}

/**
 * 长按 Shift：按住期间 peeking=true，松开恢复。
 */
export function useShiftPeekReveal(enabled: boolean) {
  const [peeking, setPeeking] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peekingRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const endPeek = () => {
    clearTimer()
    if (peekingRef.current) {
      peekingRef.current = false
      setPeeking(false)
    }
  }

  const armHold = (e: KeyboardEvent | ReactKeyboardEvent['nativeEvent']) => {
    if (!isShiftKey(e) || ('repeat' in e && e.repeat)) return false
    e.preventDefault()
    clearTimer()
    timerRef.current = setTimeout(() => {
      peekingRef.current = true
      setPeeking(true)
    }, HOLD_MS)
    return true
  }

  useEffect(() => {
    if (!enabled) {
      endPeek()
      return
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isShiftKey(e) || e.repeat) return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          (t instanceof HTMLInputElement &&
            t.type !== 'checkbox' &&
            t.type !== 'radio' &&
            !t.classList.contains('word-spell-input') &&
            !t.classList.contains('word-meaning-input')) ||
          (t instanceof HTMLTextAreaElement && !t.classList.contains('word-meaning-input')))
      ) {
        return
      }
      armHold(e)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isShiftKey(e)) endPeek()
    }

    const onWindowBlur = () => endPeek()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      endPeek()
    }
  }, [enabled])

  const onSpellKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') return
    if (isShiftKey(e) && !e.repeat) {
      armHold(e.nativeEvent)
    }
  }

  const onSpellKeyUp = (e: ReactKeyboardEvent) => {
    if (isShiftKey(e)) endPeek()
  }

  return { peeking, onSpellKeyDown, onSpellKeyUp, endPeek }
}

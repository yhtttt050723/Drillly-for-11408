import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'drillly-scratch-'

export function ScratchPad({ questionId }: { questionId: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [focused, setFocused] = useState(false)
  const [color, setColor] = useState('#0f172a')
  const [lineWidth, setLineWidth] = useState(2)
  const [eraser, setEraser] = useState(false)
  const drawing = useRef(false)
  const history = useRef<ImageData[]>([])
  const histIdx = useRef(-1)

  const key = questionId ? `${STORAGE_PREFIX}${questionId}` : null

  const saveHistory = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const snap = ctx.getImageData(0, 0, c.width, c.height)
    history.current = history.current.slice(0, histIdx.current + 1)
    history.current.push(snap)
    histIdx.current = history.current.length - 1
  }, [])

  const restore = useCallback((idx: number) => {
    const c = canvasRef.current
    const snap = history.current[idx]
    if (!c || !snap) return
    const ctx = c.getContext('2d')
    ctx?.putImageData(snap, 0, 0)
    histIdx.current = idx
    if (key) localStorage.setItem(key, c.toDataURL())
  }, [key])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const parent = c.parentElement
    if (!parent) return
    c.width = parent.clientWidth
    c.height = parent.clientHeight - 48
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    if (key) {
      const saved = localStorage.getItem(key)
      if (saved) {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0)
          saveHistory()
        }
        img.src = saved
      } else {
        saveHistory()
      }
    } else {
      saveHistory()
    }
  }, [questionId, key, saveHistory])

  const persist = () => {
    const c = canvasRef.current
    if (c && key) localStorage.setItem(key, c.toDataURL())
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvasRef.current
    if (!c) return
    drawing.current = true
    c.setPointerCapture(e.pointerId)
    const ctx = c.getContext('2d')!
    ctx.strokeStyle = eraser ? '#ffffff' : color
    ctx.lineWidth = eraser ? lineWidth * 4 : lineWidth
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    ctx?.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
    ctx?.stroke()
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    saveHistory()
    persist()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!focused) return
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        if (histIdx.current > 0) restore(histIdx.current - 1)
      }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        if (histIdx.current < history.current.length - 1) restore(histIdx.current + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, restore])

  const clear = () => {
    if (!confirm('清空草稿？')) return
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    saveHistory()
    if (key) localStorage.removeItem(key)
  }

  return (
    <aside
      className={`scratch-panel ${focused ? 'focused' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      tabIndex={0}
    >
      <div className="scratch-head">草稿画板</div>
      <div className="scratch-tools">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="颜色" />
        <input
          type="range"
          min={1}
          max={8}
          value={lineWidth}
          onChange={(e) => setLineWidth(Number(e.target.value))}
          title="线宽"
        />
        <button type="button" className="btn btn-sm" onClick={() => setEraser(!eraser)}>
          {eraser ? '画笔' : '橡皮'}
        </button>
        <button type="button" className="btn btn-sm" onClick={clear}>
          清空
        </button>
      </div>
      <div className="scratch-canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </aside>
  )
}

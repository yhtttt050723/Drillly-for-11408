import type { KeyboardEvent } from 'react'

const INDENT = '    '

/** 代码 textarea：Tab 缩进，Shift+Tab 反缩进 */
export function handleCodeTextareaTabKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (next: string) => void,
) {
  if (e.key !== 'Tab') return
  e.preventDefault()

  const el = e.currentTarget
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0

  if (e.shiftKey) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const blockEnd = value.indexOf('\n', end)
    const blockEndPos = blockEnd === -1 ? value.length : blockEnd
    const block = value.slice(lineStart, blockEndPos)
    const lines = block.split('\n')
    let removed = 0
    const outLines = lines.map((line) => {
      if (line.startsWith(INDENT)) {
        removed += INDENT.length
        return line.slice(INDENT.length)
      }
      if (line.startsWith('\t')) {
        removed += 1
        return line.slice(1)
      }
      if (line.startsWith(' ')) {
        const m = line.match(/^ +/)
        const n = Math.min(m?.[0].length ?? 0, INDENT.length)
        removed += n
        return line.slice(n)
      }
      return line
    })
    const next =
      value.slice(0, lineStart) + outLines.join('\n') + value.slice(blockEndPos)
    onChange(next)
    const newStart = Math.max(lineStart, start - Math.min(INDENT.length, start - lineStart))
    const newEnd = end - removed
    queueSelection(el, newStart, Math.max(newStart, newEnd))
    return
  }

  if (start === end) {
    const next = value.slice(0, start) + INDENT + value.slice(end)
    onChange(next)
    queueSelection(el, start + INDENT.length, start + INDENT.length)
    return
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const blockEnd = value.indexOf('\n', end)
  const blockEndPos = blockEnd === -1 ? value.length : blockEnd
  const block = value.slice(lineStart, blockEndPos)
  const indented = block
    .split('\n')
    .map((line) => INDENT + line)
    .join('\n')
  const next = value.slice(0, lineStart) + indented + value.slice(blockEndPos)
  onChange(next)
  const added = INDENT.length * block.split('\n').length
  queueSelection(el, start + INDENT.length, end + added)
}

function queueSelection(el: HTMLTextAreaElement, start: number, end: number) {
  requestAnimationFrame(() => {
    el.selectionStart = start
    el.selectionEnd = end
  })
}

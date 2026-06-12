import type { InboxProcessBody, InboxProcessResult } from '../api'

export type InboxStreamEvent =
  | { type: 'plan'; total_files: number; pending_files: number; skipped_files: number }
  | { type: 'skip'; file: string; reason: string }
  | { type: 'file_start'; file: string; file_index: number; file_total: number }
  | { type: 'splitting'; file: string }
  | { type: 'split_done'; file: string; batches: number; total_pages: number }
  | {
      type: 'batch_start'
      file: string
      batch_index: number
      batch_total: number
      page_start: number
      page_end: number
    }
  | {
      type: 'batch_done'
      file: string
      batch_index: number
      batch_total: number
      questions: number
      pdf_tag?: string
      extract_mode?: string
      text_chars?: number
      zero_hint?: string
      questions_in_db?: number
    }
  | {
      type: 'batch_error'
      file: string
      batch_index: number
      batch_total: number
      error: string
      page_start?: number
      page_end?: number
      retry?: boolean
    }
  | {
      type: 'retry_plan'
      file: string
      batches: number
      batch_indices?: number[]
    }
  | {
      type: 'retry_done'
      file: string
      questions_added: number
    }
  | { type: 'file_done'; file: string; result: InboxProcessResult['results'][0] }
  | { type: 'file_error'; file: string; error: string }
  | { type: 'complete' } & InboxProcessResult
  | { type: 'fatal'; error: string }

function parseSseChunk(buffer: string): { events: InboxStreamEvent[]; rest: string } {
  const events: InboxStreamEvent[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const block of parts) {
    const line = block.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try {
      events.push(JSON.parse(line.slice(6)) as InboxStreamEvent)
    } catch {
      /* ignore malformed */
    }
  }
  return { events, rest }
}

async function streamInbox(
  url: string,
  body: Record<string, unknown>,
  onEvent: (ev: InboxStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || r.statusText)
  }
  const reader = r.body?.getReader()
  if (!reader) throw new Error('浏览器不支持流式响应')

  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parsed = parseSseChunk(buf)
    buf = parsed.rest
    for (const ev of parsed.events) onEvent(ev)
  }
  if (buf.trim()) {
    const parsed = parseSseChunk(buf + '\n\n')
    for (const ev of parsed.events) onEvent(ev)
  }
}

export async function streamInboxProcessAll(
  body: InboxProcessBody,
  onEvent: (ev: InboxStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamInbox('/api/import/inbox/process-all/stream/', body, onEvent, signal)
}

/** 单文件流式导入；`filename` 在请求体中必填（见 InboxProcessBody） */
export type InboxProcessOneBody = InboxProcessBody

export async function streamInboxProcessOne(
  body: InboxProcessOneBody,
  onEvent: (ev: InboxStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamInbox('/api/import/inbox/process-one/stream/', body, onEvent, signal)
}

export async function streamInboxRetryFailed(
  body: InboxProcessOneBody,
  onEvent: (ev: InboxStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamInbox('/api/import/inbox/retry-failed/stream/', body, onEvent, signal)
}

export function inboxStreamPercent(
  fileIndex: number,
  fileTotal: number,
  batchIndex: number,
  batchTotal: number,
): number {
  if (fileTotal <= 0) return 0
  const fileBase = Math.max(0, fileIndex - 1) / fileTotal
  const inFile = batchTotal > 0 ? batchIndex / batchTotal / fileTotal : 1 / fileTotal
  return Math.min(99, Math.round((fileBase + inFile) * 100))
}

import type { Question } from '../api'

export function questionSource(q: Question): { pdf: string; path: string } {
  const meta = (q.content?.metadata || {}) as Record<string, unknown>
  const pdf = String(meta.source_pdf || '').trim()
  const path = String(meta.source_path || '').trim()
  return { pdf, path }
}

/** 用户手动维护的章节编号（如 6.1.6、§7.2） */
export function questionChapter(q: Question): string {
  const meta = (q.content?.metadata || {}) as Record<string, unknown>
  return String(meta.chapter || '').trim()
}

const META_TITLE_RE = /^\d+\.\s*【P\d+】\s*$/
const TITLE_PREFIX_RE = /^(\d+\.\s*【P\d+】)\s*/

/** 列表预览用：去掉 LaTeX/代码，保留可读文字 */
export function stripForListPreview(raw: string, maxLen = 52): string {
  let t = raw
    .replace(/\\begin\{verbatim\}[\s\S]*?\\end\{verbatim\}/gi, ' [代码] ')
    .replace(/\\begin\{lstlisting\}[\s\S]*?\\end\{lstlisting\}/gi, ' [代码] ')
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]+\$/g, ' ')
    .replace(/\\[a-zA-Z]+(\{[^{}]*\})?/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > maxLen) t = `${t.slice(0, maxLen)}…`
  return t
}

/** 左侧列表主行：章节编号 + 题号 + 题干摘要（不拼 PDF，PDF 单独一行） */
export function questionListPreview(q: Question): string {
  const chapter = questionChapter(q)
  const title = String(q.content?.title || '').trim()
  const stem = String(q.content?.stem || '').trim()
  const titlePlain = stripForListPreview(title, 80)
  const stemPlain = stripForListPreview(stem, 52)

  const prefixMatch = title.match(TITLE_PREFIX_RE) || stem.match(TITLE_PREFIX_RE)
  const prefix = prefixMatch ? prefixMatch[1] : ''

  // title 已是「题号 + 足够长的题干」
  if (titlePlain.length > 20 && !META_TITLE_RE.test(titlePlain)) {
    return chapter ? `[${chapter}] ${titlePlain}` : titlePlain
  }

  // title 只有「7. 【P9】」类 → 用 stem 补正文
  if (stemPlain) {
    const head = prefix || (META_TITLE_RE.test(titlePlain) ? titlePlain : '')
    const body =
      head && !stemPlain.startsWith(head) ? `${head} ${stemPlain}`.trim() : stemPlain
    return chapter ? `[${chapter}] ${body}` : body
  }

  if (titlePlain) return chapter ? `[${chapter}] ${titlePlain}` : titlePlain
  const fallback = `题目 #${q.id}`
  return chapter ? `[${chapter}] ${fallback}` : fallback
}

/** @deprecated 使用 questionListPreview + questionSource().pdf */
export function questionListLabel(q: Question): string {
  const preview = questionListPreview(q)
  const { pdf } = questionSource(q)
  if (pdf) return `${preview} · ${pdf}`
  return preview
}

import type { Question, Tag } from '../api'

const PDF_SOURCE_PREFIX = '来源·'

export function isPdfSourceTag(name: string): boolean {
  return name.startsWith(PDF_SOURCE_PREFIX)
}

/** 仅主题大/小标签，不含 PDF 来源标签 */
export function topicTagsFromQuestion(q: Question): Tag[] {
  return q.tags.filter((t) => !isPdfSourceTag(t.name))
}

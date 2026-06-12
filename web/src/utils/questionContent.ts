import type { Question } from '../api'

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'coding'
  | 'subjective'
  | 'wrong_review'
  | 'word_dictation'

export type QuestionOption = { key: string; content: string }

export type CodingTestCase = {
  input: string
  expectedOutput: string
  note?: string
}

/** 代码题仅支持 C / C++ */
export const CODING_LANGUAGES = ['c', 'cpp'] as const
export type CodingLanguage = (typeof CODING_LANGUAGES)[number]
export const DEFAULT_CODING_LANGUAGE: CodingLanguage = 'cpp'

export function normalizeCodingLanguage(lang: unknown): CodingLanguage {
  const s = String(lang || '').toLowerCase()
  return s === 'c' ? 'c' : 'cpp'
}

export function defaultStarterCode(lang: string): string {
  if (lang === 'c') {
    return '#include <stdio.h>\n\nint main() {\n    return 0;\n}'
  }
  return '#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}'
}

export function canConvertToCoding(type: string): boolean {
  return type === 'single_choice' || type === 'multiple_choice' || type === 'subjective'
}

export function codingTestCases(content: Record<string, unknown>): CodingTestCase[] {
  const raw = content.testCases
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      input: String(x.input ?? ''),
      expectedOutput: String(x.expectedOutput ?? ''),
      note: x.note != null ? String(x.note) : undefined,
    }))
}

export function convertContentToCoding(prev: Record<string, unknown>): Record<string, unknown> {
  const metadata = { ...((prev.metadata || {}) as Record<string, unknown>) }
  const next: Record<string, unknown> = {
    ...prev,
    type: 'coding',
    title: prev.title ?? '',
    stem: prev.stem ?? '',
    explanation: prev.explanation ?? '',
    images: Array.isArray(prev.images) ? prev.images : [],
    language: normalizeCodingLanguage(prev.language),
    starterCode: prev.starterCode || '',
    testCases: codingTestCases(prev),
    metadata,
    answer: [],
  }
  delete next.options
  return next
}

export function defaultQuestionContent(type: QuestionType = 'subjective'): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type,
    title: '',
    stem: '',
    explanation: '',
    images: [] as string[],
    metadata: {},
  }
  if (type === 'single_choice' || type === 'multiple_choice') {
    return {
      ...base,
      options: [
        { key: 'A', content: '' },
        { key: 'B', content: '' },
        { key: 'C', content: '' },
        { key: 'D', content: '' },
      ],
      answer: type === 'single_choice' ? ['A'] : ['A'],
    }
  }
  if (type === 'coding') {
    return {
      ...base,
      language: DEFAULT_CODING_LANGUAGE,
      starterCode: defaultStarterCode(DEFAULT_CODING_LANGUAGE),
      testCases: [] as CodingTestCase[],
      answer: [],
    }
  }
  if (type === 'wrong_review') {
    return {
      ...base,
      stem: '',
      answer: [],
      metadata: { wrong_import: true, tags: [] as string[] },
    }
  }
  if (type === 'word_dictation') {
    return {
      ...base,
      word: '',
      meaning: '',
      phonetic: '',
      hint: '',
      stem: '',
      answer: [],
      metadata: { import_source: 'manual', unit: '', tags: [] as string[] },
    }
  }
  return { ...base, answer: [] }
}

export function isWrongReview(q: Question | { type: string }): boolean {
  return q.type === 'wrong_review'
}

export function isWordDictation(q: Question | { type: string }): boolean {
  return q.type === 'word_dictation'
}

export function wordDictationMeta(q: Question): {
  word: string
  meaning: string
  phonetic: string
  hint: string
  unit: string
  sourceLabel: string
} {
  const c = q.content || {}
  const meta = (c.metadata || {}) as Record<string, unknown>
  return {
    word: String(c.word || c.title || ''),
    meaning: String(c.meaning || c.stem || ''),
    phonetic: String(c.phonetic || meta.phonetic || ''),
    hint: String(c.hint || meta.hint || ''),
    unit: String(meta.unit || ''),
    sourceLabel: String(meta.source_label || meta.import_source || ''),
  }
}

export function wrongQuestionMeta(q: Question): {
  questionNumber: string
  sourceLabel: string
  sourcePath: string
  book: string
  extraTags: string[]
} {
  const meta = (q.content?.metadata || {}) as Record<string, unknown>
  const tags = meta.tags
  return {
    questionNumber: String(meta.question_number || ''),
    sourceLabel: String(meta.source_label || meta.source_pdf || ''),
    sourcePath: String(meta.source_path || ''),
    book: String(meta.book || ''),
    extraTags: Array.isArray(tags) ? tags.map(String) : [],
  }
}

export function formatDurationMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function questionImages(q: Question | Record<string, unknown>): string[] {
  const c = ('content' in q ? q.content : q) as Record<string, unknown>
  const imgs = c?.images
  if (!Array.isArray(imgs)) return []
  return imgs.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
}

export function questionOptions(content: Record<string, unknown>): QuestionOption[] {
  const opts = content.options
  if (!Array.isArray(opts)) return []
  return opts
    .filter((o): o is QuestionOption => typeof o === 'object' && o !== null && 'key' in o)
    .map((o) => ({ key: String(o.key), content: String(o.content ?? '') }))
}

export function answerToText(content: Record<string, unknown>): string {
  const a = content.answer
  if (!Array.isArray(a)) return ''
  return a.map(String).join(', ')
}

export function textToAnswer(text: string, type: QuestionType): string[] {
  const parts = text
    .split(/[,，\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  if (type === 'single_choice') return parts.slice(0, 1)
  return parts
}

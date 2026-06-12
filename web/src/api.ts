const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || r.statusText)
  }
  if (r.status === 204) return undefined as T
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return r.json()
  return r as unknown as T
}

export type Tag = { id: number; name: string; color: string }
export type TagTreeGroup = {
  name: string
  id?: number
  children: { id: number; name: string; full_name: string; color: string }[]
}
export type Category = { id: number; name: string; color: string; sort_order: number; parent_id: number | null }
export type PracticeState = {
  round1: boolean
  round2: boolean
  source_pdf: string
}

export type Question = {
  id: number
  type: string
  content: Record<string, unknown>
  category_id: number | null
  tags: Tag[]
  category: Category | null
  practice?: PracticeState
}

export type PdfSource = { source_pdf: string; question_count: number }
export type ProgressSummary = { total: number; round1_done: number; round2_done: number }
export type DailySourceStats = {
  source_pdf: string
  submissions: number
  questions: number
}
export type DailyPracticeDay = {
  date: string
  submissions: number
  questions: number
  correct: number
  by_source: DailySourceStats[]
}
export type DailyPracticeStats = {
  timezone: string
  today: string
  days: number
  today_stats: DailyPracticeDay
  daily: DailyPracticeDay[]
  storage: string
}
export type DailyWordUnitStats = {
  unit: string
  submissions: number
  words: number
  correct: number
  wrong: number
}
export type DailyWordDay = {
  date: string
  submissions: number
  words: number
  correct: number
  wrong: number
  study_minutes: number
  by_unit: DailyWordUnitStats[]
}
export type DailyWordStats = {
  timezone: string
  today: string
  days: number
  today_stats: DailyWordDay
  daily: DailyWordDay[]
  storage: string
}
export type WrongBoardItem = {
  question_id: number
  type: string
  title: string
  stem_preview: string
  source_pdf: string
  chapter: string
  tags: Tag[]
  wrong_count: number
  last_wrong_at: string
  last_answer: string
}
export type PracticeWrongBoard = {
  timezone: string
  today: string
  days: number
  total: number
  offset: number
  limit: number
  items: WrongBoardItem[]
}
export type Submission = {
  id: number
  question_id: number
  answer: Record<string, unknown>
  score: number
  is_correct: boolean
  duration_ms: number | null
  created_at: string
}

export type SubmitAnswer = {
  submission: Submission
  practice: PracticeState | null
}

export type PracticeProgressUpdate = {
  ok: boolean
  question_id: number
  practice: PracticeState
}

/** 提交/标记后通知练习页增量更新，避免重载整表 */
export type PracticeSubmitEvent = {
  questionId: number
  practice?: PracticeState
  refreshQuestion?: boolean
  fullReload?: boolean
  selfMark?: 'correct' | 'wrong'
  isCorrect?: boolean
  /** 提交正确后自动切下一题（列表未因筛选移除时） */
  autoAdvance?: boolean
}

export const api = {
  health: () => request<{ ok: boolean; question_count?: number }>('/health/'),
  listQuestions: (params: URLSearchParams) =>
    request<Question[]>(`/questions/?${params}`),
  listPracticeQuestions: (params: URLSearchParams) =>
    request<Question[] | PracticeQuestionPage>(`/practice/questions/?${params}`),
  listPracticeQuestionsPaged: (params: URLSearchParams) => {
    const p = new URLSearchParams(params)
    p.set('page', 'true')
    return request<PracticeQuestionPage>(`/practice/questions/?${p}`)
  },
  listPdfSources: () => request<PdfSource[]>('/practice/pdf-sources/'),
  backfillSourceTags: () =>
    request<{ updated: number }>('/practice/backfill-source-tags/', {
      method: 'POST',
      body: '{}',
    }),
  progressSummary: (sourcePdf?: string) => {
    const p = new URLSearchParams()
    if (sourcePdf) p.set('source_pdf', sourcePdf)
    const q = p.toString()
    return request<ProgressSummary>(`/practice/progress/summary/${q ? `?${q}` : ''}`)
  },
  dailyPracticeStats: (sourcePdf?: string, days = 14) => {
    const p = new URLSearchParams()
    p.set('days', String(days))
    if (sourcePdf) p.set('source_pdf', sourcePdf)
    return request<DailyPracticeStats>(`/practice/daily-stats/?${p}`)
  },
  dailyWordStats: (days = 14) => {
    const p = new URLSearchParams()
    p.set('days', String(days))
    return request<DailyWordStats>(`/words/daily-stats/?${p}`)
  },
  practiceSessionStats: (opts: {
    start?: string
    end?: string
    slot?: string
    date?: string
    endDate?: string
    sourcePdf?: string
    format?: 'json' | 'md'
  } = {}) => {
    const p = new URLSearchParams()
    if (opts.start) p.set('start', opts.start)
    if (opts.end) p.set('end', opts.end)
    if (opts.slot) p.set('slot', opts.slot)
    if (opts.date) p.set('date', opts.date)
    if (opts.endDate) p.set('end_date', opts.endDate)
    if (opts.sourcePdf) p.set('source_pdf', opts.sourcePdf)
    if (opts.format) p.set('format', opts.format)
    return request<Record<string, unknown>>(`/practice/session-stats/?${p}`)
  },
  practiceWrongBoard: (opts: {
    days?: number
    sourcePdf?: string
    tags?: string
    limit?: number
    offset?: number
  } = {}) => {
    const p = new URLSearchParams()
    p.set('days', String(opts.days ?? 1))
    if (opts.limit != null) p.set('limit', String(opts.limit))
    if (opts.offset != null) p.set('offset', String(opts.offset))
    if (opts.sourcePdf) p.set('source_pdf', opts.sourcePdf)
    if (opts.tags) p.set('tags', opts.tags)
    return request<PracticeWrongBoard>(`/practice/wrong-board/?${p}`)
  },
  setPracticeProgress: (questionId: number, round: 1 | 2, done: boolean) =>
    request<PracticeProgressUpdate>(`/practice/progress/${questionId}/`, {
      method: 'POST',
      body: JSON.stringify({ round, done }),
    }),
  listCategories: () => request<Category[]>('/questions/categories/'),
  listTags: () => request<Tag[]>('/questions/tags/'),
  listTagTree: () => request<TagTreeGroup[]>('/questions/tags/tree/'),
  createTag: (body: { name: string; color?: string }) =>
    request<Tag>('/questions/tags/', { method: 'POST', body: JSON.stringify(body) }),
  getQuestion: (id: number) => request<Question>(`/questions/${id}/`),
  createQuestion: (body: {
    type: string
    content: Record<string, unknown>
    category_id?: number | null
    tag_ids?: number[]
  }) =>
    request<Question>('/questions/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchQuestion: (
    id: number,
    body: {
      type?: string
      category_id?: number | null
      tag_ids?: number[]
      content?: Record<string, unknown>
    },
  ) =>
    request<Question>(`/questions/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  convertQuestionToCoding: (id: number) =>
    request<Question>(`/questions/${id}/convert-to-coding/`, { method: 'POST' }),
  deleteQuestion: (id: number) =>
    request<{ ok: boolean }>(`/questions/${id}/`, { method: 'DELETE' }),
  uploadQuestionImage: async (questionId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(`${BASE}/questions/${questionId}/images/`, {
      method: 'POST',
      body: fd,
    })
    if (!r.ok) throw new Error(await r.text() || r.statusText)
    return r.json() as Promise<{ url: string; images: string[] }>
  },
  deleteQuestionImage: (questionId: number, url: string) => {
    const p = new URLSearchParams({ url })
    return request<{ ok: boolean; images: string[] }>(
      `/questions/${questionId}/images/?${p}`,
      { method: 'DELETE' },
    )
  },
  submit: (body: {
    question_id: number
    answer: Record<string, unknown>
    language?: string
    duration_ms?: number
    practice_round?: 1 | 2
  }) =>
    request<SubmitAnswer>('/practice/submit/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submissions: (questionId: number) =>
    request<Submission[]>(`/practice/submissions/?question_id=${questionId}`),
  runCode: (body: { language: string; code: string; stdin?: string }) =>
    request<{ stdout: string; stderr: string; exit_code: number; timed_out: boolean }>(
      '/runner/execute/',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  providers: () =>
    request<{ id: string; label: string; model: string; available: boolean }[]>(
      '/import/providers/',
    ),
  uploadPdf: (form: FormData) =>
    request<{ task_id: number; batches: number }>('/import/pdf/', {
      method: 'POST',
      body: form,
    }),
  getTask: (id: number) => request<ImportTask>(`/import/tasks/${id}/`),
  parseBatch: (taskId: number, batchId: number, provider: string, model?: string) =>
    request<{
      questions: unknown[]
      count: number
      pdf_tag?: string
      source_pdf?: string
      source_path?: string
    }>(
      `/import/tasks/${taskId}/batches/${batchId}/parse/`,
      {
        method: 'POST',
        body: JSON.stringify({ provider, model }),
      },
    ),
  confirmBatch: (taskId: number, batchId: number) =>
    request<{ created_question_ids: number[] }>(
      `/import/tasks/${taskId}/batches/${batchId}/confirm/`,
      { method: 'POST', body: '{}' },
    ),
  exportUrl: (params: URLSearchParams) => `${BASE}/practice/export/markdown/?${params}`,
  getSettings: () => request<PublicSettings>('/settings/'),
  patchSettings: (body: Record<string, string | number>) =>
    request<PublicSettings>('/settings/', { method: 'PATCH', body: JSON.stringify(body) }),
  previewEnglishPdfWords: (
    file: File,
    opts?: {
      provider?: string
      model?: string
      pages_per_batch?: number
      unit?: string
    },
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('provider', opts?.provider ?? 'deepseek')
    if (opts?.model) fd.append('model', opts.model)
    if (opts?.pages_per_batch != null) fd.append('pages_per_batch', String(opts.pages_per_batch))
    if (opts?.unit) fd.append('unit', opts.unit)
    return request<EnglishPdfWordsPreview>('/import/english-pdf-words/preview/', {
      method: 'POST',
      body: fd,
    })
  },
  uploadEnglishPdfWords: (
    file: File,
    opts?: {
      auto_import?: boolean
      provider?: string
      model?: string
      pages_per_batch?: number
      unit?: string
      tag_group?: string
      source_label?: string
      allow_reimport?: boolean
      replace_pdf_source?: boolean
    },
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('auto_import', String(opts?.auto_import ?? true))
    fd.append('provider', opts?.provider ?? 'deepseek')
    if (opts?.model) fd.append('model', opts.model)
    if (opts?.pages_per_batch != null) fd.append('pages_per_batch', String(opts.pages_per_batch))
    if (opts?.unit) fd.append('unit', opts.unit)
    if (opts?.tag_group) fd.append('tag_group', opts.tag_group)
    if (opts?.source_label) fd.append('source_label', opts.source_label)
    fd.append('allow_reimport', String(opts?.allow_reimport ?? false))
    fd.append('replace_pdf_source', String(opts?.replace_pdf_source ?? false))
    return request<EnglishPdfWordsResult>('/import/english-pdf-words/', {
      method: 'POST',
      body: fd,
    })
  },
  getInbox: () =>
    request<{ inbox_dir: string; files: InboxFile[] }>('/import/inbox/'),
  getImportJobState: () => request<ImportJobState>('/import/inbox/job-state/'),
  cancelInboxImport: () =>
    request<{ ok: boolean; message: string }>('/import/inbox/cancel/', {
      method: 'POST',
      body: '{}',
    }),
  clearImportJob: () =>
    request<{ ok: boolean }>('/import/inbox/clear-job/', { method: 'POST', body: '{}' }),
  resetInboxFile: (filename: string) =>
    request<{ file: string; questions_deleted: number; ledger_cleared: boolean }>(
      '/import/inbox/reset/',
      { method: 'POST', body: JSON.stringify({ filename }) },
    ),
  getFailedBatches: () =>
    request<{
      pending: { file: string; batch_index: number; page_start: number; page_end: number; error: string; chunk_path?: string }[]
      count_by_file: Record<string, number>
      total: number
    }>('/import/inbox/failed-batches/'),
  processInboxAll: (body: InboxProcessBody) =>
    request<InboxProcessResult>('/import/inbox/process-all/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  syncWrongbook: () =>
    request<{ ok: boolean; path: string; message: string }>('/sync/study/wrongbook/', {
      method: 'POST',
      body: '{}',
    }),
  syncPaths: () => request<SyncPaths>('/sync/paths/'),
  listWrongSubjects: () =>
    request<{ root: string; subjects: string[]; tag_groups: Record<string, string> }>(
      '/wrong-questions/subjects/',
    ),
  previewWrongImport: (subject: string) =>
    request<WrongImportPreview>(`/wrong-questions/preview/?subject=${encodeURIComponent(subject)}`),
  previewWrongImportAll: () => request<WrongImportPreviewAll>('/wrong-questions/preview-all/'),
  importWrongScreenshots: (body: WrongImportBody) =>
    request<WrongImportResult>('/wrong-questions/import/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importAllWrongScreenshots: () =>
    request<WrongImportAllResult>('/wrong-questions/import-all/', {
      method: 'POST',
      body: '{}',
    }),
  repairWrongImages: () =>
    request<{ fixed: number }>('/wrong-questions/repair-images/', {
      method: 'POST',
      body: '{}',
    }),
  repairWrongTags: () =>
    request<{ fixed: number }>('/wrong-questions/repair-tags/', {
      method: 'POST',
      body: '{}',
    }),
  previewWordImport: () => request<WordImportPreview>('/words/preview/'),
  importWordPaste: (body: WordPasteImportBody) =>
    request<WordImportResult>('/words/import-paste/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importWordStudy: (body?: WordStudyImportBody) =>
    request<WordImportResult>('/words/import-study/', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  importWordFromPdf: (body?: WordPdfImportBody) =>
    request<WordImportResult>('/words/import-pdf/', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  suggestWords: (body: WordSuggestBody) =>
    request<WordSuggestResult>('/words/suggest/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listLocalModels: () => request<{ models: string[] }>('/words/local-models/'),
  getEnglishVocabInbox: () =>
    request<{
      inbox_dir: string
      naming_hint: string
      files: EnglishVocabInboxFile[]
    }>('/import/english-vocab-inbox/'),
  processEnglishVocabInboxAll: (body: EnglishVocabInboxProcessBody) =>
    request<EnglishVocabInboxProcessResult>('/import/english-vocab-inbox/process-all/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  processEnglishVocabInboxOne: (body: EnglishVocabInboxOneBody) =>
    request<EnglishVocabInboxFileResult>('/import/english-vocab-inbox/process-one/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetEnglishVocabInboxFile: (filename: string) =>
    request<{ file: string; ledger_cleared: boolean; restored: boolean }>(
      '/import/english-vocab-inbox/reset/',
      { method: 'POST', body: JSON.stringify({ filename }) },
    ),
  listWords: (params?: {
    q?: string
    unit?: string
    book?: string
    tag?: string
    wrong_only?: '' | 'wrong' | 'correct' | 'unmarked'
    limit?: number
    offset?: number
  }) => {
    const p = new URLSearchParams()
    if (params?.q) p.set('q', params.q)
    if (params?.unit) p.set('unit', params.unit)
    if (params?.book) p.set('book', params.book)
    if (params?.tag) p.set('tag', params.tag)
    if (params?.wrong_only) p.set('wrong_only', params.wrong_only)
    if (params?.limit != null) p.set('limit', String(params.limit))
    if (params?.offset != null) p.set('offset', String(params.offset))
    const q = p.toString()
    return request<WordListResult>(`/words/${q ? `?${q}` : ''}`)
  },
  listWordUnits: () => request<{ units: string[] }>('/words/units/'),
  listWordUnitTags: (params: { book?: string; unit: string }) => {
    const p = new URLSearchParams()
    if (params.book) p.set('book', params.book)
    p.set('unit', params.unit)
    return request<{ tags: string[] }>(`/words/unit-tags/?${p}`)
  },
  listWordBooks: () => request<{ books: string[] }>('/words/books/'),
  listWordTagCatalog: () =>
    request<{ parent: string; children: string[]; books: string[] }>('/words/tags/catalog/'),
  getWordWrongStats: () =>
    request<{ total_words: number; tagged_wrong: number; last_mark_wrong: number }>(
      '/words/wrong-stats/',
    ),
  setWordTags: (id: number, body: WordTagsBody) =>
    request<WordItem>(`/words/${id}/tags/`, { method: 'PUT', body: JSON.stringify(body) }),
  mergeWordTags: (body: { from_name: string; to_name: string }) =>
    request<{ updated: number; merged: string }>('/words/tags/merge/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mergeWordEntries: (body: { target_id: number; source_id: number }) =>
    request<WordItem>('/words/merge/', { method: 'POST', body: JSON.stringify(body) }),
  markWordWrong: (id: number) =>
    request<WordItem>(`/words/${id}/mark-wrong/`, { method: 'POST', body: '{}' }),
  clearWordWrong: (id: number) =>
    request<WordItem>(`/words/${id}/clear-wrong/`, { method: 'POST', body: '{}' }),
  startWordStudySession: (body?: { book?: string; unit?: string }) =>
    request<{ ok: boolean; session?: Record<string, unknown> }>('/words/study-session/start/', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  tickWordStudySession: (body?: {
    delta_sec?: number
    book?: string
    unit?: string
    words_done_delta?: number
  }) =>
    request<{ ok: boolean; today_minutes?: number; duration_sec?: number }>(
      '/words/study-session/tick/',
      { method: 'POST', body: JSON.stringify(body || {}) },
    ),
  endWordStudySession: (body?: { sync_journal?: boolean }) =>
    request<{ ok: boolean; minutes?: number; board_file?: string }>('/words/study-session/end/', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  getWordStudyToday: () =>
    request<{
      date: string
      today_minutes: number
      today_seconds: number
      active: boolean
      active_duration_sec: number
      board_file: string
      dailyLog: Record<string, number>
      recent_blocks: unknown[]
    }>('/words/study-session/today/'),
  syncWordStudyJournal: (body?: { date?: string; minutes?: number; label?: string }) =>
    request<{ ok: boolean; path?: string; totalMinutes?: number; reason?: string }>(
      '/words/study-session/sync-journal/',
      { method: 'POST', body: JSON.stringify(body || {}) },
    ),
  clearAllWords: (body?: { clear_inbox_ledger?: boolean; restore_inbox_pdfs?: boolean }) =>
    request<{
      deleted: number
      ledger_cleared?: number
      inbox_restore?: { moved: number; files: string[] }
      word_dictation_in_db: number
    }>('/words/clear-all/', {
      method: 'POST',
      body: JSON.stringify({
        clear_inbox_ledger: body?.clear_inbox_ledger ?? true,
        restore_inbox_pdfs: body?.restore_inbox_pdfs ?? true,
      }),
    }),
  getWord: (id: number) => request<WordItem>(`/words/${id}/`),
  createWord: (body: WordCreateBody) =>
    request<WordItem>('/words/', { method: 'POST', body: JSON.stringify(body) }),
  updateWord: (id: number, body: WordPatchBody) =>
    request<WordItem>(`/words/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWord: (id: number) =>
    request<{ ok: boolean; id: number }>(`/words/${id}/`, { method: 'DELETE' }),
  resetWordPractice: (body: { book?: string; unit?: string; tag?: string }) =>
    request<{ reset: number; archived: number; question_ids: number[] }>('/words/reset-practice/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export type PracticeQuestionPage = {
  items: Question[]
  total: number
  limit: number
  offset: number
}

export type PublicSettings = {
  tongyi_api_key_masked: string
  deepseek_api_key_masked: string
  tongyi_configured: boolean
  deepseek_configured: boolean
  local_base_url: string
  local_model: string
  local_api_key_masked: string
  local_configured: boolean
  llm_default_provider: string
  pdf_inbox_dir: string
  english_vocab_inbox_dir: string
  pdf_pages_per_batch: number
  study_export_wrongbook: string
  study_video_progress_file: string
  study_word_time_board_file: string
}

export type InboxFile = {
  name: string
  path: string
  size_mb: number
  imported?: boolean
  imported_at?: string
  task_id?: number
  question_count?: number
  questions_in_db?: number
}

export type ImportJobState = {
  active: boolean
  logs: string[]
  progress?: {
    percent?: number
    file_index?: number
    file_name?: string
    batch_index?: number
    batch_total?: number
  }
  summary?: InboxProcessResult
}
export type InboxProcessBody = {
  provider: string
  model?: string
  tags: string
  pages_per_batch: number
  auto_confirm: boolean
  /** 单文件导入 / 重试失败批次时必填 */
  filename?: string
}
export type InboxProcessItem = {
  file: string
  source_path?: string
  pdf_tag?: string
  task_id: number
  batches: number
  batch_errors?: number
  partial?: boolean
  parsed_questions: number
  created_question_ids: number[]
  questions_in_db?: number
  moved_to?: string
  kept_in_inbox?: boolean
}
export type InboxSkippedItem = {
  file: string
  reason: string
  task_id?: number
  imported_at?: string
}
export type InboxProcessResult = {
  processed: number
  skipped: number
  results: InboxProcessItem[]
  skipped_files: InboxSkippedItem[]
  errors: { file: string; error: string }[]
}
export type SyncPaths = {
  wrongbook_export_dir: string
  video_progress_file: string
  video_progress_hint: string
}

export type WrongImportPreview = {
  subject: string
  folder: string
  total_files: number
  new_count: number
  skipped_count: number
  new_files: string[]
  skipped_files: string[]
  tag_group?: string
  source_label?: string
}

export type WrongImportPreviewAll = {
  subjects: string[]
  total_files: number
  new_count: number
  skipped_count: number
  per_subject: {
    subject: string
    tag_group: string
    total_files: number
    new_count: number
    skipped_count: number
  }[]
}

export type WrongImportBody = {
  subject: string
  tag_group?: string
  source_label?: string
  small_tags?: string[]
}

export type WrongImportResult = {
  subject: string
  created: number
  created_question_ids: number[]
  skipped: number
  skipped_files: string[]
  errors: { file: string; error: string }[]
}

export type EnglishPdfWordsPreview = {
  pages: number
  word_count: number
  words: WordSuggestItem[]
  truncated?: boolean
  unit?: string
  provider?: string
  batches?: number
  batches_processed?: number
  logs?: string[]
  errors?: string[]
}

export type EnglishPdfWordsResult = EnglishPdfWordsPreview & {
  filename?: string
  imported?: WordImportResult & {
    updated?: number
    removed?: number
    source_label?: string
  }
}

export type WordImportPreview = {
  study_root: string
  english_notes_dir: string
  study_files: string[]
  study_word_count: number
  study_new_count: number
  pdf_candidate_count: number
  pdf_new_count: number
  word_dictation_in_db: number
  existing_word_keys: number
}

export type WordPasteImportBody = {
  text: string
  unit?: string
  tag_group?: string
  source_label?: string
  small_tags?: string[]
}

export type WordStudyImportBody = {
  tag_group?: string
  source_label?: string
  small_tags?: string[]
}

export type WordPdfImportBody = {
  source_pdf?: string
  tag_group?: string
  source_label?: string
  small_tags?: string[]
}

export type WordImportResult = {
  created: number
  created_question_ids: number[]
  skipped: number
  files?: string[]
  source_pdf?: string
}

export type WordSuggestBody = {
  message: string
  provider?: string
  model?: string
  unit?: string
  context?: string
  auto_import?: boolean
}

export type WordSuggestItem = { word: string; meaning: string }

export type WordSuggestResult = {
  provider: string
  model: string
  words: WordSuggestItem[]
  note?: string
  paste_preview: string
  imported?: WordImportResult
}

export type WordTagsBody = {
  book?: string
  unit?: string
  small_tags?: string[]
  keep_wrong_tag?: boolean
}

export type WordItem = {
  id: number
  word: string
  meaning: string
  unit: string
  book: string
  phonetic: string
  hint: string
  source_label: string
  import_source: string
  tag_names: string[]
  small_tags?: string[]
  wrong_count?: number
  last_wrong_at?: string
  last_mark?: 'correct' | 'wrong' | null
  has_wrong_tag?: boolean
  round1?: boolean
  round2?: boolean
  practice_history_count?: number
}

export type WordPatchBody = {
  word?: string
  meaning?: string
  unit?: string
  book?: string
  phonetic?: string
  hint?: string
  source_label?: string
}

export type EnglishVocabInboxFile = {
  name: string
  path: string
  size_mb: number
  book: string
  unit: string
  imported: boolean
  imported_at?: string
  word_count?: number
  created?: number
  skipped?: number
}

export type EnglishVocabInboxProcessBody = {
  provider?: string
  model?: string
  pages_per_batch?: number
  skip_imported?: boolean
  default_book?: string
}

export type EnglishVocabInboxOneBody = EnglishVocabInboxProcessBody & {
  filename: string
  book?: string
  unit?: string
  force?: boolean
}

export type EnglishVocabInboxProcessResult = {
  inbox_dir: string
  total: number
  processed: number
  skipped: number
  errors: number
  results: EnglishVocabInboxFileResult[]
}

export type EnglishVocabInboxFileResult = {
  file: string
  ok?: boolean
  skipped?: boolean
  reason?: string
  error?: string
  book?: string
  unit?: string
  word_count?: number
  imported?: WordImportResult & { updated?: number; removed?: number }
  logs?: string[]
  moved_to?: string
}

export type WordListResult = {
  items: WordItem[]
  total: number
  limit: number
  offset: number
}

export type WordCreateBody = {
  word: string
  meaning?: string
  unit?: string
  book?: string
  phonetic?: string
  hint?: string
  source_label?: string
}

export type WrongImportAllResult = {
  subjects: string[]
  total_created: number
  results: WrongImportResult[]
  images_repaired: number
  tags_repaired: number
}

export type ImportTask = {
  id: number
  original_name: string
  total_pages: number
  pages_per_batch: number
  status: string
  tags: { id: number; name: string }[]
  batches: { id: number; page_start: number; page_end: number; status: string }[]
}

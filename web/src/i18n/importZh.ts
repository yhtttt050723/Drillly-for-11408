// UI strings for PDF import page
export const importZh = {
  title: '导入题目数据',
  tabPdf: 'PDF 题目',
  tabWrong: '错题截图',
  tabWords: '默写单词',
  parseSettingsTitle: '解析设置（收件箱一键处理 & 单文件上传共用）',
  parseSettingsNote:
    '「每批页数」= 每次发给 AI 的连续页数。王道/扫描版做题本请选「通义千问」+ 每批 1 页（无文字层时会自动用视觉模型看图识题）。大题会导入为「主观题」。',
  pagesPerBatchHint: '一键处理与上传均使用此值',
  inboxUsesSettings: '下方「一键处理」使用上方解析设置，不能单独选页码范围；要重导某几本请移出收件箱或清空导入记录。',
  inboxTitle: '收件箱 · 一键批量转化',
  putPdf: '把 PDF 放到目录：',
  loading: '加载中…',
  inboxHint: '一般为：学习资料\\做题\\PDF待导入',
  refresh: '刷新列表',
  processAll: (n: number) => `一键处理全部 PDF（${n}）`,
  manualTitle: '单文件上传（可选，单文件 ≤80MB）',
  uploadSizeHint: '王道做题本约 60MB，请优先用上方「收件箱一键处理」；单文件上传超过上限会被拒绝。',
  pagesPerBatch: '每批页数',
  model: '模型',
  noKey: '（未配置 Key）',
  pdfTags: '大标签（可选，逗号分隔；AI 会为每题生成小标签）',
  upload: '上传并拆分',
  selectPdf: '请选择 PDF',
  uploadFail: '上传失败',
  splitBatches: (n: number) => `已拆分 ${n} 个批次`,
  parseFail: '解析失败',
  parsed: (n: number) => `解析 ${n} 题`,
  parsedMeta: (n: number, tag?: string, file?: string) => {
    let s = `解析 ${n} 题`
    if (tag) s += ` · 标签：${tag}`
    if (file) s += ` · 文件：${file}`
    return s
  },
  confirmFail: '入库失败',
  confirmed: (ids: string) => `已入库: ${ids}`,
  inboxEmpty: '收件箱为空，请先把 PDF 放入下方目录',
  confirmBatch: (n: number) => `将处理 ${n} 个 PDF（通义解析并入库），继续？`,
  processing: '批量处理中，请稍候…',
  progressTitle: '导入进度',
  progressFiles: (cur: number, total: number) => `文件 ${cur} / ${total}`,
  progressBatches: (cur: number, total: number, pages: string) =>
    `批次 ${cur} / ${total}（${pages}）`,
  progressWaiting: '准备中…',
  progressDone: '全部完成',
  logPlan: (pending: number, skip: number) =>
    `待处理 ${pending} 个 PDF` + (skip ? `，跳过 ${skip} 个` : ''),
  logSkip: (file: string, reason: string) => `跳过：${file}（${reason}）`,
  logFileStart: (file: string, i: number, n: number) => `[${i}/${n}] 开始：${file}`,
  logSplit: (file: string, batches: number, pages: number) =>
    `${file}：共 ${pages} 页，拆成 ${batches} 批`,
  logBatch: (file: string, i: number, n: number, q: number, mode?: string) =>
    `${file} 第 ${i}/${n} 批 → ${q} 题` + (mode ? `（${mode}）` : ''),
  logBatchZero: (file: string, i: number, n: number, hint: string, mode?: string) =>
    `${file} 第 ${i}/${n} 批 → 0 题 ⚠ ${hint}` + (mode ? ` [${mode}]` : ''),
  logBatchError: (file: string, i: number, n: number, err: string, pages?: string) =>
    `${file} 第 ${i}/${n} 批 失败${pages ? `（${pages}）` : ''}: ${err.slice(0, 120) || '（无错误文本，多为超时/限流）'}`,
  logBatchErrorSkip: (file: string, i: number, n: number, err: string, pages?: string) =>
    `${file} 第 ${i}/${n} 批 失败（已跳过，继续）${pages ? ` ${pages}` : ''}: ${err.slice(0, 120) || '（超时/限流）'}`,
  logRetryPlan: (file: string, n: number, indices: number[]) =>
    `【重导失败批】${file}：${n} 批 → 第 ${indices.join(', ')} 批`,
  logRetryDone: (file: string, added: number) =>
    `重导完成：${file}，本次新增 ${added} 题`,
  retryFailed: (n: number) => `重导失败批（${n}）`,
  confirmRetry: (file: string, n: number) =>
    `将重导「${file}」的 ${n} 个失败批（不删除已入库题，仅补漏），继续？`,
  retryNoPending: '该文件没有待重导的失败批',
  resetFile: '清除并重新导入',
  importOne: '仅导入此文件',
  questionsInDb: (n: number) => `题库 ${n} 题`,
  practiceHint: '已入库题目可在「练习」页刷新查看；筛选对应 PDF 文件名。',
  restoreProgress: '已恢复上次导入日志（服务端）',
  cancelHint: '取消后当前批次结束后停止；已入库题目保留。',
  logFileDone: (file: string, q: number, tag?: string) =>
    `完成：${file}，入库 ${q} 题` + (tag ? `，大标签 ${tag}` : ''),
  logFileError: (file: string, err: string) => `失败：${file} — ${err}`,
  batchFail: '批量处理失败',
  batchDone: (ok: number, skip: number, err: number) =>
    `完成：新导入 ${ok} 个` +
    (skip ? `，跳过 ${skip} 个（已导入过）` : '') +
    (err ? `，失败 ${err} 个` : '') +
    '。文件可继续留在收件箱，不会重复入库。',
  inboxImported: '已导入',
  batchItem: (file: string, tag?: string, path?: string) => {
    let s = file
    if (tag) s += ` · 标签 ${tag}`
    if (path) s += ` · ${path}`
    return s
  },
  taskHeader: (id: number, name: string, pages: number) =>
    `任务 #${id} · ${name} · 共 ${pages} 页`,
  colBatch: '批次',
  colPages: '页码',
  colStatus: '状态',
  colActions: '操作',
  pageRange: (a: number, b: number) => `第 ${a}–${b} 页`,
  parse: '解析',
  confirm: '入库',
  previewJson: '预览 JSON',
}

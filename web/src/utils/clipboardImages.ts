const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
])

function isClipboardImageFile(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (!type) return true
  if (!type.startsWith('image/')) return false
  if (IMAGE_TYPES.has(type)) return true
  return type.startsWith('image/')
}

/** 从剪贴板事件提取图片文件（截图 / 复制图片） */
export function imageFilesFromClipboard(e: ClipboardEvent): File[] {
  const dt = e.clipboardData
  if (!dt) return []

  const out: File[] = []
  const seen = new Set<string>()

  const push = (file: File | null) => {
    if (!file || !isClipboardImageFile(file)) return
    const key = `${file.type}:${file.size}:${file.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }

  for (const item of dt.items) {
    if (item.kind !== 'file') continue
    const type = (item.type || '').toLowerCase()
    if (type && !type.startsWith('image/')) continue
    push(item.getAsFile())
  }

  if (!out.length && dt.files?.length) {
    for (const file of dt.files) push(file)
  }

  return out
}

/** 剪贴板是否以图片为主（截图粘贴时不抢占文本框里的文字粘贴） */
export function clipboardPasteIsImageOnly(e: ClipboardEvent): boolean {
  const files = imageFilesFromClipboard(e)
  if (!files.length) return false
  const text = (e.clipboardData?.getData('text/plain') || '').trim()
  const html = (e.clipboardData?.getData('text/html') || '').trim()
  return !text && !html
}

/** 为粘贴的图片生成稳定文件名 */
export function clipboardImageFile(file: File, index: number): File {
  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/gif'
          ? 'gif'
          : 'jpg'
  const name = file.name && file.name !== 'image.png' ? file.name : `paste-${Date.now()}-${index}.${ext}`
  if (file.name === name) return file
  return new File([file], name, { type: file.type })
}

import type { Submission } from '../api'

export type WordDictationSubStats = {
  wrongTotal: number
  zh2enWrong: number
  en2zhWrong: number
}

export function isWordSubmissionWrong(s: Submission): boolean {
  const mark = s.answer.self_mark
  if (mark === 'correct') return false
  if (mark === 'wrong') return true
  return !s.is_correct
}

export function wordDictationSubStats(subs: Submission[]): WordDictationSubStats {
  let zh2enWrong = 0
  let en2zhWrong = 0
  for (const s of subs) {
    if (!isWordSubmissionWrong(s)) continue
    if (s.answer.dictation_direction === 'en2zh') en2zhWrong++
    else zh2enWrong++
  }
  return { wrongTotal: zh2enWrong + en2zhWrong, zh2enWrong, en2zhWrong }
}

export function formatWordSubmissionLabel(s: Submission): string {
  const mark = s.answer.self_mark
  if (mark === 'correct') return '自评 · 对'
  if (mark === 'wrong') return '自评 · 错'
  return s.is_correct ? '拼写 · 对' : '拼写 · 错'
}

export function formatWordSubmissionDirection(s: Submission): string {
  return s.answer.dictation_direction === 'en2zh' ? '看英写中' : '看中写英'
}

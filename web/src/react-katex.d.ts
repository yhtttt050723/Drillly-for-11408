declare module 'react-katex' {
  import type { FC } from 'react'
  export const InlineMath: FC<{ math: string; errorColor?: string }>
  export const BlockMath: FC<{ math: string; errorColor?: string }>
}

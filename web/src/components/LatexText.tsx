import { BlockMath, InlineMath } from 'react-katex'

type Part = { kind: 'text' | 'block' | 'inline' | 'code'; value: string }

/** 将 AI 输出的裸 LaTeX / verbatim 转为可渲染片段 */
function preprocess(raw: string): string {
  let t = raw

  // verbatim / lstlisting → 占位符（在分段前抽出，避免干扰 $ 解析）
  t = t.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/gi, (_, code) => {
    return `\n\n\`\`\`\n${String(code).trim()}\n\`\`\`\n\n`
  })
  t = t.replace(/\\begin\{lstlisting\}([\s\S]*?)\\end\{lstlisting\}/gi, (_, code) => {
    return `\n\n\`\`\`\n${String(code).trim()}\n\`\`\`\n\n`
  })

  // 常见定界符
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`)

  // 整段裸复杂度 O(...)：O(n\log_2 n)、O(\sqrt{n})
  t = t.replace(/O\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (match, inner) => {
    if (/\\|[\^_{}]|log|sqrt|frac|cdot|leq|geq|neq|infty/.test(inner)) {
      return `$${match}$`
    }
    return match
  })

  // 整行/整选项几乎全是数学符号时包一层 $
  const trimmed = t.trim()
  if (
    trimmed.includes('\\') &&
    !trimmed.includes('$') &&
    /^[\sO0-9\\a-zA-Z^{}()_+\-*/=<>|.,;:!?[\]]+$/.test(trimmed)
  ) {
    return `$${trimmed}$`
  }

  return t
}

/** 解析 ``` 代码块与 $ / $$ 数学 */
function tokenize(text: string): Part[] {
  const parts: Part[] = []
  let rest = text

  while (rest.length) {
    const fence = rest.indexOf('```')
    const dblock = rest.indexOf('$$')

    const pick =
      fence === -1
        ? dblock
        : dblock === -1
          ? fence
          : Math.min(fence, dblock)

    if (pick === -1) {
      splitInline(rest, parts)
      break
    }

    if (pick > 0) splitInline(rest.slice(0, pick), parts)

    if (pick === fence) {
      const end = rest.indexOf('```', fence + 3)
      if (end === -1) {
        parts.push({ kind: 'text', value: rest })
        break
      }
      parts.push({ kind: 'code', value: rest.slice(fence + 3, end).replace(/^\n/, '') })
      rest = rest.slice(end + 3)
      continue
    }

    const end = rest.indexOf('$$', pick + 2)
    if (end === -1) {
      parts.push({ kind: 'text', value: rest })
      break
    }
    parts.push({ kind: 'block', value: rest.slice(pick + 2, end) })
    rest = rest.slice(end + 2)
  }

  return parts
}

function splitInline(
  chunk: string,
  parts: { kind: 'text' | 'block' | 'inline' | 'code'; value: string }[],
) {
  let rest = chunk
  while (rest.length) {
    const i = rest.indexOf('$')
    if (i === -1) {
      if (rest) parts.push({ kind: 'text', value: rest })
      return
    }
    if (i > 0) parts.push({ kind: 'text', value: rest.slice(0, i) })
    const j = rest.indexOf('$', i + 1)
    if (j === -1) {
      parts.push({ kind: 'text', value: rest })
      return
    }
    parts.push({ kind: 'inline', value: rest.slice(i + 1, j) })
    rest = rest.slice(j + 1)
  }
}

function MathPart({ kind, value, index }: { kind: 'block' | 'inline'; value: string; index: number }) {
  const cleaned = value
    .replace(/\\log_(\d+)/g, (_, n) => `\\log_{${n}}`)
    .replace(/\\sqrt\{([^}]+)\}/g, '\\sqrt{$1}')

  try {
    if (kind === 'block') {
      return <BlockMath key={index} math={cleaned} errorColor="#dc2626" />
    }
    return <InlineMath key={index} math={cleaned} errorColor="#dc2626" />
  } catch {
    return (
      <code key={index} className="latex-fallback">
        {kind === 'block' ? `$$${value}$$` : `$${value}$`}
      </code>
    )
  }
}

export function LatexText({ text }: { text: string }) {
  if (!text) return null
  const normalized = preprocess(text)
  const parts = tokenize(normalized)

  return (
    <span className="latex-text">
      {parts.map((p, i) => {
        if (p.kind === 'code') {
          return (
            <pre key={i} className="latex-code-block">
              <code>{p.value}</code>
            </pre>
          )
        }
        if (p.kind === 'block' || p.kind === 'inline') {
          return <MathPart key={i} kind={p.kind} value={p.value} index={i} />
        }
        return (
          <span key={i} className="latex-plain">
            {p.value}
          </span>
        )
      })}
    </span>
  )
}

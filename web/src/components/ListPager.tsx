type Props = {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
  className?: string
}

export function ListPager({ total, limit, offset, onChange, className }: Props) {
  if (total <= limit) return null
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  const go = (p: number) => {
    const next = Math.max(0, Math.min((p - 1) * limit, (pages - 1) * limit))
    onChange(next)
  }

  return (
    <nav className={className ?? 'list-pager'} aria-label="分页">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => go(page - 1)}>
        上一页
      </button>
      <span className="list-pager-meta">
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => go(page + 1)}>
        下一页
      </button>
    </nav>
  )
}

/** 单词随机默写：洗牌队列，降低重复率 */

export function shuffleIds(ids: number[]): number[] {
  const deck = [...ids]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

/** 新建一整副洗牌队列，尽量避免第一张就是 excludeId */
export function buildWordDeck(allIds: number[], excludeId: number | null): number[] {
  if (allIds.length === 0) return []
  const deck = shuffleIds(allIds)
  if (excludeId != null && deck.length > 1 && deck[0] === excludeId) {
    ;[deck[0], deck[1]] = [deck[1], deck[0]]
  }
  return deck
}

/** 从队列取下一张；队列空则重新洗一整副 */
export function drawNextWordId(
  allIds: number[],
  deck: number[],
  currentId: number | null,
): { nextId: number | null; nextDeck: number[] } {
  if (allIds.length === 0) return { nextId: null, nextDeck: [] }

  let pool = deck
  if (pool.length === 0) pool = buildWordDeck(allIds, currentId)

  let nextId = pool[0]
  let rest = pool.slice(1)

  if (currentId != null && allIds.length > 1 && nextId === currentId) {
    const alt = rest.find((id) => id !== currentId)
    if (alt != null) {
      nextId = alt
      rest = rest.filter((id) => id !== alt)
    } else {
      const fresh = buildWordDeck(allIds, currentId)
      nextId = fresh[0] ?? allIds[0]
      rest = fresh.slice(1)
    }
  }

  return { nextId, nextDeck: rest }
}

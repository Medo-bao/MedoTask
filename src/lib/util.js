import { nextTick } from 'vue'

/** Tiny class-name joiner (no dependency needed). */
export function cn(...parts) {
  const out = []
  for (const p of parts.flat(Infinity)) {
    if (!p) continue
    if (typeof p === 'string') out.push(p)
    else if (Array.isArray(p)) out.push(cn(p))
    else if (typeof p === 'object') {
      for (const [k, v] of Object.entries(p)) if (v) out.push(k)
    }
  }
  return out.join(' ')
}

/** Random short id, matching the shape the original app generated. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** "YYYYMMDD" <-> dayjs-ish helpers kept dependency-free. */
export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function toKey(date) {
  return Number(
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  )
}

export function keyToDate(key) {
  const s = String(key)
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

/** Debounce that keeps a cancel handle. */
export function debounce(fn, wait = 200) {
  let t = null
  const wrapped = (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      fn(...args)
    }, wait)
  }
  wrapped.cancel = () => {
    if (t) clearTimeout(t)
    t = null
  }
  return wrapped
}

/** Keep the active control when an update moves a row, or focus the list if it is removed. */
export async function updateWithListFocus(list, update) {
  const focused = document.activeElement
  const wasInList = list?.contains(focused)
  await update()
  if (!wasInList) return
  await nextTick()
  if (list.isConnected && document.activeElement === document.body) {
    const target = list.contains(focused) ? focused : list
    target.focus({ preventScroll: true })
  }
}

/**
 * Toast store — a plain reactive singleton, since toasts are global UI state
 * rather than per-window data.
 */
import { reactive } from 'vue'

const state = reactive({ items: [] })
let seq = 0

export function toast(message, type = 'info', duration = 2200) {
  const id = ++seq
  state.items.push({ id, message, type })
  setTimeout(() => dismiss(id), duration)
  return id
}

export function dismiss(id) {
  const i = state.items.findIndex((t) => t.id === id)
  if (i >= 0) state.items.splice(i, 1)
}

export function useToast() {
  return { state, toast, dismiss }
}

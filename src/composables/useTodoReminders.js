import { onMounted, onScopeDispose } from 'vue'
import { onDatabaseChange, write } from '@/db/database.js'
import { claimTodoReminders, dueTodoReminders } from '@/db/todos.js'
import dayjs, { toKey } from '@/lib/dates.js'
import { useSettingsStore } from '@/stores/settings.js'
import { toast } from '@/stores/toast.js'
import { useWindows } from './useWindows.js'

/** The main window stays alive in the tray and owns the reminder timer. */
export function useTodoReminders() {
  const settings = useSettingsStore()
  const windows = useWindows()
  let timer
  let checkedMinute = ''
  let checking = false

  async function check(force = false) {
    const now = dayjs()
    const date = String(toKey(now))
    const time = now.format('HH:mm')
    const minute = date + time
    if (checking || (!force && minute === checkedMinute)) return
    checkedMinute = minute
    if (!dueTodoReminders(date, time).length) return
    checking = true
    try {
      const due = await write(() => claimTodoReminders(date, time))
      if (!due.length) return
      const heading = due.length === 1 ? `${due[0].title || '待办'} · 提醒时间到` : `${due.length} 条待办到提醒时间`
      toast(heading, 'success')
      if (windows.isWindowsDesktop) {
        const body = due.length === 1 ? heading : [heading, ...due.slice(0, 5).map((todo) => todo.title)].join('\n')
        await windows.remind(body, settings.setting.notificationSound)
      }
    } catch (err) {
      console.error('[medotask] todo reminders', err)
      toast('发送待办提醒失败', 'error')
    } finally {
      checking = false
    }
  }

  const refresh = () => { void check(true) }
  const unsubscribe = onDatabaseChange(refresh)
  onMounted(() => {
    refresh()
    timer = setInterval(() => { void check() }, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
  })
  onScopeDispose(() => {
    clearInterval(timer)
    unsubscribe()
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
  })
}

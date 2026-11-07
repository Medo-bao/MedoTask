/** Date helpers shared by the views (thin wrappers over dayjs). */
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek.js'

dayjs.extend(isoWeek)

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** Integer key used throughout the database: YYYYMMDD */
export function toKey(d = dayjs()) {
  return Number(d.format('YYYYMMDD'))
}

/** Parse a YYYYMMDD key (or number) back into dayjs. */
export function fromKey(key) {
  return dayjs(String(key), 'YYYYMMDD')
}

export function isDateKey(key) {
  return /^\d{8}$/.test(String(key)) && toKey(fromKey(key)) === Number(key)
}

export function kiteReminderTime(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value ?? ''))
  return match && Number(match[1]) < 24 ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
}

/** ISO date string for <input type="date">: YYYY-MM-DD */
export function dayjsKey(key) {
  const s = String(key)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export function todayKey() {
  return toKey()
}

/** Seven days of the week containing `d`. */
export function weekOf(d = dayjs()) {
  const start = d.startOf('isoWeek')
  return Array.from({ length: 7 }, (_, i) => {
    const day = start.add(i, 'day')
    const value = toKey(day)
    return {
      day: WEEKDAY_LABELS[i],
      date: day.format('MM-DD'),
      value,
      isToday: value === todayKey(),
    }
  })
}

export default dayjs

/**
 * Todo data access.
 *
 * Mirrors the queries the original app ran, so the database stays compatible,
 * but shaped as a clean async API the stores can consume.
 */
import { select, run } from './database.js'
import { fromKey, isDateKey, kiteReminderTime, toKey } from '../lib/dates.js'

const TODO_COLUMNS =
  'id, title, completed, date, sort_order, content, parent_id, color, repeat, repeat_days, repeat_start_date, repeat_end_date, postpone_auto, time, reminder_time'

function normalizeTodo(row) {
  return {
    id: row.id,
    title: row.title ?? '',
    completed: !!row.completed,
    date: String(row.date ?? ''),
    sortOrder: row.sort_order ?? 0,
    content: row.content ?? '',
    parentId: row.parent_id ?? null,
    color: row.color ?? 'default',
    repeat: row.repeat ?? null,
    repeatDays: row.repeat_days ?? null,
    repeatStartDate: row.repeat_start_date ? String(row.repeat_start_date) : null,
    repeatEndDate: row.repeat_end_date ? String(row.repeat_end_date) : null,
    postponeAuto: !!row.postpone_auto,
    time: row.time ?? '',
    reminderTime: row.reminder_time ?? '',
  }
}

function toRow(todo) {
  return [
    todo.id,
    todo.title ?? '',
    todo.completed ? 1 : 0,
    todo.date ?? '',
    todo.sortOrder ?? 0,
    todo.content ?? '',
    todo.parentId ?? null,
    todo.color ?? 'default',
    todo.repeat ?? null,
    todo.repeatDays ?? null,
    todo.repeatStartDate ?? null,
    todo.repeatEndDate ?? null,
    todo.postponeAuto ? 1 : 0,
    todo.time ?? '',
    todo.reminderTime ?? '',
  ]
}

/* ---------------- reads ---------------- */

export function todosByDate(date) {
  return select(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE date = $1 AND repeat IS NULL ORDER BY sort_order ASC`,
    [date]
  ).map(normalizeTodo)
}

export function allUncompleted() {
  return select(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE completed = 0 AND repeat IS NULL ORDER BY sort_order ASC`
  ).map(normalizeTodo)
}

export function todoById(id) {
  const row = select(`SELECT ${TODO_COLUMNS} FROM todos WHERE id = $1`, [id])[0]
  return row ? normalizeTodo(row) : null
}

export function childrenOf(parentId) {
  return select(`SELECT ${TODO_COLUMNS} FROM todos WHERE parent_id = $1 ORDER BY sort_order ASC`, [
    parentId,
  ]).map(normalizeTodo)
}

/** Todos whose repeat rule matches the given day. */
export function repeatedTodosOnDate(date) {
  const parts = dayParts(date)
  return repeatedTodosInRange(date, date).filter((todo) => repeatsOnDate(todo, date, parts))
}

function repeatsOnDate(todo, date, parts = dayParts(date)) {
  if (todo.repeatStartDate && date < todo.repeatStartDate) return false
  if (todo.repeatEndDate && date > todo.repeatEndDate) return false
  if (todo.repeat === 'daily') return true
  if (todo.repeat !== 'weekly' && todo.repeat !== 'monthly') return false
  const weekly = todo.repeat === 'weekly'
  const index = weekly ? parts.weekdayIndex : parts.dayOfMonth - 1
  return repeatDayIndices(todo.repeat, todo.repeatDays, todo.repeatStartDate || todo.date).includes(index)
}

export function repeatedTodosInRange(start, end) {
  return select(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE repeat IS NOT NULL
       AND (NULLIF(repeat_end_date, '') IS NULL OR repeat_end_date >= $1)
       AND (NULLIF(repeat_start_date, '') IS NULL OR repeat_start_date <= $2)
     ORDER BY sort_order ASC`,
    [start, end]
  ).map(normalizeTodo)
}

/** Uncompleted todos from before today that should roll forward. */
export function postponableTodos(today) {
  return select(
    `SELECT ${TODO_COLUMNS} FROM todos
       WHERE date < $1 AND parent_id IS NULL AND repeat IS NULL AND completed = 0
         AND (postpone_auto IS NULL OR postpone_auto = 1)
     ORDER BY sort_order ASC`,
    [today]
  ).map(normalizeTodo)
}

export function countByDateRange(start, end) {
  const rows = select(
    `SELECT date, COUNT(*) as count FROM todos
       WHERE date >= $1 AND date <= $2 AND COALESCE(completed, 0) = 0 AND repeat IS NULL
       GROUP BY date`,
    [start, end]
  )
  const map = new Map()
  for (const r of rows) map.set(String(r.date), r.count)
  const rules = repeatedTodosInRange(start, end)
  if (!rules.length) return map
  const occurrences = repeatRecords(repeatItemsInRange(start, end))
  for (let day = fromKey(start); toKey(day) <= Number(end); day = day.add(1, 'day')) {
    const date = String(toKey(day))
    const parts = dayParts(date)
    const count = rules.filter((rule) => {
      const item = occurrences.get(date)?.get(rule.id)
      return !item?.completed && !item?.deleted && repeatsOnDate(rule, date, parts)
    }).length
    if (count) map.set(date, (map.get(date) ?? 0) + count)
  }
  return map
}

export function countUncompleted(date) {
  const key = String(date)
  return countByDateRange(key, key).get(key) ?? 0
}

export function countTotal() {
  const row = select('SELECT COUNT(*) as count FROM todos WHERE repeat IS NULL')[0]
  return row?.count ?? 0
}

/** Per-day completion of a repeating todo. */
export function repeatItem(todoId, date) {
  return select(
    'SELECT * FROM todo_repeat_items WHERE todo_id = $1 AND date = $2 ORDER BY rowid LIMIT 1',
    [todoId, date]
  )[0] ?? null
}

export function repeatItemsInRange(start, end) {
  return select(
    'SELECT * FROM todo_repeat_items WHERE date >= $1 AND date <= $2 ORDER BY rowid',
    [start, end]
  )
}

function repeatRecords(rows) {
  const dates = new Map()
  for (const row of rows) {
    const date = String(row.date)
    if (!dates.has(date)) dates.set(date, new Map())
    const records = dates.get(date)
    if (!records.has(row.todo_id)) records.set(row.todo_id, row)
  }
  return dates
}

export function todoOccurrencesOnDate(date) {
  const dated = todosByDate(date)
  const repeated = repeatedTodosOnDate(date)
  if (!repeated.length) return dated
  const records = repeatRecords(repeatItemsInRange(date, date)).get(String(date))
  return [...dated, ...repeated.flatMap((todo) => {
    const item = records?.get(todo.id)
    return item?.deleted ? [] : [withRepeatRecord(todo, item)]
  })]
}

function withRepeatRecord(todo, item) {
  const legacy = item?.legacy_details ? {
    title: item.title ?? todo.title,
    content: item.content ?? '',
    color: item.color ?? todo.color,
    reminderTime: kiteReminderTime(item.time),
  } : {}
  return {
    ...todo,
    ...legacy,
    completed: !!item?.completed,
    sortOrder: item?.sort_order ?? todo.sortOrder,
    occurrenceId: item?.id ?? null,
  }
}

export function dueTodoReminders(date, time) {
  const due = todoOccurrencesOnDate(date).filter((todo) =>
    !todo.completed && /^([01]\d|2[0-3]):[0-5]\d$/.test(todo.reminderTime) && todo.reminderTime <= time
  )
  if (!due.length) return due
  const sent = new Map()
  for (const row of select('SELECT todo_id, time FROM todo_reminder_delivery WHERE date = $1', [date])) {
    if (!sent.has(row.todo_id)) sent.set(row.todo_id, new Set())
    sent.get(row.todo_id).add(row.time)
  }
  return due.filter((todo) => !sent.get(todo.id)?.has(todo.reminderTime))
}

export function claimTodoReminders(date, time) {
  const due = dueTodoReminders(date, time)
  for (const todo of due) {
    run('INSERT INTO todo_reminder_delivery (todo_id, date, time) VALUES ($1, $2, $3)', [todo.id, date, todo.reminderTime])
  }
  return due
}

/** One result per task, linking repeating rules to a real occurrence. */
export function searchTodos(query, today, onlyUncompleted) {
  const rows = select(
    `SELECT ${TODO_COLUMNS} FROM todos
     WHERE instr(lower(title), lower($1)) > 0 OR instr(lower(COALESCE(content, '')), lower($1)) > 0
     ORDER BY date DESC, sort_order ASC`,
    [query]
  )
  const results = []
  for (const row of rows) {
    const todo = normalizeTodo(row)
    if (todo.repeat) {
      const date = findRepeatDate(todo, String(today), onlyUncompleted)
      if (!date) continue
      results.push({ ...withRepeatRecord(todo, repeatItem(todo.id, date)), date })
    } else if (isDateKey(todo.date) && (!onlyUncompleted || !todo.completed)) {
      results.push(todo)
    }
  }
  const included = new Set(results.filter((todo) => todo.repeat).map(({ id, date }) => `${id}:${date}`))
  const legacy = select(
    `SELECT todo_id, date FROM todo_repeat_items WHERE legacy_details = 1 AND COALESCE(deleted, 0) = 0
     AND (instr(lower(title), lower($1)) > 0 OR instr(lower(COALESCE(content, '')), lower($1)) > 0)`,
    [query]
  )
  for (const row of legacy) {
    const date = String(row.date)
    const key = `${row.todo_id}:${date}`
    if (!isDateKey(date) || included.has(key)) continue
    const todo = todoById(row.todo_id)
    const item = repeatItem(row.todo_id, date)
    if (!todo?.repeat || !item || item.deleted || (onlyUncompleted && item.completed) || !repeatsOnDate(todo, date)) continue
    included.add(key)
    results.push({ ...withRepeatRecord(todo, item), date })
  }
  return results.sort((a, b) => b.date.localeCompare(a.date))
}

function findRepeatDate(todo, today, onlyUncompleted) {
  const start = todo.repeatStartDate
  const end = todo.repeatEndDate
  const recorded = repeatRecords(select('SELECT date, todo_id, completed, deleted FROM todo_repeat_items WHERE todo_id = $1 ORDER BY rowid', [todo.id]))

  function scan(anchor, direction) {
    let day = fromKey(anchor)
    // A valid monthly rule has an occurrence within 62 days, even for the 31st.
    for (let gap = 0; gap < 62 && day.isValid(); gap++, day = day.add(direction, 'day')) {
      const date = String(toKey(day))
      if ((start && date < start) || (end && date > end)) return null
      if (!repeatsOnDate(todo, date)) continue
      const item = recorded.get(date)?.get(todo.id)
      if (!item?.deleted && (!onlyUncompleted || !item?.completed)) return date
      gap = 0
    }
    return null
  }

  const next = scan(start && start > today ? start : today, 1)
  return next ?? scan(end && end < today ? end : today, -1)
}

/* ---------------- writes ---------------- */

export function insertTodo(todo) {
  run(
    `INSERT INTO todos (${TODO_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    toRow(todo)
  )
}

export function updateTodoFields(id, fields) {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const sets = keys.map((k, i) => `${columnOf(k)} = $${i + 1}`).join(', ')
  const values = keys.map((k) => {
    const v = fields[k]
    return typeof v === 'boolean' ? (v ? 1 : 0) : v
  })
  values.push(id)
  run(`UPDATE todos SET ${sets} WHERE id = $${values.length}`, values)
}

export function updateLegacyRepeatDetails(id, fields) {
  const { title, content, color, reminderTime } = fields
  run(`UPDATE todo_repeat_items SET title = COALESCE($1, title), content = COALESCE($2, content),
       color = COALESCE($3, color), time = COALESCE($4, time) WHERE id = $5 AND legacy_details = 1`,
    [title, content, color, reminderTime, id])
}

/** Bulk sort_order update used by drag and drop. */
export function updateSortOrders(list) {
  if (!list.length) return
  const whens = list.map((_, i) => `WHEN $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ')
  const ids = list.map((_, i) => `$${list.length * 2 + i + 1}`).join(',')
  const params = [
    ...list.flatMap((t) => [t.id, t.sortOrder]),
    ...list.map((t) => t.id),
  ]
  run(`UPDATE todos SET sort_order = CASE id ${whens} END WHERE id IN (${ids})`, params)
}

export function deleteTodos(ids) {
  if (!ids.length) return
  const ph = ids.map((_, i) => `$${i + 1}`).join(',')
  run(`DELETE FROM todo_repeat_items WHERE todo_id IN (${ph})`, ids)
  run(`DELETE FROM todo_reminder_delivery WHERE todo_id IN (${ph})`, ids)
  run(`DELETE FROM todos WHERE id IN (${ph})`, ids)
}

export function setRepeatItem(item) {
  run(
    `INSERT INTO todo_repeat_items (id, todo_id, title, completed, date, sort_order, content, color, time, parent_id, deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(id) DO UPDATE SET completed = excluded.completed, sort_order = excluded.sort_order, deleted = excluded.deleted`,
    [
      item.id,
      item.todoId,
      item.title ?? '',
      item.completed ? 1 : 0,
      item.date,
      item.sortOrder ?? 0,
      item.content ?? '',
      item.color ?? 'default',
      item.time ?? '',
      item.parentId ?? null,
      item.deleted ? 1 : 0,
    ]
  )
}

/** Completed ordinary tasks and individual completed occurrences before today. */
export function trashItems(today) {
  const ordinary = select(
    `SELECT t.*, EXISTS (
        SELECT 1 FROM todos c WHERE c.parent_id = t.id AND (COALESCE(c.completed, 0) = 0 OR c.date >= $1)
      ) AS active_children
      FROM todos t WHERE t.repeat IS NULL AND t.completed = 1 AND t.date < $1`,
    [String(today)]
  ).map((row) => ({ ...normalizeTodo(row), canDelete: !row.active_children }))
  const repeated = select(
    `SELECT i.*, t.repeat AS series_repeat FROM todo_repeat_items i JOIN todos t ON t.id = i.todo_id
      WHERE i.date < $1 AND i.completed = 1 AND COALESCE(i.deleted, 0) = 0
        AND i.rowid = (SELECT MIN(r.rowid) FROM todo_repeat_items r WHERE r.todo_id = i.todo_id AND r.date = i.date)`,
    [String(today)]
  ).map((row) => ({
    ...normalizeTodo(row), id: row.todo_id, repeat: row.series_repeat, occurrenceId: row.id,
    reminderTime: kiteReminderTime(row.time), canDelete: true,
  }))
  return [...ordinary, ...repeated].filter((todo) => isDateKey(todo.date))
    .sort((a, b) => b.date.localeCompare(a.date) || a.sortOrder - b.sortOrder)
}

/* ---------------- helpers ---------------- */

function columnOf(key) {
  return camelToSnake(key)
}

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

/** Split a YYYYMMDD key into calendar parts. */
function dayParts(key) {
  const value = String(key ?? '')
  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(4, 6))
  const d = Number(value.slice(6, 8))
  const date = new Date(y, m - 1, d)
  const weekday = date.getDay()
  return {
    year: y,
    month: m,
    dayOfMonth: d,
    weekdayIndex: weekday === 0 ? 6 : weekday - 1,
  }
}

/** Keep usable stored choices, or derive the default from the first day. */
export function repeatDayIndices(repeat, stored, startDate) {
  const limit = repeat === 'weekly' ? 7 : repeat === 'monthly' ? 31 : 0
  if (!limit) return []
  const days = String(stored ?? '').split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{1,2}$/.test(value))
    .map(Number)
    .filter((value) => value < limit)
  if (days.length) return [...new Set(days)].sort((a, b) => a - b)
  if (!isDateKey(startDate)) return []
  const start = dayParts(startDate)
  return [repeat === 'weekly' ? start.weekdayIndex : start.dayOfMonth - 1]
}

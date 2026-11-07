/**
 * Todo store: the current week, the selected day, and the todo tree.
 *
 * Shape and behaviour follow the original app: todos are keyed by an integer
 * `YYYYMMDD` date, parents carry their children inline, and repeating todos
 * resolve their per-day completion from `todo_repeat_items`.
 */
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import dayjs, { fromKey, toKey, WEEKDAY_LABELS } from '@/lib/dates.js'
import { colorRank } from '@/lib/colors.js'
import * as db from '@/db/todos.js'
import { onDatabaseChange, write } from '@/db/database.js'
import { useSettingsStore } from './settings.js'

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function groupTodos(list) {
  const ids = new Set(list.map((todo) => todo.id))
  return list.filter((todo) => !ids.has(todo.parentId)).map((todo) => ({
    ...todo,
    children: list.filter((child) => child.parentId === todo.id),
  }))
}

export const useTodoStore = defineStore('todos', () => {
  const settings = useSettingsStore()
  const currentDate = ref(toKey())
  const weekStart = ref(dayjs().startOf('isoWeek'))
  const todos = ref([])
  const weekCounts = ref({})
  const showMode = ref('default')
  const loading = ref(false)
  const today = ref(currentDate.value)
  const currentWeek = computed(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = weekStart.value.add(i, 'day')
      return {
        day: WEEKDAY_LABELS[i],
        date: d.format('MM-DD'),
        value: toKey(d),
        isToday: toKey(d) === today.value,
      }
    })
  )

  /** Parent todos with their children attached. */
  const tree = computed(() => {
    const list = settings.setting.mainWindow.orderByColor === 'true'
      ? todos.value.toSorted((a, b) => colorRank(a.color) - colorRank(b.color))
      : todos.value
    return groupTodos(list)
  })

  const uncompletedCount = computed(() => todos.value.filter((t) => !t.completed).length)

  /* ---------------- loading ---------------- */

  function readDate(date) {
    return db.todoOccurrencesOnDate(date).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async function loadDate(date = currentDate.value) {
    loading.value = true
    try {
      todos.value = readDate(String(date))
    } finally {
      loading.value = false
    }
  }

  function loadWeekCounts() {
    const start = currentWeek.value[0].value
    const end = currentWeek.value[6].value
    const map = db.countByDateRange(String(start), String(end))
    const out = {}
    for (const cell of currentWeek.value) out[cell.value] = map.get(String(cell.value)) ?? 0
    weekCounts.value = out
  }

  function setCurrentDate(date) {
    currentDate.value = Number(date)
    const start = fromKey(date).startOf('isoWeek')
    if (!start.isSame(weekStart.value, 'day')) {
      weekStart.value = start
      loadWeekCounts()
    }
    return loadDate()
  }

  function setToday() {
    today.value = toKey()
    return setCurrentDate(today.value)
  }

  function refreshToday() {
    const date = toKey()
    if (date === today.value) return
    const followingToday = currentDate.value === today.value
    today.value = date
    if (followingToday) setCurrentDate(date)
  }

  const dayTimer = setInterval(refreshToday, 10_000)
  window.addEventListener('focus', refreshToday)
  document.addEventListener('visibilitychange', refreshToday)
  onScopeDispose(() => {
    clearInterval(dayTimer)
    window.removeEventListener('focus', refreshToday)
    document.removeEventListener('visibilitychange', refreshToday)
  })

  /* ---------------- mutations ---------------- */

  function newTodo(overrides = {}) {
    return {
      id: uid(),
      title: '',
      completed: false,
      date: String(currentDate.value),
      sortOrder: todos.value.length + 1,
      content: '',
      parentId: null,
      color: 'default',
      repeat: null,
      repeatDays: null,
      repeatStartDate: null,
      repeatEndDate: null,
      postponeAuto: true,
      time: '',
      ...overrides,
    }
  }

  function lastOrderOnDate(date) {
    return readDate(date).reduce((max, todo) => Math.max(max, todo.sortOrder), 0)
  }

  async function addTodos(items) {
    const records = items.map((todo) => {
      const rec = newTodo(todo)
      if (rec.repeat) rec.repeatStartDate ||= rec.date
      return rec
    })
    await write(() => {
      const lastOrderByDate = new Map()
      for (const [index, record] of records.entries()) {
        if (record.parentId) {
          const parent = db.todoById(record.parentId)
          if (!parent || parent.parentId || parent.repeat) throw new Error('这条待办无法添加子项')
          record.date = parent.date
        }
        if (!lastOrderByDate.has(record.date)) {
          lastOrderByDate.set(record.date, lastOrderOnDate(record.date))
        }
        const lastOrder = lastOrderByDate.get(record.date)
        record.sortOrder = items[index].sortOrder ?? lastOrder + 1
        lastOrderByDate.set(record.date, Math.max(lastOrder, record.sortOrder))
        db.insertTodo(record)
      }
    })
    return records
  }

  async function addTodo(todo) {
    const [record] = await addTodos([todo])
    return record
  }

  async function updateField(todo, field, value) {
    if (field === 'completed') return setCompleted([todo], value)
    await updateFields(todo, { [field]: value })
  }

  function saveOccurrence(todo, date, completed, sortOrder = todo.sortOrder, deleted = false) {
    const existing = db.repeatItem(todo.id, date)
    db.setRepeatItem({
      id: existing?.id ?? uid(),
      todoId: todo.id,
      title: todo.title,
      completed,
      date,
      sortOrder,
      content: todo.content,
      color: todo.color,
      time: todo.reminderTime || todo.time,
      parentId: todo.parentId,
      deleted,
    })
  }

  function writeDayOrder(list, date) {
    const ordinary = []
    for (const [index, todo] of list.entries()) {
      const sortOrder = index + 1
      if (todo.sortOrder === sortOrder) continue
      if (todo.repeat) {
        const completed = db.repeatItem(todo.id, date)?.completed ?? false
        saveOccurrence(todo, date, completed, sortOrder)
      } else ordinary.push({ id: todo.id, sortOrder })
    }
    db.updateSortOrders(ordinary)
  }

  async function updateFields(todo, fields) {
    if (!Object.keys(fields).length) return
    await write(() => {
      const current = db.todoById(todo.id)
      if (!current) throw new Error('这条待办已删除')
      if (fields.repeat && !current.repeat && db.childrenOf(todo.id).length) {
        throw new Error('请先处理子待办，再设置重复')
      }
      if (fields.date && fields.date !== current.date && !current.parentId) {
        moveChildren(current, fields.date)
      }
      db.updateTodoFields(todo.id, fields)
      if (todo.occurrenceId) db.updateLegacyRepeatDetails(todo.occurrenceId, fields)
    })
  }

  async function reorderTodo(source, target, after) {
    const date = String(currentDate.value)
    await write(() => {
      const siblings = readDate(date).filter((todo) => todo.parentId === target.parentId)
      const from = siblings.findIndex((todo) => todo.id === source.id)
      if (from < 0 || source.id === target.id) return
      const [item] = siblings.splice(from, 1)
      const to = siblings.findIndex((todo) => todo.id === target.id)
      if (to < 0) return
      siblings.splice(to + Number(after), 0, item)
      writeDayOrder(siblings, date)
    })
  }

  async function removeTodo(todo) {
    await removeMany([todo])
  }

  async function removeMany(list) {
    await write(() => {
      const ids = new Set(list.map((todo) => todo.id))
      for (const id of ids) {
        for (const child of db.childrenOf(id)) ids.add(child.id)
      }
      db.deleteTodos([...ids])
    })
  }

  function moveChildren(todo, date, { keepCompleted = false } = {}) {
    for (const child of db.childrenOf(todo.id)) {
      if (child.date === todo.date && (!keepCompleted || !child.completed)) {
        db.updateTodoFields(child.id, { date })
      }
    }
  }

  function moveFamily(todo, date, options) {
    db.updateTodoFields(todo.id, { date })
    moveChildren(todo, date, options)
  }

  async function moveToDate(list, date) {
    await write(() => {
      for (const { id } of list) {
        const todo = db.todoById(id)
        if (todo && !todo.repeat && !todo.parentId) moveFamily(todo, String(date))
      }
    })
  }

  async function setCompleted(list, completed) {
    const date = String(currentDate.value)
    const ids = new Set(list.map((todo) => todo.id))
    const prefs = settings.setting.mainWindow
    const shouldMove = completed ? prefs.completedToBottom !== 'false' : prefs.uncompletedToTop !== 'false'
    await write(() => {
      const rows = readDate(date)
      const changed = rows.filter((todo) => ids.has(todo.id) && todo.completed !== completed)
      for (const t of changed) {
        if (t.repeat) saveOccurrence(t, date, completed)
        else db.updateTodoFields(t.id, { completed })
      }
      if (shouldMove) {
        const movedIds = new Set(changed.map((todo) => todo.id))
        for (const parentId of new Set(changed.map((todo) => todo.parentId))) {
          const moved = changed.filter((todo) => todo.parentId === parentId)
          const rest = rows.filter((todo) => todo.parentId === parentId && !movedIds.has(todo.id))
          writeDayOrder(completed ? [...rest, ...moved] : [...moved, ...rest], date)
        }
      }
    })
  }

  /** Roll unfinished past todos into today. */
  async function postponeTodos() {
    const date = String(today.value)
    if (settings.setting.postponeAuto !== 'true' || !db.postponableTodos(date).length) return 0
    return write(() => {
      const list = db.postponableTodos(date)
      for (const todo of list) moveFamily(todo, date, { keepCompleted: true })
      return list.length
    })
  }

  function changeTrash(item, remove) {
    return write(() => {
      const todo = db.todoById(item.id)
      const date = String(item.date)
      if (!todo || Number(date) >= toKey()) throw new Error('这条事项已不在垃圾箱')
      if (item.occurrenceId) {
        const occurrence = db.repeatItem(todo.id, date)
        if (!occurrence?.completed || occurrence.deleted) throw new Error('这条记录已不在垃圾箱')
        const matches = todo.repeat && db.repeatedTodosOnDate(date).some((rule) => rule.id === todo.id)
        if (!remove && !matches) {
          db.insertTodo(newTodo({
            date, title: item.title, content: item.content, color: item.color, reminderTime: item.reminderTime,
            sortOrder: lastOrderOnDate(date) + 1,
          }))
        }
        const deleted = remove || !matches
        saveOccurrence(todo, date, deleted, occurrence.sort_order, deleted)
        return
      }
      if (item.repeat || todo.repeat || !todo.completed || todo.date !== date) throw new Error('这条事项已不在垃圾箱')
      if (!remove) {
        db.updateTodoFields(todo.id, { completed: false })
        return
      }
      const ids = new Set([todo.id])
      for (const id of ids) {
        for (const child of db.childrenOf(id)) {
          if (!child.completed || Number(child.date) >= toKey()) throw new Error('仍有未归入垃圾箱的子待办')
          ids.add(child.id)
        }
      }
      db.deleteTodos([...ids])
    })
  }

  async function loadAll() {
    await loadDate()
    loadWeekCounts()
  }
  onScopeDispose(onDatabaseChange(loadAll))

  return {
    currentDate,
    weekStart,
    todos,
    weekCounts,
    showMode,
    loading,
    today,
    currentWeek,
    tree,
    uncompletedCount,
    loadDate,
    loadWeekCounts,
    setCurrentDate,
    setToday,
    newTodo,
    addTodo,
    addTodos,
    updateField,
    updateFields,
    reorderTodo,
    removeTodo,
    removeMany,
    moveToDate,
    setCompleted,
    postponeTodos,
    changeTrash,
    loadAll,
    uid,
  }
})

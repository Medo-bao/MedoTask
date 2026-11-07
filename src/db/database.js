/**
 * SQLite access layer.
 *
 * Each window reads from an in-memory SQLite snapshot. IndexedDB serializes
 * writers across windows so each edit starts from the latest committed data.
 */
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { kiteReminderTime, toKey } from '../lib/dates.js'
import { uid } from '../lib/util.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  content TEXT DEFAULT '',
  parent_id TEXT,
  color TEXT DEFAULT 'default',
  repeat TEXT,
  repeat_days TEXT,
  repeat_start_date TEXT,
  repeat_end_date TEXT,
  postpone_auto INTEGER DEFAULT 0,
  time TEXT DEFAULT '',
  reminder_time TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);

CREATE TABLE IF NOT EXISTS todo_repeat_items (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  content TEXT DEFAULT '',
  color TEXT DEFAULT 'default',
  time TEXT DEFAULT '',
  parent_id TEXT,
  repeat TEXT,
  repeat_days TEXT,
  repeat_start_date TEXT,
  repeat_end_date TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  legacy_details INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_repeat_todo_date ON todo_repeat_items(todo_id, date);

CREATE TABLE IF NOT EXISTS todo_reminder_delivery (
  todo_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  PRIMARY KEY (todo_id, date, time)
);
CREATE INDEX IF NOT EXISTS idx_reminder_delivery_date ON todo_reminder_delivery(date);

CREATE TABLE IF NOT EXISTS draft_todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  content TEXT DEFAULT '',
  parent_id TEXT,
  color TEXT DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_date INTEGER
);
`

/** Columns that older databases may lack. */
const MIGRATIONS = [
  ['todos', 'repeat', 'TEXT'],
  ['todos', 'repeat_days', 'TEXT'],
  ['todos', 'repeat_start_date', 'TEXT'],
  ['todos', 'repeat_end_date', 'TEXT'],
  ['todos', 'postpone_auto', 'INTEGER DEFAULT 0'],
  ['todos', 'time', 'TEXT'],
  ['todos', 'reminder_time', "TEXT NOT NULL DEFAULT ''"],
  ['todo_repeat_items', 'repeat', 'TEXT'],
  ['todo_repeat_items', 'repeat_days', 'TEXT'],
  ['todo_repeat_items', 'repeat_start_date', 'TEXT'],
  ['todo_repeat_items', 'repeat_end_date', 'TEXT'],
  ['todo_repeat_items', 'deleted', 'INTEGER NOT NULL DEFAULT 0'],
  ['todo_repeat_items', 'legacy_details', 'INTEGER NOT NULL DEFAULT 0'],
  ['settings', 'updated_date', 'INTEGER'],
]

// Validate all tables used by the app after the legacy columns have been added.
const REQUIRED_COLUMNS = {
  todos: ['id', 'title', 'completed', 'date', 'sort_order', 'content', 'parent_id', 'color'],
  todo_repeat_items: ['id', 'todo_id', 'title', 'completed', 'date', 'sort_order', 'content', 'color', 'time', 'parent_id'],
  draft_todos: ['id', 'title', 'completed', 'sort_order', 'content', 'parent_id', 'color'],
  settings: ['key', 'value'],
}

const DB_KEY = 'kite.db'
const RECOVERY_KEY = 'medotask.recovery'
const SCHEMA_VERSION = 2
const STORE = 'snapshots'
const CHANGE_EVENT = 'kite:data-changed'

let SQL
let storage
let db = null
let ready
let channel

function migrate(candidate) {
  const kite = isKiteDatabase(candidate)
  candidate.exec(SCHEMA)
  for (const [table, column, type] of MIGRATIONS) {
    const cols = candidate.exec(`PRAGMA table_info(${table})`)[0].values
    if (!cols.some((row) => row[1] === column)) {
      candidate.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      if (kite && column === 'reminder_time') {
        const entries = candidate.exec("SELECT id, time FROM todos WHERE time IS NOT NULL AND time <> ''")[0]?.values ?? []
        for (const [id, time] of entries) {
          const reminder = kiteReminderTime(time)
          if (reminder) candidate.run('UPDATE todos SET reminder_time = ? WHERE id = ?', [reminder, id])
        }
      }
      if (kite && column === 'legacy_details') candidate.run('UPDATE todo_repeat_items SET legacy_details = 1')
    }
  }
  const migratedDrafts = moveLegacyDrafts(candidate)
  candidate.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  return migratedDrafts
}

// Legacy undated entries stay accessible when the inbox becomes the trash view.
function moveLegacyDrafts(candidate) {
  const drafts = candidate.exec('SELECT id, title, completed, content, parent_id, color FROM draft_todos ORDER BY sort_order, rowid')[0]?.values ?? []
  if (!drafts.length) return 0
  const date = String(toKey())
  const ids = new Map(drafts.map(([id]) => [id,
    id && !candidate.exec('SELECT id FROM todos WHERE id = ?', [id]).length ? id : uid(),
  ]))
  let order = Number(candidate.exec('SELECT COALESCE(MAX(sort_order), 0) FROM todos WHERE date = ?', [date])[0].values[0][0])
  for (const [id, title, completed, content, parentId, color] of drafts) {
    candidate.run(`INSERT INTO todos (id, title, completed, date, sort_order, content, parent_id, color, postpone_auto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
      ids.get(id), title ?? '', completed ? 1 : 0, date, ++order, content ?? '', ids.get(parentId) ?? null, color ?? 'default',
    ])
  }
  candidate.run('DELETE FROM draft_todos')
  return drafts.length
}

function prepare(bytes) {
  const candidate = new SQL.Database(bytes)
  try {
    migrate(candidate)
    return candidate
  } catch (err) {
    candidate.close()
    throw err
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('medotask', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function snapshot({ initialize = false, change, replacement, checkpoint = false, restoreAt } = {}) {
  return new Promise((resolve, reject) => {
    const writable = initialize || change || replacement || checkpoint || restoreAt !== undefined
    const tx = storage.transaction(STORE, writable ? 'readwrite' : 'readonly')
    const store = tx.objectStore(STORE)
    const recovery = restoreAt === undefined ? null : store.get(RECOVERY_KEY)
    const request = store.get(DB_KEY)
    let candidate
    let result
    let failure

    request.onsuccess = () => {
      try {
        const saved = request.result
        let migrated = false
        if (recovery) {
          const point = recovery.result
          if (!point || point.createdAt !== restoreAt) throw new Error('本地恢复点已更新，请重新确认')
          candidate = prepare(point.bytes)
        } else if (replacement) {
          candidate = new SQL.Database(replacement)
        } else if (saved) {
          candidate = new SQL.Database(saved)
          if (initialize && candidate.exec('PRAGMA user_version')[0].values[0][0] < SCHEMA_VERSION) {
            migrate(candidate)
            migrated = true
          }
        } else {
          const legacy = localStorage.getItem(DB_KEY)
          candidate = prepare(legacy ? base64ToBytes(JSON.parse(legacy)) : undefined)
        }

        if (change) {
          const previous = db
          db = candidate
          try {
            result = change()
          } finally {
            db = previous
          }
        }
        if (checkpoint && saved) store.put({ bytes: saved, createdAt: Date.now() }, RECOVERY_KEY)
        if (change || replacement || recovery || migrated || !saved) store.put(candidate.export(), DB_KEY)
      } catch (err) {
        failure = err
        tx.abort()
      }
    }

    tx.oncomplete = () => {
      db?.close()
      db = candidate
      resolve(result)
    }
    tx.onabort = () => {
      candidate?.close()
      reject(failure ?? tx.error)
    }
  })
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function broadcast() {
  channel?.postMessage(null)
  notify()
}

export function onDatabaseChange(listener) {
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes) {
  let out = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP))
  }
  return btoa(out)
}

function coerce(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Uint8Array) return v
  if (Array.isArray(v)) return JSON.stringify(v)
  return String(v)
}

/* ---------------- public API ---------------- */

/** Run a SELECT and return plain row objects. */
export function select(sql, params = []) {
  const stmt = db.prepare(sql)
  try {
    if (params.length) stmt.bind(params.map(coerce))
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}

/** Run a statement inside a write callback. */
export function run(sql, params = []) {
  db.run(sql, params.length ? params.map(coerce) : undefined)
  return db.getRowsModified()
}

/** Open the database (idempotent). */
export function open() {
  ready ??= (async () => {
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    storage = await connect()
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('medotask:database')
      channel.onmessage = async () => {
        try {
          await ready
          await snapshot()
          notify()
        } catch (err) {
          console.error('[medotask] could not refresh database', err)
        }
      }
    }
    await snapshot({ initialize: true })
    localStorage.removeItem(DB_KEY)
  })()
  return ready
}

/** Commit a group of synchronous SQLite mutations as one snapshot. */
export async function write(change) {
  const result = await snapshot({ change })
  broadcast()
  return result
}

function hasSqliteHeader(bytes) {
  return bytes.length >= 100 && String.fromCharCode(...bytes.subarray(0, 16)) === 'SQLite format 3\0'
}

function isKiteDatabase(candidate) {
  return candidate.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'").length > 0
}

/** Validate once and hold exactly the bytes shown in the confirmation. */
export function previewBackup(bytes) {
  const raw = hasSqliteHeader(bytes)
  let replacement = bytes
  if (!raw) {
    const text = new TextDecoder().decode(bytes).trim()
    try {
      replacement = base64ToBytes(text.startsWith('"') ? JSON.parse(text) : text)
    } catch {
      throw new Error('请选择 MedoTask JSON 备份或 Kite SQLite 数据库')
    }
  }
  if (!hasSqliteHeader(replacement)) {
    throw new Error('无效的 SQLite 备份')
  }
  const candidate = new SQL.Database(replacement)
  try {
    const check = candidate.exec('PRAGMA quick_check')
    if (check[0]?.values[0]?.[0] !== 'ok' || !candidate.exec('PRAGMA table_info(todos)').length) {
      throw new Error('无效的 MedoTask 数据库')
    }
    const isKite = isKiteDatabase(candidate)
    const migratedDrafts = migrate(candidate)
    const keySets = { todo_reminder_delivery: ['todo_id', 'date', 'time'] }
    for (const [table, required] of Object.entries({ ...REQUIRED_COLUMNS, ...keySets })) {
      const columns = candidate.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []
      const keys = columns.filter((column) => column[5]).sort((a, b) => a[5] - b[5]).map((column) => column[1])
      const expectedKeys = keySets[table] ?? [required[0]]
      if (keys.join(',') !== expectedKeys.join(',') ||
          !required.every((name) => columns.some((column) => column[1] === name))) {
        throw new Error(`备份表结构不兼容：${table}`)
      }
    }
    const [todoCount, firstDate, lastDate] = candidate.exec(
      "SELECT COUNT(*), MIN(NULLIF(date, '')), MAX(NULLIF(date, '')) FROM todos"
    )[0].values[0]
    const validated = candidate.export()
    return {
      todoCount, migratedDrafts, firstDate, lastDate,
      format: raw ? (isKite ? 'Kite SQLite' : 'SQLite') : 'JSON 备份',
      async apply() {
        await snapshot({ replacement: validated, checkpoint: true })
        broadcast()
      },
    }
  } finally {
    candidate.close()
  }
}

export function recoveryPoint() {
  return new Promise((resolve, reject) => {
    const tx = storage.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(RECOVERY_KEY)
    tx.oncomplete = () => resolve(request.result?.createdAt ?? null)
    tx.onabort = () => reject(tx.error)
  })
}

/** Swap the recovery point with the active data in one transaction. */
export async function restoreRecoveryPoint(createdAt) {
  await snapshot({ restoreAt: createdAt, checkpoint: true })
  broadcast()
}

/** Export the database as base64. */
export async function exportDatabase() {
  await snapshot()
  return bytesToBase64(db.export())
}

/** Wipe all data. */
export async function reset() {
  await snapshot({
    checkpoint: true,
    change: () => db.exec('DELETE FROM todos; DELETE FROM todo_repeat_items; DELETE FROM todo_reminder_delivery; DELETE FROM draft_todos; DELETE FROM settings;'),
  })
  broadcast()
}

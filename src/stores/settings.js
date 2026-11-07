/**
 * Settings store.
 *
 * MedoTask stores settings as dotted keys in a flat `settings` table
 * (`mainWindow.clickTitleAction`), which is what the original schema does.
 * This store reads them into a nested object and flattens writes back.
 */
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import { onDatabaseChange, select, run, write } from '@/db/database.js'

const DEFAULTS = {
  mode: 'light',
  postponeAuto: 'false',
  notificationSound: 'Default',
  notificationSoundName: '',
  guideCompleted: 'false',
  mainWindow: {
    clickTitleAction: 'edit',
    completedToBottom: 'true',
    uncompletedToTop: 'true',
    orderByColor: 'false',
    menuIcon: 'emoji',
  },
  miniWindow: {
    enable: 'false',
    alwaysOnBottom: 'false',
    onlyUncompleted: 'false',
    edgeHide: 'false',
    opacity: '80',
  },
  countdown: null,
}

/** "a.b.c" tree -> flat key/value pairs */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = String(v)
  }
  return out
}

/** flat pairs -> nested object, numeric segments becoming arrays */
function unflatten(rows) {
  const out = {}
  for (const { key, value } of rows) {
    const parts = key.split('.')
    let cur = out
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (i === parts.length - 1) {
        cur[part] = value
        break
      }
      if (!cur[part] || typeof cur[part] !== 'object') {
        cur[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}
      }
      cur = cur[part]
    }
  }
  return out
}

function deepMerge(base, extra) {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

export const useSettingsStore = defineStore('settings', () => {
  const raw = ref({})
  const loaded = ref(false)

  const setting = computed(() => deepMerge(DEFAULTS, raw.value))

  async function load() {
    const rows = select('SELECT key, value FROM settings')
    raw.value = unflatten(rows)
    loaded.value = true
    return setting.value
  }
  onScopeDispose(onDatabaseChange(load))

  /**
   * Merge `patch` into the stored settings.
   *
   * Arrays replace everything under their key prefix, mirroring the original
   * behaviour. Settings reload after the database commits in any window.
   */
  async function save(patch) {
    const flat = flatten(patch)
    const now = Date.now()

    await write(() => {
      for (const key of Object.keys(patch)) {
        if (Array.isArray(patch[key])) {
          run("DELETE FROM settings WHERE key LIKE $1 || '%'", [key])
        }
      }
      for (const [key, value] of Object.entries(flat)) {
        run('INSERT OR REPLACE INTO settings (key, value, updated_date) VALUES ($1,$2,$3)', [
          key,
          value,
          now,
        ])
      }
    })
    return setting.value
  }

  function setMode(mode) {
    return save({ mode })
  }

  function claimCountdown(deadline) {
    return write(() => {
      const state = unflatten(select("SELECT key, value FROM settings WHERE key LIKE 'countdown.%'")).countdown
      if (state?.enable !== 'true' || state.deadline !== String(deadline) || state.fired === 'true') return false
      run("INSERT OR REPLACE INTO settings (key, value, updated_date) VALUES ('countdown.fired', 'true', $1)", [Date.now()])
      return true
    })
  }

  return { setting, raw, loaded, load, save, setMode, claimCountdown }
})

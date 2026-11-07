/**
 * Window management.
 *
 * Desktop routes open in Tauri windows. In a browser they use named popups.
 */
import { useRoute } from 'vue-router'

const ROUTES = {
  main: { path: '/', title: 'MedoTask', width: 900, height: 700 },
  overview: { path: '/overview', title: 'MedoTask 总览', width: 1000, height: 800 },
  trash: { path: '/trash', title: 'MedoTask 垃圾箱', width: 420, height: 620 },
  setting: { path: '/setting', title: 'MedoTask 设置', width: 420, height: 520 },
  mini: { path: '/mini', title: 'MedoTask 浮窗', width: 300, height: 200 },
  ...(__HAS_ASSISTANT__ ? { ai: { path: '/ai', title: 'MedoTask 助手', width: 460, height: 620 } } : {}),
}

const handles = new Map()

function alive(label) {
  const w = handles.get(label)
  if (!w || w.closed) {
    handles.delete(label)
    return null
  }
  return w
}

export function useWindows() {
  const route = useRoute()
  const native = window.__TAURI__?.core

  /** Open (or focus) a window by label. */
  function open(label, options = {}) {
    const meta = ROUTES[label]
    if (!meta) return
    const date = label === 'main' ? options.date : undefined
    if (native) return native.invoke('open_window', { label, date })
    const url = new URL(window.location.href)
    url.hash = date ? `/?date=${date}` : meta.path
    let existing = alive(label)
    if (!existing && label === 'main') {
      try {
        const opener = window.opener
        if (opener?.location.origin === url.origin && opener.location.hash.split('?')[0] === '#/') {
          existing = opener
        }
      } catch {
        // A cross-origin opener is not an app window.
      }
    }
    if (existing) {
      try {
        if (date) existing.location.hash = url.hash
        existing.focus()
      } catch {
        /* closed between checks */
      }
      return existing
    }

    const width = options.width || meta.width
    const height = options.height || meta.height
    const left = Math.round((screen.width - width) / 2)
    const top = Math.round((screen.height - height) / 3)

    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
    ].join(',')

    let win = null
    try {
      win = window.open(url.href, `kite-${label}`, features)
    } catch {
      win = null
    }
    // popup blocked -> plain tab so the click still does something
    if (!win) {
      try {
        win = window.open(url.href, `kite-${label}`)
      } catch {
        win = null
      }
    }
    if (win) handles.set(label, win)
    return win
  }

  function close(label) {
    if (native) return native.invoke('close_window', { label })
    const w = label === route.name ? window : alive(label)
    handles.delete(label)
    try {
      w?.close()
    } catch {
      /* ignore */
    }
  }

  function minimize() {
    return native?.invoke('minimize_window')
  }

  function startDragging() {
    return native?.invoke('start_dragging')
  }

  function alwaysOnTop(value) {
    return native?.invoke('window_always_on_top', { value })
  }

  function trayAvailable() {
    return native?.invoke('tray_available')
  }

  function autostartEnabled() {
    return native.invoke('autostart_enabled')
  }

  function setAutostart(enabled) {
    return native.invoke('set_autostart', { enabled })
  }

  function updateMiniDock(options) {
    return native.invoke('update_mini_dock', options)
  }

  function remind(message, sound) {
    return native.invoke('show_countdown_reminder', { message, sound })
  }

  function saveReminderSound(bytes) {
    return native.invoke('save_reminder_sound', bytes)
  }

  function previewReminderSound(sound) {
    return native.invoke('preview_reminder_sound', { sound })
  }

  function quit() {
    return native?.invoke('quit_desktop')
  }

  return {
    isDesktop: !!native,
    isWindowsDesktop: !!native && navigator.userAgent.includes('Windows'),
    open, close, minimize, startDragging, alwaysOnTop, trayAvailable, quit,
    autostartEnabled, setAutostart, updateMiniDock, remind, saveReminderSound, previewReminderSound,
  }
}

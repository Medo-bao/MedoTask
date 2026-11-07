<script setup>
/**
 * Window title bar.
 *
 * In the browser the window chrome is ours to draw, so this is a real
 * component rather than a drag region: it renders the title, the per-window
 * actions and the little menu on the right.
 *
 * Actions are declared by each view, which lets the same bar serve the main
 * window, the calendar and the settings pane.
 */
import { computed, onMounted, ref } from 'vue'
import { AppWindow, Minus, Moon, Pin, Sun, X, LayoutGrid, CalendarDays } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings.js'
import { toast } from '@/stores/toast.js'
import { useWindows } from '@/composables/useWindows.js'

const props = defineProps({
  title: { type: String, default: 'MedoTask' },
  showMode: { type: Boolean, default: false },
  showOverview: { type: Boolean, default: false },
  showMini: { type: Boolean, default: false },
  showCalendar: { type: Boolean, default: false },
  showPin: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  closeLabel: { type: String, default: '关闭' },
})

const emit = defineEmits(['close'])

const settings = useSettingsStore()
const windows = useWindows()

const isDark = computed(() => settings.setting.mode === 'dark')
const pinned = ref(null)
const pinPending = ref(false)

async function syncPin(value) {
  if (pinPending.value) return
  pinPending.value = true
  try {
    pinned.value = await windows.alwaysOnTop(value)
  } catch (err) {
    console.error('[medotask] always on top', err)
    toast('无法更新窗口置顶状态', 'error')
  } finally {
    pinPending.value = false
  }
}

onMounted(() => {
  if (props.showPin && windows.isDesktop) void syncPin()
})

function toggleMode() {
  settings.setMode(isDark.value ? 'light' : 'dark')
}
</script>

<template>
  <header
    class="flex h-9 shrink-0 select-none items-center justify-between border-b bg-background/80 pl-2.5 pr-1 backdrop-blur"
    @mousedown.left.self="windows.startDragging()"
  >
    <span class="truncate text-xs font-medium text-muted-foreground" @mousedown.left="windows.startDragging()">{{ title }}</span>

    <div class="flex items-center gap-0.5">
      <button
        v-if="showCalendar"
        class="title-bar-btn"
        title="月历总览"
        @click="windows.open('overview')"
      >
        <CalendarDays class="h-3.5 w-3.5" />
      </button>

      <button v-if="showOverview" class="title-bar-btn" title="总览" @click="windows.open('overview')">
        <LayoutGrid class="h-3.5 w-3.5" />
      </button>

      <button v-if="showMini" class="title-bar-btn" title="浮窗" @click="windows.open('mini')">
        <AppWindow class="h-3.5 w-3.5" />
      </button>

      <button class="title-bar-btn" title="切换主题" @click="toggleMode">
        <Sun v-if="isDark" class="h-3.5 w-3.5" />
        <Moon v-else class="h-3.5 w-3.5" />
      </button>

      <button
        v-if="showPin && windows.isDesktop"
        class="title-bar-btn aria-pressed:bg-accent aria-pressed:text-accent-foreground"
        aria-label="窗口置顶"
        :aria-pressed="pinned === true"
        :title="pinned ? '取消置顶' : '置顶'"
        :disabled="pinPending"
        @click="syncPin(pinned === null ? undefined : !pinned)"
      >
        <Pin class="h-3.5 w-3.5" :fill="pinned ? 'currentColor' : 'none'" />
      </button>

      <span class="mx-1 h-4 w-px bg-border" />

      <button v-if="windows.isDesktop" class="title-bar-btn" title="最小化" @click="windows.minimize()">
        <Minus class="h-3.5 w-3.5" />
      </button>
      <button class="title-bar-btn hover:bg-destructive hover:text-white" :title="closeLabel" :aria-label="closeLabel" @click="emit('close')">
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </header>
</template>

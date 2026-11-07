<script setup>
/**
 * Countdown card: a named target time that counts down.
 *
 * Stores its configuration in settings so it survives restarts, matching the
 * original's "添加提醒" feature.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { AlarmClock, BellOff, Settings2 } from 'lucide-vue-next'
import Popover from './ui/Popover.vue'
import Button from './ui/Button.vue'
import { useSettingsStore } from '@/stores/settings.js'
import { useWindows } from '@/composables/useWindows.js'
import { toast } from '@/stores/toast.js'

const settings = useSettingsStore()
const windows = useWindows()

const open = ref(false)
const title = ref('下班')
const time = ref('18:00')
const remaining = ref(0)
const saving = ref(false)
let timer = null
let notifying = false

const countdown = computed(() => settings.setting.countdown)
const enabled = computed(() => countdown.value?.enable === 'true')
const deadline = computed(() => Number(countdown.value?.deadline) || 0)
const fired = computed(() => countdown.value?.fired === 'true')

const label = computed(() => {
  const t = countdown.value?.title || ''
  return t.length > 6 ? `${t.slice(0, 4)}…${t.slice(-2)}` : t
})

const pretty = computed(() => {
  let s = remaining.value
  if (s <= 0) return '已到时间'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}天`)
  if (h) parts.push(`${h}小时`)
  if (m) parts.push(`${m}分钟`)
  if (!parts.length) parts.push(`${s}秒`)
  return parts.slice(0, 2).join('')
})

function nextDeadline(value) {
  const [hh, mm] = value.split(':').map(Number)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime()
}

async function tick() {
  if (!enabled.value || !deadline.value || fired.value) return
  const target = deadline.value
  remaining.value = Math.max(0, Math.ceil((target - Date.now()) / 1000))
  if (remaining.value || notifying) return
  const message = `${countdown.value?.title || '提醒'}时间到啦！`
  notifying = true
  try {
    if (!await settings.claimCountdown(target)) return
    toast(message, 'success')
    if (windows.isWindowsDesktop) await windows.remind(message, settings.setting.notificationSound)
  } catch (err) {
    console.error('[medotask] countdown reminder', err)
    toast('发送提醒失败', 'error')
  } finally {
    notifying = false
  }
}

async function saveCountdown(patch) {
  if (saving.value) return
  saving.value = true
  try {
    await settings.save({ countdown: patch })
    open.value = false
  } catch (err) {
    toast(`保存提醒失败：${err?.message ?? err}`, 'error')
  } finally {
    saving.value = false
  }
}

function enable() {
  const target = nextDeadline(time.value)
  if (!Number.isFinite(target)) return
  return saveCountdown({
    enable: 'true', title: title.value.trim(), time: time.value, deadline: target, fired: 'false',
  })
}

function disable() {
  return saveCountdown({ enable: 'false' })
}

watch(() => countdown.value?.title, (value) => { title.value = value ?? '下班' }, { immediate: true })
watch(() => countdown.value?.time, (value) => { time.value = value || '18:00' }, { immediate: true })
watch([enabled, deadline, fired], ([active, target, delivered]) => {
  clearInterval(timer)
  remaining.value = 0
  if (!active || delivered) return
  if (!target) {
    // Older saved reminders kept a time of day without an absolute deadline.
    const legacyTarget = nextDeadline(time.value)
    if (Number.isFinite(legacyTarget)) void saveCountdown({ deadline: legacyTarget, fired: 'false' })
    return
  }
  void tick()
  timer = setInterval(tick, 1000)
}, { immediate: true })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div
    class="relative flex h-10 min-w-0 select-none items-center justify-center rounded-md bg-secondary text-sm text-secondary-foreground"
  >
    <div v-if="enabled" class="flex flex-col items-center justify-center px-2 leading-tight">
      <span class="truncate text-[11px] text-muted-foreground">{{ fired ? label : `距离${label}还剩` }}</span>
      <span class="font-mono text-xs tabular-nums">{{ pretty }}</span>
    </div>
    <button v-else class="ring-focus flex h-full w-full items-center justify-center gap-1.5" @click="open = true">
      <AlarmClock class="h-3.5 w-3.5" />
      添加提醒
    </button>

    <Popover v-model:open="open" align="center" side="bottom" content-class="w-64" :as-child="false">
      <template #trigger>
        <!-- invisible anchor: the visible triggers above drive `open` -->
        <span class="absolute left-1/2 top-1/2 h-0 w-0" aria-hidden="true" />
      </template>
      <div class="flex flex-col gap-2 text-xs">
        <label class="flex items-center gap-2">
          <span class="w-10 shrink-0 text-muted-foreground">事项</span>
          <input
            v-model="title"
            class="h-7 w-full rounded-md border border-input bg-background px-2 text-xs ring-focus"
          />
        </label>
        <label class="flex items-center gap-2">
          <span class="w-10 shrink-0 text-muted-foreground">时间</span>
          <input
            v-model="time"
            type="time"
            class="h-7 w-full rounded-md border border-input bg-background px-2 text-xs ring-focus"
          />
        </label>
        <div class="flex gap-2 pt-1">
          <Button size="sm" class="flex-1" :disabled="saving || !time" @click="enable">开始</Button>
          <Button v-if="enabled" variant="outline" size="sm" class="flex-1" :disabled="saving" @click="disable">
            <BellOff class="h-3 w-3" />
            停止
          </Button>
        </div>
      </div>
    </Popover>

    <button
      v-if="enabled"
      class="title-bar-btn absolute right-1 h-6 w-6"
      title="设置提醒"
      @click="open = !open"
    >
      <Settings2 class="h-3 w-3" />
    </button>
  </div>
</template>

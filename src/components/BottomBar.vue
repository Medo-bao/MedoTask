<script setup>
/** Bottom bar: history, counters, quick actions and the settings entry. */
import { Settings, Trash2 } from 'lucide-vue-next'

defineProps({
  todayCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  isToday: { type: Boolean, default: true },
})

const emit = defineEmits(['open-trash', 'open-settings'])
</script>

<template>
  <footer class="flex h-9 shrink-0 items-center justify-between border-t bg-background px-2">
    <div class="flex items-center gap-1">
      <slot name="menu" />
      <button class="bottom-bar-btn" title="垃圾箱" aria-label="垃圾箱" @click="emit('open-trash')">
        <Trash2 class="h-4 w-4" />
      </button>
    </div>

    <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span :title="isToday ? '今日未完成' : '所选日期未完成'">{{ isToday ? '今' : '待' }} {{ todayCount }}</span>
      <span title="列表总数">总 {{ totalCount }}</span>
      <button class="bottom-bar-btn" title="设置" @click="emit('open-settings')">
        <Settings class="h-3.5 w-3.5" />
      </button>
    </div>
  </footer>
</template>

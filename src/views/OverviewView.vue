<script setup>
/**
 * Month overview.
 *
 * A calendar grid with per-day load badges. Clicking a day selects it and
 * brings the main window forward.
 */
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-vue-next'
import TitleBar from '@/components/TitleBar.vue'
import { useWindows } from '@/composables/useWindows.js'
import { toKey } from '@/lib/dates.js'
import { countByDateRange } from '@/db/todos.js'
import { onDatabaseChange } from '@/db/database.js'
import { dayLabel } from '@/lib/lunar.js'

const windows = useWindows()

const cursor = ref(dayjs().startOf('month'))
const counts = ref(new Map())

const monthLabel = computed(() => cursor.value.format('YYYY年M月'))

const grid = computed(() => {
  const start = cursor.value.startOf('isoWeek')
  const end = cursor.value.endOf('month').endOf('isoWeek')
  const days = []
  let d = start
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    days.push({
      key: toKey(d),
      day: d.date(),
      dateLabel: d.format('YYYY年M月D日'),
      inMonth: d.month() === cursor.value.month(),
      isToday: d.isSame(dayjs(), 'day'),
      lunar: dayLabel(d.toDate()),
    })
    d = d.add(1, 'day')
  }
  return days
})

function loadCounts() {
  const start = grid.value[0].key
  const end = grid.value[grid.value.length - 1].key
  counts.value = countByDateRange(String(start), String(end))
}
onScopeDispose(onDatabaseChange(loadCounts))

function shift(delta) {
  cursor.value = cursor.value.add(delta, 'month').startOf('month')
  loadCounts()
}

function goToday() {
  cursor.value = dayjs().startOf('month')
  loadCounts()
}

function openDay(date) {
  return windows.open('main', { date })
}

onMounted(loadCounts)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <TitleBar title="MedoTask 总览" show-pin @close="windows.close('overview')" />

    <div class="flex items-center justify-between px-3 py-2">
      <h1 class="text-base font-semibold">{{ monthLabel }}</h1>
      <div class="flex items-center gap-1">
        <button class="title-bar-btn" title="回到今天" @click="goToday">
          <CalendarDays class="h-4 w-4" />
        </button>
        <button class="title-bar-btn" title="上个月" @click="shift(-1)">
          <ChevronLeft class="h-4 w-4" />
        </button>
        <button class="title-bar-btn" title="下个月" @click="shift(1)">
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="grid shrink-0 grid-cols-7 border-t text-center text-[11px] text-muted-foreground">
      <div v-for="d in ['一', '二', '三', '四', '五', '六', '日']" :key="d" class="border-b py-1.5">
        {{ d }}
      </div>
    </div>

    <div class="scroll-thin grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
      <button
        v-for="cell in grid"
        :key="cell.key"
        :aria-label="cell.dateLabel"
        :title="`${counts.get(String(cell.key)) || 0} 项未完成`"
        class="relative flex flex-col items-start gap-0.5 border-b border-r p-1.5 text-left transition-colors ring-focus hover:bg-accent/50"
        :class="!cell.inMonth && 'bg-muted/30 text-muted-foreground'"
        @click="openDay(cell.key)"
      >
        <span
          class="flex h-5 w-5 items-center justify-center rounded-full text-xs"
          :class="cell.isToday ? 'bg-primary font-semibold text-primary-foreground' : ''"
        >
          {{ cell.day }}
        </span>
        <span class="text-[10px] leading-none opacity-60">{{ cell.lunar }}</span>
        <span
          v-if="counts.get(String(cell.key))"
          class="absolute right-1.5 top-1.5 rounded-full bg-yellow-500/15 px-1 text-[10px] font-medium text-yellow-700 dark:text-yellow-400"
        >
          {{ counts.get(String(cell.key)) }}
        </span>
      </button>
    </div>
  </div>
</template>

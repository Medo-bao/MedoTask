<script setup>
/**
 * Week strip: seven equally sized days, arrow paging and drop-to-move.
 */
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { cn } from '@/lib/util.js'

defineProps({
  days: { type: Array, required: true }, // [{ day, date, value, isToday }]
  modelValue: { type: Number, required: true },
  counts: { type: Object, default: () => ({}) },
  canDrop: Boolean,
})

const emit = defineEmits(['update:modelValue', 'change-week', 'drop'])
</script>

<template>
  <div class="flex items-center gap-1 rounded-md bg-muted p-1">
    <button
      class="press-feedback flex h-11 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      title="上一周"
      aria-label="上一周"
      @click="emit('change-week', -1)"
    >
      <ChevronLeft class="h-4 w-4" />
    </button>

    <button
      v-for="d in days"
      :key="d.value"
      class="press-feedback relative flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-sm text-center text-xs ring-focus"
      :class="
        cn(
          canDrop && 'outline outline-1 -outline-offset-1 outline-primary/35 hover:bg-accent',
          d.value === modelValue
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/60'
        )
      "
      :aria-pressed="d.value === modelValue"
      :title="`${d.day} ${d.date} · ${counts[d.value] || 0} 项未完成`"
      @click="emit('update:modelValue', d.value)"
      @dragover.prevent
      @drop.prevent="canDrop && emit('drop', d.value)"
    >
      <span :class="cn('select-none', d.isToday && 'font-bold text-green-600 dark:text-green-500')">
        {{ d.day }}
      </span>
      <span class="select-none text-[11px] opacity-80">{{ d.date }}</span>
      <span
        v-if="counts[d.value] > 0"
        class="absolute right-0.5 top-0.5 rounded-full bg-yellow-500/15 px-1 text-[9px] leading-3 tabular-nums text-yellow-700 dark:text-yellow-400"
        aria-hidden="true"
      >{{ Math.min(counts[d.value], 99) }}{{ counts[d.value] > 99 ? '+' : '' }}</span>
    </button>

    <button
      class="press-feedback flex h-11 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      title="下一周"
      aria-label="下一周"
      @click="emit('change-week', 1)"
    >
      <ChevronRight class="h-4 w-4" />
    </button>
  </div>
</template>

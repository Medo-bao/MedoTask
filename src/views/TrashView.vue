<script setup>
import { computed, onScopeDispose, ref, watch } from 'vue'
import { Archive, CalendarDays, RotateCcw, Trash2 } from 'lucide-vue-next'
import TitleBar from '@/components/TitleBar.vue'
import { useWindows } from '@/composables/useWindows.js'
import { useTodoStore } from '@/stores/todos.js'
import { toast } from '@/stores/toast.js'
import { onDatabaseChange } from '@/db/database.js'
import { trashItems } from '@/db/todos.js'
import { dayjsKey } from '@/lib/dates.js'

const windows = useWindows()
const todos = useTodoStore()
const items = ref([])
const busy = ref(false)
const groups = computed(() => {
  const byDate = new Map()
  for (const item of items.value) {
    if (!byDate.has(item.date)) byDate.set(item.date, [])
    byDate.get(item.date).push(item)
  }
  return byDate
})

function load() {
  items.value = trashItems(todos.today)
}
watch(() => todos.today, load, { immediate: true })
onScopeDispose(onDatabaseChange(load))

async function change(item, remove = false) {
  if (busy.value || (remove && !item.canDelete)) return
  if (remove && !window.confirm(item.occurrenceId ? '永久删除这一天的完成记录？' : '永久删除这条事项及其已完成的子事项？')) return
  busy.value = true
  try {
    await todos.changeTrash(item, remove)
    toast(remove ? '已永久删除' : '已在原日期恢复为未完成', 'success')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <TitleBar title="MedoTask 垃圾箱" @close="windows.close('trash')" />
    <p class="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
      自动汇总今天之前已完成的事项。
    </p>
    <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      <div v-if="!items.length" class="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Archive class="size-6 opacity-60" />
        垃圾箱是空的
      </div>
      <section v-for="[date, group] in groups" :key="date" class="pt-2">
        <h2 class="px-1 pb-1 text-xs font-medium text-muted-foreground">{{ dayjsKey(date) }}</h2>
        <div
          v-for="item in group"
          :key="item.occurrenceId || item.id"
          class="flex min-w-0 items-center gap-1 rounded px-1 py-1.5 hover:bg-accent/60"
        >
          <div class="min-w-0 flex-1">
            <p class="break-words text-sm">{{ item.title || '未命名待办' }}</p>
            <p v-if="item.occurrenceId || item.parentId" class="text-xs text-muted-foreground">{{ item.occurrenceId ? '重复待办' : '子待办' }}</p>
          </div>
          <button class="title-bar-btn shrink-0" title="查看原日期" aria-label="查看原日期" @click="windows.open('main', { date: Number(date) })">
            <CalendarDays class="size-3.5" />
          </button>
          <button class="title-bar-btn shrink-0" title="恢复为未完成" aria-label="恢复为未完成" :disabled="busy" @click="change(item)">
            <RotateCcw class="size-3.5" />
          </button>
          <button
            class="title-bar-btn shrink-0 hover:text-destructive disabled:opacity-40"
            :title="item.canDelete ? '永久删除' : '仍有未归入垃圾箱的子待办'"
            aria-label="永久删除"
            :disabled="busy || !item.canDelete"
            @click="change(item, true)"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      </section>
    </div>
    <footer class="shrink-0 border-t px-3 py-2 text-right text-xs text-muted-foreground">共 {{ items.length }} 条</footer>
  </div>
</template>

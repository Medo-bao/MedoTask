<script setup>
import { computed, onScopeDispose, ref, watch } from 'vue'
import { Archive, CalendarDays, RotateCcw, Search, Trash2 } from 'lucide-vue-next'
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
const query = ref('')
const keyword = computed(() => query.value.trim().toLowerCase())
const visibleItems = computed(() => {
  const text = keyword.value
  if (!text) return items.value
  return items.value.filter(({ title, content }) =>
    String(title ?? '').toLowerCase().includes(text) || String(content ?? '').toLowerCase().includes(text)
  )
})
const groups = computed(() => {
  const byDate = new Map()
  for (const item of visibleItems.value) {
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
    <div role="search" class="shrink-0 border-b px-3 py-1.5">
      <div class="relative">
        <Search aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          aria-label="搜索垃圾箱"
          placeholder="搜索标题或备注"
          class="h-8 w-full min-w-0 rounded-md border border-input bg-background pl-8 pr-2 text-sm ring-focus"
        />
      </div>
    </div>
    <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      <div v-if="!visibleItems.length" class="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <component :is="keyword ? Search : Archive" aria-hidden="true" class="size-6 opacity-60" />
        {{ keyword ? '未找到匹配的事项' : '垃圾箱是空的' }}
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
    <footer aria-live="polite" class="shrink-0 border-t px-3 py-2 text-right text-xs text-muted-foreground">
      {{ keyword ? '找到' : '共' }} {{ visibleItems.length }} 条
    </footer>
  </div>
</template>

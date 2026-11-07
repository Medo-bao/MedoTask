<script setup>
import { computed, onScopeDispose, ref, watch } from 'vue'
import Dialog from './ui/Dialog.vue'
import { searchTodos } from '@/db/todos.js'
import { onDatabaseChange } from '@/db/database.js'
import { dayjsKey } from '@/lib/dates.js'

const props = defineProps({ open: Boolean, today: Number })
const emit = defineEmits(['update:open', 'select'])

const query = ref('')
const onlyUncompleted = ref(false)
const results = ref([])
const shown = computed(() => results.value.slice(0, 50))

function search() {
  const text = query.value.trim()
  results.value = props.open && text ? searchTodos(text, props.today, onlyUncompleted.value) : []
}

watch([() => props.open, () => props.today, query, onlyUncompleted], search)
onScopeDispose(onDatabaseChange(() => { if (props.open) search() }))
</script>

<template>
  <Dialog
    :open="open"
    title="搜索待办"
    description="在所有日期里搜索标题或备注。"
    width="w-[92%] max-w-lg"
    @update:open="emit('update:open', $event)"
  >
    <input
      v-model="query"
      type="search"
      aria-label="搜索标题或备注"
      placeholder="输入标题或备注"
      class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm ring-focus"
    />
    <label class="flex items-center gap-2 text-xs">
      <input v-model="onlyUncompleted" type="checkbox" />
      仅未完成
    </label>
    <p v-if="!query.trim()" class="py-4 text-center text-sm text-muted-foreground">输入内容开始搜索</p>
    <p v-else-if="!shown.length" class="py-4 text-center text-sm text-muted-foreground">没有找到待办</p>
    <ul v-else class="scroll-thin max-h-[48vh] overflow-y-auto">
      <li v-for="item in shown" :key="item.occurrenceId || item.id">
        <button
          type="button"
          class="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent ring-focus"
          @click="emit('select', item)"
        >
          <span class="w-full truncate text-sm">{{ item.title || '未命名待办' }}</span>
          <span v-if="item.content" class="w-full truncate text-xs text-muted-foreground">{{ item.content }}</span>
          <span class="text-xs text-muted-foreground">
            {{ dayjsKey(item.date) }} · {{ item.completed ? '已完成' : '未完成' }}{{ item.repeat ? ' · 重复待办' : '' }}
          </span>
        </button>
      </li>
    </ul>
    <p v-if="results.length > shown.length" class="text-xs text-muted-foreground">显示前 50 条，共 {{ results.length }} 条结果</p>
  </Dialog>
</template>

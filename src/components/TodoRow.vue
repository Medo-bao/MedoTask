<script setup>
/**
 * One todo row.
 *
 * Enter commits inline edits, Escape reverts them, and the handle moves rows.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Bell, GripVertical, ListPlus, Repeat, Trash2 } from 'lucide-vue-next'
import Checkbox from './ui/Checkbox.vue'
import { COLOR_STYLES } from '@/lib/colors.js'
import { useSettingsStore } from '@/stores/settings.js'

const props = defineProps({
  todo: { type: Object, required: true },
  isChild: Boolean,
  dragging: { type: Object, default: null },
})

const emit = defineEmits([
  'toggle',
  'update:title',
  'delete',
  'add-child',
  'open-editor',
  'drag-start',
  'drag-end',
  'reorder',
])

const editing = ref(false)
const settings = useSettingsStore()
const clickCompletes = computed(() => settings.setting.mainWindow.clickTitleAction === 'complete')
const textarea = ref(null)
const titleEl = ref(null)
const rowEl = ref(null)
const draft = ref(props.todo.title)
const placement = ref(null)

const colorClass = computed(() => COLOR_STYLES[props.todo.color]?.row ?? '')

watch(
  () => props.todo.title,
  (v) => {
    if (!editing.value) draft.value = v
  }
)

async function startEdit() {
  editing.value = true
  await nextTick()
  const el = textarea.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
  autoGrow()
}

function activateTitle(event) {
  if (event.repeat || event.isComposing || event.keyCode === 229) return
  if (clickCompletes.value) emit('toggle', props.todo, !props.todo.completed)
  else startEdit()
}

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function commit() {
  if (!editing.value) return
  const value = draft.value.trim()
  editing.value = false
  if (value && value !== props.todo.title) emit('update:title', value)
}

function commitOnEnter(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (event.repeat) return
  commit()
  nextTick(() => rowEl.value?.focus({ preventScroll: true }))
}

function cancel(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  draft.value = props.todo.title
  editing.value = false
  nextTick(() => titleEl.value?.focus())
}

const canReorder = computed(() =>
  props.dragging && props.dragging.id !== props.todo.id && props.dragging.parentId === props.todo.parentId
)

function startDrag(event) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-medotask-todo', props.todo.id)
  emit('drag-start', props.todo)
}

function dragOver(event) {
  if (!canReorder.value) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const rect = event.currentTarget.getBoundingClientRect()
  placement.value = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before'
}

function drop(event) {
  if (!canReorder.value || !placement.value) return
  event.preventDefault()
  emit('reorder', props.todo, placement.value === 'after')
  placement.value = null
}
</script>

<template>
  <div
    ref="rowEl"
    :id="`todo-${todo.id}`"
    tabindex="-1"
    class="group flex items-start gap-2 rounded-md py-1.5 pl-2.5 pr-1.5 transition-colors hover:bg-accent/60 ring-focus"
    :class="[
      colorClass,
      isChild ? 'ml-5 py-1' : '',
      canReorder && placement === 'before' && 'shadow-[inset_0_2px_var(--color-primary)]',
      canReorder && placement === 'after' && 'shadow-[inset_0_-2px_var(--color-primary)]',
    ]"
    @dragover="dragOver"
    @dragleave="placement = null"
    @drop="drop"
  >
    <button
      type="button"
      class="flex h-6 shrink-0 cursor-grab items-center text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
      :title="todo.parentId || todo.repeat ? '拖动排序' : '拖动排序或改期'"
      aria-label="拖动待办"
      draggable="true"
      tabindex="-1"
      @dragstart="startDrag"
      @dragend="emit('drag-end')"
    >
      <GripVertical class="h-3.5 w-3.5" />
    </button>

    <div class="flex h-6 shrink-0 items-center">
      <Checkbox
        :checked="todo.completed"
        :aria-label="todo.title || '未命名待办'"
        @update:checked="emit('toggle', todo, $event)"
      />
    </div>

    <div class="min-w-0 flex-1">
      <textarea
        v-if="editing"
        ref="textarea"
        v-model="draft"
        rows="1"
        aria-label="编辑待办标题"
        class="block min-h-6 w-full resize-none select-text overflow-hidden rounded-sm bg-transparent text-sm leading-6 ring-focus"
        @input="autoGrow"
        @keydown.enter.exact="commitOnEnter"
        @keydown.esc="cancel"
        @blur="commit"
      />
      <div
        v-else
        ref="titleEl"
        role="button"
        class="break-words rounded-sm text-sm leading-6 ring-focus"
        :class="[clickCompletes ? 'cursor-pointer' : 'cursor-text', todo.completed && 'text-muted-foreground line-through']"
        tabindex="0"
        @click="activateTitle"
        @keydown.enter.prevent="activateTitle"
        @keydown.space.prevent="activateTitle"
      >
        {{ todo.title || '未命名待办' }}
      </div>

      <div
        v-if="todo.content && !editing"
        class="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
      >
        {{ todo.content }}
      </div>

      <div v-if="todo.repeat" class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Repeat class="h-3 w-3" />
        <span>{{ todo.repeat === 'daily' ? '每天' : todo.repeat === 'weekly' ? '每周' : '每月' }}</span>
      </div>
      <div v-if="todo.reminderTime" class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground" title="到点提醒">
        <Bell class="h-3 w-3" />
        <span>{{ todo.reminderTime }}</span>
      </div>

    </div>

    <div class="flex h-6 shrink-0 items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <button
        v-if="!isChild && !todo.repeat"
        class="title-bar-btn ring-focus"
        title="添加子待办"
        @click="emit('add-child', todo)"
      >
        <ListPlus class="h-3.5 w-3.5" />
      </button>
      <button class="title-bar-btn ring-focus" title="编辑详情" @click="emit('open-editor', todo)">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <button class="title-bar-btn hover:text-destructive ring-focus" title="删除" @click="emit('delete', todo)">
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
  <slot name="children" />
</template>

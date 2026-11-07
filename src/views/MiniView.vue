<script setup>
/**
 * Mini window: a compact, always-in-reach todo list.
 *
 * Keeps today's parent/child structure and syncs with the main window.
 */
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { AppWindow, ExternalLink, ListFilter, Plus, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import { groupTodos, useTodoStore } from '@/stores/todos.js'
import { useSettingsStore } from '@/stores/settings.js'
import { toast } from '@/stores/toast.js'
import { useWindows } from '@/composables/useWindows.js'
import { colorOf } from '@/lib/colors.js'
import { cn, updateWithListFocus } from '@/lib/util.js'

const todos = useTodoStore()
const settings = useSettingsStore()
const windows = useWindows()

const draftOpen = ref(false)
const draftTitle = ref('')
const draftInput = ref(null)
const draftForm = ref(null)
const addButton = ref(null)
const todoList = ref(null)
const saving = ref(false)
const filtering = ref(false)
const onlyUncompleted = computed(() => settings.setting.miniWindow?.onlyUncompleted === 'true')
const opacity = computed(() => {
  const percent = Number(settings.setting.miniWindow?.opacity ?? 80)
  return Number.isFinite(percent) ? Math.min(100, Math.max(30, percent)) / 100 : 0.8
})
const materialStyle = computed(() => windows.isWindowsDesktop
  ? { '--mini-alpha': opacity.value }
  : { opacity: opacity.value })
const dockEnabled = computed(() => windows.isWindowsDesktop && settings.setting.miniWindow?.edgeHide === 'true')
const dock = ref({ edge: null, openness: 1, moving: false })
const panelOpacity = computed(() => Math.min(1, dock.value.openness * 2.4))
const panelStyle = computed(() => dock.value.edge ? {
  ...materialStyle.value,
  width: `${dock.value.width}px`,
  height: `${dock.value.height}px`,
  opacity: panelOpacity.value,
} : materialStyle.value)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let frame
let timer
let busy = false
let refreshPending = false
let revealPending = false
let disposed = false

async function updateDock() {
  busy = true
  refreshPending = false
  const reveal = revealPending
  revealPending = false
  try {
    const view = await windows.updateMiniDock({
      enabled: dockEnabled.value,
      reveal,
      holdOpen: draftOpen.value,
      reducedMotion: reducedMotion.matches,
    })
    if (!disposed) dock.value = view
  } catch (err) {
    console.error('[medotask] mini dock', err)
  } finally {
    busy = false
    if (!disposed) {
      if (refreshPending) void updateDock()
      else if (dock.value.moving) frame = requestAnimationFrame(updateDock)
      else if (dockEnabled.value) timer = setTimeout(updateDock, dock.value.check_in_ms ?? 160)
    }
  }
}

function refreshDock(reveal = false) {
  cancelAnimationFrame(frame)
  clearTimeout(timer)
  revealPending ||= reveal
  if (busy) refreshPending = true
  else void updateDock()
}

function checkDock() {
  if (dockEnabled.value || dock.value.edge) refreshDock()
}

if (windows.isWindowsDesktop) {
  watch(dockEnabled, (enabled, wasEnabled) => {
    if (enabled || wasEnabled) refreshDock()
  }, { immediate: true })
  watch(draftOpen, checkDock)
  reducedMotion.addEventListener('change', checkDock)
  window.addEventListener('medotask:reveal-mini', checkDock)
  onScopeDispose(() => {
    disposed = true
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    reducedMotion.removeEventListener('change', checkDock)
    window.removeEventListener('medotask:reveal-mini', checkDock)
  })
}

const rows = computed(() => {
  const tree = groupTodos(todos.todos)
  if (!onlyUncompleted.value) return tree
  return tree.map((todo) => ({ ...todo, children: todo.children.filter((child) => !child.completed) }))
    .filter((todo) => !todo.completed || todo.children.length)
})

async function openDraft() {
  draftOpen.value = true
  await nextTick()
  draftInput.value?.focus()
}

function closeDraft(focusAdd = false) {
  const activeElement = document.activeElement
  const restoreFocus = activeElement === document.body || draftForm.value?.contains(activeElement)
  draftOpen.value = false
  draftTitle.value = ''
  if (restoreFocus) {
    nextTick(() => (focusAdd ? addButton.value : todoList.value)?.focus({ preventScroll: true }))
  }
}

async function addTodo() {
  const title = draftTitle.value.trim()
  if (!title || saving.value) return
  saving.value = true
  try {
    await todos.addTodo({ title, date: String(todos.today) })
    closeDraft()
  } catch (err) {
    toast(err.message || '添加失败', 'error')
  } finally {
    saving.value = false
  }
}

function draftEnter(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat) void addTodo()
}

async function toggleFilter() {
  if (filtering.value) return
  filtering.value = true
  try {
    await settings.save({ miniWindow: { onlyUncompleted: onlyUncompleted.value ? 'false' : 'true' } })
  } catch (err) {
    toast(err.message || '保存筛选失败', 'error')
  } finally {
    filtering.value = false
  }
}

async function toggle(todo, checked) {
  try {
    await updateWithListFocus(todoList.value, () => todos.updateField(todo, 'completed', checked))
  } catch (err) {
    toast(err.message || '更新待办失败', 'error')
  }
}

onMounted(() => { void todos.setToday() })
</script>

<template>
  <div
    class="relative size-full overflow-hidden"
    :data-edge="dock.edge"
    @mouseenter="checkDock"
    @mouseleave="checkDock"
  >
    <div
      class="mini-panel flex h-full flex-col overflow-hidden"
      :class="{ 'mini-material rounded-lg border': windows.isWindowsDesktop }"
      :style="panelStyle"
      :inert="dock.openness < 1"
    >
      <header class="flex h-8 shrink-0 items-center gap-1 px-1.5 text-xs text-muted-foreground" @mousedown.left.self="windows.startDragging()">
        <span class="flex min-w-0 flex-1 self-stretch cursor-grab items-center gap-1.5 pl-0.5 active:cursor-grabbing" @mousedown.left="windows.startDragging()">
          <AppWindow class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">今日待办</span>
        </span>
        <div class="flex items-center gap-0.5">
          <button
            ref="addButton"
            class="title-bar-btn size-6 ring-focus"
            title="新建待办"
            aria-label="新建待办"
            :aria-expanded="draftOpen"
            :aria-controls="draftOpen ? 'mini-draft' : undefined"
            @click="openDraft"
          >
            <Plus class="size-3.5" aria-hidden="true" />
          </button>
          <button
            class="title-bar-btn size-6 ring-focus aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            title="只看未完成"
            aria-label="只看未完成"
            :aria-pressed="onlyUncompleted"
            :aria-disabled="filtering"
            @click="toggleFilter"
          >
            <ListFilter class="size-3.5" aria-hidden="true" />
          </button>
          <button class="title-bar-btn size-6 ring-focus" title="打开主窗" aria-label="打开主窗" @click="windows.open('main')">
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </button>
          <button class="title-bar-btn size-6 ring-focus" title="关闭" aria-label="关闭" @click="windows.close('mini')">
            <X class="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <form
        v-if="draftOpen"
        ref="draftForm"
        id="mini-draft"
        aria-label="浮窗新建待办"
        class="mx-1.5 mb-1 flex shrink-0 items-center gap-1 rounded-md border bg-background/45 px-1 py-0.5"
        @submit.prevent="addTodo"
      >
        <input
          ref="draftInput"
          v-model="draftTitle"
          class="h-6 min-w-0 flex-1 rounded bg-transparent px-1 text-xs ring-focus"
          aria-label="待办标题"
          placeholder="写一条今日待办"
          :readonly="saving"
          @keydown.enter="draftEnter"
        />
        <Button size="xs" type="submit" :disabled="saving || !draftTitle.trim()">添加</Button>
        <button type="button" class="title-bar-btn size-6 ring-focus" title="取消新建" aria-label="取消新建" :disabled="saving" @click="closeDraft(true)">
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </form>

      <div ref="todoList" tabindex="-1" role="region" aria-label="今日待办列表" class="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 outline-none">
        <div v-if="!rows.length" class="flex h-full items-center justify-center text-[11px] text-muted-foreground">
          {{ onlyUncompleted ? '没有未完成的待办' : '没有待办' }}
        </div>
        <TransitionGroup :key="todos.currentDate" :css="false" move-class="todo-shift">
          <div v-for="todo in rows" :key="todo.id" class="rounded" :class="colorOf(todo.color).row">
            <label class="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors hover:bg-accent/60">
              <Checkbox :checked="todo.completed" size="sm" :aria-label="todo.title || '未命名待办'" @update:checked="toggle(todo, $event)" />
              <span :class="cn('min-w-0 flex-1 truncate leading-5', todo.completed && 'text-muted-foreground line-through')">
                {{ todo.title || '未命名待办' }}
              </span>
            </label>
            <label
              v-for="child in todo.children"
              :key="child.id"
              class="ml-3 flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors hover:bg-accent/60"
            >
              <Checkbox :checked="child.completed" size="sm" :aria-label="child.title || '未命名子待办'" @update:checked="toggle(child, $event)" />
              <span :class="cn('min-w-0 flex-1 truncate leading-4', child.completed && 'text-muted-foreground line-through')">
                {{ child.title || '未命名子待办' }}
              </span>
            </label>
          </div>
        </TransitionGroup>
      </div>
    </div>
    <button
      v-if="dock.edge"
      type="button"
      class="mini-material mini-strip flex items-center justify-center overflow-hidden rounded-lg border ring-focus"
      :style="{ ...materialStyle, opacity: 1 - panelOpacity }"
      :inert="panelOpacity >= 0.5"
      aria-label="展开浮窗"
      @click="refreshDock(true)"
    />
  </div>
</template>

<style scoped>
.mini-material {
  background-color: hsl(var(--background) / var(--mini-alpha));
  border-color: hsl(var(--foreground) / 0.18);
}

.mini-strip {
  position: absolute;
  inset-block: 0;
  width: min(6px, 100%);
  background-color: hsl(var(--accent) / var(--mini-alpha));
  transition: background-color var(--motion-fast) ease;
}

.mini-strip::before {
  content: '';
  width: 3px;
  height: min(28px, 60%);
  border-radius: 999px;
  background-color: hsl(var(--foreground) / 0.42);
  transition: background-color var(--motion-fast) ease;
}

.mini-strip:is(:hover, :focus-visible)::before {
  background-color: hsl(var(--foreground) / 0.72);
}

[data-edge] .mini-panel {
  position: absolute;
}
[data-edge='left'] .mini-panel,
[data-edge='right'] .mini-panel {
  top: 0;
}
[data-edge='left'] .mini-panel {
  right: 0;
}
[data-edge='right'] .mini-panel {
  left: 0;
}
[data-edge='top'] .mini-panel {
  bottom: 0;
  left: 0;
}
[data-edge='left'] .mini-strip {
  left: 0;
}
[data-edge='right'] .mini-strip {
  right: 0;
}
[data-edge='top'] .mini-strip {
  inset: 0 0 auto;
  width: 100%;
  height: min(6px, 100%);
}
[data-edge='top'] .mini-strip::before {
  width: 28px;
  height: 3px;
}
</style>

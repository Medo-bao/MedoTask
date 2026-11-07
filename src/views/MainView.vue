<script setup>
/**
 * Main window: today's todos.
 *
 * Layout follows the original: title bar, a countdown strip, the week
 * strip, then the list. Everything below the strip is data-driven from the
 * Pinia stores.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Sparkles, SquarePen, Copy, Upload, Download, ListChecks, ListFilter, Search, X } from 'lucide-vue-next'

import TitleBar from '@/components/TitleBar.vue'
import WeekTabs from '@/components/WeekTabs.vue'
import TodoRow from '@/components/TodoRow.vue'
import CountdownCard from '@/components/CountdownCard.vue'
import BottomBar from '@/components/BottomBar.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import AboutDialog from '@/components/AboutDialog.vue'
import TodoEditorDialog from '@/components/TodoEditorDialog.vue'
import TodoSearchDialog from '@/components/TodoSearchDialog.vue'

import { DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui'
import { useTodoStore } from '@/stores/todos.js'
import { useSettingsStore } from '@/stores/settings.js'
import { useWindows } from '@/composables/useWindows.js'
import { useTodoReminders } from '@/composables/useTodoReminders.js'
import { useToast } from '@/stores/toast.js'
import { exportMarkdown, exportHtml, exportCsv, parseImport } from '@/lib/transfer.js'
import { fromKey, isDateKey, toKey } from '@/lib/dates.js'
import { updateWithListFocus } from '@/lib/util.js'
import { childrenOf } from '@/db/todos.js'

const todos = useTodoStore()
const settings = useSettingsStore()
const windows = useWindows()
useTodoReminders()
const route = useRoute()
const router = useRouter()
const { toast } = useToast()

const aboutOpen = ref(false)
const editorOpen = ref(false)
const editorReturnFocus = ref(null)
const searchOpen = ref(false)
const searchReturnFocus = ref(null)
const editingTodo = ref(null)
const saving = ref(false)
const quickDraft = ref(null)
const quickInput = ref(null)
const quickForm = ref(null)
const quickSaving = ref(false)
const addButton = ref(null)
const todoList = ref(null)
const dragging = ref(null)
const trayReady = ref(false)
const hasAssistant = __HAS_ASSISTANT__
const importDraft = ref(null)
const importing = ref(false)
const importItems = computed(() => parseImport(importDraft.value?.text))

const onlyUncompleted = computed(() => todos.showMode === 'uncompleted')
const visibleTree = computed(() => {
  if (!onlyUncompleted.value) return todos.tree
  return todos.tree.map((todo) => ({ ...todo, children: todo.children.filter((child) => !child.completed) }))
    .filter((todo) => !todo.completed || todo.children.length)
})
const visibleTodos = computed(() => visibleTree.value.flatMap((todo) => [todo, ...todo.children]))
const selectedDay = computed(() => fromKey(todos.currentDate).format('M月D日'))
const canDropOnDay = computed(() => !!dragging.value && !dragging.value.repeat && !dragging.value.parentId)

async function openQuickInput() {
  if (editorOpen.value || aboutOpen.value || searchOpen.value || importDraft.value) return
  quickDraft.value ??= { title: '', date: todos.currentDate }
  await nextTick()
  quickInput.value?.focus()
}

function closeQuickInput(focusAdd = false) {
  const activeElement = document.activeElement
  const restoreFocus = activeElement === document.body || quickForm.value?.contains(activeElement)
  quickDraft.value = null
  if (restoreFocus) {
    nextTick(() => (focusAdd ? addButton.value?.$el : todoList.value)?.focus({ preventScroll: true }))
  }
}

watch(() => route.query, ({ date, capture }) => {
  const validDate = typeof date === 'string' && isDateKey(date)
  if (validDate) todos.setCurrentDate(date)
  if (capture === '1') openQuickInput()
  if (validDate || capture === '1') router.replace({ name: 'main' })
}, { immediate: true })

if (windows.isDesktop) {
  onMounted(async () => {
    trayReady.value = await windows.trayAvailable()
  })
}

onMounted(async () => {
  await postpone()
  await todos.loadAll()
})

async function postpone() {
  const count = await todos.postponeTodos()
  if (count) toast(`已将 ${count} 条逾期待办移到今天`, 'success')
}

watch([() => settings.setting.postponeAuto, () => todos.today], postpone)

/* ---------------- actions ---------------- */

function openNewTodo(parent = null) {
  if (editorOpen.value || aboutOpen.value) return
  const draft = parent ? null : quickDraft.value
  openEditor({
    title: draft?.title.trim() ?? '',
    date: String(draft?.date ?? todos.currentDate),
    parentId: parent?.id ?? null,
  }, draft ? quickInput.value : null)
}

async function submitQuickTodo(keepOpen = false) {
  const draft = quickDraft.value
  const title = draft?.title.trim()
  if (!title || quickSaving.value) return
  quickSaving.value = true
  try {
    await todos.addTodo({ title, date: String(draft.date) })
    if (keepOpen) {
      draft.title = ''
    } else closeQuickInput()
    if (draft.date !== todos.currentDate) {
      toast(`已添加到${fromKey(draft.date).format('M月D日')}`, 'success')
    }
  } catch (err) {
    toast(err.message || '添加失败', 'error')
  } finally {
    quickSaving.value = false
    if (keepOpen) nextTick(() => quickInput.value?.focus())
  }
}

function quickEnter(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat) void submitQuickTodo()
}

function quickEscape(event) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!quickSaving.value) closeQuickInput(true)
}

function toggle(todo, checked) {
  return updateWithListFocus(todoList.value, () => todos.updateField(todo, 'completed', checked))
}

async function saveTitle(todo, title) {
  await todos.updateFields(todo, { title })
}

async function remove(todo) {
  if (childrenOf(todo.id).length && !window.confirm('删除这条待办及其全部子待办？')) return false
  if (todo.repeat && !window.confirm('删除整条重复待办及其完成记录？')) return false
  await updateWithListFocus(todoList.value, () => todos.removeTodo(todo))
  return true
}

function openEditor(todo, returnFocus = null) {
  editingTodo.value = todo
  editorReturnFocus.value = returnFocus
  editorOpen.value = true
}

function openSearch() {
  searchReturnFocus.value = null
  searchOpen.value = true
}

async function openSearchResult(todo) {
  if (todo.completed) todos.showMode = 'default'
  await todos.setCurrentDate(todo.date)
  await nextTick()
  const row = document.getElementById(`todo-${todo.id}`)
  row?.scrollIntoView({ block: 'nearest' })
  searchReturnFocus.value = row ?? todoList.value
  searchOpen.value = false
}

function closeEditorAfterChange() {
  editorReturnFocus.value = todoList.value
  editorOpen.value = false
}

async function onEditorSaved(fields) {
  const todo = editingTodo.value
  if (!todo || saving.value) return
  saving.value = true
  try {
    if (todo.id) await todos.updateFields(todo, fields)
    else await todos.addTodo({ ...fields, parentId: todo.parentId })
    if (fields.date && !fields.repeat) await todos.setCurrentDate(fields.date)
    if (!todo.id && !todo.parentId) quickDraft.value = null
    closeEditorAfterChange()
    if (fields.repeat) toast('已保存重复待办', 'success')
  } catch (err) {
    toast(err.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteFromEditor() {
  if (await remove(editingTodo.value)) closeEditorAfterChange()
}

function changeWeek(delta) {
  return todos.setCurrentDate(toKey(fromKey(todos.currentDate).add(delta * 7, 'day')))
}

async function returnToToday() {
  await todos.setToday()
  await nextTick()
  todoList.value?.focus({ preventScroll: true })
}

async function reorder(target, after) {
  const source = dragging.value
  dragging.value = null
  if (source) await todos.reorderTodo(source, target, after)
}

async function onDrop(dateValue) {
  if (!canDropOnDay.value) return
  const todo = dragging.value
  dragging.value = null
  await todos.moveToDate([todo], dateValue)
  await todos.setCurrentDate(dateValue)
  toast(`已移到${selectedDay.value}`, 'success')
}

async function batch(action) {
  const list = onlyUncompleted.value ? visibleTodos.value.filter((todo) => !todo.completed) : visibleTodos.value
  if (!list.length) return
  if (action === 'today') {
    await todos.moveToDate(list, todos.today)
    await todos.setToday()
  }
  if (action === 'complete') await todos.setCompleted(list, true)
  if (action === 'uncomplete') await todos.setCompleted(list, false)
  if (action === 'remove' && window.confirm('删除当前显示的待办及其子待办？重复待办的规则和完成记录也会删除。')) {
    await todos.removeMany(list)
  }
}

async function copy(kind) {
  const text =
    kind === 'markdown'
      ? listToMarkdown(visibleTree.value)
      : visibleTodos.value.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.title}`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制到剪贴板', 'success')
  } catch {
    toast('复制失败', 'error')
  }
}

async function importFromClipboard() {
  importDraft.value = { date: todos.currentDate, text: '' }
  const draft = importDraft.value
  try {
    const text = await navigator.clipboard.readText()
    if (importDraft.value === draft && !draft.text) draft.text = text
  } catch {
    // The preview also accepts text pasted manually.
  }
}

async function confirmClipboardImport() {
  const draft = importDraft.value
  const items = importItems.value
  if (!draft || !items.length || importing.value) return
  importing.value = true
  try {
    await todos.addTodos(items.map((title) => ({ title, date: String(draft.date) })))
    importDraft.value = null
    toast(`已导入 ${items.length} 条待办`, 'success')
  } catch (err) {
    toast(`导入失败：${err.message}`, 'error')
  } finally {
    importing.value = false
  }
}

function listToMarkdown(list) {
  const checkbox = (t) => `- [${t.completed ? 'x' : ' '}] ${t.title}`
  return list.flatMap((t) => [checkbox(t), ...t.children.map((child) => `  ${checkbox(child)}`)]).join('\n')
}

function doExport(kind) {
  const list = visibleTree.value
  if (kind === 'md') exportMarkdown(list, todos.currentDate)
  if (kind === 'html') exportHtml(list, todos.currentDate)
  if (kind === 'csv') exportCsv(list, todos.currentDate)
  toast('已导出', 'success')
}

</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <TitleBar
      title="MedoTask"
      show-overview
      show-mini
      show-pin
      :close-label="trayReady ? '关闭到系统托盘' : '关闭'"
      @close="windows.close('main')"
    />

    <div class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <CountdownCard class="shrink-0" />

      <WeekTabs
        class="shrink-0"
        :days="todos.currentWeek"
        :model-value="todos.currentDate"
        :counts="todos.weekCounts"
        :can-drop="canDropOnDay"
        @update:model-value="todos.setCurrentDate"
        @change-week="changeWeek"
        @drop="onDrop"
      />

      <div class="flex shrink-0 items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>{{ todos.currentDate === todos.today ? '今日待办' : `${selectedDay}的待办` }}</span>
        <div class="flex items-center gap-1">
          <button v-if="todos.currentDate !== todos.today" class="rounded px-2 py-1 hover:bg-accent ring-focus" @click="returnToToday">回到今天</button>
          <button
            class="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground ring-focus"
            :aria-pressed="onlyUncompleted"
            @click="todos.showMode = onlyUncompleted ? 'default' : 'uncompleted'"
          >
            <ListFilter class="size-3.5" />
            只看未完成
          </button>
        </div>
      </div>

      <!-- list -->
      <div ref="todoList" tabindex="-1" role="region" aria-label="待办列表" class="scroll-thin relative min-h-0 flex-1 overflow-y-auto rounded-md border outline-none">
        <div class="flex flex-col p-1.5">
          <p v-if="!visibleTree.length && !quickDraft" class="py-8 text-center text-sm text-muted-foreground">
            {{ onlyUncompleted ? '没有未完成的待办' : todos.currentDate === todos.today ? '今天还没有待办' : `${selectedDay}还没有待办` }}
          </p>
          <TransitionGroup :key="todos.currentDate" :css="false" move-class="todo-shift">
            <div v-for="todo in visibleTree" :key="todo.id">
              <TodoRow
                :todo="todo"
                :dragging="dragging"
                :is-child="!!todo.parentId"
                @toggle="toggle"
                @update:title="saveTitle(todo, $event)"
                @delete="remove"
                @open-editor="openEditor"
                @add-child="openNewTodo"
                @drag-start="dragging = $event"
                @drag-end="dragging = null"
                @reorder="reorder"
              >
                <template #children>
                  <TodoRow
                    v-for="child in todo.children"
                    :key="child.id"
                    :todo="child"
                    :dragging="dragging"
                    is-child
                    @toggle="toggle"
                    @update:title="saveTitle(child, $event)"
                    @delete="remove"
                    @open-editor="openEditor"
                    @drag-start="dragging = $event"
                    @drag-end="dragging = null"
                    @reorder="reorder"
                  />
                </template>
              </TodoRow>
            </div>
          </TransitionGroup>

          <form
            v-if="quickDraft"
            ref="quickForm"
            id="inline-todo-editor"
            aria-label="列表内新建待办"
            class="flex flex-col gap-1 rounded-md border-y bg-muted/35 py-1.5 pl-2.5 pr-1.5"
            @submit.prevent="submitQuickTodo()"
          >
            <p v-if="quickDraft.date !== todos.currentDate" class="pl-11 text-xs text-muted-foreground">
              添加到 {{ fromKey(quickDraft.date).format('M月D日') }}
            </p>
            <div class="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" class="w-3.5 shrink-0" />
              <span aria-hidden="true" class="size-4 shrink-0 rounded border border-primary" />
              <input
                ref="quickInput"
                v-model="quickDraft.title"
                class="h-7 min-w-0 flex-1 rounded bg-transparent px-1 text-sm ring-focus"
                placeholder="要做什么？"
                aria-label="快速新建待办"
                :readonly="quickSaving"
                @keydown.enter="quickEnter"
                @keydown.esc="quickEscape"
              />
              <Button size="xs" type="submit" :disabled="quickSaving || !quickDraft.title.trim()">保存</Button>
              <Button size="xs" variant="secondary" type="button" :disabled="quickSaving || !quickDraft.title.trim()" @click="submitQuickTodo(true)">
                保存并继续
              </Button>
              <Button size="xs" variant="ghost" class="px-1.5" title="新建待办详情" aria-label="新建待办详情" :disabled="quickSaving" @click="openNewTodo()">
                <SquarePen class="size-3.5" />
              </Button>
              <Button size="xs" variant="ghost" class="px-1.5" title="取消新建待办" aria-label="取消新建待办" :disabled="quickSaving" @click="closeQuickInput(true)">
                <X class="size-3.5" />
              </Button>
            </div>
          </form>

          <Button
            ref="addButton"
            variant="secondary"
            class="mt-1.5 h-9 w-full shrink-0"
            aria-label="新建待办"
            :aria-expanded="!!quickDraft"
            :aria-controls="quickDraft ? 'inline-todo-editor' : undefined"
            @click="openQuickInput"
          >
            <span class="text-lg leading-none">+</span>
          </Button>
        </div>
      </div>
    </div>

    <BottomBar
      :today-count="todos.uncompletedCount"
      :total-count="todos.todos.length"
      :is-today="todos.currentDate === todos.today"
      @open-trash="windows.open('trash')"
      @open-settings="windows.open('setting')"
    >
      <template #menu>
        <button class="bottom-bar-btn" title="搜索待办" aria-label="搜索待办" @click="openSearch">
          <Search class="h-4 w-4" />
        </button>
        <DropdownMenu>
          <template #trigger>
            <button class="bottom-bar-btn" title="菜单">
              <ListChecks class="h-4 w-4" />
            </button>
          </template>

          <DropdownMenuItem
            class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
            @select="batch('today')"
          >
            设为今日
          </DropdownMenuItem>
          <DropdownMenuItem
            class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
            @select="batch('complete')"
          >
            全部设为完成
          </DropdownMenuItem>
          <DropdownMenuItem
            class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
            @select="batch('uncomplete')"
          >
            全部设为未完成
          </DropdownMenuItem>
          <DropdownMenuSeparator class="my-1 h-px bg-border" />
          <DropdownMenuItem
            class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive outline-none focus:bg-accent"
            @select="batch('remove')"
          >
            删除全部
          </DropdownMenuItem>
          <DropdownMenuSeparator class="my-1 h-px bg-border" />
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="aboutOpen = true">
            关于
          </DropdownMenuItem>
          <template v-if="windows.isDesktop">
            <DropdownMenuItem
              class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
              @select="windows.quit()"
            >
              退出 MedoTask
            </DropdownMenuItem>
          </template>
        </DropdownMenu>

        <DropdownMenu>
          <template #trigger>
            <button class="bottom-bar-btn" title="复制">
              <Copy class="h-4 w-4" />
            </button>
          </template>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="copy('markdown')">
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="copy('text')">
            文本列表
          </DropdownMenuItem>
        </DropdownMenu>

        <DropdownMenu>
          <template #trigger>
            <button class="bottom-bar-btn" title="导入">
              <Upload class="h-4 w-4" />
            </button>
          </template>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="importFromClipboard">
            从剪贴板导入
          </DropdownMenuItem>
        </DropdownMenu>

        <DropdownMenu>
          <template #trigger>
            <button class="bottom-bar-btn" title="导出">
              <Download class="h-4 w-4" />
            </button>
          </template>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="doExport('md')">
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="doExport('html')">
            HTML
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer rounded-sm px-2 py-1.5 text-sm" @select="doExport('csv')">
            CSV
          </DropdownMenuItem>
        </DropdownMenu>

        <button v-if="hasAssistant" class="bottom-bar-btn" title="打开 AI 助手" aria-label="打开 AI 助手" @click="windows.open('ai')">
          <Sparkles class="h-4 w-4" />
        </button>
      </template>
    </BottomBar>

    <AboutDialog v-model:open="aboutOpen" />
    <Dialog
      :open="!!importDraft"
      title="批量导入待办"
      :description="importDraft ? `每行一条，将添加到 ${fromKey(importDraft.date).format('M月D日')}。` : ''"
      @update:open="!$event && !importing && (importDraft = null)"
    >
      <textarea
        v-if="importDraft"
        v-model="importDraft.text"
        aria-label="待导入文本"
        placeholder="在这里粘贴待办文本"
        class="min-h-24 resize-y rounded-md border border-input bg-background p-2 text-sm ring-focus"
        :readonly="importing"
      />
      <ul v-if="importItems.length" class="scroll-thin max-h-24 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted-foreground">
        <li v-for="(item, index) in importItems.slice(0, 10)" :key="index" class="break-words">{{ item }}</li>
        <li v-if="importItems.length > 10">另有 {{ importItems.length - 10 }} 条</li>
      </ul>
      <template #footer>
        <Button size="sm" variant="outline" :disabled="importing" @click="importDraft = null">取消</Button>
        <Button size="sm" :disabled="importing || !importItems.length" @click="confirmClipboardImport">
          导入 {{ importItems.length }} 条
        </Button>
      </template>
    </Dialog>
    <TodoSearchDialog v-model:open="searchOpen" :today="todos.today" :return-focus="searchReturnFocus" @select="openSearchResult" />
    <TodoEditorDialog
      v-model:open="editorOpen"
      :todo="editingTodo"
      :saving="saving"
      :return-focus="editorReturnFocus"
      @save="onEditorSaved"
      @delete="deleteFromEditor"
    />
  </div>
</template>

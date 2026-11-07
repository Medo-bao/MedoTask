<script setup>
/**
 * Full editor for one todo: title, notes, colour, date, repeat rule and
 * parent/child links. This is the "detail" view the original opened from the
 * row menu.
 */
import { computed, ref, watch } from 'vue'
import Dialog from './ui/Dialog.vue'
import Button from './ui/Button.vue'
import { COLORS } from '@/lib/colors.js'
import { dayParts } from '@/db/todos.js'
import { dayjsKey } from '@/lib/dates.js'

const props = defineProps({
  open: Boolean,
  todo: { type: Object, default: null },
  saving: Boolean,
})
const emit = defineEmits(['update:open', 'save', 'delete'])

const REPEATS = [
  { value: null, label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const isChild = computed(() => !!props.todo?.parentId)
const canRepeat = computed(() => !isChild.value && (!props.todo?.children?.length || !!props.todo.repeat))

const form = ref({
  title: '',
  content: '',
  color: 'default',
  date: '',
  repeat: null,
  repeatDays: [],
  reminderTime: '',
  postponeAuto: true,
})

watch(
  [() => props.open, () => props.todo],
  ([open, t]) => {
    if (!open || !t) return
    let days = []
    if (t.repeatDays) {
      days = String(t.repeatDays)
        .split(',')
        .filter(Boolean)
        .map(Number)
    }
    form.value = {
      title: t.title ?? '',
      content: t.content ?? '',
      color: t.color ?? 'default',
      date: t.date ? dayjsKey(t.date) : '',
      repeat: t.repeat ?? null,
      repeatDays: days,
      reminderTime: t.reminderTime ?? '',
      postponeAuto: t.postponeAuto ?? true,
    }
  },
  { immediate: true }
)

const repeatChoices = computed(() => {
  if (form.value.repeat === 'weekly') return WEEKDAYS
  if (form.value.repeat === 'monthly') return MONTH_DAYS
  return []
})

const chosenDays = computed(() => {
  if (!repeatChoices.value.length) return []
  if (form.value.repeatDays.length) return form.value.repeatDays
  const key = form.value.date.replace(/-/g, '') || props.todo?.date
  const d = dayParts(key)
  return [form.value.repeat === 'weekly' ? d.weekdayIndex : d.dayOfMonth - 1]
})

function toggleDay(i) {
  const days = new Set(chosenDays.value)
  if (days.has(i)) {
    if (days.size === 1) return
    days.delete(i)
  } else days.add(i)
  form.value.repeatDays = [...days].sort((a, b) => a - b)
}

const canSave = computed(() => !!form.value.title.trim() && (isChild.value || !!form.value.date))

function save(event) {
  if (event?.repeat || event?.isComposing || event?.keyCode === 229 || props.saving || !canSave.value) return
  const fields = {
    title: form.value.title.trim(),
    content: form.value.content,
    color: form.value.color,
    reminderTime: form.value.reminderTime,
  }
  if (!isChild.value) {
    const date = form.value.date.replace(/-/g, '')
    const repeat = canRepeat.value ? form.value.repeat : null
    const days = chosenDays.value
    Object.assign(fields, {
      date,
      repeat,
      postponeAuto: form.value.postponeAuto,
      repeatDays: repeat && days.length ? `,${days.join(',')},` : null,
      repeatStartDate: repeat
        ? (date === String(props.todo.date) && props.todo.repeatStartDate) || date
        : null,
    })
  }
  emit('save', fields)
}
</script>

<template>
  <Dialog
    :open="open"
    :title="todo?.id ? '编辑待办' : isChild ? '新建子待办' : '新建待办'"
    width="w-[92%] max-w-sm"
    @update:open="!saving && emit('update:open', $event)"
  >
    <div class="flex flex-col gap-2.5 text-xs">
      <label class="flex flex-col gap-1">
        <span class="text-muted-foreground">标题</span>
        <input
          v-model="form.title"
          class="h-8 rounded-md border border-input bg-background px-2 text-sm ring-focus"
          placeholder="要做什么？"
          autofocus
          @keydown.enter="save"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-muted-foreground">备注</span>
        <textarea
          v-model="form.content"
          rows="3"
          class="scroll-thin resize-none rounded-md border border-input bg-background p-2 text-xs ring-focus"
          placeholder="补充说明"
        />
      </label>

      <label v-if="!isChild" class="flex items-center gap-2">
        <span class="w-12 shrink-0 text-muted-foreground">日期</span>
        <input
          v-model="form.date"
          type="date"
          class="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs ring-focus"
        />
      </label>

      <div class="flex items-center gap-2">
        <label class="flex min-w-0 flex-1 items-center gap-2">
          <span class="w-12 shrink-0 text-muted-foreground">到点提醒</span>
          <input
            v-model="form.reminderTime"
            type="time"
            class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs ring-focus"
          />
        </label>
        <Button v-if="form.reminderTime" variant="ghost" size="xs" @click="form.reminderTime = ''">清除时间</Button>
      </div>

      <label v-if="canRepeat" class="flex items-center gap-2">
        <span class="w-12 shrink-0 text-muted-foreground">重复</span>
        <select
          v-model="form.repeat"
          class="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs ring-focus"
          @change="form.repeatDays = []"
        >
          <option v-for="r in REPEATS" :key="String(r.value)" :value="r.value">{{ r.label }}</option>
        </select>
      </label>

      <div v-if="canRepeat && repeatChoices.length" class="grid grid-cols-7 gap-1 pl-14">
        <button
          v-for="(d, i) in repeatChoices"
          :key="d"
          class="h-7 rounded border text-[11px] transition-colors ring-focus"
          :aria-label="form.repeat === 'weekly' ? `周${d}` : `每月 ${d} 日`"
          :aria-pressed="chosenDays.includes(i)"
          :class="
            chosenDays.includes(i)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-accent'
          "
          @click="toggleDay(i)"
        >
          {{ d }}
        </button>
      </div>

      <label v-if="!isChild && !form.repeat" class="flex items-center gap-2">
        <span class="w-12 shrink-0 text-muted-foreground">延期</span>
        <input v-model="form.postponeAuto" type="checkbox" />
        <span>全局开启时，逾期自动移到今天</span>
      </label>

      <div class="flex items-center gap-2">
        <span class="w-12 shrink-0 text-muted-foreground">颜色</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="c in COLORS"
            :key="c.value"
            class="h-5 w-5 rounded-full border-2 transition-transform ring-focus hover:scale-110"
            :class="[c.dot, form.color === c.value ? 'border-foreground' : 'border-transparent']"
            :title="c.label"
            @click="form.color = c.value"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <Button v-if="todo?.id" variant="ghost" size="sm" class="text-destructive" :disabled="saving" @click="emit('delete')">删除</Button>
      <div class="flex-1" />
      <Button variant="outline" size="sm" :disabled="saving" @click="emit('update:open', false)">取消</Button>
      <Button size="sm" :disabled="saving || !canSave" @click="save">保存</Button>
    </template>
  </Dialog>
</template>

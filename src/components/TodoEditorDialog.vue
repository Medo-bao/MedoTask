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
import { repeatDayIndices } from '@/db/todos.js'
import { dayjsKey, isDateKey } from '@/lib/dates.js'

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
const SCHEDULE_FIELDS = ['date', 'repeat', 'repeatDays', 'repeatStartDate', 'repeatEndDate']
const isChild = computed(() => !!props.todo?.parentId)
const canRepeat = computed(() => !isChild.value && (!props.todo?.children?.length || !!props.todo.repeat))

let originalFields
const form = ref({
  title: '',
  content: '',
  color: 'default',
  date: '',
  repeat: null,
  repeatDays: [],
  repeatEndDate: '',
  reminderTime: '',
  postponeAuto: true,
})

const repeatChoices = computed(() => {
  if (form.value.repeat === 'weekly') return WEEKDAYS
  if (form.value.repeat === 'monthly') return MONTH_DAYS
  return []
})

const dateKey = computed(() => form.value.date.replace(/-/g, ''))
const repeatStart = computed(() => {
  const original = props.todo?.repeatStartDate
  return dateKey.value === String(props.todo?.date) && isDateKey(original)
    ? String(original)
    : dateKey.value
})
const repeatEnd = computed(() => form.value.repeatEndDate.replace(/-/g, ''))
const invalidRepeatEnd = computed(() =>
  canRepeat.value && !!form.value.repeat && !!repeatEnd.value &&
  (!isDateKey(repeatEnd.value) || repeatEnd.value < repeatStart.value)
)
const chosenDays = computed(() =>
  repeatDayIndices(form.value.repeat, form.value.repeatDays, repeatStart.value)
)

function toggleDay(i) {
  const days = new Set(chosenDays.value)
  if (days.has(i)) {
    if (days.size === 1) return
    days.delete(i)
  } else days.add(i)
  form.value.repeatDays = [...days].sort((a, b) => a - b)
}

const canSave = computed(() =>
  !!form.value.title.trim() && (isChild.value || isDateKey(dateKey.value)) && !invalidRepeatEnd.value
)

function collectFields() {
  const fields = {
    title: form.value.title.trim(),
    content: form.value.content,
    color: form.value.color,
    reminderTime: form.value.reminderTime,
  }
  if (!isChild.value) {
    const repeat = canRepeat.value ? form.value.repeat : null
    const days = chosenDays.value
    Object.assign(fields, {
      date: dateKey.value,
      repeat,
      postponeAuto: form.value.postponeAuto,
      repeatDays: repeat && days.length ? `,${days.join(',')},` : null,
      repeatStartDate: repeat ? repeatStart.value : null,
      repeatEndDate: repeat ? repeatEnd.value || null : null,
    })
  }
  return fields
}

watch(
  [() => props.open, () => props.todo],
  ([open, t]) => {
    if (!open || !t) return
    form.value = {
      title: t.title ?? '',
      content: t.content ?? '',
      color: t.color ?? 'default',
      date: t.date ? dayjsKey(t.date) : '',
      repeat: t.repeat ?? null,
      repeatDays: t.repeatDays ?? [],
      repeatEndDate: t.repeat && isDateKey(t.repeatEndDate) ? dayjsKey(t.repeatEndDate) : '',
      reminderTime: t.reminderTime ?? '',
      postponeAuto: t.postponeAuto ?? true,
    }
    originalFields = collectFields()
  },
  { immediate: true }
)

function save(event) {
  if (event?.repeat || event?.isComposing || event?.keyCode === 229 || props.saving || !canSave.value) return
  const fields = collectFields()
  if (!props.todo.id) {
    emit('save', fields)
    return
  }
  // Other windows may have edited fields this dialog left untouched.
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== originalFields[key]))
  if (SCHEDULE_FIELDS.some((key) => Object.hasOwn(changes, key))) {
    for (const key of SCHEDULE_FIELDS) changes[key] = fields[key]
  }
  emit('save', changes)
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

      <div v-if="canRepeat && form.repeat" class="flex items-center gap-2">
        <label class="flex min-w-0 flex-1 items-center gap-2">
          <span class="w-12 shrink-0 text-muted-foreground">截止日期</span>
          <input
            v-model="form.repeatEndDate"
            type="date"
            class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs ring-focus"
          />
        </label>
        <Button v-if="form.repeatEndDate" variant="ghost" size="xs" @click="form.repeatEndDate = ''">清除</Button>
      </div>
      <p v-if="invalidRepeatEnd" class="text-destructive">截止日期不能早于重复开始日期</p>

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

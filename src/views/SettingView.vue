<script setup>
/**
 * Settings window.
 *
 * Sections mirror the original: appearance, main window behaviour, mini
 * window and data. Cloud sync and auto-update are intentionally
 * absent — this build is offline by design.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Download, HardDrive, Home, Palette, PanelTop, RotateCcw, Upload, Trash2, Volume2 } from 'lucide-vue-next'
import TitleBar from '@/components/TitleBar.vue'
import Tabs from '@/components/ui/Tabs.vue'
import Switch from '@/components/ui/Switch.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { TabsContent } from 'reka-ui'
import { useSettingsStore } from '@/stores/settings.js'
import { useWindows } from '@/composables/useWindows.js'
import { toast } from '@/stores/toast.js'
import { exportDatabase, previewBackup, recoveryPoint, reset, restoreRecoveryPoint } from '@/db/database.js'
import { dayjsKey, isDateKey } from '@/lib/dates.js'
import { colorOf } from '@/lib/colors.js'

const settings = useSettingsStore()
const windows = useWindows()

const tab = ref('base')
const version = __APP_VERSION__
const edition = __HAS_ASSISTANT__ ? '完整版' : '纯净版'

const TABS = [
  { value: 'base', label: '基础', icon: Palette },
  { value: 'main', label: '主窗', icon: Home },
  { value: 'mini', label: '浮窗', icon: PanelTop },
  { value: 'data', label: '数据', icon: HardDrive },
]

const SOUNDS = {
  Default: '默认', IM: '即时消息', Mail: '邮件', Reminder: '日程提醒', SMS: '短信', Alarm: '闹钟', Call: '来电',
}

const s = computed(() => settings.setting)
const autostart = ref(null)
const autostartBusy = ref(false)
const soundBusy = ref(false)

onMounted(async () => {
  if (!windows.isWindowsDesktop) return
  try {
    autostart.value = await windows.autostartEnabled()
  } catch (err) {
    toast(`读取开机自启状态失败：${err?.message ?? err}`, 'error')
  }
})

async function setAutostart(enabled) {
  if (autostartBusy.value) return
  autostartBusy.value = true
  try {
    autostart.value = await windows.setAutostart(enabled)
  } catch (err) {
    toast(`设置开机自启失败：${err?.message ?? err}`, 'error')
  } finally {
    autostartBusy.value = false
  }
}

async function set(patch) {
  try {
    await settings.save(patch)
  } catch (err) {
    console.error('[kite] save failed', patch, err)
    toast(`保存失败：${err?.message ?? err}`, 'error')
  }
}

/* ---------------- data ---------------- */

async function chooseReminderSound(e) {
  const input = e.target
  const file = input.files?.[0]
  input.value = ''
  if (!file || soundBusy.value) return
  if (file.size > 8 * 1024 * 1024) {
    toast('请选择 8 MB 以内的 WAV 文件', 'error')
    return
  }
  soundBusy.value = true
  try {
    await windows.saveReminderSound(new Uint8Array(await file.arrayBuffer()))
    await settings.save({ notificationSound: 'Custom', notificationSoundName: file.name })
    toast('已设置自定义提醒声音', 'success')
  } catch (err) {
    toast(`设置提醒声音失败：${err?.message ?? err}`, 'error')
  } finally {
    soundBusy.value = false
  }
}

async function previewSound() {
  try {
    await windows.previewReminderSound(s.value.notificationSound)
  } catch (err) {
    toast(err?.message ?? String(err), 'error')
  }
}

const backupPreview = ref(null)
const recoveryAt = ref(null)
const dataBusy = ref(false)
const recoveryLabel = computed(() => recoveryAt.value === null ? '' : new Date(recoveryAt.value).toLocaleString())
const backupRange = computed(() => {
  const preview = backupPreview.value
  if (!preview || !isDateKey(preview.firstDate) || !isDateKey(preview.lastDate)) return '无已安排日期'
  const first = dayjsKey(preview.firstDate)
  return preview.firstDate === preview.lastDate ? first : `${first} 至 ${dayjsKey(preview.lastDate)}`
})

async function refreshRecovery() {
  try {
    recoveryAt.value = await recoveryPoint()
  } catch (err) {
    toast(`读取恢复点失败：${err.message}`, 'error')
  }
}

watch(tab, (value) => { if (value === 'data') void refreshRecovery() })

async function doExport() {
  try {
    const backup = await exportDatabase()
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kite-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('已导出备份', 'success')
  } catch (err) {
    toast(`导出失败：${err.message}`, 'error')
  }
}

async function doImport(e) {
  const input = e.target
  const file = input.files?.[0]
  input.value = ''
  if (!file || dataBusy.value) return
  dataBusy.value = true
  try {
    const preview = previewBackup(new Uint8Array(await file.arrayBuffer()))
    backupPreview.value = { ...preview, filename: file.name }
  } catch (err) {
    toast(`导入失败：${err.message}`, 'error')
  } finally {
    dataBusy.value = false
  }
}

async function changeData(action, failure, success) {
  if (dataBusy.value) return
  dataBusy.value = true
  try {
    await action()
    toast(success, 'success')
  } catch (err) {
    toast(`${failure}：${err.message}`, 'error')
  } finally {
    await refreshRecovery()
    dataBusy.value = false
  }
}

function confirmImport() {
  if (!backupPreview.value) return
  const { apply } = backupPreview.value
  return changeData(async () => {
    await apply()
    backupPreview.value = null
  }, '导入失败', '已导入备份，原数据已保留为恢复点')
}

function doReset() {
  if (!confirm('确定清空所有数据？当前数据会保存为最近一个本地恢复点。')) return
  return changeData(reset, '清空失败', '已清空数据，原数据已保留为恢复点')
}

function doRestore() {
  const createdAt = recoveryAt.value
  if (createdAt === null || !confirm(`恢复 ${recoveryLabel.value} 的数据？当前数据将成为新的恢复点。`)) return
  return changeData(() => restoreRecoveryPoint(createdAt), '恢复失败', '已恢复本地数据')
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <TitleBar title="MedoTask 设置" @close="windows.close('setting')" />

    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Tabs v-model="tab" :tabs="TABS">
        <div class="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto">
          <!-- base -->
          <TabsContent value="base" class="flex flex-col divide-y">
            <div v-if="windows.isWindowsDesktop" class="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div class="text-sm">开机自启</div>
                <div class="mt-0.5 text-xs text-muted-foreground">登录 Windows 后在系统托盘启动</div>
              </div>
              <Switch
                :model-value="autostart ?? false"
                :disabled="autostart === null || autostartBusy"
                label="开机自启"
                @update:model-value="setAutostart"
              />
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">暗黑模式</span>
              <Switch
                :checked="s.mode === 'dark'"
                label="暗黑模式"
                @update:checked="set({ mode: $event ? 'dark' : 'light' })"
              />
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">自动延期</span>
              <Switch
                :checked="s.postponeAuto === 'true'"
                label="自动延期"
                @update:checked="set({ postponeAuto: $event ? 'true' : 'false' })"
              />
            </div>

            <div v-if="windows.isWindowsDesktop" class="space-y-2 py-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm">提醒声音</span>
                <select
                  aria-label="提醒声音"
                  :value="s.notificationSound"
                  :disabled="soundBusy"
                  class="h-7 w-32 rounded-md border border-input bg-background px-2 text-xs ring-focus"
                  @change="set({ notificationSound: $event.target.value })"
                >
                  <option v-for="(label, sound) in SOUNDS" :key="sound" :value="sound">{{ label }}</option>
                  <option v-if="s.notificationSoundName || s.notificationSound === 'Custom'" value="Custom">自定义</option>
                </select>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <span v-if="s.notificationSound === 'Custom'" class="min-w-0 flex-1 truncate text-xs text-muted-foreground" :title="s.notificationSoundName">{{ s.notificationSoundName }}</span>
                <Button variant="outline" size="xs" as="label" class="cursor-pointer" :aria-disabled="soundBusy">
                  选择 WAV
                  <input type="file" accept=".wav,audio/wav,audio/x-wav" class="sr-only" :disabled="soundBusy" @change="chooseReminderSound" />
                </Button>
                <Button variant="outline" size="xs" :disabled="soundBusy" @click="previewSound">
                  <Volume2 class="size-3.5" />
                  试听
                </Button>
              </div>
            </div>
          </TabsContent>

          <!-- main window -->
          <TabsContent value="main" class="flex flex-col divide-y">
            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">单击标题</span>
              <select
                :value="s.mainWindow?.clickTitleAction ?? 'edit'"
                class="h-7 w-32 rounded-md border border-input bg-background px-2 text-xs ring-focus"
                @change="set({ mainWindow: { clickTitleAction: $event.target.value } })"
              >
                <option value="edit">进行编辑</option>
                <option value="complete">设为完成</option>
              </select>
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">已完成自动置底</span>
              <Switch
                :checked="s.mainWindow?.completedToBottom !== 'false'"
                @update:checked="set({ mainWindow: { completedToBottom: $event ? 'true' : 'false' } })"
              />
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">未完成自动置顶</span>
              <Switch
                :checked="s.mainWindow?.uncompletedToTop !== 'false'"
                @update:checked="set({ mainWindow: { uncompletedToTop: $event ? 'true' : 'false' } })"
              />
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">按颜色排序</span>
              <Switch
                :checked="s.mainWindow?.orderByColor === 'true'"
                @update:checked="set({ mainWindow: { orderByColor: $event ? 'true' : 'false' } })"
              />
            </div>
          </TabsContent>

          <!-- mini window -->
          <TabsContent value="mini" class="flex flex-col divide-y">
            <div v-if="windows.isWindowsDesktop" class="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div class="text-sm">贴边自动隐藏</div>
                <div class="mt-0.5 text-xs text-muted-foreground">拖到屏幕左、上或右侧，悬停或单击边条展开</div>
              </div>
              <Switch
                :model-value="s.miniWindow?.edgeHide === 'true'"
                label="贴边自动隐藏"
                @update:model-value="set({ miniWindow: { edgeHide: $event ? 'true' : 'false' } })"
              />
            </div>

            <div class="flex items-center justify-between py-2.5">
              <span class="text-sm">仅显示未完成</span>
              <Switch
                :checked="s.miniWindow?.onlyUncompleted === 'true'"
                @update:checked="set({ miniWindow: { onlyUncompleted: $event ? 'true' : 'false' } })"
              />
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between py-2.5">
                <span class="text-sm">{{ windows.isWindowsDesktop ? '背景不透明度' : '透明度' }}</span>
                <span class="text-xs text-muted-foreground">{{ s.miniWindow?.opacity ?? 80 }}%</span>
              </div>
              <input
                type="range"
                :aria-label="windows.isWindowsDesktop ? '浮窗背景不透明度' : '浮窗透明度'"
                min="30"
                max="100"
                :value="Number(s.miniWindow?.opacity ?? 80)"
                class="w-full accent-primary"
                @input="set({ miniWindow: { opacity: $event.target.value } })"
              />
            </div>

            <Button variant="secondary" size="sm" @click="windows.open('mini')">打开浮窗</Button>
          </TabsContent>

          <TabsContent value="data" class="flex flex-col gap-3">
            <p class="text-xs text-muted-foreground">数据保存在本机</p>

            <div class="flex gap-2">
              <Button variant="secondary" size="sm" class="flex-1" :disabled="dataBusy" @click="doExport">
                <Download class="h-3.5 w-3.5" />
                导出备份
              </Button>
              <Button variant="secondary" size="sm" class="flex-1" as="label">
                <Upload class="h-3.5 w-3.5" />
                导入备份
                <input type="file" accept=".json,.db,.sqlite,.sqlite3,application/json,application/x-sqlite3" class="hidden" :disabled="dataBusy" @change="doImport" />
              </Button>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <div class="min-w-0">
                <p class="text-sm">本地恢复点</p>
                <p class="text-xs text-muted-foreground">{{ recoveryLabel || '导入或清空后自动保留最近一份' }}</p>
              </div>
              <Button variant="outline" size="sm" :disabled="dataBusy || recoveryAt === null" @click="doRestore">
                <RotateCcw class="h-3.5 w-3.5" />
                恢复
              </Button>
            </div>

            <Button variant="outline" size="sm" class="text-destructive" :disabled="dataBusy" @click="doReset">
              <Trash2 class="h-3.5 w-3.5" />
              清空所有数据
            </Button>

            <div class="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
              MedoTask v{{ version }} · {{ edition }}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>

    <Dialog
      :open="!!backupPreview"
      title="备份预览"
      description="确认后将整体替换当前数据，并自动保留当前数据作为本地恢复点。"
      @update:open="!$event && !dataBusy && (backupPreview = null)"
    >
      <div class="space-y-1 text-sm">
        <p class="break-all font-medium">{{ backupPreview?.filename }}</p>
        <p>{{ backupPreview?.format }} · 待办 {{ backupPreview?.todoCount }} 条</p>
        <p v-if="backupPreview?.migratedDrafts" class="text-muted-foreground">
          其中 {{ backupPreview.migratedDrafts }} 条原收集箱事项将安排到今天
        </p>
        <p class="text-muted-foreground">日期范围 {{ backupRange }}</p>
      </div>
      <template #footer>
        <Button variant="outline" size="sm" :disabled="dataBusy" @click="backupPreview = null">取消</Button>
        <Button size="sm" :disabled="dataBusy" @click="confirmImport">确认导入</Button>
      </template>
    </Dialog>
  </div>
</template>

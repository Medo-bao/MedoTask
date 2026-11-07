<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { CornerDownLeft, Settings2, Sparkles, Square, Trash2 } from 'lucide-vue-next'
import TitleBar from '@/components/TitleBar.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { loadConfig, saveConfig, streamChat, probe } from '@/lib/assistant.js'
import { parseImport } from '@/lib/transfer.js'
import { useTodoStore } from '@/stores/todos.js'
import { useWindows } from '@/composables/useWindows.js'
import { toast } from '@/stores/toast.js'

const todos = useTodoStore()
const windows = useWindows()

const messages = ref([])
const input = ref('')
const busy = ref(false)
const activeConfig = ref(loadConfig())
const config = ref({ ...activeConfig.value })
const showConfig = ref(false)
const status = ref('unknown')
const connectionError = ref('')
const scrollEl = ref(null)
const inputEl = ref(null)
const invoke = window.__TAURI__?.core?.invoke
let controller = null
let stopped = false
const usesCodex = computed(() => activeConfig.value.provider === 'codex')
/** Desktop only: the DSH provider talks to a local runtime over stdio. */
const localDsh = computed(() => !!invoke && activeConfig.value.provider === 'dsh')
const usesLink = computed(() => usesCodex.value || localDsh.value)
const linkName = computed(() => (usesCodex.value ? 'Codex' : 'DSH'))
const connecting = computed(() => status.value === 'connecting')
const statusText = computed(() => {
  if (status.value === 'ok') return usesLink.value ? `${linkName.value} 已连接` : '助手已连接'
  if (connecting.value) return `正在连接 ${linkName.value}…`
  return status.value === 'unknown' && !usesLink.value ? '检测中…' : '未连接'
})
const latestReply = computed(() => messages.value.findLast((message) => message.role === 'assistant'))
const canCreateTodos = computed(() => !busy.value && latestReply.value?.complete && !!latestReply.value.content.trim())

async function checkStatus() {
  if (usesLink.value) return
  const checked = activeConfig.value
  const r = await probe()
  if (activeConfig.value === checked) status.value = r.ok ? 'ok' : 'down'
}

async function connect() {
  if (!invoke || busy.value || connecting.value || status.value === 'ok') return
  status.value = 'connecting'
  connectionError.value = ''
  try {
    if (usesCodex.value) {
      await invoke('codex_connect', {
        transport: activeConfig.value.codexTransport,
        path: activeConfig.value.codexPath,
      })
    } else {
      await invoke('dsh_connect', {
        path: activeConfig.value.dshPath,
        model: activeConfig.value.model,
      })
    }
    status.value = 'ok'
    inputEl.value?.focus()
  } catch (err) {
    status.value = 'down'
    connectionError.value = String(err?.message ?? err)
  }
}

async function disconnect() {
  status.value = 'down'
  if (!invoke) return
  await invoke(usesCodex.value ? 'codex_disconnect' : 'dsh_disconnect').catch(() => {})
}

/** Tauri's streaming channel, when the shell provides one. */
function createChannel(onDelta) {
  const Channel = window.__TAURI__?.core?.Channel
  if (!Channel) return null
  const channel = new Channel()
  channel.onmessage = onDelta
  return channel
}

async function send() {
  const text = input.value.trim()
  if (!text || busy.value) return
  const codex = usesCodex.value
  const dsh = localDsh.value
  if ((codex || dsh) && status.value !== 'ok') {
    toast(`请先连接 ${codex ? 'Codex' : 'DSH'}`, 'info')
    return
  }

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  stopped = false
  connectionError.value = ''
  busy.value = true

  messages.value.push({ role: 'assistant', content: '', complete: false })
  const target = messages.value[messages.value.length - 1]
  const appendDelta = (delta) => {
    if (stopped) return
    target.content += delta
    void scrollToEnd()
  }
  void scrollToEnd()
  try {
    if (dsh) {
      const channel = createChannel(appendDelta)
      const reply = await invoke('dsh_chat', {
        prompt: text,
        instructions: activeConfig.value.systemPrompt,
        ...(channel ? { onDelta: channel } : {}),
      })
      if (!stopped) target.content = reply
    } else if (codex) {
      const reply = await invoke('codex_chat', {
        prompt: text, instructions: activeConfig.value.systemPrompt,
      })
      if (!stopped) target.content = reply
    } else {
      controller = new AbortController()
      await streamChat(
        {
          messages: messages.value
            .filter((m) => m.content && (m.role === 'user' || m.complete))
            .map(({ role, content }) => ({ role, content })),
        },
        appendDelta,
        controller.signal
      )
    }
    if (!stopped && !target.content.trim()) throw new Error('助手未返回文本')
    target.complete = !stopped
    if (!stopped) status.value = 'ok'
  } catch (err) {
    if (!stopped) {
      const detail = String(err?.message ?? err)
      if (target.content.trim()) connectionError.value = detail
      else target.content = `出错了：${detail}`
      if (codex || dsh) await disconnect()
      else status.value = 'down'
    }
  } finally {
    if (stopped && !target.content.trim()) target.content = '已停止生成'
    busy.value = false
    controller = null
    await scrollToEnd()
  }
}

function stop() {
  stopped = true
  if (usesLink.value) void disconnect()
  controller?.abort()
}

/** Turn the last assistant answer into todos. */
async function toTodos() {
  if (!canCreateTodos.value) return
  const items = parseImport(latestReply.value.content)
  if (!items.length) {
    toast('这段回答里没有识别出待办', 'info')
    return
  }
  await todos.setToday()
  await todos.addTodos(items.map((title) => ({ title })))
  toast(`已添加 ${items.length} 条待办`, 'success')
}

async function clearChat() {
  if (usesLink.value) await disconnect()
  messages.value = []
}

async function scrollToEnd() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function openConfig() {
  config.value = { ...activeConfig.value }
  showConfig.value = true
}

async function saveConfigAndClose() {
  const previous = activeConfig.value
  const changedCodex = previous.provider === 'codex' && (
    config.value.provider !== 'codex' ||
    config.value.codexTransport !== previous.codexTransport ||
    config.value.codexPath !== previous.codexPath
  )
  const changedDsh = previous.provider === 'dsh' && (
    config.value.provider !== 'dsh' ||
    config.value.dshPath !== previous.dshPath ||
    config.value.model !== previous.model
  )
  if (changedCodex || changedDsh) await disconnect()
  activeConfig.value = saveConfig(config.value)
  showConfig.value = false
  connectionError.value = ''
  if (usesLink.value) {
    if (activeConfig.value.provider !== previous.provider) status.value = 'down'
    await connect()
    return
  }
  status.value = 'unknown'
  await checkStatus()
  toast('已保存助手配置', 'success')
}

onMounted(async () => {
  await todos.setToday()
  await checkStatus()
  inputEl.value?.focus()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <TitleBar title="MedoTask 助手" @close="windows.close('ai')" />

    <div class="flex items-center justify-between border-b px-3 py-1.5 text-[11px]">
      <span class="flex items-center gap-1.5" :class="status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'">
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="status === 'ok' ? 'bg-green-500' : status === 'down' ? 'bg-destructive' : 'bg-muted-foreground'"
        />
        {{ statusText }}
      </span>
      <div class="flex items-center gap-1">
        <Button v-if="usesLink && status !== 'ok'" size="sm" variant="ghost" :disabled="busy || connecting" @click="connect">
          连接 {{ linkName }}
        </Button>
        <button class="title-bar-btn h-6 w-6" title="清空对话" :disabled="busy || connecting" @click="clearChat">
          <Trash2 class="h-3.5 w-3.5" />
        </button>
        <button class="title-bar-btn h-6 w-6" title="助手设置" :disabled="busy || connecting" @click="openConfig">
          <Settings2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
    <p v-if="connectionError" role="alert" class="border-b px-3 py-2 text-xs text-destructive">{{ connectionError }}</p>

    <div ref="scrollEl" class="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div v-if="!messages.length" class="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <Sparkles class="h-6 w-6 opacity-60" />
        <p>描述你想安排的事，我可以帮你整理成待办。</p>
        <p class="text-[11px] opacity-70">例如：明天上午写周报，下午整理房间</p>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="mb-2 flex flex-col gap-1">
        <div
          class="max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs leading-5"
          :class="
            m.role === 'user'
              ? 'self-end bg-primary text-primary-foreground'
              : 'self-start border bg-muted/50'
          "
        >
          {{ m.content || (busy ? '…' : '') }}
        </div>
      </div>
    </div>

    <div class="border-t p-2">
      <div class="flex items-end gap-1.5">
        <textarea
          ref="inputEl"
          v-model="input"
          rows="1"
          class="scroll-thin max-h-24 min-h-8 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs ring-focus"
          placeholder="说点什么…"
        />
        <Button v-if="busy" title="停止生成" size="sm" variant="outline" @click="stop">
          <Square class="h-3.5 w-3.5" />
        </Button>
        <Button v-else title="发送" size="sm" :disabled="!input.trim() || (usesLink && status !== 'ok')" @click="send">
          <CornerDownLeft class="h-3.5 w-3.5" />
        </Button>
      </div>
      <div class="mt-1 flex justify-end">
        <button
          class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          :disabled="!canCreateTodos"
          @click="toTodos"
        >
          把回答变成待办
        </button>
      </div>
    </div>

    <Dialog v-model:open="showConfig" title="助手配置" hide-close>
      <div class="text-xs">
        <label class="mb-2 flex flex-col gap-1">
          <span class="text-muted-foreground">服务</span>
          <select v-model="config.provider" class="h-8 rounded-md border border-input bg-background px-2 ring-focus">
            <option value="off">关闭</option>
            <option value="dsh">DeepSeek Harness（本地）</option>
            <option value="openai">OpenAI 兼容接口</option>
            <option v-if="invoke" value="codex">Codex 本机</option>
          </select>
        </label>

        <template v-if="config.provider === 'dsh' && invoke">
          <label class="mb-2 flex flex-col gap-1">
            <span class="text-muted-foreground">dsh 启动文件</span>
            <input
              v-model.trim="config.dshPath"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
              placeholder="留空自动查找，可填写 dsh.cmd 的绝对路径"
            />
          </label>
          <label class="mb-2 flex flex-col gap-1">
            <span class="text-muted-foreground">模型（可选）</span>
            <input
              v-model.trim="config.model"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
              placeholder="deepseek-flash"
            />
          </label>
          <p class="mb-3 text-muted-foreground">使用本机 DeepSeek Harness 的登录状态。助手在只读沙箱中运行，不会改动你的文件。</p>
        </template>

        <template v-else-if="config.provider === 'codex'">
          <label class="mb-2 flex flex-col gap-1">
            <span class="text-muted-foreground">连接方式</span>
            <select v-model="config.codexTransport" class="h-8 rounded-md border border-input bg-background px-2 ring-focus">
              <option value="app-server">App Server（新版）</option>
              <option value="mcp">MCP（兼容旧版）</option>
            </select>
          </label>
          <label class="mb-2 flex flex-col gap-1">
            <span class="text-muted-foreground">Codex 可执行文件</span>
            <input
              v-model.trim="config.codexPath"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
              placeholder="留空自动查找，可填写绝对路径"
            />
          </label>
          <p class="mb-3 text-muted-foreground">使用本机 Codex 的登录状态。发送的对话由 Codex 处理。</p>
        </template>

        <template v-else-if="config.provider === 'openai' || config.provider === 'dsh'">
          <p v-if="config.provider === 'dsh'" class="mb-3 text-muted-foreground">
            Web 版通过下方配置的兼容网关连接 DeepSeek Harness。
          </p>
          <label class="mb-2 flex flex-col gap-1">
            <span class="text-muted-foreground">地址</span>
            <input
              v-model="config.endpoint"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
              placeholder="http://127.0.0.1:3128"
            />
          </label>

          <label class="mb-3 flex flex-col gap-1">
            <span class="text-muted-foreground">模型（可选）</span>
            <input
              v-model="config.model"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
              placeholder="留空使用默认"
            />
          </label>

          <label class="mb-3 flex flex-col gap-1">
            <span class="text-muted-foreground">访问令牌（可选）</span>
            <input
              v-model.trim="config.apiKey"
              type="password"
              autocomplete="off"
              class="h-8 rounded-md border border-input bg-background px-2 ring-focus"
            />
          </label>
        </template>
      </div>
      <template #footer>
        <Button variant="outline" size="sm" @click="showConfig = false">取消</Button>
        <Button size="sm" @click="saveConfigAndClose">
          {{ invoke && (config.provider === 'codex' || config.provider === 'dsh') ? '保存并连接' : '保存' }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>

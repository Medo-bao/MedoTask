/**
 * Assistant bridge.
 *
 * The full edition talks to a configured assistant. Only the chat text is sent
 * to the chosen provider, which can be local or remote.
 *
 * The transport is pluggable:
 *
 *   - `dsh`     : DeepSeek Harness. The desktop shell spawns the local
 *                 `dsh --profile sdk` stdio runtime over IPC; a browser build
 *                 has no shell, so it falls back to an HTTP surface.
 *   - `openai`  : any OpenAI-compatible endpoint the user configures
 *                 (e.g. a locally served llama.cpp / Ollama gateway)
 *   - `off`     : disabled
 *
 * Every provider speaks the same streaming contract, so the UI does not care
 * which one is configured.
 */

const STORE_KEY = 'kite.assistant'

/** Persisted configuration. */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

export function saveConfig(cfg) {
  const next = { ...loadConfig(), ...cfg }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    /* quota */
  }
  return next
}

export const DEFAULTS = {
  provider: 'dsh', // dsh | openai | codex | off
  /**
   * Browser fallback for `dsh`: an OpenAI-compatible gateway in front of the
   * local runtime. The desktop shell ignores this and speaks the SDK stdio
   * protocol directly.
   */
  endpoint: 'http://127.0.0.1:11434',
  /** Absolute path to `dsh.cmd` / `dsh.exe`; empty means look it up. */
  dshPath: '',
  model: '',
  apiKey: '',
  codexTransport: 'app-server',
  codexPath: '',
  temperature: 0.3,
  systemPrompt:
    '你是 MedoTask 助手。用户会描述想做的事，请用简洁中文回答；' +
    '如果用户在记录待办，请只输出待办条目，每行一条，不要编号和解释。',
}

/**
 * Stream a chat completion.
 *
 * @param {{messages: {role:string,content:string}[]}} req
 * @param {(chunk:string)=>void} onDelta
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} the full text
 */
export async function streamChat(req, onDelta, signal) {
  const cfg = loadConfig()
  if (cfg.provider === 'off') {
    throw new Error('尚未配置 AI 助手，请先在设置里选择服务')
  }
  if (cfg.provider === 'dsh') return streamDsh(cfg, req, onDelta, signal)
  return streamOpenAi(cfg, req, onDelta, signal)
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible endpoint                                          */
/* ------------------------------------------------------------------ */

async function streamOpenAi(cfg, req, onDelta, signal) {
  const base = (cfg.endpoint || '').replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: cfg.model || undefined,
      stream: true,
      temperature: cfg.temperature ?? 0.3,
      messages: [{ role: 'system', content: cfg.systemPrompt }, ...req.messages],
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`请求失败 (${res.status}) ${text.slice(0, 200)}`)
  }

  return readSse(res, onDelta)
}

/* ------------------------------------------------------------------ */
/* DeepSeek Harness                                                    */
/* ------------------------------------------------------------------ */

/**
 * DSH's browser fallback. The desktop shell does not use this path: it owns a
 * real `dsh --profile sdk` child process, because DSH has no OpenAI-compatible
 * HTTP route of its own.
 *
 * Kept for the web build, where the user runs a gateway such as
 * `scripts/gateway.mjs` in front of a local runtime.
 */
async function streamDsh(cfg, req, onDelta, signal) {
  const base = (cfg.endpoint || DEFAULTS.endpoint).replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`

  const body = JSON.stringify({
    model: cfg.model || 'default',
    stream: true,
    messages: [{ role: 'system', content: cfg.systemPrompt }, ...req.messages],
  })

  // try the OpenAI-compatible route first
  for (const route of ['/v1/chat/completions', '/api/chat/completions']) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers, signal, body })
    if (res.status === 404) continue
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`DSH ${route} 返回 ${res.status}：${text.slice(0, 200)}`)
    }
    return readSse(res, onDelta)
  }
  throw new Error(
    '无法连接到本地 DeepSeek Harness。请确认它正在运行，并在设置里填写正确的地址。'
  )
}

async function readSse(res, onDelta) {
  if (!res.body) throw new Error('响应没有内容')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // A CRLF counts as one line ending, even when a chunk ends between the two characters.
      const frames = buffer.split(/(?:\r\n|\r(?!\n)|\n){2}/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5))
          .join('\n').trim()
        if (!data || data === '[DONE]') continue
        let json
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const delta = json?.choices?.[0]?.delta?.content ?? json?.delta
        if (typeof delta === 'string' && delta) {
          full += delta
          onDelta?.(delta)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return full
}

/* ------------------------------------------------------------------ */
/* Availability probe                                                  */
/* ------------------------------------------------------------------ */

/** Check whether the configured assistant answers at all. */
export async function probe() {
  const cfg = loadConfig()
  if (cfg.provider === 'off') return { ok: false, reason: '未配置' }
  try {
    const base = (cfg.endpoint || DEFAULTS.endpoint).replace(/\/+$/, '')
    const headers = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}
    const res = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(2500) })
    const models = res.ok ? await res.json() : null
    return { ok: Array.isArray(models?.data), status: res.status }
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) }
  }
}

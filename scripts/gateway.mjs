#!/usr/bin/env node
/**
 * Local assistant gateway.
 *
 * Kite's AI panel speaks the OpenAI chat-completions API. This small server
 * adapts it to a *local* model backend so the app never needs a hosted key:
 *
 *   POST /v1/chat/completions   -> forwarded upstream (streaming passthrough)
 *   GET  /v1/models             -> upstream model list, or a static list
 *   GET  /health                -> liveness for the app's status dot
 *
 * Upstream is configured entirely by environment variables, so the same
 * gateway works with DeepSeek Harness, Ollama, llama.cpp or any other
 * OpenAI-compatible endpoint:
 *
 *   KITE_UPSTREAM      base URL of the upstream API   (default http://127.0.0.1:3128)
 *   KITE_UPSTREAM_KEY  bearer token, if the upstream needs one
 *   KITE_GATEWAY_TOKEN distinct client token required when an upstream key is set
 *   KITE_MODEL         default model id
 *   KITE_PORT          port to listen on              (default 11434)
 *
 * Usage:  node scripts/gateway.mjs
 */
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const UPSTREAM = (process.env.KITE_UPSTREAM || 'http://127.0.0.1:3128').replace(/\/+$/, '')
const UPSTREAM_KEY = process.env.KITE_UPSTREAM_KEY || ''
const GATEWAY_TOKEN = (process.env.KITE_GATEWAY_TOKEN || '').trim()
const DEFAULT_MODEL = process.env.KITE_MODEL || 'deepseek-v4.1-flash'
const PORT = Number(process.env.KITE_PORT || 11434)

if (UPSTREAM_KEY && (!GATEWAY_TOKEN || GATEWAY_TOKEN === UPSTREAM_KEY)) {
  throw new Error('配置 KITE_UPSTREAM_KEY 时，必须另设一个不同的 KITE_GATEWAY_TOKEN')
}
const authorizedHeader = Buffer.from(`Bearer ${GATEWAY_TOKEN}`)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Forward a streaming upstream response straight through. */
async function proxyStream(path, payload, res) {
  const headers = { 'content-type': 'application/json' }
  if (UPSTREAM_KEY) headers.authorization = `Bearer ${UPSTREAM_KEY}`

  const upstream = await fetch(`${UPSTREAM}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch((err) => {
    send(res, 502, { error: { message: `upstream unreachable: ${err.message}` } })
    return null
  })
  if (!upstream) return

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    send(res, upstream.status, { error: { message: text.slice(0, 500) || 'upstream error' } })
    return
  }

  res.writeHead(200, {
    ...CORS,
    'content-type': upstream.headers.get('content-type') || 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }
  } catch {
    /* client went away */
  } finally {
    res.end()
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (GATEWAY_TOKEN) {
    const received = Buffer.from(req.headers.authorization || '')
    if (received.length !== authorizedHeader.length || !timingSafeEqual(received, authorizedHeader)) {
      send(res, 401, { error: { message: '缺少有效的网关访问令牌' } })
      return
    }
  }

  if (url.pathname === '/health') {
    send(res, 200, { status: 'ok', upstream: UPSTREAM, model: DEFAULT_MODEL })
    return
  }

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    try {
      const headers = {}
      if (UPSTREAM_KEY) headers.authorization = `Bearer ${UPSTREAM_KEY}`
      const up = await fetch(`${UPSTREAM}/v1/models`, { headers, signal: AbortSignal.timeout(2000) })
      send(res, up.status, await up.text())
    } catch (err) {
      send(res, 502, { error: { message: `upstream unreachable: ${err.message}` } })
    }
    return
  }

  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const raw = await readBody(req).catch(() => null)
    if (!raw) return send(res, 400, { error: { message: 'empty body' } })

    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      return send(res, 400, { error: { message: 'invalid JSON' } })
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return send(res, 400, { error: { message: 'expected a chat request object' } })
    }
    if (!payload.model || payload.model === 'default') payload.model = DEFAULT_MODEL
    return proxyStream('/v1/chat/completions', payload, res)
  }

  send(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[kite] assistant gateway on http://127.0.0.1:${PORT}`)
  console.log(`[kite] upstream: ${UPSTREAM}  model: ${DEFAULT_MODEL}`)
})

/**
 * Import / export helpers.
 *
 * All formats are produced locally and downloaded through a blob URL — no
 * server, matching the app's offline-first stance.
 */
import { dayjsKey } from './dates.js'

function stamp(key) {
  return dayjsKey(key)
}

function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function checkbox(t) {
  return `- [${t.completed ? 'x' : ' '}] ${t.title}`
}

export function exportMarkdown(list, dateKey) {
  const lines = [`# 待办（${stamp(dateKey)}）`, '']
  for (const t of list) {
    lines.push(checkbox(t))
    if (t.content) lines.push(`  > ${t.content.replace(/\n/g, ' ')}`)
    for (const c of t.children ?? []) {
      lines.push(`  ${checkbox(c)}`)
      if (c.content) lines.push(`    > ${c.content.replace(/\n/g, ' ')}`)
    }
  }
  download(`待办-${stamp(dateKey)}.md`, lines.join('\n'), 'text/markdown;charset=utf-8')
}

export function exportHtml(list, dateKey) {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const rows = list
    .map((t) => {
      const cls = t.completed ? 'done' : ''
      const kids = (t.children ?? [])
        .map((c) => `<li class="child ${c.completed ? 'done' : ''}">${esc(c.title)}</li>`)
        .join('')
      return `<li class="${cls}">${esc(t.title)}${kids ? `<ul>${kids}</ul>` : ''}</li>`
    })
    .join('\n')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>待办 ${stamp(dateKey)}</title>
<style>
body{font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#111}
h1{font-size:18px}
ul{list-style:none;padding-left:0}
li{padding:4px 0;border-bottom:1px solid #eee}
li.child{margin-left:20px;font-size:13px;color:#555}
.done{text-decoration:line-through;color:#999}
</style></head><body>
<h1>待办（${stamp(dateKey)}）</h1>
<ul>${rows}</ul>
</body></html>`
  download(`待办-${stamp(dateKey)}.html`, html, 'text/html;charset=utf-8')
}

export function exportCsv(list, dateKey) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const rows = [['日期', '标题', '完成', '备注', '颜色']]
  for (const t of list) {
    rows.push([stamp(dateKey), t.title, t.completed ? '是' : '否', t.content ?? '', t.color ?? ''])
    for (const c of t.children ?? []) {
      rows.push([stamp(dateKey), `  ${c.title}`, c.completed ? '是' : '否', c.content ?? '', c.color ?? ''])
    }
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  // BOM so Excel opens UTF-8 correctly
  download(`待办-${stamp(dateKey)}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8')
}

/** Parse pasted text into a list of titles. */
export function parseImport(text) {
  if (!text) return []
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
    )
    .filter(Boolean)
}

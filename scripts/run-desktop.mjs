/**
 * Run the desktop build with a project-local WebView2 profile.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXE = path.join(ROOT, 'src-tauri', 'target', 'release', 'medotask-full.exe')
const profile = path.join(ROOT, '.desktop-home', 'webview')

if (!fs.existsSync(EXE)) {
  console.error('还没有构建桌面版。先运行：npm run desktop:exe')
  process.exit(1)
}

fs.mkdirSync(profile, { recursive: true })

console.log('启动 MedoTask（数据目录重定向到 .desktop-home/）…')

const child = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile },
  stdio: 'inherit',
  windowsHide: false,
})

child.on('exit', (code) => {
  console.log(`MedoTask 已退出（退出码 ${code}）`)
  process.exit(code ?? 0)
})

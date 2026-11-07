#!/usr/bin/env node
/**
 * Package the app for distribution.
 *
 * Writes the full and clean distributions and one shared source archive.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KITE = path.dirname(ROOT)
const OUT = path.basename(KITE) === 'kite' && path.basename(ROOT) === 'rewrite'
  ? path.resolve(KITE, '..', 'MedoTask')
  : path.join(ROOT, 'dist-release')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const NAME = 'medotask'

const RELEASE = path.join(ROOT, 'src-tauri', 'target', 'release')
const EDITIONS = [
  { name: 'Full', label: '完整版', dist: 'dist' },
  { name: 'Clean', label: '纯净版', dist: 'dist-clean' },
]

const SOURCE_ENTRIES = new Set([
  '.gitignore',
  '.npmrc',
  'README.md',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'docs',
  'public',
  'scripts',
  'src',
  'src-tauri',
])

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-clean',
  'dist-release',
  'target',
  'gen', // Tauri schema cache, regenerated on build
  'android', // unused mobile icon sets
  'ios',
  '.pw',
  '.tmp',
  '.cargo-home',
  '.desktop-home',
  '.dsh-test',
  '.git',
  '.npm-cache',
])

const LOCAL_SOURCE_FILES = [
  /^\.env(?:\.|$)/i,
  /^\.credentials\.yaml$/i,
  /^e2e-report\.json$/i,
  /\.(?:db|sqlite3?)(?:-wal|-shm)?$/i,
  /\.(?:log|jsonl)$/i,
  /-backup-.*\.json$/i,
]

function includeSource(file) {
  const name = path.basename(file)
  return !EXCLUDE_DIRS.has(name) &&
    !LOCAL_SOURCE_FILES.some((pattern) => pattern.test(name)) &&
    path.relative(ROOT, file) !== path.join('public', 'sql-wasm-browser.wasm') &&
    !fs.lstatSync(file).isSymbolicLink()
}

function copySource(dest) {
  fs.mkdirSync(dest)
  for (const name of SOURCE_ENTRIES) {
    const from = path.join(ROOT, name)
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(dest, name), { recursive: true, filter: includeSource })
    }
  }
}

/** Zip a directory with the platform's archive tool. */
function zip(sourceDir, outFile) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $root = $env:MEDOTASK_ZIP_SOURCE
        $zip = [IO.Compression.ZipFile]::Open($env:MEDOTASK_ZIP_OUTPUT, [IO.Compression.ZipArchiveMode]::Create)
        try {
          Get-ChildItem -LiteralPath $root -Recurse -Force -File | ForEach-Object {
            $name = $_.FullName.Substring($root.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name)
          }
        } finally {
          $zip.Dispose()
        }
      `],
      {
        stdio: 'inherit',
        env: { ...process.env, MEDOTASK_ZIP_SOURCE: sourceDir, MEDOTASK_ZIP_OUTPUT: outFile },
      }
    )
  } else {
    execFileSync('zip', ['-rq', outFile, '.'], { cwd: sourceDir, stdio: 'inherit' })
  }
}

/** Copy a tree, honouring EXCLUDE_DIRS. */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDE_DIRS.has(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else fs.copyFileSync(from, to)
  }
}

function sizeOf(file) {
  return `${(fs.statSync(file).size / 1024).toFixed(0)} KB`
}

function checkWebBuild(dir, edition, label) {
  const infoPath = path.join(dir, 'build-info.json')
  const info = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : null
  if (info?.version !== VERSION || info.edition !== edition) {
    throw new Error(`${label} Web 构建与当前版本 ${VERSION} 不匹配，请重新构建。`)
  }
}

function checkDesktopBuild(exe, label) {
  if (process.platform !== 'win32') throw new Error('请在 Windows 上打包并校验桌面 EXE。')
  const version = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      '[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:MEDOTASK_PACKAGE_EXE).ProductVersion'],
    { encoding: 'utf8', env: { ...process.env, MEDOTASK_PACKAGE_EXE: exe } },
  ).trim()
  if (version !== VERSION) {
    throw new Error(`${label} EXE 的产品版本为 ${version || '未知'}，当前版本为 ${VERSION}。请重新构建。`)
  }
}

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
if ([lock, lock.packages?.['']].some((entry) => entry?.name !== pkg.name || entry?.version !== VERSION)) {
  throw new Error('package-lock.json 的项目名或版本与 package.json 不一致。')
}

for (const { dist } of EDITIONS) {
  if (!fs.existsSync(path.join(ROOT, dist, 'index.html'))) {
    console.error(`${dist}/ 不存在，请先构建两个版本`)
    process.exit(1)
  }
}

fs.mkdirSync(OUT, { recursive: true })
const staging = fs.mkdtempSync(path.join(OUT, '.staging-'))
const artifacts = path.join(staging, 'artifacts')
const results = []

function archive(dir, suffix, label) {
  const out = path.join(artifacts, `${NAME}-${VERSION}-${suffix}.zip`)
  zip(dir, out)
  results.push([out, sizeOf(out), label])
}

try {
  fs.mkdirSync(artifacts)
  const built = new Date().toISOString()
  for (const { name, label, dist } of EDITIONS) {
    const key = name.toLowerCase()
    const binary = `medotask-${key}.exe`
    const exe = `MedoTask-${name}.exe`
    const title = `MedoTask v${VERSION} · ${label}`
    const desktopExe = path.join(RELEASE, binary)
    const webDir = path.join(staging, `${key}-web`)
    copyTree(path.join(ROOT, dist), webDir)
    checkWebBuild(webDir, key, label)
    if (fs.existsSync(desktopExe)) {
      const dir = path.join(staging, `${key}-desktop`)
      fs.mkdirSync(dir, { recursive: true })
      const stagedExe = path.join(dir, exe)
      fs.copyFileSync(desktopExe, stagedExe)
      checkDesktopBuild(stagedExe, label)
      fs.writeFileSync(path.join(dir, 'README.txt'), [
        title,
        `构建时间 ${built}`,
        '',
        `解压后双击 ${exe}。需要 Windows 10 或更高版本及 WebView2。`,
        '两个桌面版本使用同一份本机待办和设置。切换版本前，请从托盘退出当前运行的 MedoTask。',
        '',
      ].join('\r\n'), 'utf8')
      archive(dir, `${key}-desktop`, `${label}桌面版`)
      const portable = path.join(artifacts, `MedoTask-${VERSION}-${name}.exe`)
      fs.copyFileSync(stagedExe, portable)
      results.push([portable, sizeOf(portable), `${label}免安装程序`])
    } else {
      console.log(`! 未找到 ${binary}，跳过${label}桌面包`)
    }

    fs.writeFileSync(path.join(webDir, 'VERSION.txt'), [
      title, `构建时间 ${built}`, '', '将目录部署到 HTTP 站点后打开 index.html。', '',
    ].join('\n'), 'utf8')
    archive(webDir, `${key}-web`, `${label}静态站点`)
  }

  const srcDir = path.join(staging, 'source')
  copySource(srcDir)
  archive(srcDir, 'source', '工程源码')
  for (const [file] of results) fs.renameSync(file, path.join(OUT, path.basename(file)))
} finally {
  const resolved = fs.realpathSync(staging)
  if (path.dirname(resolved) === fs.realpathSync(OUT) && path.basename(resolved).startsWith('.staging-')) {
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

console.log('')
for (const [file, size, label] of results) {
  console.log(`✓ ${path.basename(file).padEnd(38)} ${size.padStart(9)}   ${label}`)
}
console.log(`\n输出目录: ${OUT}`)

# MedoTask 1.0.0 — 桌面待办应用

以 **Kite 0.2.0** 为参照重新实现的待办应用。同一套 Vue 源码可构建为 Web 应用和 Tauri 桌面应用。

**纯净版**包含待办、日历、提醒、浮窗和数据迁移。**完整版**在相同功能上增加 AI 助手。

## MedoTask 构建与运行

在仓库根目录执行 `npm ci`。Web 构建使用 Node.js，Windows 桌面构建还需要 Rust MSVC 工具链、Visual Studio C++ Build Tools 和 Windows SDK。本地已用 Node.js 22.23.4 和 Rust 1.97.1 构建。运行桌面版需要 Windows 10 或更高版本及 WebView2。

| 用途 | 命令 | 结果 |
|---|---|---|
| Web 开发 | `npm run dev` | Vite 默认使用 `http://localhost:5174` |
| Web 完整版 | `npm run build` | `dist/`，由 HTTP 服务托管，可用 `npm run preview` 本地预览 |
| Web 纯净版 | `npm run build:clean` | `dist-clean/`，由 HTTP 服务托管 |
| 桌面开发 | `npm run desktop:dev` | Tauri 拉起 Vite 并载入 `http://localhost:5174` |
| Windows 免安装完整版 | `npm run desktop:exe` | `src-tauri/target/release/medotask-full.exe` |
| Windows 免安装纯净版 | `npm run desktop:exe:clean` | `src-tauri/target/release/medotask-clean.exe` |

### 开发沙箱注意事项

WebView2 需要一个可写的数据目录。桌面版优先沿用已存在的旧版 WebView2 目录，新用户使用 `%LOCALAPPDATA%\cn.medotask.app\webview`。
在受限开发环境中可使用独立的 WebView2 数据目录：

```bash
npm run desktop:run      # 使用项目内 .desktop-home/webview
```

正常桌面环境不需要这一步，直接运行 exe 即可。
如果工作区给构建产物加上了 Windows 的低完整性标签，请把桌面 ZIP 解压到普通用户目录后再双击运行。

## 分发

在 Windows 上依次执行 `npm run desktop:exe`、`npm run desktop:exe:clean` 和 `npm run package`，分发包默认输出到 `dist-release/`。只打 Web 和源码包时，先执行两条 Web 构建命令。

| 文件 | 内容 | 用途 |
|---|---|---|
| `medotask-<版本>-full-desktop.zip` | `MedoTask-Full.exe` + 说明 | 免安装完整版 |
| `medotask-<版本>-clean-desktop.zip` | `MedoTask-Clean.exe` + 说明 | 免安装纯净版 |
| `medotask-<版本>-<full 或 clean>-web.zip` | 静态站点 + `VERSION.txt` | 部署到 HTTP 服务器 |
| `medotask-<版本>-source.zip` | 工程源码（不含 `node_modules`、`target`、`dist`） | 换环境自行构建 |

ZIP 命名及前端显示版本来自 `package.json`，桌面打包配置的版本位于 `src-tauri/tauri.conf.json`。脚本先检查 Web 构建的版本及版型，并核对 Windows EXE 的产品版本，校验通过后才输出分发包。

两个桌面版本共用待办、设置、自定义声音和系统单实例标识。切换版本前，从系统托盘退出正在运行的 MedoTask。

## 窗口

MedoTask 一直是「一个用途一个窗口」。这里每个窗口是一个路由：

| 窗口 | 路由 | 入口 |
|---|---|---|
| 主窗（今日待办） | `/#/` | 直接打开 |
| 月历总览 | `/#/overview` | 标题栏「总览」按钮 |
| 垃圾箱 | `/#/trash` | 底栏垃圾箱图标 |
| 设置 | `/#/setting` | 底栏齿轮 / 菜单 |
| 浮窗 | `/#/mini` | 标题栏浮窗按钮 |
| 助手（完整版） | `/#/ai` | 主窗底栏星标 |

桌面版通过 Tauri 创建原生窗口，浏览器版用 `window.open` 打开对应的 Hash 路由，受浏览器弹窗策略限制。

## 功能

### 当前入口

| 功能 | 说明 |
|---|---|
| 待办 | 点列表下方的 `+`，直接在列表末尾输入。点「保存并继续」可在同一天连录多条，也可在输入行打开详情或取消。支持内联改名和给普通待办添加子项 |
| 搜索 | 主窗底栏可跨日期查标题和备注，并筛选未完成事项。点击结果跳到对应日期。重复待办的结果会指向实际出现的一天 |
| 排序与改期 | 拖动把手调整同层顺序。把普通父待办拖到日期栏时，子项随父待办改期 |
| 重复待办 | 每天、每周和每月。每周可选星期，每月可选日号，默认取任务日期 |
| 逐日完成 | 重复待办每天的完成状态独立记录 |
| 自动延期 | 全局开启后，启动或跨天时，允许自动延期的未完成普通待办会移到今天。详情里可单独关闭 |
| 周视图 | 七天等宽，角标显示每日未完成数。翻周时同步切换列表日期，停在今天时跨午夜会自动切到新的一天 |
| 月历总览 | 按与主窗一致的口径统计每日未完成数，包含当天出现的重复待办。显示农历与二十四节气，选日期会让主窗跳到对应的一天 |
| 倒计时 | 保存单次提醒的目标时间。Windows 播放所选声音，主窗在后台时弹出桌面提醒。在「设置 → 基础」可试听内置声音或导入 8 MB 以内的 WAV |
| 待办提醒 | 在待办详情设置当天的提醒时间，重复待办按每次出现分别提醒。程序运行或驻留托盘时会检查当天未完成事项 |
| 垃圾箱 | 按原日期汇总往日完成事项，包含重复待办的单日记录。可跳到原日期、恢复为未完成或永久删除 |
| 批量录入 | 从剪贴板读取或手动粘贴，自动去掉 Markdown 和编号前缀，确认预览后写入 |
| 导出 | Markdown、HTML、CSV |
| 数据备份 | 支持 MedoTask JSON 备份和 Kite SQLite 数据库，导入前预览数量与日期范围。覆盖或清空前保留本地恢复点 |
| 暗色模式 | 跟随设置，跨窗口同步 |
| AI 助手 | 完整版可主动连接本机 Codex、本地网关或兼容服务，把回答一键转为待办 |

### 与 Kite 0.2.0 的功能差异

| 项目 | Kite 0.2.0 原版 | MedoTask 1.0.0 |
|---|---|---|
| 本地数据 | Tauri SQLite 插件，可切换数据目录 | sql.js 与 IndexedDB，窗口间事务写入和刷新，可直接导入 Kite 的 SQLite 文件 |
| 联网能力 | WebDAV 同步、检查更新、厂商 AI 页面 | 待办数据在本地。助手默认接本地网关，可配置兼容服务并将回答转成待办 |
| 桌面能力 | 原生多窗口、系统级快捷键、托盘、开机自启、浮窗贴边与隐藏 | 原生开窗、最小化、标题栏拖动及部分窗口置顶。Windows 支持系统托盘、开机自启和浮窗贴边隐藏 |
| 日历 | 周视图、月历、农历和节气 | 周栏和月历均统计当天的未完成事项，包括重复待办 |

每月任务只在含所选日号的月份出现。旧版没有保存星期或日号的重复任务会按原定日期显示，编辑后保存即可明确规则。已有待办保留原来的自动延期设置。

Kite 主窗提供显示模式和批量导入确认。MedoTask 把日内筛选做成「只看未完成」按钮，未完成的子项仍显示父项上下文。批量录入可在预览时修改文本和确认目标日期，剪贴板不可用时可直接粘贴。

Windows 桌面版关闭主窗后仍驻留托盘。单击托盘图标打开主窗，右键菜单可快速新建待办、打开浮窗或退出。新建输入行使用展开时选中的日期。

在「设置 → 基础」开启「开机自启」后，登录 Windows 时应用驻留托盘。手动打开应用会显示主窗。

在「设置 → 浮窗」开启「贴边自动隐藏」后，将浮窗拖到屏幕左、上或右侧。鼠标移开时浮窗收成带短线的无字边条，短暂悬停或单击可展开。

左右边条收起后保留浮窗展开时的高度，宽度收至 6 逻辑像素。顶部边条收至 6 逻辑像素高。收缩中移回鼠标会从当前位置展开。系统减少动态效果时，浮窗和界面直接切换状态。

展开后可在浮窗直接新建、筛选和勾选待办，填写新事项期间浮窗保持展开。

Windows 记住主窗与浮窗展开时的位置和大小，以及浮窗的贴边方向。重新打开时，窗口会放进现有屏幕的工作区域。

主窗标题栏的图钉切换本次运行中的窗口置顶。Windows 浮窗使用半透明背景，可在「设置 → 浮窗」调整背景不透明度，文字和按钮保持实色。

## 工程结构

```
MedoTask/
├── src/
│   ├── main.js              启动：开库 → 装 Pinia → 挂载
│   ├── App.vue              主题和通知
│   ├── router.js            六个窗口的路由
│   ├── db/
│   │   ├── database.js      sql.js、IndexedDB 事务、迁移和窗口通知
│   │   └── todos.js         待办、重复记录和垃圾箱
│   ├── stores/
│   │   ├── todos.js         当前周、选中日、待办树、批量操作
│   │   ├── settings.js      点号键值设置，扁平化存储
│   │   └── toast.js         全局提示
│   ├── components/
│   │   ├── ui/              Button / Dialog / Dropdown / Popover / Switch / Tabs / Checkbox
│   │   ├── TitleBar.vue     自绘标题栏
│   │   ├── WeekTabs.vue     日期切换、周翻页与拖放接收
│   │   ├── TodoRow.vue      单行待办，内联编辑
│   │   ├── CountdownCard.vue 倒计时
│   │   ├── BottomBar.vue    底栏
│   │   ├── TodoEditorDialog.vue 详情编辑
│   │   ├── AboutDialog.vue
│   │   └── ToastHost.vue
│   ├── views/               六个窗口的页面
│   ├── composables/         useWindows
│   └── lib/                 colors / dates / lunar / transfer / assistant / util
├── src-tauri/             Rust 桌面壳、配置和图标
└── scripts/               网关、桌面启动与打包
```

## 数据

待办和设置表沿用了 Kite 的主要字段：

```sql
todos              id,title,completed,date,sort_order,content,parent_id,color,
                   repeat,repeat_days,repeat_start_date,repeat_end_date,postpone_auto,time,reminder_time
todo_repeat_items  id,todo_id,title,completed,date,sort_order,content,color,time,parent_id,...
todo_reminder_delivery  todo_id,date,time
draft_todos        id,title,completed,sort_order,content,parent_id,color
settings           key,value,updated_date
```

- `date` 使用 `YYYYMMDD` 作为日期键
- `repeat_days` 是逗号包裹的下标串（`,0,2,4,`）
- `settings` 用点号扁平键（`mainWindow.clickTitleAction`），读回来再还原成嵌套对象

数据是保存在 IndexedDB 中的 SQLite 快照。首次启动会迁移同一浏览器站点或 WebView2 配置中的旧版 MedoTask `localStorage` 数据库。窗口写入按事务提交，其他窗口在提交后刷新。

在 Kite 保存并退出后，打开 MedoTask「设置 → 数据 → 导入备份」，选择 Kite 数据目录下的 `kite.db`。导入保留日期、备注、颜色、父子关系、提醒时间和重复待办的单日记录。旧收集箱事项迁入导入当天，已有日期的事项保留原日期。确认后用导入数据替换当前数据，可用恢复点撤回。自定义 WAV 文件保存在桌面配置目录中，换设备时可重新选择。

## 完整版 AI 助手

在 Windows 打开「AI 助手 → 助手设置 → Codex 本机」。选择连接方式后点「保存并连接」。默认查找本机 Codex CLI，也可填写可执行文件的绝对路径。对话使用 CLI 已有登录，MedoTask 只发送助手中输入的对话。

新版 Codex 使用 [App Server](https://learn.chatgpt.com/docs/app-server) 的 JSON-RPC 连接。仍提供 `codex mcp-server` 的旧版 CLI 可选择「MCP（兼容旧版）」。[OpenAI 的迁移说明](https://learn.chatgpt.com/docs/mcp-server)

AI 面板默认连接本机助手，也可以连接配置的 OpenAI 兼容服务。附带的网关可以转发给本机或远端上游：

```powershell
$env:KITE_UPSTREAM = 'http://127.0.0.1:3128'
$env:KITE_MODEL = 'deepseek-v4.1-flash'
npm run gateway
```

然后在助手窗口的齿轮里把地址填成 `http://127.0.0.1:11434`。

支持的后端：

- **DeepSeek Harness** — profile 里的 `api: openai-completions` 就是 `/v1/chat/completions`，网关可直接转发
- **Ollama / llama.cpp / vLLM** — 任何 OpenAI 兼容端点
- **需要密钥的远端** — 配置 `KITE_UPSTREAM_KEY` 及独立的 `KITE_GATEWAY_TOKEN`，然后在助手设置的「访问令牌」填写网关令牌

网关默认监听 `127.0.0.1:11434`。启动时读取上游密钥，只将它用于上游请求。配置网关令牌后，客户端请求须携带该令牌。

> 助手功能需要上游可用。如果网关后面的服务没跑起来，面板会显示「未连接」，但不会影响其它功能。

# MedoTask

MedoTask 是面向 Windows 的本地待办应用，以 Kite 0.2.0 为交互参照，使用 Vue、SQLite 和 Tauri。待办、设置和提醒存于本机。[版本记录](https://github.com/Medo-bao/MedoTask/releases)

| 版本 | 功能 |
| --- | --- |
| 纯净版 | 待办、周视图、月历、提醒、浮窗、垃圾箱、备份和 Kite 数据迁移 |
| 完整版 | 包含纯净版功能，并提供 AI 助手。桌面版可连接本机 DeepSeek Harness 或 Codex，也可接 OpenAI 兼容接口 |

## 使用

- 点击主窗列表下方的「+」直接输入事项，点击「添加」或按回车提交。通过输入行的详情按钮设置备注、日期、重复或提醒。
- 垃圾箱按日期汇总往日已完成的事项，可按标题和备注搜索，也可恢复或永久删除。
- 可导出 Markdown、HTML 和 CSV。Windows 版支持托盘驻留、主窗置顶、浮窗贴边隐藏和自定义 WAV 提醒音。

## 从源码构建

Windows 桌面构建需要 Node.js、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 Windows SDK。运行需要 Windows 10 或更高版本及 WebView2。在仓库根目录执行以下命令。

```powershell
npm.cmd ci
npm.cmd run desktop:exe
npm.cmd run desktop:exe:clean
npm.cmd run package
```

桌面 EXE、桌面 ZIP、Web ZIP 和源码 ZIP 会输出到 `dist-release/`。两个桌面版本共用本机待办和设置。切换版本前，从托盘退出当前运行的 MedoTask。

Web 完整版和纯净版分别使用 `npm run build` 和 `npm run build:clean` 构建，产物位于 `dist/` 和 `dist-clean/`，可用 HTTP 服务托管。浏览器中的 DSH 选项使用配置的兼容网关。

## 备份与 Kite 迁移

打开「设置 → 数据」可导出本机 JSON 备份。迁移 Kite 时，在 Kite 保存后从同一页面导入 `kite.db`。确认前可预览事项数量和日期范围。导入会创建本地恢复点，原 Kite 收集箱事项安排到导入当天。

## 源码结构

| 路径 | 内容 |
| --- | --- |
| `src/` | Vue 界面、待办规则和本机数据库 |
| `src-tauri/` | Windows 窗口、托盘、提醒和助手连接 |
| `scripts/` | 打包、桌面启动和可选 AI 网关 |

GitHub Release 提供对应标签的源码归档。

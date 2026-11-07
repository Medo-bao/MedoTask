//! DeepSeek Harness link.
//!
//! The full edition can talk to a local DeepSeek Harness runtime instead of an
//! HTTP endpoint. DSH ships a stdio JSON-RPC profile for exactly this use:
//!
//!   dsh --profile sdk
//!
//! frames are newline-delimited JSON. The handshake is `initialize`, one turn
//! is `session/prompt`, and `session.event` notifications carry the session
//! log (`assistant/message`, `turn/end`, …). `shutdown` ends the runtime.
//!
//! The child runs inside MedoTask's own data directory with a read-only
//! sandbox, so the assistant cannot modify the user's files.

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

use crate::assistant_link::{stop_child, AssistantLink};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const REPLY_TIMEOUT: Duration = Duration::from_secs(300);
const PROVIDER: &str = "deepseek-official";
const DEFAULT_MODEL: &str = "deepseek-flash";

#[derive(Clone, Default)]
pub(crate) struct DshLink(AssistantLink<DshSession>);

impl DshLink {
    fn connect(
        &self,
        generation: u64,
        launcher: &Launcher,
        cwd: &Path,
        model: &str,
    ) -> Result<(), String> {
        if self.0.connect(
            generation,
            || DshSession::spawn(launcher, cwd),
            |session| session.initialize(cwd, model),
        )? {
            Ok(())
        } else {
            Err("DSH 已断开连接".into())
        }
    }
}

struct DshSession {
    child: Mutex<Child>,
    wire: Mutex<Wire>,
    diagnostics: Arc<Mutex<String>>,
}

impl DshSession {
    fn spawn(launcher: &Launcher, cwd: &Path) -> Result<Self, String> {
        // The runtime spills tool output to a temp directory; give it one inside
        // MedoTask's own data folder so a locked-down or sandboxed host still works.
        let scratch = cwd.join("tmp");
        std::fs::create_dir_all(&scratch).map_err(|err| format!("无法创建 dsh 临时目录：{err}"))?;
        let mut command = launcher.command();
        command
            .args(["--profile", "sdk"])
            .current_dir(cwd)
            .env("DSH_PERMISSION_MODE", "read-only")
            .env("TEMP", &scratch)
            .env("TMP", &scratch)
            .env("TMPDIR", &scratch)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // MedoTask may itself be started from a DSH shell. Those variables
        // describe *that* runtime (its profile, session and GUI), so the child
        // must not inherit them or it would attach to the wrong profile.
        for name in [
            "DSH_PROFILE",
            "DSH_PROFILE_DIR",
            "DSH_SESSION_ID",
            "DSH_SHELL",
            "DSH_WEB_URL",
            "DSH_LAUNCH_ENVIRONMENT",
        ] {
            command.env_remove(name);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|err| format!("无法启动 dsh：{err}"))?;
        let input = child.stdin.take().expect("piped DSH stdin");
        let stdout = child.stdout.take().expect("piped DSH stdout");
        let stderr = child.stderr.take().expect("piped DSH stderr");
        let (send, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(message) = serde_json::from_str(&line) {
                    if send.send(message).is_err() {
                        break;
                    }
                }
            }
        });
        // DSH writes boot diagnostics here; a hard exit is only diagnosable with it.
        let diagnostics = Arc::new(Mutex::new(String::new()));
        let sink = diagnostics.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut text) = sink.lock() {
                    if text.len() < 4000 {
                        text.push_str(&line);
                        text.push('\n');
                    }
                }
            }
        });

        let session_id = format!("medotask-{}", session_stamp());
        Ok(Self {
            child: Mutex::new(child),
            wire: Mutex::new(Wire {
                input,
                output,
                next_id: 0,
                session_id,
            }),
            diagnostics,
        })
    }

    fn initialize(&self, cwd: &Path, model: &str) -> Result<(), String> {
        self.wire
            .lock()
            .map_err(|err| err.to_string())?
            .initialize(cwd, model)
            .map_err(|err| {
                let mut detail = err;
                if let Ok(text) = self.diagnostics.lock() {
                    if !text.trim().is_empty() {
                        detail = format!("{detail}\n{}", text.trim());
                    }
                }
                detail
            })
    }

    fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            stop_child(&mut child);
        }
    }
}

impl Drop for DshSession {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Wire {
    input: ChildStdin,
    output: mpsc::Receiver<Value>,
    next_id: u64,
    session_id: String,
}

impl Wire {
    fn send(&mut self, message: Value) -> Result<(), String> {
        writeln!(self.input, "{message}").map_err(|err| format!("写入 dsh 失败：{err}"))
    }

    fn receive(&mut self, deadline: Instant) -> Result<Value, String> {
        self.output
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|err| match err {
                mpsc::RecvTimeoutError::Timeout => "等待 DSH 响应超时".to_owned(),
                mpsc::RecvTimeoutError::Disconnected => "DSH 已断开连接".to_owned(),
            })
    }

    /// Send one request and wait for its reply. Notifications that arrive in the
    /// meantime are handed to `on_notification` in wire order.
    fn request(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
        mut on_notification: impl FnMut(&Value),
    ) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params }))?;
        loop {
            let reply = self.receive(deadline)?;
            if reply["id"].as_u64() != Some(id) {
                on_notification(&reply);
                continue;
            }
            if let Some(error) = reply.get("error") {
                return Err(error["message"]
                    .as_str()
                    .unwrap_or("DSH 请求失败")
                    .to_owned());
            }
            return Ok(reply["result"].clone());
        }
    }

    fn initialize(&mut self, cwd: &Path, model: &str) -> Result<(), String> {
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let model = if model.trim().is_empty() {
            DEFAULT_MODEL
        } else {
            model.trim()
        };
        let reply = self.request(
            "initialize",
            json!({
                "cwd": cwd.to_string_lossy(),
                "provider": PROVIDER,
                "model": model,
            }),
            deadline,
            |_| {},
        )?;
        if reply["serverInfo"]["name"].as_str() != Some("deepseek-harness-sdk-runtime") {
            return Err("此 dsh 不是 DeepSeek Harness 的 SDK 运行时".into());
        }
        Ok(())
    }

    fn ask(
        &mut self,
        prompt: &str,
        instructions: &str,
        on_delta: &mut dyn FnMut(&str),
    ) -> Result<String, String> {
        let deadline = Instant::now() + REPLY_TIMEOUT;
        let text = if instructions.trim().is_empty() {
            prompt.to_owned()
        } else {
            format!("{}\n\n{}", instructions.trim(), prompt)
        };
        // `session/prompt` answers as soon as the turn is queued; anything the
        // runtime emits before that reply still belongs to this turn.
        let mut early = Vec::new();
        self.request(
            "session/prompt",
            json!({
                "sessionId": self.session_id,
                "contentBlocks": [{ "type": "text", "text": text }],
            }),
            deadline,
            |message| early.push(message.clone()),
        )?;

        let mut turn: Option<u64> = None;
        // `emitted` is everything already handed to the UI; `partial` is the
        // current assistant message, which DSH re-sends in full as it settles.
        let mut emitted = String::new();
        let mut partial = String::new();
        let mut partial_id = String::new();
        let mut early = early.into_iter();
        loop {
            let message = match early.next() {
                Some(message) => message,
                None => self.receive(deadline)?,
            };
            let Some(event) = event_of(&message, &self.session_id) else {
                continue;
            };
            match event["type"].as_str() {
                Some("turn/start") => turn = event["data"]["turn"].as_u64(),
                Some("assistant/message") => {
                    if turn.is_some() && event["data"]["turn"].as_u64() != turn {
                        continue;
                    }
                    let next = message_text(event);
                    if next.trim().is_empty() {
                        continue;
                    }
                    let id = event["data"]["message"]["id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    let delta = if id == partial_id && next.starts_with(partial.as_str()) {
                        next[partial.len()..].to_owned()
                    } else if emitted.is_empty() {
                        next.clone()
                    } else {
                        format!("\n\n{next}")
                    };
                    partial_id = id;
                    partial = next;
                    if !delta.is_empty() {
                        emitted.push_str(&delta);
                        on_delta(&delta);
                    }
                }
                Some("turn/end") => {
                    if turn.is_some_and(|turn| event["data"]["turn"].as_u64() != Some(turn)) {
                        continue;
                    }
                    let reason = &event["data"]["reason"];
                    match reason["kind"].as_str() {
                        Some("completed" | "max-tokens") => break,
                        Some(kind) => {
                            let detail = reason["error"]["message"]
                                .as_str()
                                .filter(|text| !text.is_empty())
                                .map(str::to_owned)
                                .unwrap_or_else(|| format!("DSH 未完成本次回复（{kind}）"));
                            return Err(detail);
                        }
                        None => break,
                    }
                }
                _ => {}
            }
        }
        let answer = emitted.trim().to_owned();
        if answer.is_empty() {
            return Err("DSH 没有返回文本".into());
        }
        Ok(answer)
    }
}

/// The `session.event` payload for this session, if the frame is one.
fn event_of<'a>(message: &'a Value, session_id: &str) -> Option<&'a Value> {
    if message["method"].as_str() != Some("session.event") {
        return None;
    }
    let params = &message["params"];
    if params["sessionId"].as_str() != Some(session_id) {
        return None;
    }
    Some(&params["event"])
}

/// Assistant text of one `assistant/message` event, reasoning excluded.
fn message_text(event: &Value) -> String {
    event["data"]["message"]["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("")
}

fn session_stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

/// How to launch the SDK runtime: a native executable or a script run by node.
enum Launcher {
    Exe(PathBuf),
    Script(PathBuf),
}

impl Launcher {
    fn command(&self) -> Command {
        match self {
            Self::Exe(path) => Command::new(path),
            Self::Script(path) => {
                let mut command = Command::new(node_program());
                command.arg(path);
                command
            }
        }
    }
}

fn node_program() -> String {
    if cfg!(windows) {
        "node.exe".into()
    } else {
        "node".into()
    }
}

/// Read the `bin.js` target out of an npm/pnpm generated `.cmd` shim.
fn script_of_shim(shim: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(shim).ok()?;
    let end = text.find("bin.js")? + "bin.js".len();
    let start = text[..end].rfind('"').map(|index| index + 1)?;
    let token = text[start..end].trim();
    if token.is_empty() {
        return None;
    }
    let dir = shim.parent()?;
    let expanded = token
        .replace("%~dp0", &format!("{}\\", dir.display()))
        .replace("%dp0%", &format!("{}\\", dir.display()))
        .replace('/', "\\");
    let path = PathBuf::from(expanded);
    // `canonicalize` answers in extended-length form (`\\?\C:\…`), which node
    // cannot use as a script path; strip the prefix back to a normal drive path.
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    let path = match path.to_string_lossy().strip_prefix(r"\\?\") {
        Some(stripped) => PathBuf::from(stripped),
        None => path,
    };
    path.is_file().then_some(path)
}

fn launcher_at(path: &Path) -> Option<Launcher> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let found = match extension.as_str() {
        "exe" => Some(Launcher::Exe(path.to_path_buf())),
        "cmd" | "bat" => script_of_shim(path).map(Launcher::Script),
        "js" | "cjs" | "mjs" => Some(Launcher::Script(path.to_path_buf())),
        _ => None,
    };
    found
}

fn launcher_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["dsh.exe", "dsh.cmd", "dsh.bat"]
    } else {
        &["dsh"]
    }
}

fn find_launcher(explicit: &str) -> Result<Launcher, String> {
    let explicit = explicit.trim().trim_matches('"');
    if !explicit.is_empty() {
        let path = PathBuf::from(explicit);
        if !path.is_absolute() || !path.is_file() {
            return Err("请选择 dsh 启动文件的绝对路径".into());
        }
        return launcher_at(&path)
            .ok_or_else(|| "无法从该文件启动 dsh，请选择 dsh.cmd、dsh.exe 或 bin.js".to_owned());
    }

    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .filter(|dir| dir.is_absolute())
        .flat_map(|dir| launcher_names().iter().map(move |name| dir.join(name)))
        .collect();
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(local.join("pnpm/bin/dsh.cmd"));
        }
        if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
            candidates.push(roaming.join("npm/dsh.cmd"));
        }
    }

    for candidate in &candidates {
        if !candidate.is_file() {
            continue;
        }
        if let Some(launcher) = launcher_at(candidate) {
            return Ok(launcher);
        }
    }
    Err("找不到 dsh。请安装 DeepSeek Harness CLI，或在设置里填写 dsh 启动文件路径".into())
}

fn require_assistant(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "ai" {
        Ok(())
    } else {
        Err("请从助手窗口连接 DSH".into())
    }
}

pub(crate) fn disconnect(app: &tauri::AppHandle) {
    if let Some(link) = app.try_state::<DshLink>() {
        if let Ok((_, Some(session))) = link.0.reset() {
            tauri::async_runtime::spawn_blocking(move || session.stop());
        }
    }
}

#[tauri::command]
pub(crate) async fn dsh_connect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DshLink>,
    path: String,
    model: String,
) -> Result<(), String> {
    require_assistant(&window)?;
    let cwd = super::webview_profile(window.app_handle())
        .map_err(|err| err.to_string())?
        .join("dsh-work");
    let link = state.inner().clone();
    let (generation, previous) = link.0.reset()?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(session) = previous {
            session.stop();
        }
        let launcher = find_launcher(&path)?;
        link.connect(generation, &launcher, &cwd, &model)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn dsh_chat(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DshLink>,
    prompt: String,
    instructions: String,
    on_delta: Option<tauri::ipc::JavaScriptChannelId>,
) -> Result<String, String> {
    require_assistant(&window)?;
    let session = state.0.session()?.ok_or("请先连接 DSH")?;
    let channel = on_delta.map(|id| id.channel_on::<_, String>(window.as_ref().clone()));
    tauri::async_runtime::spawn_blocking(move || {
        let mut wire = session.wire.lock().map_err(|err| err.to_string())?;
        let mut emit = |delta: &str| {
            if let Some(channel) = &channel {
                let _ = channel.send(delta.to_owned());
            }
        };
        wire.ask(&prompt, &instructions, &mut emit)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn dsh_disconnect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DshLink>,
) -> Result<(), String> {
    require_assistant(&window)?;
    if let Some(session) = state.0.reset()?.1 {
        tauri::async_runtime::spawn_blocking(move || session.stop())
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

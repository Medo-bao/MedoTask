use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

use crate::assistant_link::{stop_child, AssistantLink};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const REPLY_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Transport {
    AppServer,
    Mcp,
}

impl Transport {
    fn command(self) -> &'static str {
        match self {
            Self::AppServer => "app-server",
            Self::Mcp => "mcp-server",
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct CodexLink(AssistantLink<Session>);

struct Session {
    child: Mutex<Child>,
    wire: Mutex<Wire>,
}

impl Session {
    fn spawn(executable: &Path, cwd: &Path, transport: Transport) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .arg(transport.command())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|err| err.to_string())?;
        let input = child.stdin.take().expect("piped Codex stdin");
        let stdout = child.stdout.take().expect("piped Codex stdout");
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
        Ok(Self {
            child: Mutex::new(child),
            wire: Mutex::new(Wire {
                input,
                output,
                transport,
                next_id: 0,
                thread_id: None,
            }),
        })
    }

    fn initialize(&self) -> Result<(), String> {
        self.wire
            .lock()
            .map_err(|err| err.to_string())?
            .initialize()
    }

    fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            stop_child(&mut child);
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Wire {
    input: ChildStdin,
    output: mpsc::Receiver<Value>,
    transport: Transport,
    next_id: u64,
    thread_id: Option<String>,
}

impl Wire {
    fn send(&mut self, mut message: Value) -> Result<(), String> {
        if self.transport == Transport::Mcp {
            message["jsonrpc"] = json!("2.0");
        }
        writeln!(self.input, "{message}").map_err(|err| err.to_string())
    }

    fn receive(&mut self, deadline: Instant) -> Result<Value, String> {
        let message = self
            .output
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|err| match err {
                mpsc::RecvTimeoutError::Timeout => "等待 Codex 响应超时".to_owned(),
                mpsc::RecvTimeoutError::Disconnected => "Codex 已断开连接".to_owned(),
            })?;
        if let (Some(id), Some(_)) = (message.get("id"), message.get("method")) {
            // Neither transport is granted interactive approvals by MedoTask.
            self.send(json!({ "id": id, "error": { "code": -32601, "message": "Client request not supported" } }))?;
        }
        Ok(message)
    }

    fn request(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
        mut on_event: impl FnMut(Value),
    ) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params }))?;
        loop {
            let reply = self.receive(deadline)?;
            if reply["id"].as_u64() != Some(id) || reply.get("method").is_some() {
                on_event(reply);
                continue;
            }
            if let Some(error) = reply.get("error") {
                return Err(error["message"]
                    .as_str()
                    .unwrap_or("Codex 请求失败")
                    .to_owned());
            }
            return Ok(reply["result"].clone());
        }
    }

    fn initialize(&mut self) -> Result<(), String> {
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let client = json!({ "name": "medotask", "title": "MedoTask", "version": env!("CARGO_PKG_VERSION") });
        if self.transport == Transport::AppServer {
            self.request(
                "initialize",
                json!({ "clientInfo": client }),
                deadline,
                |_| {},
            )?;
            return self.send(json!({ "method": "initialized" }));
        }
        let reply = self.request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "clientInfo": client, "capabilities": {} }),
            deadline,
            |_| {},
        )?;
        if !matches!(
            reply["protocolVersion"].as_str(),
            Some("2025-06-18" | "2025-03-26" | "2024-11-05")
        ) {
            return Err("此 Codex 返回了不支持的 MCP 协议版本".into());
        }
        self.send(json!({ "method": "notifications/initialized" }))?;
        let reply = self.request("tools/list", json!({}), deadline, |_| {})?;
        if reply["tools"].as_array().is_some_and(|tools| {
            tools.iter().any(|tool| tool["name"] == "codex")
                && tools.iter().any(|tool| tool["name"] == "codex-reply")
        }) {
            Ok(())
        } else {
            Err("此 MCP 服务缺少 Codex 对话工具".into())
        }
    }

    fn ask(&mut self, prompt: &str, instructions: &str) -> Result<String, String> {
        let deadline = Instant::now() + REPLY_TIMEOUT;
        let first_prompt = || format!("{instructions}\n\n{prompt}");
        if self.transport == Transport::Mcp {
            let (name, arguments) = match &self.thread_id {
                Some(id) => ("codex-reply", json!({ "threadId": id, "prompt": prompt })),
                None => (
                    "codex",
                    json!({
                        "prompt": first_prompt(), "sandbox": "read-only", "approval-policy": "never"
                    }),
                ),
            };
            let reply = self.request(
                "tools/call",
                json!({ "name": name, "arguments": arguments }),
                deadline,
                |_| {},
            )?;
            let structured = &reply["structuredContent"];
            let message = structured["content"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    reply["content"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|part| part["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                });
            if reply["isError"] == true {
                return Err(if message.is_empty() {
                    "Codex MCP 调用失败".into()
                } else {
                    message
                });
            }
            if let Some(id) = structured["threadId"].as_str() {
                self.thread_id = Some(id.into());
            }
            return nonempty_reply(message);
        }

        let first_turn = self.thread_id.is_none();
        if first_turn {
            let reply = self.request(
                "thread/start",
                json!({
                    "sandbox": "read-only", "approvalPolicy": "never", "ephemeral": true
                }),
                deadline,
                |_| {},
            )?;
            self.thread_id = Some(
                reply["thread"]["id"]
                    .as_str()
                    .ok_or("Codex 没有返回会话 ID")?
                    .to_owned(),
            );
        }
        let thread_id = self.thread_id.clone().ok_or("Codex 没有返回会话 ID")?;
        let text = if first_turn {
            first_prompt()
        } else {
            prompt.to_owned()
        };
        let mut early = Vec::new();
        let reply = self.request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": text, "text_elements": [] }]
            }),
            deadline,
            |message| early.push(message),
        )?;
        let turn_id = reply["turn"]["id"]
            .as_str()
            .ok_or("Codex 没有返回消息 ID")?;
        let mut early = early.into_iter();
        let mut answer = String::new();
        loop {
            let message = match early.next() {
                Some(message) => message,
                None => self.receive(deadline)?,
            };
            let params = &message["params"];
            if params["threadId"] != thread_id {
                continue;
            }
            match message["method"].as_str() {
                Some("item/completed") if params["turnId"] == turn_id => {
                    let item = &params["item"];
                    if item["type"] == "agentMessage" && item["phase"] != "commentary" {
                        if let Some(text) = item["text"].as_str() {
                            answer = text.to_owned();
                        }
                    }
                }
                Some("turn/completed") if params["turn"]["id"] == turn_id => {
                    let turn = &params["turn"];
                    if turn["status"] != "completed" {
                        return Err(turn["error"]["message"]
                            .as_str()
                            .unwrap_or("Codex 未完成本次回复")
                            .to_owned());
                    }
                    return nonempty_reply(answer);
                }
                _ => {}
            }
        }
    }
}

fn nonempty_reply(reply: String) -> Result<String, String> {
    if reply.trim().is_empty() {
        Err("Codex 没有返回文本".into())
    } else {
        Ok(reply)
    }
}

fn subdirectories(path: PathBuf) -> Vec<PathBuf> {
    let mut directories: Vec<_> = std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    directories.sort_by(|a, b| b.cmp(a));
    directories
}

fn executables(path: &str) -> Result<Vec<PathBuf>, String> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    let path = path.trim().trim_matches('"');
    if !path.is_empty() {
        let path = PathBuf::from(path);
        if !path.is_absolute()
            || !path.is_file()
            || (cfg!(windows)
                && !path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("exe")))
        {
            return Err("请选择 Codex 可执行文件的绝对路径（Windows 为 .exe）".into());
        }
        return Ok(vec![path]);
    }
    let mut candidates: Vec<_> = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .collect();
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        if let Some(local) = &local {
            candidates.extend(
                subdirectories(local.join("OpenAI/Codex/bin"))
                    .into_iter()
                    .map(|dir| dir.join(name)),
            );
        }
        let npm = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|dir| dir.join("npm/node_modules/@openai/codex"));
        let volta = std::env::var_os("VOLTA_HOME")
            .map(PathBuf::from)
            .or_else(|| local.map(|dir| dir.join("Volta")))
            .map(|dir| dir.join("tools/image/packages/@openai/codex/node_modules/@openai/codex"));
        for root in npm.into_iter().chain(volta) {
            for architecture in ["x64", "arm64"] {
                let vendor = root.join(format!(
                    "node_modules/@openai/codex-win32-{architecture}/vendor"
                ));
                candidates.extend(
                    subdirectories(vendor)
                        .into_iter()
                        .map(|dir| dir.join("bin").join(name)),
                );
            }
        }
    }
    let mut found = Vec::new();
    for candidate in candidates {
        if candidate.is_file() && !found.contains(&candidate) {
            found.push(candidate);
        }
    }
    if found.is_empty() {
        return Err("找不到 Codex CLI，请安装 Codex 或填写可执行文件路径".into());
    }
    Ok(found)
}

fn require_assistant(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "ai" {
        Ok(())
    } else {
        Err("请从助手窗口连接 Codex".into())
    }
}

pub(crate) fn disconnect(app: &tauri::AppHandle) {
    if let Some(link) = app.try_state::<CodexLink>() {
        if let Ok((_, Some(session))) = link.0.reset() {
            tauri::async_runtime::spawn_blocking(move || session.stop());
        }
    }
}

#[tauri::command]
pub(crate) async fn codex_connect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CodexLink>,
    transport: Transport,
    path: String,
) -> Result<(), String> {
    require_assistant(&window)?;
    let cwd = super::webview_profile(window.app_handle())
        .map_err(|err| err.to_string())?
        .join("codex-work");
    let link = state.inner().clone();
    let (generation, previous) = link.0.reset()?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(session) = previous {
            session.stop();
        }
        let candidates = executables(&path)?;
        std::fs::create_dir_all(&cwd).map_err(|err| err.to_string())?;
        let mut last_error = String::new();
        for candidate in candidates {
            match link.0.connect(
                generation,
                || Session::spawn(&candidate, &cwd, transport),
                Session::initialize,
            ) {
                Ok(true) => return Ok(()),
                Ok(false) => return Err("Codex 已断开连接".into()),
                Err(err) => last_error = err,
            }
        }
        let hint = match transport {
            Transport::Mcp => "请使用支持 codex mcp-server 的 CLI，或切换到 App Server",
            Transport::AppServer => "请检查 Codex CLI 路径和版本",
        };
        Err(format!("Codex 连接失败。{hint}。{last_error}"))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn codex_chat(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CodexLink>,
    prompt: String,
    instructions: String,
) -> Result<String, String> {
    require_assistant(&window)?;
    let session = state.0.session()?.ok_or("请先连接 Codex")?;
    tauri::async_runtime::spawn_blocking(move || {
        session
            .wire
            .lock()
            .map_err(|err| err.to_string())?
            .ask(&prompt, &instructions)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn codex_disconnect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CodexLink>,
) -> Result<(), String> {
    require_assistant(&window)?;
    if let Some(session) = state.0.reset()?.1 {
        tauri::async_runtime::spawn_blocking(move || session.stop())
            .await
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

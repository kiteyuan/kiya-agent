use std::{
    env,
    io::{BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Manager};
use serde_json::json;

#[derive(Clone)]
pub struct ServiceManager {
    aria2_state: Arc<Mutex<String>>,
    local_mcp_state: Arc<Mutex<String>>,
    logs: Arc<Mutex<Vec<String>>>,
    aria2_child: Arc<Mutex<Option<Child>>>,
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self {
            aria2_state: Arc::new(Mutex::new("starting".into())),
            local_mcp_state: Arc::new(Mutex::new("starting".into())),
            logs: Arc::new(Mutex::new(vec![
                "[bootstrap] preparing aria2 runtime".into(),
                "[bootstrap] preparing local mcp runtime".into(),
            ])),
            aria2_child: Arc::new(Mutex::new(None)),
        }
    }
}

pub type SharedServiceManager = Arc<ServiceManager>;

impl ServiceManager {
    pub fn aria2_state(&self) -> String {
        self.aria2_state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| "error".into())
    }

    pub fn local_mcp_state(&self) -> String {
        self.local_mcp_state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| "error".into())
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.clone())
            .unwrap_or_else(|_| vec!["[bootstrap] failed to read service logs".into()])
    }

    pub fn ensure_aria2_started(&self, paths: &RuntimePaths) -> Result<(), String> {
        if is_port_open("127.0.0.1:16800") {
            self.set_aria2_state("ready");
            return Ok(());
        }

        if let Some(program) = &paths.aria2_executable {
            self.push_log(format!(
                "[bootstrap] starting packaged aria2 from {}",
                program.display()
            ));
            let child = Command::new(program)
                .args([
                    "--enable-rpc",
                    "--rpc-listen-all=false",
                    "--rpc-listen-port=16800",
                    "--continue=true",
                    "--summary-interval=0",
                ])
                .arg(format!("--dir={}", paths.download_dir.display()))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("启动 aria2 失败: {error}"))?;
            if let Ok(mut slot) = self.aria2_child.lock() {
                *slot = Some(child);
            }
        } else {
            self.push_log(format!(
                "[bootstrap] packaged aria2 missing for {}, fallback to {}",
                paths.runtime_target,
                paths.mock_aria2_script.display()
            ));
            let child = Command::new(&paths.node_program)
                .arg(&paths.mock_aria2_script)
                .current_dir(&paths.project_root)
                .env("KIYA_DOWNLOAD_DIR", &paths.download_dir)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("启动 mock aria2 失败: {error}"))?;
            if let Ok(mut slot) = self.aria2_child.lock() {
                *slot = Some(child);
            }
        }

        for _ in 0..20 {
            if is_port_open("127.0.0.1:16800") {
                self.set_aria2_state("ready");
                self.push_log("[bootstrap] aria2 ready");
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }

        self.set_aria2_state("error");
        Err("aria2 启动后未能监听 16800 端口".into())
    }

    pub fn validate_local_mcp(&self, paths: &RuntimePaths) -> Result<(), String> {
        self.push_log(format!(
            "[bootstrap] validating local mcp script {}",
            paths.local_mcp_script.display()
        ));

        let mut child = Command::new(&paths.node_program)
            .arg(&paths.local_mcp_script)
            .current_dir(&paths.project_root)
            .env("KIYA_DOWNLOAD_DIR", &paths.download_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("启动 local mcp 校验进程失败: {error}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "local mcp stdin 不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "local mcp stdout 不可用".to_string())?;
        let mut reader = BufReader::new(stdout);

        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        });
        stdin
            .write_all(format!("{payload}\n").as_bytes())
            .map_err(|error| format!("写入 local mcp 初始化命令失败: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("刷新 local mcp 初始化命令失败: {error}"))?;

        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| format!("读取 local mcp 初始化响应失败: {error}"))?;
        let _ = child.kill();

        if line.contains("\"serverInfo\"") {
            self.set_local_mcp_state("ready");
            self.push_log("[bootstrap] local mcp ready");
            return Ok(());
        }

        self.set_local_mcp_state("error");
        Err("local mcp 初始化响应不符合预期".into())
    }

    fn set_aria2_state(&self, value: &str) {
        if let Ok(mut state) = self.aria2_state.lock() {
            *state = value.into();
        }
    }

    fn set_local_mcp_state(&self, value: &str) {
        if let Ok(mut state) = self.local_mcp_state.lock() {
            *state = value.into();
        }
    }

    fn push_log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(message.into());
        }
    }
}

pub fn spawn_managed_services(state: SharedServiceManager, app: AppHandle) {
    thread::spawn(move || {
        let paths = RuntimePaths::from_app(&app);

        if let Err(error) = state.ensure_aria2_started(&paths) {
            state.set_aria2_state("error");
            state.push_log(format!("[bootstrap] {error}"));
        }

        if let Err(error) = state.validate_local_mcp(&paths) {
            state.set_local_mcp_state("error");
            state.push_log(format!("[bootstrap] {error}"));
        }
    });
}

pub struct RuntimePaths {
    pub project_root: PathBuf,
    pub local_mcp_script: PathBuf,
    pub mock_aria2_script: PathBuf,
    pub aria2_executable: Option<PathBuf>,
    pub node_program: PathBuf,
    pub download_dir: PathBuf,
    pub runtime_target: String,
}

impl RuntimePaths {
    fn from_app(app: &AppHandle) -> Self {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir.clone());
        let resource_dir = app.path().resource_dir().ok();
        let resource_paths = resource_dir
            .as_ref()
            .map(|dir| vec![dir.clone()])
            .unwrap_or_default();
        Self::resolve(project_root, resource_paths)
    }

    pub fn from_command(app: &AppHandle) -> Self {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir.clone());
        let resource_dir = app.path().resource_dir().ok();
        let resource_paths = resource_dir
            .as_ref()
            .map(|dir| vec![dir.clone()])
            .unwrap_or_default();
        Self::resolve(project_root, resource_paths)
    }

    pub fn default_download_dir() -> PathBuf {
        home_dir()
            .unwrap_or_else(env::temp_dir)
            .join("Downloads")
    }

    pub fn runtime_target() -> String {
        let os = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };

        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        };

        format!("{os}-{arch}")
    }

    fn resolve(project_root: PathBuf, resource_paths: Vec<PathBuf>) -> Self {
        let resource_candidates = resource_paths
            .into_iter()
            .chain(std::iter::once(
                project_root.join("src-tauri").join("resources"),
            ))
            .collect::<Vec<_>>();

        let local_mcp_script = first_existing(
            resource_candidates
                .iter()
                .map(|dir| dir.join("local-mcp.js"))
                .chain(std::iter::once(
                    project_root.join("local-mcp").join("src").join("index.js"),
                ))
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|| project_root.join("local-mcp").join("src").join("index.js"));

        let mock_aria2_script = first_existing(
            resource_candidates
                .iter()
                .map(|dir| dir.join("mock-aria2-rpc.mjs"))
                .chain(std::iter::once(
                    project_root
                        .join("src-tauri")
                        .join("dev-bin")
                        .join("mock-aria2-rpc.mjs"),
                ))
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|| {
            project_root
                .join("src-tauri")
                .join("dev-bin")
                .join("mock-aria2-rpc.mjs")
        });

        let aria2_executable = first_existing(
            resource_candidates
                .iter()
                .flat_map(|dir| {
                    [
                        dir.join("aria2c.exe"),
                        dir.join("aria2.exe"),
                        dir.join("aria2c"),
                        dir.join("aria2"),
                    ]
                })
                .collect::<Vec<_>>(),
        );

        let node_program = first_existing(
            resource_candidates
                .iter()
                .flat_map(|dir| [dir.join("node.exe"), dir.join("node")])
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|| PathBuf::from("node"));

        Self {
            project_root,
            local_mcp_script,
            mock_aria2_script,
            aria2_executable,
            node_program,
            download_dir: Self::default_download_dir(),
            runtime_target: Self::runtime_target(),
        }
    }
}

fn first_existing<I>(candidates: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = PathBuf>,
{
    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
}

fn is_port_open(address: &str) -> bool {
    match address.to_socket_addrs() {
        Ok(mut addrs) => addrs
            .next()
            .and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(200)).ok())
            .is_some(),
        Err(_) => false,
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

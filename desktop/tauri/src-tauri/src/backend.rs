use crate::profile::{open_file, Profile};
#[cfg(unix)]
use std::os::unix::{fs::PermissionsExt, process::CommandExt};
#[cfg(windows)]
#[path = "backend_windows.rs"]
mod windows;
use std::{
    fs::OpenOptions,
    io::{self, Read},
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::Url;

pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(62);

pub fn parse_ready(line: &[u8]) -> Option<Url> {
    let port = line.strip_prefix(b"SUMI_READY http://127.0.0.1:")?;
    if port.is_empty() || !port.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let port = std::str::from_utf8(port).ok()?;
    let number: u16 = port.parse().ok()?;
    if number == 0 || number.to_string() != port {
        return None;
    }
    Url::parse(&format!("http://127.0.0.1:{port}")).ok()
}

fn read_ready(mut stdout: impl Read, sender: mpsc::SyncSender<Url>) -> io::Result<()> {
    let mut buffer = [0; 4096];
    let mut line = Vec::with_capacity(256);
    let mut overflow = false;
    let mut ready = false;
    loop {
        let count = stdout.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if ready {
            continue;
        }
        for &byte in &buffer[..count] {
            if byte == b'\n' {
                if !overflow {
                    if let Some(origin) = parse_ready(&line) {
                        let _ = sender.try_send(origin);
                        ready = true;
                        break;
                    }
                }
                line.clear();
                overflow = false;
            } else if line.len() < 256 {
                line.push(byte);
            } else {
                overflow = true;
            }
        }
    }
    Ok(())
}

pub struct Backend {
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: windows::Job,
    stopping: AtomicBool,
}

impl Backend {
    pub fn spawn(
        runtime: &Path,
        profile: &Profile,
        home: &Path,
    ) -> io::Result<(Arc<Self>, Receiver<Url>)> {
        let node = runtime.join(if cfg!(windows) {
            "runtime/node.exe"
        } else {
            "runtime/node"
        });
        let launch = runtime.join("launch.cjs");
        for file in [&node, &launch, &runtime.join("server/apps/web/server.js")] {
            if !file.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("staged runtime is missing {}", file.display()),
                ));
            }
        }
        let log = open_file(
            &profile.dir.join("tauri-desktop.log"),
            OpenOptions::new().append(true).create(true),
        )?;
        #[cfg(unix)]
        log.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        let mut cmd = Command::new(node);
        cmd.arg(launch)
            .current_dir(&profile.dir)
            .env_clear()
            .env("HOME", home)
            .env("TMPDIR", std::env::temp_dir())
            .env(
                "LANG",
                std::env::var_os("LANG").unwrap_or_else(|| "en_US.UTF-8".into()),
            )
            .env("JOURNAL_DATA_DIR", &profile.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(log);
        #[cfg(unix)]
        cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .process_group(0);
        #[cfg(windows)]
        for variable in [
            "SystemRoot",
            "WINDIR",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
        ] {
            if let Some(value) = std::env::var_os(variable) {
                cmd.env(variable, value);
            }
        }
        if profile.test {
            cmd.env("SUMI_TEST_MODE", "1");
        }
        #[cfg(unix)]
        let mut child = cmd.spawn()?;
        #[cfg(windows)]
        let (mut child, job) = windows::Job::spawn(&mut cmd)?;
        let stdout = child.stdout.take().expect("piped stdout");
        let backend = Arc::new(Self {
            child: Mutex::new(Some(child)),
            #[cfg(windows)]
            job,
            stopping: AtomicBool::new(false),
        });
        let (tx, rx) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("sumi-readiness".into())
            .spawn(move || {
                if let Err(e) = read_ready(stdout, tx) {
                    eprintln!("Sumi readiness pipe failed: {e}");
                }
            })?;
        Ok((backend, rx))
    }

    pub fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    pub fn status(&self) -> io::Result<Option<ExitStatus>> {
        match self.child.lock().unwrap().as_mut() {
            Some(child) => child.try_wait(),
            None => Ok(None),
        }
    }

    pub fn stop(&self) {
        if self.stopping.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(mut child) = self.child.lock().unwrap().take() else {
            return;
        };
        #[cfg(unix)]
        stop_group(&mut child);
        #[cfg(windows)]
        self.job.stop(&mut child);
    }
}

#[cfg(unix)]
fn stop_group(child: &mut Child) {
    use std::time::Instant;
    let group = -(child.id() as libc::pid_t);
    // Signal the entire process group so future backend helpers cannot survive shutdown.
    unsafe { libc::kill(group, libc::SIGTERM) };
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let reaped = child.try_wait().ok().flatten().is_some();
        if reaped && unsafe { libc::kill(group, 0) } != 0 {
            return;
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    unsafe { libc::kill(group, libc::SIGKILL) };
    let _ = child.wait();
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readiness_is_one_exact_loopback_line() {
        assert_eq!(
            parse_ready(b"SUMI_READY http://127.0.0.1:49152")
                .unwrap()
                .port(),
            Some(49152)
        );
        for suffix in [
            "0", "65536", "080", "80 ", "80/", "80?x", "80\r", "80.evil", "80@evil",
        ] {
            assert!(
                parse_ready(format!("SUMI_READY http://127.0.0.1:{suffix}").as_bytes()).is_none()
            );
        }
        assert!(parse_ready(b"SUMI_READY http://localhost:1234").is_none());
        assert!(parse_ready(b" SUMI_READY http://127.0.0.1:1234").is_none());
    }

    #[test]
    fn overlong_or_partial_stdout_cannot_spoof_readiness() {
        let input = format!(
            "{}SUMI_READY http://127.0.0.1:1234\nSUMI_READY http://127.0.0.1:1235",
            "x".repeat(500)
        );
        let (tx, rx) = mpsc::sync_channel(1);
        read_ready(input.as_bytes(), tx).unwrap();
        assert!(rx.try_recv().is_err());
    }
}

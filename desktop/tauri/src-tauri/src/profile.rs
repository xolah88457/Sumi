use serde_json::{Map, Value};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::{
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MAX_PREFERENCES_BYTES: usize = 65_536;
pub const SMOKE_FILE: &str = "tauri-smoke.json";

pub struct Profile {
    pub dir: PathBuf,
    pub test: bool,
    pub smoke: bool,
    _lock: fs::File,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn canonical_existing_prefix(path: &Path) -> io::Result<PathBuf> {
    match path.canonicalize() {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Do not treat a broken symlink as a missing ordinary path component.
            if path.symlink_metadata().is_ok() {
                return Err(error);
            }
            let parent = path
                .parent()
                .ok_or_else(|| invalid("invalid profile path"))?;
            let name = path
                .file_name()
                .ok_or_else(|| invalid("invalid profile name"))?;
            Ok(canonical_existing_prefix(parent)?.join(name))
        }
        Err(error) => Err(error),
    }
}

fn select_test_dir(candidate: &Path, temp: &Path, production: &Path) -> io::Result<PathBuf> {
    if !candidate.is_absolute() {
        return Err(invalid(
            "SUMI_TEST_MODE=1 requires absolute JOURNAL_DATA_DIR",
        ));
    }
    let candidate = candidate.canonicalize()?;
    let temp = temp.canonicalize()?;
    let production = canonical_existing_prefix(production)?;
    // Canonical path checks catch symlinks; inode checks also catch case and
    // normalization aliases on APFS without treating a sibling prefix as a child.
    if contains(&production, &candidate) || contains(&candidate, &production) {
        return Err(invalid("SUMI_TEST_MODE=1 rejects the production profile"));
    }
    if contains(&candidate, &temp) || !contains(&temp, &candidate) || !candidate.is_dir() {
        return Err(invalid(
            "JOURNAL_DATA_DIR must be an existing strict temp subdirectory",
        ));
    }
    // The backend also writes inside this tree. Refuse preseeded links (including
    // hardlinks to regular files) rather than following them into other profiles.
    reject_link_entries(&candidate)?;
    Ok(candidate)
}

#[cfg(unix)]
fn contains(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
        || root.metadata().is_ok_and(|root| {
            path.ancestors().any(|ancestor| {
                ancestor
                    .metadata()
                    .is_ok_and(|m| (m.dev(), m.ino()) == (root.dev(), root.ino()))
            })
        })
}

#[cfg(windows)]
fn contains(root: &Path, path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};
    // Keep component boundaries, and compare Windows names without lossy Unicode folding.
    let mut parts = path.components();
    root.components().all(|root| {
        parts.next().is_some_and(|part| {
            let a: Vec<u16> = root.as_os_str().encode_wide().collect();
            let b: Vec<u16> = part.as_os_str().encode_wide().collect();
            (unsafe {
                CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1)
            }) == CSTR_EQUAL
        })
    })
}

#[cfg(target_os = "macos")]
fn system_temp_dir() -> io::Result<PathBuf> {
    // Use the OS-assigned root, not an arbitrary inherited TMPDIR.
    let output = Command::new("/usr/bin/getconf")
        .arg("DARWIN_USER_TEMP_DIR")
        .output()?;
    let path = std::str::from_utf8(&output.stdout)
        .map_err(io::Error::other)?
        .trim();
    if !output.status.success() || !Path::new(path).is_absolute() {
        return Err(invalid("Cannot determine the macOS temporary directory"));
    }
    Ok(PathBuf::from(path))
}

#[cfg(target_os = "linux")]
fn system_temp_dir() -> io::Result<PathBuf> {
    // Unlike std::env::temp_dir(), this is independent of inherited TMPDIR.
    Ok(PathBuf::from("/tmp"))
}

#[cfg(windows)]
fn system_temp_dir() -> io::Result<PathBuf> {
    // GetTempPath honors arbitrary TMP/TEMP overrides; use the OS-known user temp root.
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, ptr::null_mut};
    use windows_sys::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_LocalAppData, SHGetKnownFolderPath},
    };
    let mut ptr = null_mut();
    let hr = unsafe { SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, null_mut(), &mut ptr) };
    if hr < 0 || ptr.is_null() {
        return Err(io::Error::other(format!(
            "Cannot determine Local AppData: {hr:#x}"
        )));
    }
    let path = unsafe {
        let len = (0..).find(|&i| *ptr.add(i) == 0).unwrap();
        let path = OsString::from_wide(std::slice::from_raw_parts(ptr, len));
        CoTaskMemFree(ptr.cast());
        PathBuf::from(path).join("Temp")
    };
    Ok(path)
}

#[cfg(unix)]
fn regular_unlinked(_path: &Path, metadata: &fs::Metadata) -> io::Result<bool> {
    Ok(metadata.is_file() && metadata.nlink() == 1)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(windows)]
fn regular_unlinked(path: &Path, metadata: &fs::Metadata) -> io::Result<bool> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    if !metadata.is_file() || is_reparse_point(metadata) {
        return Ok(false);
    }
    let file = open_regular(path)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info.nNumberOfLinks == 1)
}

fn reject_link_entries(dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let m = path.symlink_metadata()?;
        #[cfg(windows)]
        if is_reparse_point(&m) {
            return Err(invalid("test profile contains a reparse point"));
        }
        if m.is_dir() {
            reject_link_entries(&path)?;
        } else if !regular_unlinked(&path, &m)? {
            return Err(invalid("test profile contains a link or special file"));
        }
    }
    Ok(())
}

/// Journal data directory shared with the former Electron app, so an existing journal is
/// found as is: macOS `~/Library/Application Support/Sumi`, Linux
/// `$XDG_CONFIG_HOME/Sumi` (else `~/.config/Sumi`), Windows `%APPDATA%\Sumi`.
fn production_dir(home: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    return home.join("Library/Application Support/Sumi");
    #[cfg(target_os = "linux")]
    return app_data_dir(home.join(".config"), env::var_os("XDG_CONFIG_HOME"));
    #[cfg(windows)]
    return app_data_dir(home.join("AppData/Roaming"), env::var_os("APPDATA"));
}

#[cfg(not(target_os = "macos"))]
fn app_data_dir(default: PathBuf, supplied: Option<std::ffi::OsString>) -> PathBuf {
    supplied
        .map(|path| match path.to_str() {
            Some(path) => PathBuf::from(path.trim()),
            None => PathBuf::from(path),
        })
        .filter(|path| path.is_absolute())
        .unwrap_or(default)
        .join("Sumi")
}

impl Profile {
    pub fn open(home: &Path) -> io::Result<Self> {
        let production = production_dir(home);
        let test = env::var_os("SUMI_TEST_MODE").is_some_and(|v| v == "1");
        let smoke = test && env::var_os("SUMI_TAURI_SMOKE").is_some_and(|v| v == "1");
        let dir = if test {
            let supplied = env::var_os("JOURNAL_DATA_DIR").unwrap_or_default();
            select_test_dir(Path::new(&supplied), &system_temp_dir()?, &production)?
        } else {
            production
        };
        Self::at(dir, test, smoke)
    }

    /// Opens (creating if needed) the profile at `dir` and takes its single-instance lock.
    /// Existing files, including an Electron-era journal, are never modified or removed.
    pub(crate) fn at(dir: PathBuf, test: bool, smoke: bool) -> io::Result<Self> {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        builder.recursive(true).create(&dir)?;
        #[cfg(unix)]
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        let lock = open_file(
            &dir.join("tauri.lock"),
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false),
        )?;
        // Keep the exclusive advisory lock until the backend has stopped.
        lock.try_lock().map_err(io::Error::from)?;
        if smoke {
            for name in [SMOKE_FILE, crate::SMOKE_DOWNLOAD] {
                match fs::remove_file(dir.join(name)) {
                    Ok(()) => (),
                    Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(Self {
            dir,
            test,
            smoke,
            _lock: lock,
        })
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| invalid("file has no parent"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)?;
    Ok(())
}

fn filter_preferences(value: Value) -> Value {
    Value::Object(match value {
        Value::Object(entries) => entries
            .into_iter()
            .filter(|(key, v)| key.starts_with("journal-") && v.is_string())
            .collect(),
        _ => Map::new(),
    })
}

fn parse_bytes(bytes: &[u8]) -> Option<Value> {
    if bytes.len() > MAX_PREFERENCES_BYTES {
        return None;
    }
    serde_json::from_slice(bytes).ok().map(filter_preferences)
}

pub struct Preferences {
    path: PathBuf,
    cache: Value,
    corrupted: bool,
}

pub fn open_file(path: &Path, options: &mut fs::OpenOptions) -> io::Result<fs::File> {
    #[cfg(unix)]
    options
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        // In particular, do not request append access to an existing reparse point.
        if path.symlink_metadata().is_ok_and(|m| is_reparse_point(&m)) {
            return Err(invalid("profile file is a reparse point"));
        }
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    #[cfg(windows)]
    if is_reparse_point(&metadata) {
        return Err(invalid("profile file is a reparse point"));
    }
    if !metadata.is_file() {
        return Err(invalid("profile file must be a regular file"));
    }
    Ok(file)
}

fn open_regular(path: &Path) -> io::Result<fs::File> {
    open_file(path, fs::OpenOptions::new().read(true))
}

fn migrated_preferences(_test: bool) -> Option<Value> {
    #[cfg(target_os = "macos")]
    if !_test {
        return Command::new("/usr/bin/defaults")
            .args(["read", "local.sumi.journal", "journalPreferences"])
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| parse_bytes(&o.stdout));
    }
    None
}

impl Preferences {
    pub fn open(dir: &Path, test: bool) -> io::Result<Self> {
        let path = dir.join("preferences.json");
        let empty = || Value::Object(Map::new());
        let (cache, corrupted) = match open_regular(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(MAX_PREFERENCES_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)?;
                match parse_bytes(&bytes) {
                    Some(value) => (value, false),
                    None => {
                        eprintln!("Sumi preferences are invalid; preserving the original file.");
                        (empty(), true)
                    }
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let migrated = migrated_preferences(test);
                let cache = migrated.unwrap_or_else(empty);
                atomic_write(&path, &serde_json::to_vec(&cache)?)?;
                (cache, false)
            }
            Err(e) => return Err(e),
        };
        Ok(Self {
            path,
            cache,
            corrupted,
        })
    }

    pub fn value(&self) -> &Value {
        &self.cache
    }

    pub fn save(&mut self, value: Value) -> io::Result<Value> {
        let filtered = filter_preferences(value);
        let bytes = serde_json::to_vec(&filtered)?;
        if bytes.len() > MAX_PREFERENCES_BYTES {
            return Err(invalid("preferences exceed 64 KiB"));
        }
        if self.corrupted {
            let mut file = open_regular(&self.path)?;
            let parent = self.path.parent().expect("preferences parent");
            let mut backup = tempfile::Builder::new()
                .prefix("preferences.json.corrupt-")
                .tempfile_in(parent)?;
            io::copy(&mut file, &mut backup)?;
            backup.as_file().sync_all()?;
            backup.keep()?;
        }
        atomic_write(&self.path, &bytes)?;
        self.cache = filtered;
        self.corrupted = false;
        Ok(self.cache.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn test_profiles_must_be_existing_safe_temp_descendants() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        let prod = p.join("Sumi");
        let good = p.join("Sumi-test");
        fs::create_dir_all(prod.join("child")).unwrap();
        fs::create_dir(&good).unwrap();
        #[cfg(unix)]
        symlink(&prod, p.join("prod-alias")).unwrap();
        assert_eq!(
            select_test_dir(&good, p, &prod).unwrap(),
            good.canonicalize().unwrap()
        );
        for bad in [
            p.into(),
            prod.clone(),
            prod.join("child"),
            #[cfg(unix)]
            p.join("prod-alias/child"),
            p.join("missing"),
        ] {
            assert!(select_test_dir(&bad, p, &prod).is_err(), "{bad:?}");
        }
        fs::write(prod.join("note"), b"production").unwrap();
        fs::hard_link(prod.join("note"), good.join("linked")).unwrap();
        assert!(select_test_dir(&good, p, &prod).is_err());
        fs::remove_file(good.join("linked")).unwrap();
        #[cfg(unix)]
        {
            symlink(&prod, good.join("voice")).unwrap();
            assert!(select_test_dir(&good, p, &prod).is_err());
        }
        #[cfg(windows)]
        assert!(select_test_dir(&p.join("sUMI/child"), p, &prod).is_err());
    }

    #[test]
    fn preserves_corrupt_bytes_and_atomically_filters_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("preferences.json");
        fs::write(&file, b"{broken").unwrap();
        let mut prefs = Preferences::open(dir.path(), true).unwrap();
        assert_eq!(prefs.value(), &json!({}));
        assert!(prefs
            .save(json!({"journal-big": "z".repeat(MAX_PREFERENCES_BYTES)}))
            .is_err());
        assert_eq!(fs::read(&file).unwrap(), b"{broken");
        prefs
            .save(json!({"journal-mode": "dark", "journal-bad": 1, "bad": "text"}))
            .unwrap();
        let backup = fs::read_dir(dir.path())
            .unwrap()
            .map(Result::unwrap)
            .find(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("preferences.json.corrupt-")
            })
            .unwrap();
        assert_eq!(fs::read(backup.path()).unwrap(), b"{broken");
        #[cfg(unix)]
        assert_eq!(fs::metadata(file).unwrap().mode() & 0o777, 0o600);
        assert_eq!(
            Preferences::open(dir.path(), true).unwrap().value(),
            &json!({"journal-mode": "dark"})
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn data_directory_matches_the_former_electron_app() {
        let home = Path::new("/home/someone");
        let abs = if cfg!(windows) { "C:\\Data" } else { "/data" };
        let (default, name) = (home.join("cfg"), "Sumi");
        assert_eq!(app_data_dir(default.clone(), None), default.join(name));
        assert_eq!(
            app_data_dir(default.clone(), Some(format!("  {abs}  ").into())),
            Path::new(abs).join(name)
        );
        // Electron ignored relative XDG_CONFIG_HOME / APPDATA values too.
        assert_eq!(
            app_data_dir(default.clone(), Some("relative/dir".into())),
            default.join(name)
        );
        assert_eq!(
            app_data_dir(default.clone(), Some("".into())),
            default.join(name)
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_default_is_dot_config_sumi() {
        if env::var_os("XDG_CONFIG_HOME").is_none() {
            assert_eq!(
                production_dir(Path::new("/home/someone")),
                Path::new("/home/someone/.config/Sumi")
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_default_is_application_support_sumi() {
        assert_eq!(
            production_dir(Path::new("/Users/someone")),
            Path::new("/Users/someone/Library/Application Support/Sumi")
        );
    }

    #[test]
    fn existing_electron_era_journal_is_opened_untouched_and_single_instance() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("Sumi");
        fs::create_dir_all(dir.join("electron")).unwrap();
        // Synthetic stand-ins for what the Electron app left behind.
        let files: [(&str, &[u8]); 4] = [
            ("journal.db", b"synthetic journal database bytes"),
            (
                "preferences.json",
                br#"{"journal-theme-v1":"dark","other":"x"}"#,
            ),
            ("desktop.log", b"old electron log"),
            ("electron/SingletonLock", b"leftover"),
        ];
        for (name, bytes) in files {
            fs::write(dir.join(name), bytes).unwrap();
        }
        let profile = Profile::at(dir.clone(), false, false).unwrap();
        assert_eq!(profile.dir, dir);
        // A second launch on the same journal is refused while the first holds it.
        assert!(Profile::at(dir.clone(), false, false).is_err());
        for (name, bytes) in files {
            assert_eq!(fs::read(dir.join(name)).unwrap(), bytes, "{name}");
        }
        // The Electron preferences file is read as is; non journal-* keys are dropped.
        assert_eq!(
            Preferences::open(&dir, false).unwrap().value(),
            &json!({"journal-theme-v1": "dark"})
        );
        // Reading preferences does not rewrite the original file.
        assert_eq!(fs::read(dir.join("preferences.json")).unwrap(), files[1].1);
    }
}

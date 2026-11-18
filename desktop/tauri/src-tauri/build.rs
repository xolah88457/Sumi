fn main() {
    for name in ["SUMI_TAURI_UPDATER_ENDPOINT", "SUMI_TAURI_UPDATER_PUBKEY"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed=../bridge.js");
    println!("cargo:rerun-if-changed=../runtime");
    // A shell-only cargo check or test does not need a staged Next.js payload.
    // Tauri CLI builds still require the runtime and bundle it as a resource.
    if tauri_build::is_dev()
        && !std::path::Path::new("../runtime").exists()
        && std::env::var_os("TAURI_CONFIG").is_none()
    {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":null}}"#);
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "save_preferences",
            "runtime_info",
            "check_for_updates",
            "smoke_report",
            "open_external",
        ]),
    ))
    .expect("build Tauri manifest");
}

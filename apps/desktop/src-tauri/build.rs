fn main() {
    // `telemetry.rs` reads these with `option_env!`. Cargo tracks that through
    // dep-info for the crate itself; declaring them here as well makes the
    // dependency explicit and covers the build script's own outputs.
    println!("cargo::rerun-if-env-changed=WRITER_POSTHOG_KEY");
    println!("cargo::rerun-if-env-changed=WRITER_POSTHOG_HOST");

    tauri_build::build()
}

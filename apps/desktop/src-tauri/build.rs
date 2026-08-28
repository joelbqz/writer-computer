fn main() {
    // `telemetry.rs` reads these with `option_env!`, which Cargo does not track
    // on its own. Without these lines a build cached from before the key was
    // set would silently ship a binary that cannot report anything.
    println!("cargo::rerun-if-env-changed=WRITER_POSTHOG_KEY");
    println!("cargo::rerun-if-env-changed=WRITER_POSTHOG_HOST");

    tauri_build::build()
}

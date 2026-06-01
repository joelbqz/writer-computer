//! Implementation of the standalone `writer` shell launcher.
//!
//! The CLI itself is kept dependency-free: argv parsing is hand-rolled and
//! launch behavior is abstracted behind [`Launcher`] so tests can inject a
//! fake without spawning the real desktop app.

use crate::open_target::{self, PendingOpenPayload};
use crate::virtual_workspace::{parse_files_csv, VirtualWorkspaceRegistry};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Exit code constants. Keep in sync with the spec.
const EXIT_SUCCESS: u8 = 0;
const EXIT_USAGE: u8 = 2;
const EXIT_RUNTIME: u8 = 3;

pub const USAGE: &str = "\
Usage: writer [PATH]
       writer workspace <command>

Open a folder or markdown file in the Writer desktop app.

Arguments:
  PATH              Directory or .md/.markdown file to open. If omitted,
                    Writer launches with no target.

Options:
  -h, --help        Print this help and exit.
  -V, --version     Print version and exit.

Workspace commands:
  workspace new <name> --files=<paths>       Create a virtual workspace.
  workspace list                             List virtual workspaces.
  workspace open <name>                      Open a virtual workspace.
  workspace add <name> --files=<paths>       Add references.
  workspace remove <name> --files=<paths>    Remove references only.
  workspace delete <name>                    Delete the workspace definition.

  <paths> is a comma-separated list of absolute file or folder paths.

Environment:
  WRITER_APP_PATH   Override the path to the Writer bundle (macOS) or
                    binary (Linux/Windows). Useful for development builds.
  WRITER_VIRTUAL_WORKSPACES_FILE
                    Override the virtual workspace definition file.
";

/// Version embedded at compile time from the Cargo package.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// What the parser pulled out of argv.
#[derive(Debug, PartialEq, Eq)]
enum ParsedArgs {
    Help,
    Version,
    Open { path: Option<PathBuf> },
    Workspace(WorkspaceCommand),
}

#[derive(Debug, PartialEq, Eq)]
enum WorkspaceCommand {
    New { name: String, files: Vec<PathBuf> },
    List,
    Open { name: String },
    Add { name: String, files: Vec<PathBuf> },
    Remove { name: String, files: Vec<PathBuf> },
    Delete { name: String },
}

#[derive(Debug, PartialEq, Eq)]
enum ParseError {
    MissingArgument(&'static str),
    MissingFiles,
    UnknownFlag(String),
    UnknownCommand(String),
    TooManyArgs,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingArgument(arg) => write!(f, "missing argument: {arg}"),
            Self::MissingFiles => write!(f, "missing required option: --files=<paths>"),
            Self::UnknownFlag(flag) => write!(f, "unknown option: {flag}"),
            Self::UnknownCommand(command) => write!(f, "unknown command: {command}"),
            Self::TooManyArgs => write!(f, "expected at most one path argument"),
        }
    }
}

fn parse_args(argv: &[OsString]) -> Result<ParsedArgs, ParseError> {
    // argv[0] is the program name.
    if argv
        .get(1)
        .and_then(|arg| arg.to_str())
        .is_some_and(|arg| arg == "workspace")
    {
        return parse_workspace_args(&argv[2..]);
    }

    let mut positional: Option<PathBuf> = None;

    for arg in argv.iter().skip(1) {
        if let Some(flag) = arg.to_str() {
            match flag {
                "--help" | "-h" => return Ok(ParsedArgs::Help),
                "--version" | "-V" => return Ok(ParsedArgs::Version),
                _ if flag.starts_with('-') => {
                    return Err(ParseError::UnknownFlag(flag.to_string()));
                }
                _ => {}
            }
        }

        if positional.is_some() {
            return Err(ParseError::TooManyArgs);
        }
        positional = Some(PathBuf::from(arg));
    }

    Ok(ParsedArgs::Open { path: positional })
}

fn parse_workspace_args(args: &[OsString]) -> Result<ParsedArgs, ParseError> {
    let command = args
        .first()
        .and_then(|arg| arg.to_str())
        .ok_or(ParseError::MissingArgument("workspace command"))?;

    let parsed = match command {
        "new" => {
            let name = workspace_name_arg(args, 1)?;
            let files = parse_required_files(args, 2)?;
            WorkspaceCommand::New { name, files }
        }
        "list" => {
            if args.len() > 1 {
                return Err(ParseError::TooManyArgs);
            }
            WorkspaceCommand::List
        }
        "open" => {
            let name = workspace_name_arg(args, 1)?;
            if args.len() > 2 {
                return Err(ParseError::TooManyArgs);
            }
            WorkspaceCommand::Open { name }
        }
        "add" => {
            let name = workspace_name_arg(args, 1)?;
            let files = parse_required_files(args, 2)?;
            WorkspaceCommand::Add { name, files }
        }
        "remove" => {
            let name = workspace_name_arg(args, 1)?;
            let files = parse_required_files(args, 2)?;
            WorkspaceCommand::Remove { name, files }
        }
        "delete" => {
            let name = workspace_name_arg(args, 1)?;
            if args.len() > 2 {
                return Err(ParseError::TooManyArgs);
            }
            WorkspaceCommand::Delete { name }
        }
        other if other.starts_with('-') => return Err(ParseError::UnknownFlag(other.to_string())),
        other => return Err(ParseError::UnknownCommand(other.to_string())),
    };

    Ok(ParsedArgs::Workspace(parsed))
}

fn workspace_name_arg(args: &[OsString], index: usize) -> Result<String, ParseError> {
    args.get(index)
        .map(|arg| arg.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
        .ok_or(ParseError::MissingArgument("name"))
}

fn parse_required_files(args: &[OsString], start: usize) -> Result<Vec<PathBuf>, ParseError> {
    let mut files: Option<Vec<PathBuf>> = None;
    let mut index = start;
    while index < args.len() {
        let arg = args[index].to_string_lossy();
        if arg == "--files" {
            index += 1;
            let value = args
                .get(index)
                .ok_or(ParseError::MissingArgument("--files value"))?
                .to_string_lossy()
                .to_string();
            files = Some(parse_files_csv(&value).map_err(|_| ParseError::MissingFiles)?);
        } else if let Some(value) = arg.strip_prefix("--files=") {
            files = Some(parse_files_csv(value).map_err(|_| ParseError::MissingFiles)?);
        } else if arg.starts_with('-') {
            return Err(ParseError::UnknownFlag(arg.to_string()));
        } else {
            return Err(ParseError::TooManyArgs);
        }
        index += 1;
    }
    files.ok_or(ParseError::MissingFiles)
}

/// Resolve a user-supplied path against `cwd`. Relative paths and `.` / `..`
/// are normalized so the canonical form handed to the app is stable
/// regardless of where the shell was when invoking the CLI.
fn resolve_input_path(input: &Path, cwd: &Path) -> PathBuf {
    if input.is_absolute() {
        input.to_path_buf()
    } else {
        cwd.join(input)
    }
}

/// Trait boundary between the CLI's decision logic and the actual process
/// spawn. Lets tests observe the exact path that would be handed to the app
/// without requiring Writer to be installed.
pub trait Launcher {
    /// Launch the Writer app. `target` is `None` for the no-arg case.
    fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError>;
}

#[derive(Debug)]
pub enum LaunchError {
    AppNotFound(String),
    Io(std::io::Error),
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AppNotFound(msg) => write!(f, "{msg}"),
            Self::Io(err) => write!(f, "could not launch Writer: {err}"),
        }
    }
}

impl From<std::io::Error> for LaunchError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

/// Default launcher: hands the target to the OS-specific entrypoint.
pub struct SystemLauncher;

impl Launcher for SystemLauncher {
    fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError> {
        launch_system(target)
    }
}

#[cfg(target_os = "macos")]
fn launch_system(target: Option<&Path>) -> Result<(), LaunchError> {
    use std::process::Command;

    let mut cmd = if let Some(override_path) = std::env::var_os("WRITER_APP_PATH") {
        let mut c = Command::new("open");
        c.arg("-a").arg(override_path);
        c
    } else {
        let mut c = Command::new("open");
        c.arg("-a").arg("Writer");
        c
    };

    if let Some(path) = target {
        let target_arg = path.to_string_lossy();
        if crate::virtual_workspace::is_virtual_workspace_uri(&target_arg) {
            cmd.arg("--args").arg(path);
        } else {
            cmd.arg(path);
        }
    }

    let status = cmd.status()?;
    if !status.success() {
        return Err(LaunchError::AppNotFound(
            "Writer is not installed. Install it from the DMG or set WRITER_APP_PATH.".into(),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn launch_system(target: Option<&Path>) -> Result<(), LaunchError> {
    use std::process::Command;

    let program = std::env::var_os("WRITER_APP_PATH").unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "writer.exe".into()
        } else {
            "writer-desktop".into()
        }
    });

    let mut cmd = Command::new(&program);
    if let Some(path) = target {
        cmd.arg(path);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(LaunchError::AppNotFound(format!(
                "could not find the Writer binary ({}). Install Writer or set WRITER_APP_PATH.",
                program.to_string_lossy()
            )))
        }
        Err(err) => Err(err.into()),
    }
}

/// Entry point for both the binary and integration tests.
pub fn run<L: Launcher>(argv: Vec<OsString>, cwd: &Path, launcher: &L) -> ExitCode {
    match parse_args(&argv) {
        Ok(ParsedArgs::Help) => {
            println!("{USAGE}");
            ExitCode::from(EXIT_SUCCESS)
        }
        Ok(ParsedArgs::Version) => {
            println!("writer {VERSION}");
            ExitCode::from(EXIT_SUCCESS)
        }
        Ok(ParsedArgs::Open { path }) => run_open(path, cwd, launcher),
        Ok(ParsedArgs::Workspace(command)) => run_workspace(command, launcher),
        Err(err) => {
            fail_usage(err);
            ExitCode::from(EXIT_USAGE)
        }
    }
}

fn run_workspace<L: Launcher>(command: WorkspaceCommand, launcher: &L) -> ExitCode {
    let registry = match VirtualWorkspaceRegistry::for_app_data() {
        Ok(registry) => registry,
        Err(err) => {
            fail_runtime(&err);
            return ExitCode::from(EXIT_RUNTIME);
        }
    };

    let result = match command {
        WorkspaceCommand::New { name, files } => registry.create(&name, &files).map(|workspace| {
            println!(
                "Created workspace {} ({} references)",
                workspace.name,
                workspace.references.len()
            );
        }),
        WorkspaceCommand::List => registry.list().map(|workspaces| {
            for workspace in workspaces {
                println!(
                    "{}\t{} references",
                    workspace.name,
                    workspace.references.len()
                );
            }
        }),
        WorkspaceCommand::Open { name } => match registry.get(&name) {
            Ok(workspace) => {
                let target = PathBuf::from(workspace.uri());
                launcher.launch(Some(&target)).map_err(|err| {
                    crate::virtual_workspace::VirtualWorkspaceError::Io(std::io::Error::other(
                        err.to_string(),
                    ))
                })
            }
            Err(err) => Err(err),
        },
        WorkspaceCommand::Add { name, files } => registry.add(&name, &files).map(|workspace| {
            println!(
                "Updated workspace {} ({} references)",
                workspace.name,
                workspace.references.len()
            );
        }),
        WorkspaceCommand::Remove { name, files } => {
            registry.remove(&name, &files).map(|workspace| {
                println!(
                    "Updated workspace {} ({} references)",
                    workspace.name,
                    workspace.references.len()
                );
            })
        }
        WorkspaceCommand::Delete { name } => registry.delete(&name).map(|()| {
            println!("Deleted workspace {name}");
        }),
    };

    match result {
        Ok(()) => ExitCode::from(EXIT_SUCCESS),
        Err(err) => {
            fail_runtime(&err);
            ExitCode::from(EXIT_RUNTIME)
        }
    }
}

fn run_open<L: Launcher>(path: Option<PathBuf>, cwd: &Path, launcher: &L) -> ExitCode {
    let target: Option<PathBuf> = match path {
        None => None,
        Some(input) => {
            let resolved = resolve_input_path(&input, cwd);
            match open_target::validate_and_resolve(&resolved) {
                Ok(payload) => Some(canonical_target(&payload)),
                Err(err) => {
                    fail_runtime(&err);
                    return ExitCode::from(EXIT_RUNTIME);
                }
            }
        }
    };

    if let Err(err) = launcher.launch(target.as_deref()) {
        fail_runtime(&err);
        return ExitCode::from(EXIT_RUNTIME);
    }

    ExitCode::from(EXIT_SUCCESS)
}

/// Pick the single path the app should receive. A markdown target hands
/// back the file (so the app opens both the workspace and the file),
/// while a directory target hands back the workspace.
fn canonical_target(payload: &PendingOpenPayload) -> PathBuf {
    payload
        .file
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&payload.workspace))
}

fn fail_usage(err: ParseError) {
    eprintln!("writer: {err}");
    eprintln!();
    eprint!("{USAGE}");
}

fn fail_runtime(err: &dyn std::fmt::Display) {
    eprintln!("writer: {err}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;
    use tempfile::tempdir;

    struct FakeLauncher {
        calls: RefCell<Vec<Option<PathBuf>>>,
        fail: Option<LaunchError>,
    }

    impl FakeLauncher {
        fn new() -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                fail: None,
            }
        }

        fn failing(err: LaunchError) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                fail: Some(err),
            }
        }
    }

    impl Launcher for FakeLauncher {
        fn launch(&self, target: Option<&Path>) -> Result<(), LaunchError> {
            self.calls
                .borrow_mut()
                .push(target.map(|p| p.to_path_buf()));
            match &self.fail {
                Some(LaunchError::AppNotFound(msg)) => Err(LaunchError::AppNotFound(msg.clone())),
                Some(LaunchError::Io(err)) => Err(LaunchError::Io(std::io::Error::new(
                    err.kind(),
                    err.to_string(),
                ))),
                None => Ok(()),
            }
        }
    }

    fn argv(parts: &[&str]) -> Vec<OsString> {
        parts.iter().map(OsString::from).collect()
    }

    #[test]
    fn parse_help_flags() {
        assert_eq!(
            parse_args(&argv(&["writer", "--help"])).unwrap(),
            ParsedArgs::Help
        );
        assert_eq!(
            parse_args(&argv(&["writer", "-h"])).unwrap(),
            ParsedArgs::Help
        );
    }

    #[test]
    fn parse_version_flags() {
        assert_eq!(
            parse_args(&argv(&["writer", "--version"])).unwrap(),
            ParsedArgs::Version
        );
        assert_eq!(
            parse_args(&argv(&["writer", "-V"])).unwrap(),
            ParsedArgs::Version
        );
    }

    #[test]
    fn parse_no_args() {
        assert_eq!(
            parse_args(&argv(&["writer"])).unwrap(),
            ParsedArgs::Open { path: None }
        );
    }

    #[test]
    fn parse_single_path() {
        assert_eq!(
            parse_args(&argv(&["writer", "."])).unwrap(),
            ParsedArgs::Open {
                path: Some(PathBuf::from("."))
            }
        );
    }

    #[test]
    fn parse_workspace_new_with_files_equals() {
        assert_eq!(
            parse_args(&argv(&[
                "writer",
                "workspace",
                "new",
                "Drafts",
                "--files=/tmp/a.md,/tmp/b"
            ]))
            .unwrap(),
            ParsedArgs::Workspace(WorkspaceCommand::New {
                name: "Drafts".into(),
                files: vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b")]
            })
        );
    }

    #[test]
    fn parse_workspace_add_with_files_value() {
        assert_eq!(
            parse_args(&argv(&[
                "writer",
                "workspace",
                "add",
                "Drafts",
                "--files",
                "/tmp/a.md,/tmp/b"
            ]))
            .unwrap(),
            ParsedArgs::Workspace(WorkspaceCommand::Add {
                name: "Drafts".into(),
                files: vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b")]
            })
        );
    }

    #[test]
    fn parse_workspace_list() {
        assert_eq!(
            parse_args(&argv(&["writer", "workspace", "list"])).unwrap(),
            ParsedArgs::Workspace(WorkspaceCommand::List)
        );
    }

    #[test]
    fn parse_workspace_open() {
        assert_eq!(
            parse_args(&argv(&["writer", "workspace", "open", "Drafts"])).unwrap(),
            ParsedArgs::Workspace(WorkspaceCommand::Open {
                name: "Drafts".into()
            })
        );
    }

    #[test]
    fn parse_workspace_delete() {
        assert_eq!(
            parse_args(&argv(&["writer", "workspace", "delete", "Drafts"])).unwrap(),
            ParsedArgs::Workspace(WorkspaceCommand::Delete {
                name: "Drafts".into()
            })
        );
    }

    #[test]
    fn parse_workspace_remove_requires_files() {
        assert!(matches!(
            parse_args(&argv(&["writer", "workspace", "remove", "Drafts"])),
            Err(ParseError::MissingFiles)
        ));
    }

    #[test]
    fn parse_rejects_multiple_positional() {
        assert!(matches!(
            parse_args(&argv(&["writer", "a", "b"])),
            Err(ParseError::TooManyArgs)
        ));
    }

    #[test]
    fn parse_rejects_unknown_flag() {
        assert!(matches!(
            parse_args(&argv(&["writer", "--bogus"])),
            Err(ParseError::UnknownFlag(_))
        ));
    }

    #[test]
    fn run_no_args_launches_with_none() {
        let cwd = tempdir().unwrap();
        let launcher = FakeLauncher::new();
        let code = run(argv(&["writer"]), cwd.path(), &launcher);
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_SUCCESS))
        );
        assert_eq!(launcher.calls.borrow().as_slice(), &[None]);
    }

    #[test]
    fn run_directory_target_passes_canonical_workspace() {
        let cwd = tempdir().unwrap();
        let target = cwd.path().join("project");
        fs::create_dir(&target).unwrap();

        let launcher = FakeLauncher::new();
        let _ = run(argv(&["writer", "project"]), cwd.path(), &launcher);

        let calls = launcher.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].as_ref().unwrap(), &target.canonicalize().unwrap());
    }

    #[test]
    fn run_markdown_target_passes_file_path() {
        let cwd = tempdir().unwrap();
        let md = cwd.path().join("note.md");
        fs::write(&md, "").unwrap();

        let launcher = FakeLauncher::new();
        let _ = run(argv(&["writer", "note.md"]), cwd.path(), &launcher);

        let calls = launcher.calls.borrow();
        assert_eq!(calls[0].as_ref().unwrap(), &md.canonicalize().unwrap());
    }

    #[test]
    fn run_unsupported_file_is_runtime_error_without_launch() {
        let cwd = tempdir().unwrap();
        let img = cwd.path().join("pic.png");
        fs::write(&img, "").unwrap();

        let launcher = FakeLauncher::new();
        let code = run(argv(&["writer", "pic.png"]), cwd.path(), &launcher);
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_RUNTIME))
        );
        assert!(launcher.calls.borrow().is_empty());
    }

    #[test]
    fn run_missing_path_is_runtime_error() {
        let cwd = tempdir().unwrap();
        let launcher = FakeLauncher::new();
        let code = run(argv(&["writer", "nope.md"]), cwd.path(), &launcher);
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_RUNTIME))
        );
        assert!(launcher.calls.borrow().is_empty());
    }

    #[test]
    fn run_bad_flag_is_usage_error() {
        let cwd = tempdir().unwrap();
        let launcher = FakeLauncher::new();
        let code = run(argv(&["writer", "--nope"]), cwd.path(), &launcher);
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_USAGE))
        );
        assert!(launcher.calls.borrow().is_empty());
    }

    #[test]
    fn run_propagates_launcher_failure_as_runtime_error() {
        let cwd = tempdir().unwrap();
        let launcher = FakeLauncher::failing(LaunchError::AppNotFound("nope".into()));
        let code = run(argv(&["writer"]), cwd.path(), &launcher);
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(EXIT_RUNTIME))
        );
    }

    #[test]
    fn run_workspace_open_launches_virtual_workspace_uri() {
        let store = tempdir().unwrap();
        let source = tempdir().unwrap();
        let note = source.path().join("note.md");
        fs::write(&note, "# Note").unwrap();
        let store_file = store.path().join("virtual_workspaces.json");
        std::env::set_var("WRITER_VIRTUAL_WORKSPACES_FILE", &store_file);

        let launcher = FakeLauncher::new();
        let cwd = tempdir().unwrap();
        let create_code = run(
            argv(&[
                "writer",
                "workspace",
                "new",
                "Drafts",
                &format!("--files={}", note.display()),
            ]),
            cwd.path(),
            &launcher,
        );
        assert_eq!(
            format!("{create_code:?}"),
            format!("{:?}", ExitCode::from(EXIT_SUCCESS))
        );

        let open_code = run(
            argv(&["writer", "workspace", "open", "Drafts"]),
            cwd.path(),
            &launcher,
        );
        assert_eq!(
            format!("{open_code:?}"),
            format!("{:?}", ExitCode::from(EXIT_SUCCESS))
        );
        assert_eq!(
            launcher.calls.borrow().as_slice(),
            &[Some(PathBuf::from("writer-workspace://Drafts"))]
        );

        std::env::remove_var("WRITER_VIRTUAL_WORKSPACES_FILE");
    }

    #[test]
    fn resolve_input_path_joins_relative_against_cwd() {
        let cwd = Path::new("/tmp/work");
        assert_eq!(resolve_input_path(Path::new("foo"), cwd), cwd.join("foo"));
        assert_eq!(
            resolve_input_path(Path::new("/abs/path"), cwd),
            PathBuf::from("/abs/path")
        );
    }
}

use crate::state::IndexedFile;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const VIRTUAL_WORKSPACE_URI_PREFIX: &str = "writer-workspace://";
const STORE_ENV: &str = "WRITER_VIRTUAL_WORKSPACES_FILE";
const APP_IDENTIFIER: &str = "com.writer-computer";
const STORE_FILENAME: &str = "virtual_workspaces.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualWorkspace {
    pub name: String,
    #[serde(default)]
    pub references: Vec<VirtualReference>,
}

impl VirtualWorkspace {
    pub fn uri(&self) -> String {
        workspace_uri(&self.name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualReference {
    pub path: String,
    pub kind: VirtualReferenceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VirtualReferenceKind {
    File,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VirtualDirectoryEntry {
    pub name: String,
    /// Directory entries use a virtual URI. File entries use their real
    /// absolute path so editor reads/writes still hit the referenced file.
    pub path: String,
    pub source_path: String,
    pub kind: VirtualReferenceKind,
    pub is_markdown: bool,
    pub missing: bool,
}

#[derive(Debug)]
pub enum VirtualWorkspaceError {
    AlreadyExists(String),
    DuplicateRoot(String),
    EmptyFileList,
    EmptyName,
    InvalidName(String),
    Io(std::io::Error),
    MissingWorkspace(String),
    NoSuchReference(String),
    NonAbsolutePath(PathBuf),
    NotFound(PathBuf),
    NotFileOrFolder(PathBuf),
    Parse(serde_json::Error),
}

impl std::fmt::Display for VirtualWorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyExists(name) => write!(f, "workspace already exists: {name}"),
            Self::DuplicateRoot(name) => {
                write!(f, "virtual workspace root name would be ambiguous: {name}")
            }
            Self::EmptyFileList => write!(f, "--files must contain at least one path"),
            Self::EmptyName => write!(f, "workspace name cannot be empty"),
            Self::InvalidName(name) => write!(f, "invalid workspace name: {name}"),
            Self::Io(err) => write!(f, "{err}"),
            Self::MissingWorkspace(name) => write!(f, "workspace does not exist: {name}"),
            Self::NoSuchReference(path) => {
                write!(f, "reference is not in the workspace: {path}")
            }
            Self::NonAbsolutePath(path) => write!(f, "path is not absolute: {}", path.display()),
            Self::NotFound(path) => write!(f, "path does not exist: {}", path.display()),
            Self::NotFileOrFolder(path) => {
                write!(f, "path is not a file or folder: {}", path.display())
            }
            Self::Parse(err) => write!(f, "could not parse virtual workspaces: {err}"),
        }
    }
}

impl std::error::Error for VirtualWorkspaceError {}

impl From<std::io::Error> for VirtualWorkspaceError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for VirtualWorkspaceError {
    fn from(err: serde_json::Error) -> Self {
        Self::Parse(err)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredVirtualWorkspaces {
    version: u32,
    #[serde(default)]
    workspaces: Vec<VirtualWorkspace>,
}

impl Default for StoredVirtualWorkspaces {
    fn default() -> Self {
        Self {
            version: 1,
            workspaces: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct VirtualWorkspaceRegistry {
    path: PathBuf,
}

impl VirtualWorkspaceRegistry {
    pub fn for_app_data() -> Result<Self, VirtualWorkspaceError> {
        Ok(Self {
            path: default_store_path()?,
        })
    }

    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list(&self) -> Result<Vec<VirtualWorkspace>, VirtualWorkspaceError> {
        Ok(self.load()?.workspaces)
    }

    pub fn get(&self, name: &str) -> Result<VirtualWorkspace, VirtualWorkspaceError> {
        let name = validate_workspace_name(name)?;
        self.load()?
            .workspaces
            .into_iter()
            .find(|workspace| workspace.name == name)
            .ok_or_else(|| VirtualWorkspaceError::MissingWorkspace(name.to_string()))
    }

    pub fn create(
        &self,
        name: &str,
        paths: &[PathBuf],
    ) -> Result<VirtualWorkspace, VirtualWorkspaceError> {
        let name = validate_workspace_name(name)?.to_string();
        let references = normalize_references(paths)?;

        let mut data = self.load()?;
        if data
            .workspaces
            .iter()
            .any(|workspace| workspace.name == name)
        {
            return Err(VirtualWorkspaceError::AlreadyExists(name));
        }

        validate_root_names(&references)?;
        let workspace = VirtualWorkspace { name, references };
        data.workspaces.push(workspace.clone());
        sort_workspaces(&mut data.workspaces);
        self.save(&data)?;
        Ok(workspace)
    }

    pub fn add(
        &self,
        name: &str,
        paths: &[PathBuf],
    ) -> Result<VirtualWorkspace, VirtualWorkspaceError> {
        let name = validate_workspace_name(name)?.to_string();
        let mut incoming = normalize_references(paths)?;

        let mut data = self.load()?;
        let workspace = data
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.name == name)
            .ok_or_else(|| VirtualWorkspaceError::MissingWorkspace(name.clone()))?;

        for reference in incoming.drain(..) {
            if !workspace
                .references
                .iter()
                .any(|existing| existing.path == reference.path)
            {
                workspace.references.push(reference);
            }
        }
        workspace.references.sort_by(|a, b| a.path.cmp(&b.path));
        validate_root_names(&workspace.references)?;
        let updated = workspace.clone();
        self.save(&data)?;
        Ok(updated)
    }

    pub fn remove(
        &self,
        name: &str,
        paths: &[PathBuf],
    ) -> Result<VirtualWorkspace, VirtualWorkspaceError> {
        let name = validate_workspace_name(name)?.to_string();
        let requested = normalize_paths_for_removal(paths)?;

        let mut data = self.load()?;
        let workspace = data
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.name == name)
            .ok_or_else(|| VirtualWorkspaceError::MissingWorkspace(name.clone()))?;

        for path in &requested {
            if !workspace
                .references
                .iter()
                .any(|reference| &reference.path == path)
            {
                return Err(VirtualWorkspaceError::NoSuchReference(path.clone()));
            }
        }

        let remove_set: HashSet<&str> = requested.iter().map(String::as_str).collect();
        workspace
            .references
            .retain(|reference| !remove_set.contains(reference.path.as_str()));
        let updated = workspace.clone();
        self.save(&data)?;
        Ok(updated)
    }

    pub fn delete(&self, name: &str) -> Result<(), VirtualWorkspaceError> {
        let name = validate_workspace_name(name)?.to_string();
        let mut data = self.load()?;
        let original_len = data.workspaces.len();
        data.workspaces.retain(|workspace| workspace.name != name);
        if data.workspaces.len() == original_len {
            return Err(VirtualWorkspaceError::MissingWorkspace(name));
        }
        self.save(&data)
    }

    fn load(&self) -> Result<StoredVirtualWorkspaces, VirtualWorkspaceError> {
        if !self.path.exists() {
            return Ok(StoredVirtualWorkspaces::default());
        }
        let raw = std::fs::read_to_string(&self.path)?;
        let mut data: StoredVirtualWorkspaces = serde_json::from_str(&raw)?;
        sort_workspaces(&mut data.workspaces);
        Ok(data)
    }

    fn save(&self, data: &StoredVirtualWorkspaces) -> Result<(), VirtualWorkspaceError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(data)?;
        std::fs::write(&self.path, raw)?;
        Ok(())
    }
}

pub fn workspace_uri(name: &str) -> String {
    format!("{VIRTUAL_WORKSPACE_URI_PREFIX}{name}")
}

pub fn workspace_name_from_uri(value: &str) -> Option<&str> {
    let name = value.strip_prefix(VIRTUAL_WORKSPACE_URI_PREFIX)?;
    if name.is_empty() {
        return None;
    }
    Some(name)
}

pub fn is_virtual_workspace_uri(value: &str) -> bool {
    workspace_name_from_uri(value).is_some()
}

pub fn read_directory(
    workspace: &VirtualWorkspace,
    directory: &str,
) -> Result<Vec<VirtualDirectoryEntry>, VirtualWorkspaceError> {
    let root_uri = workspace.uri();
    if directory == root_uri {
        return read_virtual_root(workspace);
    }

    let relative = virtual_relative_path(&root_uri, directory)
        .ok_or_else(|| VirtualWorkspaceError::NotFound(PathBuf::from(directory)))?;
    let source = source_dir_for_virtual_path(workspace, relative)
        .ok_or_else(|| VirtualWorkspaceError::NotFound(PathBuf::from(directory)))?;
    read_source_directory(&root_uri, relative, &source)
}

pub fn index_workspace(workspace: &VirtualWorkspace) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    let root_uri = workspace.uri();
    let mut files = Vec::new();
    let mut dirs = HashSet::new();

    for reference in &workspace.references {
        let root_name = root_name(reference);
        let source = PathBuf::from(&reference.path);
        match reference.kind {
            VirtualReferenceKind::File => {
                if source.exists() && is_markdown_path(&source) {
                    files.push(IndexedFile {
                        path: source,
                        relative_path: root_name,
                        name: file_name(&reference.path),
                    });
                }
            }
            VirtualReferenceKind::Folder => {
                if source.is_dir() {
                    collect_markdown_files(&source, &root_name, &mut files, &mut dirs, &root_uri);
                }
            }
        }
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    (files, dirs)
}

pub fn parse_files_csv(value: &str) -> Result<Vec<PathBuf>, VirtualWorkspaceError> {
    let mut paths = Vec::new();
    for raw in value.split(',') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        paths.push(PathBuf::from(trimmed));
    }
    if paths.is_empty() {
        return Err(VirtualWorkspaceError::EmptyFileList);
    }
    Ok(paths)
}

fn default_store_path() -> Result<PathBuf, VirtualWorkspaceError> {
    if let Some(path) = std::env::var_os(STORE_ENV) {
        return Ok(PathBuf::from(path));
    }
    Ok(default_app_data_dir()?.join(STORE_FILENAME))
}

fn default_app_data_dir() -> Result<PathBuf, VirtualWorkspaceError> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is not set"))?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_IDENTIFIER));
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA").ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "APPDATA is not set")
        })?;
        return Ok(PathBuf::from(appdata).join(APP_IDENTIFIER));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home).join(APP_IDENTIFIER));
        }
        let home = std::env::var_os("HOME")
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is not set"))?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(APP_IDENTIFIER))
    }
}

fn validate_workspace_name(name: &str) -> Result<&str, VirtualWorkspaceError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(VirtualWorkspaceError::EmptyName);
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed.chars().any(char::is_control)
    {
        return Err(VirtualWorkspaceError::InvalidName(name.to_string()));
    }
    Ok(trimmed)
}

fn normalize_references(paths: &[PathBuf]) -> Result<Vec<VirtualReference>, VirtualWorkspaceError> {
    if paths.is_empty() {
        return Err(VirtualWorkspaceError::EmptyFileList);
    }

    let mut references = Vec::with_capacity(paths.len());
    let mut seen = HashSet::new();
    for path in paths {
        if !path.is_absolute() {
            return Err(VirtualWorkspaceError::NonAbsolutePath(path.clone()));
        }
        if !path.exists() {
            return Err(VirtualWorkspaceError::NotFound(path.clone()));
        }
        let metadata = path.metadata()?;
        let kind = if metadata.is_file() {
            VirtualReferenceKind::File
        } else if metadata.is_dir() {
            VirtualReferenceKind::Folder
        } else {
            return Err(VirtualWorkspaceError::NotFileOrFolder(path.clone()));
        };
        let canonical = path.canonicalize()?;
        let path = canonical.to_string_lossy().to_string();
        if seen.insert(path.clone()) {
            references.push(VirtualReference { path, kind });
        }
    }
    references.sort_by(|a, b| a.path.cmp(&b.path));
    validate_root_names(&references)?;
    Ok(references)
}

fn normalize_paths_for_removal(paths: &[PathBuf]) -> Result<Vec<String>, VirtualWorkspaceError> {
    if paths.is_empty() {
        return Err(VirtualWorkspaceError::EmptyFileList);
    }

    let mut normalized = Vec::with_capacity(paths.len());
    let mut seen = HashSet::new();
    for path in paths {
        if !path.is_absolute() {
            return Err(VirtualWorkspaceError::NonAbsolutePath(path.clone()));
        }
        let path = if path.exists() {
            path.canonicalize()?.to_string_lossy().to_string()
        } else {
            path.to_string_lossy().to_string()
        };
        if seen.insert(path.clone()) {
            normalized.push(path);
        }
    }
    Ok(normalized)
}

fn validate_root_names(references: &[VirtualReference]) -> Result<(), VirtualWorkspaceError> {
    let mut by_root: HashMap<String, &str> = HashMap::new();
    for reference in references {
        let root = root_name(reference);
        if let Some(existing) = by_root.insert(root.clone(), &reference.path) {
            if existing != reference.path {
                return Err(VirtualWorkspaceError::DuplicateRoot(root));
            }
        }
    }
    Ok(())
}

fn sort_workspaces(workspaces: &mut [VirtualWorkspace]) {
    workspaces.sort_by_key(|workspace| workspace.name.to_lowercase());
}

fn read_virtual_root(
    workspace: &VirtualWorkspace,
) -> Result<Vec<VirtualDirectoryEntry>, VirtualWorkspaceError> {
    let root_uri = workspace.uri();
    let mut entries = Vec::with_capacity(workspace.references.len());
    for reference in &workspace.references {
        let source = PathBuf::from(&reference.path);
        let missing = !source.exists();
        let name = root_name(reference);
        let path = match reference.kind {
            VirtualReferenceKind::File => reference.path.clone(),
            VirtualReferenceKind::Folder => virtual_join(&root_uri, &name),
        };
        entries.push(VirtualDirectoryEntry {
            name,
            path,
            source_path: reference.path.clone(),
            kind: reference.kind,
            is_markdown: reference.kind == VirtualReferenceKind::File && is_markdown_path(&source),
            missing,
        });
    }
    sort_entries(&mut entries);
    Ok(entries)
}

fn read_source_directory(
    root_uri: &str,
    virtual_relative: &str,
    source: &Path,
) -> Result<Vec<VirtualDirectoryEntry>, VirtualWorkspaceError> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    if !source.exists() {
        return Ok(Vec::new());
    }

    for entry in std::fs::read_dir(source)?.flatten() {
        let file_type = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let source_path = entry.path();
        if file_type.is_dir() {
            let relative = append_relative(virtual_relative, &name);
            dirs.push(VirtualDirectoryEntry {
                name,
                path: virtual_join(root_uri, &relative),
                source_path: source_path.to_string_lossy().to_string(),
                kind: VirtualReferenceKind::Folder,
                is_markdown: false,
                missing: false,
            });
        } else if file_type.is_file() && is_markdown_path(&source_path) {
            files.push(VirtualDirectoryEntry {
                name,
                path: source_path.to_string_lossy().to_string(),
                source_path: source_path.to_string_lossy().to_string(),
                kind: VirtualReferenceKind::File,
                is_markdown: true,
                missing: false,
            });
        }
    }

    dirs.sort_by_key(|entry| entry.name.to_lowercase());
    files.sort_by_key(|entry| entry.name.to_lowercase());
    dirs.extend(files);
    Ok(dirs)
}

fn source_dir_for_virtual_path(workspace: &VirtualWorkspace, relative: &str) -> Option<PathBuf> {
    let mut parts = relative.split('/');
    let root = parts.next()?;
    let rest = parts.collect::<Vec<_>>();

    workspace.references.iter().find_map(|reference| {
        if reference.kind != VirtualReferenceKind::Folder || root_name(reference) != root {
            return None;
        }
        let mut source = PathBuf::from(&reference.path);
        for component in &rest {
            if component.is_empty() || *component == "." || *component == ".." {
                return None;
            }
            source.push(component);
        }
        Some(source)
    })
}

fn collect_markdown_files(
    source_dir: &Path,
    virtual_relative: &str,
    files: &mut Vec<IndexedFile>,
    dirs: &mut HashSet<PathBuf>,
    root_uri: &str,
) {
    let Ok(entries) = std::fs::read_dir(source_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let source_path = entry.path();
        if file_type.is_dir() {
            let child_relative = append_relative(virtual_relative, &name);
            collect_markdown_files(&source_path, &child_relative, files, dirs, root_uri);
        } else if file_type.is_file() && is_markdown_path(&source_path) {
            let relative_path = append_relative(virtual_relative, &name);
            files.push(IndexedFile {
                path: source_path,
                relative_path: relative_path.clone(),
                name,
            });
            register_virtual_ancestors(dirs, &relative_path, root_uri);
        }
    }
}

fn register_virtual_ancestors(dirs: &mut HashSet<PathBuf>, relative_file: &str, root_uri: &str) {
    let Some((mut dir, _file)) = relative_file.rsplit_once('/') else {
        return;
    };
    loop {
        dirs.insert(PathBuf::from(virtual_join(root_uri, dir)));
        let Some((parent, _name)) = dir.rsplit_once('/') else {
            break;
        };
        dir = parent;
    }
}

fn virtual_relative_path<'a>(root_uri: &str, directory: &'a str) -> Option<&'a str> {
    let prefix = format!("{root_uri}/");
    let relative = directory.strip_prefix(&prefix)?;
    if relative.is_empty() {
        None
    } else {
        Some(relative)
    }
}

fn virtual_join(root_uri: &str, relative: &str) -> String {
    format!("{root_uri}/{}", relative.trim_matches('/'))
}

fn append_relative(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{parent}/{child}")
    }
}

fn root_name(reference: &VirtualReference) -> String {
    file_name(&reference.path)
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn sort_entries(entries: &mut [VirtualDirectoryEntry]) {
    entries.sort_by(|a, b| {
        match (
            a.kind == VirtualReferenceKind::Folder,
            b.kind == VirtualReferenceKind::Folder,
        ) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn registry_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("virtual_workspaces.json");
        (dir, path)
    }

    #[test]
    fn parse_files_csv_rejects_empty_lists() {
        assert!(matches!(
            parse_files_csv(" , "),
            Err(VirtualWorkspaceError::EmptyFileList)
        ));
    }

    #[test]
    fn create_rejects_non_absolute_paths() {
        let (_dir, path) = registry_path();
        let registry = VirtualWorkspaceRegistry::at(path);
        let err = registry
            .create("drafts", &[PathBuf::from("relative.md")])
            .unwrap_err();
        assert!(matches!(err, VirtualWorkspaceError::NonAbsolutePath(_)));
    }

    #[test]
    fn create_persists_canonical_absolute_references() {
        let (_store_dir, store_path) = registry_path();
        let source = tempdir().unwrap();
        let file = source.path().join("note.md");
        fs::write(&file, "# Note").unwrap();

        let registry = VirtualWorkspaceRegistry::at(store_path.clone());
        registry
            .create("drafts", std::slice::from_ref(&file))
            .unwrap();

        let loaded = VirtualWorkspaceRegistry::at(store_path)
            .get("drafts")
            .unwrap();
        assert_eq!(loaded.references.len(), 1);
        assert_eq!(
            loaded.references[0].path,
            file.canonicalize().unwrap().to_string_lossy().to_string()
        );
        assert_eq!(loaded.references[0].kind, VirtualReferenceKind::File);
    }

    #[test]
    fn add_and_remove_mutate_only_references() {
        let (_store_dir, store_path) = registry_path();
        let source = tempdir().unwrap();
        let one = source.path().join("one.md");
        let two = source.path().join("two.md");
        fs::write(&one, "# One").unwrap();
        fs::write(&two, "# Two").unwrap();

        let registry = VirtualWorkspaceRegistry::at(store_path);
        registry
            .create("drafts", std::slice::from_ref(&one))
            .unwrap();
        registry.add("drafts", std::slice::from_ref(&two)).unwrap();
        registry
            .remove("drafts", std::slice::from_ref(&one))
            .unwrap();

        let loaded = registry.get("drafts").unwrap();
        assert_eq!(loaded.references.len(), 1);
        assert_eq!(
            loaded.references[0].path,
            two.canonicalize().unwrap().to_string_lossy().to_string()
        );
        assert!(one.exists(), "remove must not delete referenced files");
        assert!(two.exists());
    }

    #[test]
    fn delete_removes_definition_only() {
        let (_store_dir, store_path) = registry_path();
        let source = tempdir().unwrap();
        let file = source.path().join("note.md");
        fs::write(&file, "# Note").unwrap();

        let registry = VirtualWorkspaceRegistry::at(store_path);
        registry
            .create("drafts", std::slice::from_ref(&file))
            .unwrap();
        registry.delete("drafts").unwrap();

        assert!(matches!(
            registry.get("drafts"),
            Err(VirtualWorkspaceError::MissingWorkspace(_))
        ));
        assert!(file.exists(), "delete must not delete referenced files");
    }

    #[test]
    fn read_directory_expands_folder_with_nested_structure() {
        let source = tempdir().unwrap();
        let folder = source.path().join("docs");
        let nested = folder.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(folder.join("root.md"), "# Root").unwrap();
        fs::write(nested.join("child.md"), "# Child").unwrap();
        fs::write(nested.join("ignored.txt"), "ignored").unwrap();

        let workspace = VirtualWorkspace {
            name: "drafts".into(),
            references: normalize_references(&[folder]).unwrap(),
        };
        let root_entries = read_directory(&workspace, &workspace.uri()).unwrap();
        assert_eq!(root_entries[0].name, "docs");
        assert_eq!(root_entries[0].kind, VirtualReferenceKind::Folder);

        let docs_entries = read_directory(&workspace, &root_entries[0].path).unwrap();
        assert_eq!(docs_entries.len(), 2);
        assert_eq!(docs_entries[0].name, "nested");
        assert_eq!(docs_entries[1].name, "root.md");

        let nested_entries = read_directory(&workspace, &docs_entries[0].path).unwrap();
        assert_eq!(nested_entries.len(), 1);
        assert_eq!(nested_entries[0].name, "child.md");
        assert!(nested_entries[0].path.ends_with("child.md"));
    }

    #[test]
    fn missing_direct_reference_is_returned_as_missing() {
        let source = tempdir().unwrap();
        let file = source.path().join("note.md");
        fs::write(&file, "# Note").unwrap();
        let reference = normalize_references(std::slice::from_ref(&file))
            .unwrap()
            .remove(0);
        fs::remove_file(&file).unwrap();

        let workspace = VirtualWorkspace {
            name: "drafts".into(),
            references: vec![reference],
        };
        let entries = read_directory(&workspace, &workspace.uri()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "note.md");
        assert!(entries[0].missing);
    }

    #[test]
    fn index_workspace_uses_virtual_relative_paths() {
        let source = tempdir().unwrap();
        let folder = source.path().join("docs");
        let nested = folder.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("child.md"), "# Child").unwrap();

        let workspace = VirtualWorkspace {
            name: "drafts".into(),
            references: normalize_references(&[folder]).unwrap(),
        };
        let (files, dirs) = index_workspace(&workspace);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative_path, "docs/nested/child.md");
        assert!(dirs.contains(&PathBuf::from(format!("{}/docs/nested", workspace.uri()))));
    }

    #[test]
    fn duplicate_root_names_are_rejected() {
        let source_a = tempdir().unwrap();
        let source_b = tempdir().unwrap();
        let folder_a = source_a.path().join("docs");
        let folder_b = source_b.path().join("docs");
        fs::create_dir(&folder_a).unwrap();
        fs::create_dir(&folder_b).unwrap();

        let err = normalize_references(&[folder_a, folder_b]).unwrap_err();
        assert!(matches!(err, VirtualWorkspaceError::DuplicateRoot(_)));
    }

    #[test]
    fn workspace_uri_round_trips_name() {
        let uri = workspace_uri("Draft Notes");
        assert_eq!(workspace_name_from_uri(&uri), Some("Draft Notes"));
        assert!(is_virtual_workspace_uri(&uri));
    }
}

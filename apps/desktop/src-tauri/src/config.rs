use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A value parsed from a Ghostty-style config file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConfigValue {
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<String>),
}

impl ConfigValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            ConfigValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            ConfigValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            ConfigValue::Bool(b) => Some(*b),
            _ => None,
        }
    }
}

/// Serialize a ConfigValue back to its plain-text representation.
fn value_to_string(value: &ConfigValue) -> String {
    match value {
        ConfigValue::Bool(b) => b.to_string(),
        ConfigValue::Number(n) => {
            if *n == (*n as i64) as f64 {
                (*n as i64).to_string()
            } else {
                n.to_string()
            }
        }
        ConfigValue::String(s) => s.clone(),
        ConfigValue::List(_) => String::new(), // Lists are serialized as repeated keys
    }
}

/// Parse a value string into a typed ConfigValue.
fn parse_value(s: &str) -> ConfigValue {
    let trimmed = s.trim();
    if trimmed.eq_ignore_ascii_case("true") {
        return ConfigValue::Bool(true);
    }
    if trimmed.eq_ignore_ascii_case("false") {
        return ConfigValue::Bool(false);
    }
    if let Ok(n) = trimmed.parse::<f64>() {
        // Only treat as number if it's a valid finite number
        if n.is_finite() {
            return ConfigValue::Number(n);
        }
    }
    ConfigValue::String(trimmed.to_string())
}

/// Parse a Ghostty-style config string into a key-value map.
/// - Lines starting with # are comments
/// - Blank lines are ignored
/// - Format: `key = value`
/// - Repeated keys accumulate into a List
fn parse_config_with_defaults(
    content: &str,
    defaults: Option<&HashMap<String, ConfigValue>>,
) -> HashMap<String, ConfigValue> {
    let mut map: HashMap<String, ConfigValue> = HashMap::new();
    let mut list_keys: HashMap<String, Vec<String>> = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim().to_string();
            let value_str = value.trim().to_string();

            if list_keys.contains_key(&key) {
                // Already seen this key — it's a list
                list_keys.get_mut(&key).unwrap().push(value_str);
            } else if map.contains_key(&key) {
                // Second occurrence — convert to list
                let first = match map.remove(&key).unwrap() {
                    ConfigValue::String(s) => s,
                    ConfigValue::Number(n) => {
                        if n == (n as i64) as f64 {
                            (n as i64).to_string()
                        } else {
                            n.to_string()
                        }
                    }
                    ConfigValue::Bool(b) => b.to_string(),
                    ConfigValue::List(l) => l.join(", "),
                };
                list_keys.insert(key, vec![first, value_str]);
            } else {
                let value = if matches!(
                    defaults.and_then(|values| values.get(&key)),
                    Some(ConfigValue::String(_))
                ) {
                    ConfigValue::String(value_str)
                } else {
                    parse_value(&value_str)
                };
                map.insert(key, value);
            }
        }
    }

    // Convert accumulated list keys into ConfigValue::List
    for (key, values) in list_keys {
        map.insert(key, ConfigValue::List(values));
    }

    map
}

#[cfg(test)]
pub fn parse_config(content: &str) -> HashMap<String, ConfigValue> {
    parse_config_with_defaults(content, None)
}

/// Serialize a config map back to plain-text, preserving comments and
/// structure from the original content. New keys are appended at the end.
pub fn serialize_config(values: &HashMap<String, ConfigValue>, original: &str) -> String {
    let mut result = String::new();
    let mut written_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            result.push_str(line);
            result.push('\n');
            continue;
        }
        if let Some((key, _)) = trimmed.split_once('=') {
            let key = key.trim().to_string();
            if written_keys.contains(&key) {
                // Skip duplicate lines for list keys — we already wrote them all
                continue;
            }
            if let Some(value) = values.get(&key) {
                match value {
                    ConfigValue::List(items) => {
                        for item in items {
                            result.push_str(&format!("{} = {}\n", key, item));
                        }
                    }
                    _ => {
                        result.push_str(&format!("{} = {}\n", key, value_to_string(value)));
                    }
                }
                written_keys.insert(key);
            }
            // If key is not in values, it was removed — skip the line
        } else {
            // Unrecognized line — preserve as-is
            result.push_str(line);
            result.push('\n');
        }
    }

    // Append any new keys not in the original
    for (key, value) in values {
        if !written_keys.contains(key) {
            match value {
                ConfigValue::List(items) => {
                    for item in items {
                        result.push_str(&format!("{} = {}\n", key, item));
                    }
                }
                _ => {
                    result.push_str(&format!("{} = {}\n", key, value_to_string(value)));
                }
            }
        }
    }

    result
}

/// Remove a key from a config file's text, preserving other content.
pub fn remove_key_from_config(key: &str, original: &str) -> String {
    let mut result = String::new();
    for line in original.lines() {
        let trimmed = line.trim();
        if let Some((k, _)) = trimmed.split_once('=') {
            if k.trim() == key {
                continue; // Skip this line
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    result
}

/// All settings with their defaults, derived from `settings.schema.json`.
pub fn default_settings() -> HashMap<String, ConfigValue> {
    settings_schema()
        .into_iter()
        .map(|d| (d.key, d.default))
        .collect()
}

/// The settings schema definition used by the frontend for rendering controls.
/// Loaded from `apps/desktop/shared/settings.schema.json` — single source of
/// truth per `docs/consolidation.md`. Do not declare defaults, labels, or types
/// anywhere else.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingDef {
    pub key: String,
    pub label: String,
    pub description: String,
    pub category: String,
    #[serde(rename = "type")]
    pub value_type: String, // "string" | "number" | "boolean" | "enum" | "list" | "color" | "range" | "font"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>, // enum + list
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>, // range
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>, // range
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>, // range
    /// CSS custom property name (e.g. `--writer-editor-font-size`) that the
    /// frontend should mirror this setting's value into. Optional.
    #[serde(rename = "cssVar", default, skip_serializing_if = "Option::is_none")]
    pub css_var: Option<String>,
    /// Format applied to the value before pushing to `cssVar`. `"px"` appends
    /// a px unit; `"raw"` (or omitted) uses the value as-is.
    #[serde(rename = "cssFormat", default, skip_serializing_if = "Option::is_none")]
    pub css_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalize: Option<SettingNormalization>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<SettingScope>,
    pub default: ConfigValue,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingNormalization {
    Trim,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingScope {
    Global,
}

#[derive(Debug, Deserialize)]
struct SettingsSchemaFile {
    settings: Vec<SettingDef>,
}

const SETTINGS_SCHEMA_JSON: &str = include_str!("../../shared/settings.schema.json");

fn load_schema() -> Vec<SettingDef> {
    let parsed: SettingsSchemaFile =
        serde_json::from_str(SETTINGS_SCHEMA_JSON).expect("settings.schema.json is malformed");
    parsed.settings
}

pub fn settings_schema() -> Vec<SettingDef> {
    load_schema()
}

/// Manages the three-layer settings: defaults → global → workspace.
pub struct Settings {
    defaults: HashMap<String, ConfigValue>,
    normalizers: HashMap<String, SettingNormalization>,
    global_only: HashSet<String>,
    global: HashMap<String, ConfigValue>,
    workspace: HashMap<String, ConfigValue>,
    global_raw: String,
    workspace_raw: String,
    global_path: PathBuf,
    workspace_path: Option<PathBuf>,
}

pub(crate) struct WorkspaceSettingsLayer {
    values: HashMap<String, ConfigValue>,
    raw: String,
    path: PathBuf,
}

pub(crate) struct WorkspaceSettingsLoader {
    defaults: HashMap<String, ConfigValue>,
}

impl WorkspaceSettingsLoader {
    pub(crate) fn read(&self, workspace_root: &Path) -> WorkspaceSettingsLayer {
        let path = workspace_root.join(".writer").join("config");
        let (raw, values) = if path.exists() {
            let raw = std::fs::read_to_string(&path).unwrap_or_default();
            let values = parse_config_with_defaults(&raw, Some(&self.defaults));
            (raw, values)
        } else {
            (String::new(), HashMap::new())
        };
        WorkspaceSettingsLayer { values, raw, path }
    }
}

impl Settings {
    pub fn new(global_config_dir: PathBuf) -> std::io::Result<Self> {
        let defaults = default_settings();
        let schema = settings_schema();
        let normalizers = schema
            .iter()
            .filter_map(|definition| {
                definition
                    .normalize
                    .map(|normalize| (definition.key.clone(), normalize))
            })
            .collect::<HashMap<_, _>>();
        let global_only = schema
            .iter()
            .filter(|definition| definition.scope == Some(SettingScope::Global))
            .map(|definition| definition.key.clone())
            .collect::<HashSet<_>>();
        let global_path = global_config_dir.join("config");

        let (global_raw, global) = Self::read_global(&global_path, &defaults)?;

        let mut settings = Self {
            defaults,
            normalizers,
            global_only,
            global,
            workspace: HashMap::new(),
            global_raw,
            workspace_raw: String::new(),
            global_path,
            workspace_path: None,
        };

        // Migrate from old preferences.json if it exists and config doesn't
        settings.migrate_from_preferences(&global_config_dir)?;
        settings.migrate_theme_fonts()?;
        settings.migrate_editor_width()?;

        Ok(settings)
    }

    fn read_global(
        path: &Path,
        defaults: &HashMap<String, ConfigValue>,
    ) -> std::io::Result<(String, HashMap<String, ConfigValue>)> {
        match std::fs::read_to_string(path) {
            Ok(raw) => {
                let parsed = parse_config_with_defaults(&raw, Some(defaults));
                Ok((raw, parsed))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok((String::new(), HashMap::new()))
            }
            Err(error) => Err(error),
        }
    }

    /// One-time migration: font stacks used to be per-mode theme primaries
    /// (`theme.{light,dark}.{ui,editor,mono}-font`); they are now the global
    /// `fonts.*` settings shared by both modes. For each slot, adopt the old
    /// light value (dark as fallback) unless the new key is already set, then
    /// drop the old keys from the global config. Old keys are kept on a failed
    /// write so a later launch can retry.
    fn migrate_theme_fonts(&mut self) -> std::io::Result<()> {
        const FONT_SLOTS: [(&str, &str, &str); 3] = [
            ("fonts.ui", "theme.light.ui-font", "theme.dark.ui-font"),
            (
                "fonts.editor",
                "theme.light.editor-font",
                "theme.dark.editor-font",
            ),
            (
                "fonts.mono",
                "theme.light.mono-font",
                "theme.dark.mono-font",
            ),
        ];
        for (new_key, light_key, dark_key) in FONT_SLOTS {
            let old = self
                .global
                .get(light_key)
                .or_else(|| self.global.get(dark_key))
                .cloned();
            let Some(value) = old else {
                continue;
            };
            if !self.global.contains_key(new_key) {
                self.set_global(new_key, value)?;
            }
            for old_key in [light_key, dark_key] {
                if self.global.contains_key(old_key) {
                    self.reset_global(old_key)?;
                }
            }
        }
        Ok(())
    }

    /// One-time migration: the editor width used to be the two-state enum
    /// `appearance.editor-width` (`full` | `narrow`); it is now the pixel
    /// slider `editor.content-width`. `narrow` was a 720px column and `full`
    /// filled the pane, which maps onto the slider's top end. Unless the new
    /// key is already set, adopt the mapped value, then drop the old key. An
    /// unrecognized old value is simply dropped. The old key is kept on a
    /// failed write so a later launch can retry.
    fn migrate_editor_width(&mut self) -> std::io::Result<()> {
        const OLD_KEY: &str = "appearance.editor-width";
        const NEW_KEY: &str = "editor.content-width";
        let Some(old) = self.global.get(OLD_KEY) else {
            return Ok(());
        };
        let mapped = match old.as_str() {
            Some("narrow") => Some(720.0),
            Some("full") => Some(1600.0),
            _ => None,
        };
        if let Some(width) = mapped {
            if !self.global.contains_key(NEW_KEY) {
                self.set_global(NEW_KEY, ConfigValue::Number(width))?;
            }
        }
        self.reset_global(OLD_KEY)
    }

    /// One-time migration: read theme from old `preferences.json` (tauri-plugin-store format)
    /// and write it into the new config file. Removes the old file after migration.
    fn migrate_from_preferences(&mut self, app_data_dir: &Path) -> std::io::Result<()> {
        let prefs_path = app_data_dir.join("preferences.json");
        // Only migrate if the global config doesn't already have a theme set
        if self.global.contains_key("appearance.theme") {
            // Old file exists but we already have settings — just clean up
            return match std::fs::remove_file(&prefs_path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            };
        }
        let data = match std::fs::read_to_string(&prefs_path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(theme) = json.get("theme").and_then(|v| v.as_str()) {
                self.set_global("appearance.theme", ConfigValue::String(theme.to_string()))?;
            }
        }
        std::fs::remove_file(&prefs_path)
    }

    /// Load workspace-level config from `{workspace_root}/.writer/config`.
    #[cfg(test)]
    pub fn load_workspace(&mut self, workspace_root: &Path) {
        let layer = self.workspace_loader().read(workspace_root);
        self.install_workspace_layer(layer);
    }

    /// Snapshot immutable parser inputs while the settings lock is held; the
    /// returned loader performs filesystem I/O without retaining that lock.
    pub(crate) fn workspace_loader(&self) -> WorkspaceSettingsLoader {
        WorkspaceSettingsLoader {
            defaults: self.defaults.clone(),
        }
    }

    pub(crate) fn install_workspace_layer(&mut self, layer: WorkspaceSettingsLayer) {
        self.workspace = layer.values;
        self.workspace_raw = layer.raw;
        self.workspace_path = Some(layer.path);
    }

    /// Clear workspace-level settings.
    pub fn clear_workspace(&mut self) {
        self.workspace.clear();
        self.workspace_raw.clear();
        self.workspace_path = None;
    }

    /// Get the merged value for a key: workspace → global → default.
    pub fn get(&self, key: &str) -> Option<&ConfigValue> {
        if self.global_only.contains(key) {
            return self.get_global_or_default(key);
        }
        self.workspace
            .get(key)
            .or_else(|| self.global.get(key))
            .or_else(|| self.defaults.get(key))
    }

    /// Get an app-level setting without allowing a workspace config override.
    pub fn get_global_or_default(&self, key: &str) -> Option<&ConfigValue> {
        self.global.get(key).or_else(|| self.defaults.get(key))
    }

    /// Get all merged settings as a flat map.
    pub fn merged(&self) -> HashMap<String, ConfigValue> {
        let mut result = self.defaults.clone();
        for (k, v) in &self.global {
            result.insert(k.clone(), v.clone());
        }
        for (k, v) in &self.workspace {
            if !self.global_only.contains(k) {
                result.insert(k.clone(), v.clone());
            }
        }
        result
    }

    /// Set a value at the global scope, writing to disk.
    pub fn set_global(&mut self, key: &str, value: ConfigValue) -> std::io::Result<()> {
        self.reload_global()?;
        let value = self.normalize_value(key, value);
        let mut current = parse_config_with_defaults(&self.global_raw, Some(&self.defaults));
        current.insert(key.to_string(), value);
        let next_raw = serialize_config(&current, &self.global_raw);
        if let Some(parent) = self.global_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.global_path, &next_raw)?;
        self.global = current;
        self.global_raw = next_raw;
        Ok(())
    }

    /// Set a value at the workspace scope, writing to disk.
    pub fn set_workspace(&mut self, key: &str, value: ConfigValue) -> std::io::Result<()> {
        if self.global_only.contains(key) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("setting {key} is global-only"),
            ));
        }
        let value = self.normalize_value(key, value);
        let ws_path = match &self.workspace_path {
            Some(p) => p.clone(),
            None => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "no workspace config path",
                ))
            }
        };
        self.workspace.insert(key.to_string(), value.clone());
        let mut current = parse_config_with_defaults(&self.workspace_raw, Some(&self.defaults));
        current.insert(key.to_string(), value);
        self.workspace_raw = serialize_config(&current, &self.workspace_raw);
        if let Some(parent) = ws_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&ws_path, &self.workspace_raw)
    }

    fn normalize_value(&self, key: &str, value: ConfigValue) -> ConfigValue {
        match (self.normalizers.get(key), value) {
            (Some(SettingNormalization::Trim), ConfigValue::String(value)) => {
                ConfigValue::String(value.trim().to_string())
            }
            (_, value) => value,
        }
    }

    /// Remove a key override from the global scope.
    pub fn reset_global(&mut self, key: &str) -> std::io::Result<()> {
        self.reload_global()?;
        let mut current = parse_config_with_defaults(&self.global_raw, Some(&self.defaults));
        current.remove(key);
        let next_raw = remove_key_from_config(key, &self.global_raw);
        if let Some(parent) = self.global_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.global_path, &next_raw)?;
        self.global = current;
        self.global_raw = next_raw;
        Ok(())
    }

    /// Remove a key override from the workspace scope.
    pub fn reset_workspace(&mut self, key: &str) -> std::io::Result<()> {
        let ws_path = match &self.workspace_path {
            Some(p) => p.clone(),
            None => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "no workspace config path",
                ))
            }
        };
        self.workspace.remove(key);
        self.workspace_raw = remove_key_from_config(key, &self.workspace_raw);
        std::fs::write(&ws_path, &self.workspace_raw)
    }

    /// Reload global config from disk.
    pub fn reload_global(&mut self) -> std::io::Result<()> {
        let (global_raw, global) = Self::read_global(&self.global_path, &self.defaults)?;
        self.global_raw = global_raw;
        self.global = global;
        Ok(())
    }

    /// Path to the global config file.
    pub fn global_path(&self) -> &Path {
        &self.global_path
    }

    /// Path to the workspace config file, if any.
    pub fn workspace_path(&self) -> Option<&Path> {
        self.workspace_path.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple() {
        let input = "key = value\nnumber = 42\nbool = true\n";
        let result = parse_config(input);
        assert_eq!(
            result.get("key"),
            Some(&ConfigValue::String("value".into()))
        );
        assert_eq!(result.get("number"), Some(&ConfigValue::Number(42.0)));
        assert_eq!(result.get("bool"), Some(&ConfigValue::Bool(true)));
    }

    #[test]
    fn test_parse_comments_and_blanks() {
        let input = "# comment\n\nkey = value\n# another comment\n";
        let result = parse_config(input);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result.get("key"),
            Some(&ConfigValue::String("value".into()))
        );
    }

    #[test]
    fn test_parse_dotted_keys() {
        let input = "editor.font-size = 16\nappearance.theme = dark\n";
        let result = parse_config(input);
        assert_eq!(
            result.get("editor.font-size"),
            Some(&ConfigValue::Number(16.0))
        );
        assert_eq!(
            result.get("appearance.theme"),
            Some(&ConfigValue::String("dark".into()))
        );
    }

    #[test]
    fn test_parse_list_values() {
        let input =
            "files.exclude = node_modules\nfiles.exclude = .DS_Store\nfiles.exclude = dist\n";
        let result = parse_config(input);
        assert_eq!(
            result.get("files.exclude"),
            Some(&ConfigValue::List(vec![
                "node_modules".into(),
                ".DS_Store".into(),
                "dist".into()
            ]))
        );
    }

    #[test]
    fn test_serialize_preserves_comments() {
        let original = "# My settings\ntheme = dark\n\n# Font settings\nfont-size = 14\n";
        let mut values = HashMap::new();
        values.insert("theme".into(), ConfigValue::String("light".into()));
        values.insert("font-size".into(), ConfigValue::Number(16.0));
        let result = serialize_config(&values, original);
        assert!(result.contains("# My settings"));
        assert!(result.contains("theme = light"));
        assert!(result.contains("# Font settings"));
        assert!(result.contains("font-size = 16"));
    }

    #[test]
    fn test_serialize_appends_new_keys() {
        let original = "theme = dark\n";
        let mut values = HashMap::new();
        values.insert("theme".into(), ConfigValue::String("dark".into()));
        values.insert("font-size".into(), ConfigValue::Number(14.0));
        let result = serialize_config(&values, original);
        assert!(result.contains("theme = dark"));
        assert!(result.contains("font-size = 14"));
    }

    #[test]
    fn test_remove_key() {
        let original = "theme = dark\nfont-size = 14\nline-height = 1.6\n";
        let result = remove_key_from_config("font-size", original);
        assert!(!result.contains("font-size"));
        assert!(result.contains("theme = dark"));
        assert!(result.contains("line-height = 1.6"));
    }

    #[test]
    fn test_roundtrip() {
        let input = "editor.font-size = 16\nappearance.theme = system\n";
        let parsed = parse_config(input);
        let serialized = serialize_config(&parsed, input);
        let reparsed = parse_config(&serialized);
        assert_eq!(parsed, reparsed);
    }

    #[test]
    fn test_settings_merge_order() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();

        // Default
        assert_eq!(
            settings.get("editor.font-size"),
            Some(&ConfigValue::Number(16.0))
        );

        // Global override
        settings
            .set_global("editor.font-size", ConfigValue::Number(18.0))
            .unwrap();
        assert_eq!(
            settings.get("editor.font-size"),
            Some(&ConfigValue::Number(18.0))
        );
    }

    #[test]
    fn test_theme_font_migration() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("config"),
            "theme.light.editor-font = Georgia, serif\n\
             theme.dark.editor-font = Iowan Old Style, serif\n\
             theme.dark.mono-font = Fira Code, monospace\n",
        )
        .unwrap();

        let settings = Settings::new(dir.path().to_path_buf()).unwrap();

        // Light wins when both modes were customized; dark is the fallback.
        assert_eq!(
            settings.get("fonts.editor"),
            Some(&ConfigValue::String("Georgia, serif".into()))
        );
        assert_eq!(
            settings.get("fonts.mono"),
            Some(&ConfigValue::String("Fira Code, monospace".into()))
        );
        // Untouched slot falls back to the schema default.
        assert_eq!(settings.get("fonts.ui"), settings.defaults.get("fonts.ui"));

        // Old keys are gone from the config file and from the merged view.
        let raw = std::fs::read_to_string(dir.path().join("config")).unwrap();
        assert!(!raw.contains("theme.light.editor-font"));
        assert!(!raw.contains("theme.dark.editor-font"));
        assert!(!raw.contains("theme.dark.mono-font"));
        assert!(settings.get("theme.light.editor-font").is_none());

        // Migration is idempotent: an already-set new key is not overwritten.
        std::fs::write(
            dir.path().join("config"),
            "fonts.editor = Palatino, serif\ntheme.light.editor-font = Georgia, serif\n",
        )
        .unwrap();
        let settings = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            settings.get("fonts.editor"),
            Some(&ConfigValue::String("Palatino, serif".into()))
        );
    }

    #[test]
    fn test_editor_width_migration() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config");

        std::fs::write(&config_path, "appearance.editor-width = narrow\n").unwrap();
        let settings = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            settings.get("editor.content-width"),
            Some(&ConfigValue::Number(720.0))
        );
        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(!raw.contains("appearance.editor-width"));
        assert!(settings.get("appearance.editor-width").is_none());

        // `full` maps onto the slider's top end.
        std::fs::write(&config_path, "appearance.editor-width = full\n").unwrap();
        let settings = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            settings.get("editor.content-width"),
            Some(&ConfigValue::Number(1600.0))
        );

        // An already-set new key wins; the old key is still removed.
        std::fs::write(
            &config_path,
            "editor.content-width = 900\nappearance.editor-width = narrow\n",
        )
        .unwrap();
        let settings = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            settings.get("editor.content-width"),
            Some(&ConfigValue::Number(900.0))
        );
        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(!raw.contains("appearance.editor-width"));

        // An unrecognized old value is dropped and the default applies.
        std::fs::write(&config_path, "appearance.editor-width = wide\n").unwrap();
        let settings = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            settings.get("editor.content-width"),
            settings.defaults.get("editor.content-width")
        );
        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(!raw.contains("appearance.editor-width"));
    }

    #[test]
    fn test_settings_workspace_override() {
        let dir = tempfile::tempdir().unwrap();
        let ws_dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();

        settings
            .set_global("editor.font-size", ConfigValue::Number(18.0))
            .unwrap();
        settings.load_workspace(ws_dir.path());
        settings
            .set_workspace("editor.font-size", ConfigValue::Number(20.0))
            .unwrap();

        assert_eq!(
            settings.get("editor.font-size"),
            Some(&ConfigValue::Number(20.0))
        );
    }

    #[test]
    fn test_settings_reset() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();

        settings
            .set_global("editor.font-size", ConfigValue::Number(18.0))
            .unwrap();
        assert_eq!(
            settings.get("editor.font-size"),
            Some(&ConfigValue::Number(18.0))
        );

        settings.reset_global("editor.font-size").unwrap();
        // Falls back to default
        assert_eq!(
            settings.get("editor.font-size"),
            Some(&ConfigValue::Number(16.0))
        );
    }

    #[test]
    fn stale_settings_instances_merge_global_writes_and_resets() {
        let dir = tempfile::tempdir().unwrap();
        let mut first_window = Settings::new(dir.path().to_path_buf()).unwrap();
        let mut second_window = Settings::new(dir.path().to_path_buf()).unwrap();

        first_window
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("Ghostty".into()),
            )
            .unwrap();
        second_window
            .set_global("appearance.sidebar-visible", ConfigValue::Bool(false))
            .unwrap();

        let after_write = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            after_write.get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
        assert_eq!(
            after_write.get("appearance.sidebar-visible"),
            Some(&ConfigValue::Bool(false))
        );

        second_window
            .reset_global("appearance.sidebar-visible")
            .unwrap();
        let after_reset = Settings::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            after_reset.get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
    }

    #[test]
    fn reload_global_treats_missing_as_empty_and_preserves_memory_on_read_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();
        settings
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("Ghostty".into()),
            )
            .unwrap();

        std::fs::remove_file(settings.global_path()).unwrap();
        settings.reload_global().unwrap();
        assert_eq!(
            settings.get("workspace.default-terminal"),
            Some(&ConfigValue::String(String::new()))
        );

        settings
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("Ghostty".into()),
            )
            .unwrap();
        std::fs::remove_file(settings.global_path()).unwrap();
        std::fs::create_dir(settings.global_path()).unwrap();

        assert!(settings.reload_global().is_err());
        assert_eq!(
            settings.get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
        assert!(settings
            .set_global("appearance.sidebar-visible", ConfigValue::Bool(false))
            .is_err());
        assert!(settings.global_path().is_dir());
    }

    #[test]
    fn terminal_string_setting_preserves_lexical_value_across_reload_and_reset() {
        for value in ["TRUE", "00123", "1e3"] {
            let dir = tempfile::tempdir().unwrap();
            let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();
            settings
                .set_global(
                    "workspace.default-terminal",
                    ConfigValue::String(value.into()),
                )
                .unwrap();

            let mut reloaded = Settings::new(dir.path().to_path_buf()).unwrap();
            assert_eq!(
                reloaded.get("workspace.default-terminal"),
                Some(&ConfigValue::String(value.into()))
            );

            reloaded.reset_global("workspace.default-terminal").unwrap();
            let reset = Settings::new(dir.path().to_path_buf()).unwrap();
            assert_eq!(
                reset.get("workspace.default-terminal"),
                Some(&ConfigValue::String(String::new()))
            );
        }
    }

    #[test]
    fn terminal_string_setting_trims_at_the_settings_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();

        settings
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("  Ghostty  ".into()),
            )
            .unwrap();
        assert_eq!(
            settings.get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );

        settings
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("   ".into()),
            )
            .unwrap();
        assert_eq!(
            settings.get("workspace.default-terminal"),
            Some(&ConfigValue::String(String::new()))
        );
    }

    #[test]
    fn global_setting_lookup_ignores_workspace_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path().to_path_buf()).unwrap();
        settings
            .set_global(
                "workspace.default-terminal",
                ConfigValue::String("Ghostty".into()),
            )
            .unwrap();
        std::fs::create_dir_all(workspace.path().join(".writer")).unwrap();
        std::fs::write(
            workspace.path().join(".writer/config"),
            "workspace.default-terminal = OtherTerminal\n",
        )
        .unwrap();
        settings.load_workspace(workspace.path());

        assert_eq!(
            settings.get_global_or_default("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
        assert_eq!(
            settings
                .set_workspace(
                    "workspace.default-terminal",
                    ConfigValue::String("OtherTerminal".into()),
                )
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert_eq!(
            settings.get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
        assert_eq!(
            settings.merged().get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
    }

    #[test]
    fn test_value_with_equals_sign() {
        // Values can contain = signs
        let input = "template = title: My Title\n";
        let result = parse_config(input);
        // split_once on '=' should keep everything after first =
        assert_eq!(
            result.get("template"),
            Some(&ConfigValue::String("title: My Title".into()))
        );
    }

    #[test]
    fn test_parse_false_value() {
        let input = "editor.spell-check = false\n";
        let result = parse_config(input);
        assert_eq!(
            result.get("editor.spell-check"),
            Some(&ConfigValue::Bool(false))
        );
    }

    #[test]
    fn test_parse_float() {
        let input = "editor.line-height = 1.6\n";
        let result = parse_config(input);
        assert_eq!(
            result.get("editor.line-height"),
            Some(&ConfigValue::Number(1.6))
        );
    }
}

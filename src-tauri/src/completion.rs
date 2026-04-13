use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::env;
#[cfg(unix)]
use std::ffi::{CStr, CString};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const MAX_COMPLETION_ITEMS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub value: String,
    pub display: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResponse {
    pub replace_from: usize,
    pub replace_to: usize,
    pub common_prefix: Option<String>,
    pub items: Vec<CompletionItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionContext {
    replace_from: usize,
    replace_to: usize,
    prefix: String,
    is_command_position: bool,
}

static ZSH_WORDS: OnceLock<Vec<String>> = OnceLock::new();

/// Cached set of all known command names (PATH executables + shell builtins).
static COMMAND_SET: OnceLock<HashSet<String>> = OnceLock::new();

fn get_command_set() -> &'static HashSet<String> {
    COMMAND_SET.get_or_init(|| {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        build_command_set(
            load_zsh_words(&shell),
            path_commands("").unwrap_or_default(),
        )
    })
}

fn build_command_set(zsh_words: Vec<String>, path_commands: BTreeSet<String>) -> HashSet<String> {
    zsh_words.into_iter().chain(path_commands).collect()
}

/// Returns true if the given command name exists as a PATH executable or shell builtin.
pub fn check_command_exists(command: &str) -> bool {
    check_command_exists_with(command, get_command_set(), &shell_command_exists)
}

fn check_command_exists_with(
    command: &str,
    command_set: &HashSet<String>,
    shell_lookup: &dyn Fn(&str) -> bool,
) -> bool {
    command_set.contains(command) || shell_lookup(command)
}

fn shell_command_exists(command: &str) -> bool {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    Command::new(shell)
        .env("TOME_LOOKUP_COMMAND", command)
        .args([
            "-lc",
            "emulate -L zsh; command -v -- \"$TOME_LOOKUP_COMMAND\" >/dev/null 2>&1",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return format!("{}/{}", home, rest);
        }
    } else if path == "~" {
        if let Ok(home) = env::var("HOME") {
            return home;
        }
    } else if let Some(rest) = path.strip_prefix('~') {
        let (username, suffix) = match rest.split_once('/') {
            Some((username, suffix)) => (username, Some(suffix)),
            None => (rest, None),
        };

        #[cfg(unix)]
        if let Some(home) = resolve_home_for_user(username) {
            return match suffix {
                Some(suffix) if !suffix.is_empty() => format!("{home}/{suffix}"),
                _ => home,
            };
        }
    }
    path.to_string()
}

#[cfg(unix)]
fn resolve_home_for_user(username: &str) -> Option<String> {
    let username = CString::new(username).ok()?;
    let passwd = unsafe { libc::getpwnam(username.as_ptr()) };
    if passwd.is_null() {
        return None;
    }

    let home_dir = unsafe { CStr::from_ptr((*passwd).pw_dir) };
    Some(home_dir.to_string_lossy().into_owned())
}

/// Returns true if the given path exists on the filesystem.
/// Relative paths are resolved against `cwd`; `~/…` paths expand the home directory.
pub fn check_path_exists(path: &str, cwd: &str) -> bool {
    let expanded = expand_tilde(path);
    let p = Path::new(&expanded);
    if p.is_absolute() {
        p.exists()
    } else {
        Path::new(cwd).join(p).exists()
    }
}

pub fn request_completion(
    shell: &str,
    current_dir: &Path,
    text: &str,
    cursor: usize,
) -> Result<CompletionResponse, String> {
    let context = extract_completion_context(text, cursor);

    if !shell.contains("zsh") {
        return Ok(empty_response(&context));
    }

    if context.prefix.is_empty() {
        return Ok(empty_response(&context));
    }

    let items = if context.is_command_position {
        complete_commands(shell, &context.prefix)?
    } else {
        complete_paths(current_dir, &context.prefix)?
    };

    let common_prefix = compute_common_prefix(items.iter().map(|item| item.value.as_str()))
        .filter(|prefix| prefix.len() > context.prefix.len());

    Ok(CompletionResponse {
        replace_from: context.replace_from,
        replace_to: context.replace_to,
        common_prefix,
        items,
    })
}

fn empty_response(context: &CompletionContext) -> CompletionResponse {
    CompletionResponse {
        replace_from: context.replace_from,
        replace_to: context.replace_to,
        common_prefix: None,
        items: Vec::new(),
    }
}

fn extract_completion_context(text: &str, cursor: usize) -> CompletionContext {
    let clamped_cursor = cursor.min(text.len());
    let mut replace_from = clamped_cursor;
    let mut replace_to = text.len();

    for (idx, ch) in text[..clamped_cursor].char_indices().rev() {
        if is_completion_boundary(ch) {
            replace_from = idx + ch.len_utf8();
            break;
        }
        replace_from = idx;
    }

    for (idx, ch) in text[clamped_cursor..].char_indices() {
        if is_completion_boundary(ch) {
            replace_to = clamped_cursor + idx;
            break;
        }
    }

    let line_start = text[..replace_from].rfind('\n').map(|idx| idx + 1).unwrap_or(0);
    let before_token = text[line_start..replace_from].trim_end();
    let is_command_position = before_token.is_empty()
        || before_token.ends_with('|')
        || before_token.ends_with("&&")
        || before_token.ends_with("||")
        || before_token.ends_with(';')
        || before_token.ends_with('(');

    CompletionContext {
        replace_from,
        replace_to,
        prefix: text[replace_from..clamped_cursor].to_string(),
        is_command_position,
    }
}

fn is_completion_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '|' | '&' | ';' | '(' | ')' | '<' | '>')
}

fn starts_with_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .collect::<String>()
        .starts_with(&needle.chars().map(|c| c.to_ascii_lowercase()).collect::<String>())
}

fn complete_commands(shell: &str, prefix: &str) -> Result<Vec<CompletionItem>, String> {
    let mut candidates = BTreeMap::new();

    for command in path_commands(prefix)? {
        candidates.entry(command).or_insert_with(|| "command".to_string());
    }

    for word in zsh_words(shell) {
        if starts_with_ignore_case(word, prefix) {
            candidates.entry(word.clone()).or_insert_with(|| "builtin".to_string());
        }
    }

    Ok(candidates
        .into_iter()
        .take(MAX_COMPLETION_ITEMS)
        .map(|(value, kind)| CompletionItem {
            display: value.clone(),
            value,
            kind,
        })
        .collect())
}

fn path_commands(prefix: &str) -> Result<BTreeSet<String>, String> {
    let mut commands = BTreeSet::new();

    let Some(path_var) = env::var_os("PATH") else {
        return Ok(commands);
    };

    for dir in env::split_paths(&path_var) {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let candidate = file_name.to_string_lossy();
            if !starts_with_ignore_case(&candidate, prefix) {
                continue;
            }

            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_file() && is_executable(&metadata) {
                commands.insert(candidate.to_string());
            }
        }
    }

    Ok(commands)
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

fn zsh_words(shell: &str) -> &'static Vec<String> {
    ZSH_WORDS.get_or_init(|| load_zsh_words(shell))
}

fn load_zsh_words(shell: &str) -> Vec<String> {
    let fallback = vec![
        "alias", "autoload", "bg", "bindkey", "builtin", "cd", "command", "dirs", "echo", "eval",
        "exec", "exit", "export", "fc", "fg", "function", "hash", "history", "if", "jobs", "local",
        "noglob", "popd", "print", "pushd", "pwd", "read", "readonly", "repeat", "return",
        "select", "set", "shift", "source", "test", "then", "time", "trap", "typeset", "ulimit",
        "umask", "unalias", "unset", "until", "wait", "while",
    ];

    let output = Command::new(shell)
        .args([
            "-lc",
            "emulate -L zsh; print -rl -- ${(ok)builtins} ${(ok)reswords}",
        ])
        .output();

    let Ok(output) = output else {
        return fallback.into_iter().map(String::from).collect();
    };

    if !output.status.success() {
        return fallback.into_iter().map(String::from).collect();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut words = BTreeSet::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            words.insert(trimmed.to_string());
        }
    }

    if words.is_empty() {
        fallback.into_iter().map(String::from).collect()
    } else {
        words.into_iter().collect()
    }
}

fn complete_paths(current_dir: &Path, prefix: &str) -> Result<Vec<CompletionItem>, String> {
    let Some((base_dir, display_prefix, name_prefix)) = resolve_path_base(current_dir, prefix)
    else {
        return Ok(Vec::new());
    };

    let entries = match fs::read_dir(&base_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let mut items = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !starts_with_ignore_case(&name, &name_prefix) {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let is_directory = file_type.is_dir();
        let mut value = format!("{display_prefix}{name}");
        if is_directory {
            value.push('/');
        }

        items.push(CompletionItem {
            display: value.clone(),
            value,
            kind: if is_directory {
                "directory".to_string()
            } else {
                "path".to_string()
            },
        });
    }

    items.sort_by(|left, right| left.value.cmp(&right.value));
    if items.len() > MAX_COMPLETION_ITEMS {
        items.truncate(MAX_COMPLETION_ITEMS);
    }

    Ok(items)
}

fn resolve_path_base(current_dir: &Path, prefix: &str) -> Option<(PathBuf, String, String)> {
    let home_dir = env::var_os("HOME").map(PathBuf::from);

    let (display_prefix, name_prefix) = match prefix.rsplit_once('/') {
        Some((dir, name)) => (format!("{dir}/"), name.to_string()),
        None => (String::new(), prefix.to_string()),
    };

    let base_dir = if prefix.starts_with("~/") {
        let home_dir = home_dir?;
        let dir_part = display_prefix.strip_prefix("~/").unwrap_or("");
        home_dir.join(dir_part)
    } else if prefix.starts_with('/') {
        PathBuf::from(&display_prefix)
    } else if display_prefix.is_empty() {
        current_dir.to_path_buf()
    } else {
        current_dir.join(&display_prefix)
    };

    Some((base_dir, display_prefix, name_prefix))
}

fn compute_common_prefix<'a, I>(mut values: I) -> Option<String>
where
    I: Iterator<Item = &'a str>,
{
    let first = values.next()?.to_string();
    let mut prefix_chars: Vec<char> = first.chars().collect();

    for value in values {
        let mut new_prefix = Vec::new();
        for (left, right) in prefix_chars.iter().zip(value.chars()) {
            if !left.eq_ignore_ascii_case(&right) {
                break;
            }
            // Preserve the character case from the first value
            new_prefix.push(*left);
        }
        prefix_chars = new_prefix;
        if prefix_chars.is_empty() {
            break;
        }
    }

    Some(prefix_chars.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn extracts_context_for_argument_token() {
        let context = extract_completion_context("git sta", 7);

        assert_eq!(
            context,
            CompletionContext {
                replace_from: 4,
                replace_to: 7,
                prefix: "sta".to_string(),
                is_command_position: false,
            }
        );
    }

    #[test]
    fn extracts_context_for_command_token() {
        let context = extract_completion_context("gi", 2);

        assert_eq!(
            context,
            CompletionContext {
                replace_from: 0,
                replace_to: 2,
                prefix: "gi".to_string(),
                is_command_position: true,
            }
        );
    }

    #[test]
    fn extracts_context_after_shell_connectors() {
        let context = extract_completion_context("echo hi && gi", 13);

        assert_eq!(context.replace_from, 11);
        assert_eq!(context.prefix, "gi");
        assert!(context.is_command_position);
    }

    #[test]
    fn computes_common_prefix() {
        let prefix = compute_common_prefix(["status", "stash", "stat"].into_iter());
        assert_eq!(prefix.as_deref(), Some("sta"));
    }

    #[test]
    fn completes_paths_relative_to_cwd() {
        let temp_root = unique_test_dir();
        fs::create_dir_all(temp_root.join("src")).unwrap();
        fs::write(temp_root.join("status.txt"), "ok").unwrap();

        let items = complete_paths(&temp_root, "st").unwrap();

        assert_eq!(
            items,
            vec![CompletionItem {
                value: "status.txt".to_string(),
                display: "status.txt".to_string(),
                kind: "path".to_string(),
            }]
        );

        fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn completes_nested_paths() {
        let temp_root = unique_test_dir();
        fs::create_dir_all(temp_root.join("src/components")).unwrap();

        let items = complete_paths(&temp_root, "src/co").unwrap();

        assert_eq!(
            items,
            vec![CompletionItem {
                value: "src/components/".to_string(),
                display: "src/components/".to_string(),
                kind: "directory".to_string(),
            }]
        );

        fs::remove_dir_all(temp_root).unwrap();
    }

    fn unique_test_dir() -> PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        env::temp_dir().join(format!("tome-completion-test-{suffix}"))
    }

    #[test]
    fn completes_paths_case_insensitive() {
        let temp_root = unique_test_dir();
        fs::create_dir_all(temp_root.join("Documents")).unwrap();

        // "doc" should match "Documents"
        let items = complete_paths(&temp_root, "doc").unwrap();
        assert!(items.iter().any(|i| i.value == "Documents/"));

        // "DOC" should also match "Documents"
        let items = complete_paths(&temp_root, "DOC").unwrap();
        assert!(items.iter().any(|i| i.value == "Documents/"));

        fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn computes_common_prefix_case_insensitive() {
        // Different cases should still find common prefix
        let prefix = compute_common_prefix(["Documents", "documents", "DOC"].into_iter());
        assert_eq!(prefix.as_deref(), Some("Doc"));
    }

    // -----------------------------------------------------------------------
    // check_path_exists
    // -----------------------------------------------------------------------

    #[test]
    fn check_path_exists_absolute_existing() {
        // /tmp is guaranteed to exist on macOS / Linux
        assert!(check_path_exists("/tmp", "/"));
    }

    #[test]
    fn check_path_exists_absolute_nonexistent() {
        assert!(!check_path_exists("/nonexistent_tome_test_xyz", "/"));
    }

    #[test]
    fn check_path_exists_relative_existing() {
        let temp_root = unique_test_dir();
        fs::create_dir_all(temp_root.join("subdir")).unwrap();
        let cwd = temp_root.to_string_lossy().to_string();

        assert!(check_path_exists("subdir", &cwd));

        fs::remove_dir_all(&temp_root).unwrap();
    }

    #[test]
    fn check_path_exists_relative_nonexistent() {
        let temp_root = unique_test_dir();
        fs::create_dir_all(&temp_root).unwrap();
        let cwd = temp_root.to_string_lossy().to_string();

        assert!(!check_path_exists("no_such_dir", &cwd));

        fs::remove_dir_all(&temp_root).unwrap();
    }

    #[test]
    fn check_path_exists_tilde_home() {
        if env::var("HOME").is_err() {
            return; // skip if HOME not set
        }
        // ~ itself must exist
        assert!(check_path_exists("~", "/"));
    }

    #[test]
    fn check_path_exists_tilde_username_home() {
        let Ok(username) = env::var("USER") else {
            return;
        };

        let path = format!("~{username}");
        assert!(check_path_exists(&path, "/"));
    }

    // -----------------------------------------------------------------------
    // check_command_exists
    // -----------------------------------------------------------------------

    #[test]
    fn check_command_exists_bogus_returns_false() {
        assert!(!check_command_exists("__nonexistent_cmd_tome_xyz__"));
    }

    #[test]
    fn check_command_exists_builtin_pwd() {
        // "pwd" is a zsh builtin and is also in PATH as /bin/pwd
        assert!(check_command_exists("pwd"));
    }

    #[test]
    fn build_command_set_merges_path_commands_with_shell_words() {
        let command_set = build_command_set(
            vec!["pwd".to_string()],
            BTreeSet::from(["claude".to_string(), "codex".to_string()]),
        );

        assert!(command_set.contains("pwd"));
        assert!(command_set.contains("claude"));
        assert!(command_set.contains("codex"));
    }

    #[test]
    fn check_command_exists_with_falls_back_to_shell_lookup() {
        let command_set = HashSet::new();

        let exists =
            check_command_exists_with("claude", &command_set, &|command| command == "claude");

        assert!(exists);
    }

    #[test]
    fn check_command_exists_with_prefers_cached_command_set() {
        let command_set = HashSet::from(["claude".to_string()]);

        let exists = check_command_exists_with("claude", &command_set, &|_| false);

        assert!(exists);
    }
}

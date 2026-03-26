use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
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

fn complete_commands(shell: &str, prefix: &str) -> Result<Vec<CompletionItem>, String> {
    let mut candidates = BTreeMap::new();

    for command in path_commands(prefix)? {
        candidates.entry(command).or_insert_with(|| "command".to_string());
    }

    for word in zsh_words(shell) {
        if word.starts_with(prefix) {
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
            if !candidate.starts_with(prefix) {
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
        if !name.starts_with(&name_prefix) {
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
    let mut prefix = first;

    for value in values {
        let mut next_prefix = String::new();
        for (left, right) in prefix.chars().zip(value.chars()) {
            if left != right {
                break;
            }
            next_prefix.push(left);
        }
        prefix = next_prefix;
        if prefix.is_empty() {
            break;
        }
    }

    Some(prefix)
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
}

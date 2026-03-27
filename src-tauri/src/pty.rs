use crate::completion::CompletionResponse;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum TerminalEvent {
    #[serde(rename = "output")]
    Output { session_id: String, data: String },
    #[serde(rename = "block")]
    Block {
        session_id: String,
        event_type: String,
        exit_code: Option<i32>,
    },
    #[serde(rename = "alternate_screen")]
    AlternateScreen { session_id: String, active: bool },
    #[serde(rename = "current_directory")]
    CurrentDirectory { session_id: String, path: String },
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    _master: Box<dyn MasterPty + Send>,
    shell: String,
    current_dir: Arc<Mutex<PathBuf>>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create_session(
        &self,
        app: AppHandle,
        initial_cwd: Option<String>,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();
        let initial_dir = resolve_initial_cwd(initial_cwd)?;

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("--login");
        cmd.cwd(&initial_dir);

        // Set TERM_PROGRAM so shell integration can detect us
        cmd.env("TERM_PROGRAM", "tome");
        cmd.env("TERM", "xterm-256color");

        // Write shell integration to a temp location and source it via ZDOTDIR
        if shell.contains("zsh") {
            let integration_dir = std::env::temp_dir().join("tome-shell-integration");
            let _ = std::fs::create_dir_all(&integration_dir);

            // Write a .zshenv that sources the user's real config then loads our hooks
            let user_zdotdir = std::env::var("ZDOTDIR")
                .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
            let zshenv_content = format!(
                "export ZDOTDIR=\"{user_zdotdir}\"\n\
                 [[ -f \"$ZDOTDIR/.zshenv\" ]] && source \"$ZDOTDIR/.zshenv\"\n\
                 {}\n",
                include_str!("../shell-integration/tome.zsh")
            );
            let _ = std::fs::write(integration_dir.join(".zshenv"), zshenv_content);

            // Forward .zshrc loading
            let zshrc_content =
                format!("[[ -f \"{user_zdotdir}/.zshrc\" ]] && source \"{user_zdotdir}/.zshrc\"\n");
            let _ = std::fs::write(integration_dir.join(".zshrc"), zshrc_content);

            cmd.env("ZDOTDIR", integration_dir.to_string_lossy().to_string());
        }

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let sid = session_id.clone();
        let current_dir = Arc::new(Mutex::new(initial_dir));
        let current_dir_for_reader = Arc::clone(&current_dir);

        // Spawn reader thread
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut parser = OutputParser::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let events = parser.parse(&data);

                        for event in events {
                            let te = match event {
                                ParsedEvent::Output(text) => TerminalEvent::Output {
                                    session_id: sid.clone(),
                                    data: text,
                                },
                                ParsedEvent::Block(block_event) => TerminalEvent::Block {
                                    session_id: sid.clone(),
                                    event_type: block_event.event_type,
                                    exit_code: block_event.exit_code,
                                },
                                ParsedEvent::AlternateScreen(active) => {
                                    TerminalEvent::AlternateScreen {
                                        session_id: sid.clone(),
                                        active,
                                    }
                                }
                                ParsedEvent::CurrentDirectory(path) => {
                                    if let Ok(mut cwd) = current_dir_for_reader.lock() {
                                        *cwd = PathBuf::from(&path);
                                    }
                                    TerminalEvent::CurrentDirectory {
                                        session_id: sid.clone(),
                                        path,
                                    }
                                }
                            };
                            let _ = app.emit("terminal-event", te);
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let session = PtySession {
            writer,
            _master: pair.master,
            shell,
            current_dir,
        };

        self.sessions.lock().unwrap().insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn write_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or("Session not found")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session.writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id).ok_or("Session not found")?;
        session
            ._master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))?;
        Ok(())
    }

    pub fn request_completion(
        &self,
        session_id: &str,
        text: &str,
        cursor: usize,
    ) -> Result<CompletionResponse, String> {
        let (shell, current_dir) = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions.get(session_id).ok_or("Session not found")?;
            let current_dir = session
                .current_dir
                .lock()
                .map_err(|_| "Failed to access session cwd".to_string())?
                .clone();
            (session.shell.clone(), current_dir)
        };

        crate::completion::request_completion(&shell, &current_dir, text, cursor)
    }

    pub fn get_current_directory(&self, session_id: &str) -> Result<String, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id).ok_or("Session not found")?;
        let current_dir = session
            .current_dir
            .lock()
            .map_err(|_| "Failed to access session cwd".to_string())?
            .clone();

        Ok(current_dir.to_string_lossy().to_string())
    }
}

fn resolve_initial_cwd(initial_cwd: Option<String>) -> Result<PathBuf, String> {
    match initial_cwd {
        Some(path) => {
            let resolved = PathBuf::from(path);
            if !resolved.exists() {
                return Err(format!(
                    "Initial cwd does not exist: {}",
                    resolved.to_string_lossy()
                ));
            }

            if !resolved.is_dir() {
                return Err(format!(
                    "Initial cwd is not a directory: {}",
                    resolved.to_string_lossy()
                ));
            }

            Ok(resolved)
        }
        None => std::env::current_dir()
            .map_err(|e| format!("Failed to determine current directory: {}", e)),
    }
}

// --- Output Parser ---

#[derive(Debug, PartialEq)]
pub(crate) enum ParsedEvent {
    Output(String),
    Block(BlockEventData),
    AlternateScreen(bool),
    CurrentDirectory(String),
}

#[derive(Debug, PartialEq)]
pub(crate) struct BlockEventData {
    pub event_type: String,
    pub exit_code: Option<i32>,
}

pub(crate) struct OutputParser {
    buffer: String,
}

impl OutputParser {
    fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    fn parse(&mut self, data: &str) -> Vec<ParsedEvent> {
        let mut events = Vec::new();
        self.buffer.push_str(data);

        let mut output_start = 0;
        let mut i = 0;
        let bytes = self.buffer.as_bytes();

        while i < bytes.len() {
            if bytes[i] == 0x1b {
                // Check for alternate screen: ESC [ ? 1049 h/l
                if let Some(rest) = self.buffer.get(i..) {
                    if rest.starts_with("\x1b[?1049h") {
                        if i > output_start {
                            events.push(ParsedEvent::Output(
                                self.buffer[output_start..i].to_string(),
                            ));
                        }
                        events.push(ParsedEvent::AlternateScreen(true));
                        i += 8;
                        output_start = i;
                        continue;
                    }
                    if rest.starts_with("\x1b[?1049l") {
                        if i > output_start {
                            events.push(ParsedEvent::Output(
                                self.buffer[output_start..i].to_string(),
                            ));
                        }
                        events.push(ParsedEvent::AlternateScreen(false));
                        i += 8;
                        output_start = i;
                        continue;
                    }

                    // Check for any OSC sequence: ESC ] ... BEL/ST
                    if rest.starts_with("\x1b]") {
                        if let Some(end) = find_osc_end(rest) {
                            let osc_body = &rest[2..end]; // after ESC ]
                            let skip = if rest.as_bytes().get(end) == Some(&0x07) {
                                end + 1 // BEL
                            } else {
                                end + 2 // ST (\x1b\\)
                            };

                            // OSC 133 → block events
                            if let Some(osc_content) = osc_body.strip_prefix("133;") {
                                if let Some(evt) = parse_osc133(osc_content) {
                                    if i > output_start {
                                        events.push(ParsedEvent::Output(
                                            self.buffer[output_start..i].to_string(),
                                        ));
                                    }
                                    events.push(ParsedEvent::Block(evt));
                                    i += skip;
                                    output_start = i;
                                    continue;
                                }
                            }

                            if let Some(osc_content) = osc_body.strip_prefix("633;") {
                                if let Some(path) = parse_tome_osc(osc_content) {
                                    if i > output_start {
                                        events.push(ParsedEvent::Output(
                                            self.buffer[output_start..i].to_string(),
                                        ));
                                    }
                                    events.push(ParsedEvent::CurrentDirectory(path));
                                    i += skip;
                                    output_start = i;
                                    continue;
                                }
                            }

                            // All other OSC sequences (title, etc.) → strip silently
                            if i > output_start {
                                events.push(ParsedEvent::Output(
                                    self.buffer[output_start..i].to_string(),
                                ));
                            }
                            i += skip;
                            output_start = i;
                            continue;
                        } else {
                            // Incomplete OSC sequence, keep in buffer
                            if i > output_start {
                                events.push(ParsedEvent::Output(
                                    self.buffer[output_start..i].to_string(),
                                ));
                            }
                            self.buffer = self.buffer[i..].to_string();
                            return events;
                        }
                    }
                }
            }
            i += 1;
        }

        if output_start < self.buffer.len() {
            events.push(ParsedEvent::Output(self.buffer[output_start..].to_string()));
        }
        self.buffer.clear();
        events
    }
}

pub(crate) fn find_osc_end(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == 0x07 {
            return Some(i); // BEL terminator
        }
        if bytes[i] == 0x1b && bytes.get(i + 1) == Some(&b'\\') {
            return Some(i); // ST terminator
        }
    }
    None
}

pub(crate) fn parse_osc133(content: &str) -> Option<BlockEventData> {
    let parts: Vec<&str> = content.splitn(2, ';').collect();
    match parts[0] {
        "A" => Some(BlockEventData {
            event_type: "prompt_start".to_string(),
            exit_code: None,
        }),
        "B" => Some(BlockEventData {
            event_type: "input_start".to_string(),
            exit_code: None,
        }),
        "C" => Some(BlockEventData {
            event_type: "command_start".to_string(),
            exit_code: None,
        }),
        "D" => {
            let exit_code = parts.get(1).and_then(|s| s.parse::<i32>().ok());
            Some(BlockEventData {
                event_type: "command_end".to_string(),
                exit_code,
            })
        }
        _ => None,
    }
}

pub(crate) fn parse_tome_osc(content: &str) -> Option<String> {
    let mut parts = content.splitn(3, ';');
    match (parts.next(), parts.next()) {
        (Some("P"), Some(encoded_path)) => BASE64_STANDARD
            .decode(encoded_path)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- find_osc_end tests ---

    #[test]
    fn find_osc_end_with_bel_terminator() {
        let s = "\x1b]133;A\x07rest";
        assert_eq!(find_osc_end(s), Some(7));
    }

    #[test]
    fn find_osc_end_with_st_terminator() {
        let s = "\x1b]133;A\x1b\\rest";
        assert_eq!(find_osc_end(s), Some(7));
    }

    #[test]
    fn find_osc_end_no_terminator() {
        let s = "\x1b]133;A";
        assert_eq!(find_osc_end(s), None);
    }

    // --- parse_osc133 tests ---

    #[test]
    fn parse_osc133_prompt_start() {
        let result = parse_osc133("A").unwrap();
        assert_eq!(result.event_type, "prompt_start");
        assert_eq!(result.exit_code, None);
    }

    #[test]
    fn parse_osc133_input_start() {
        let result = parse_osc133("B").unwrap();
        assert_eq!(result.event_type, "input_start");
        assert_eq!(result.exit_code, None);
    }

    #[test]
    fn parse_osc133_command_start() {
        let result = parse_osc133("C").unwrap();
        assert_eq!(result.event_type, "command_start");
        assert_eq!(result.exit_code, None);
    }

    #[test]
    fn parse_osc133_command_end_with_exit_code() {
        let result = parse_osc133("D;0").unwrap();
        assert_eq!(result.event_type, "command_end");
        assert_eq!(result.exit_code, Some(0));
    }

    #[test]
    fn parse_osc133_command_end_with_nonzero_exit_code() {
        let result = parse_osc133("D;127").unwrap();
        assert_eq!(result.event_type, "command_end");
        assert_eq!(result.exit_code, Some(127));
    }

    #[test]
    fn parse_osc133_command_end_no_exit_code() {
        let result = parse_osc133("D").unwrap();
        assert_eq!(result.event_type, "command_end");
        assert_eq!(result.exit_code, None);
    }

    #[test]
    fn parse_osc133_unknown_marker() {
        assert!(parse_osc133("Z").is_none());
    }

    #[test]
    fn parse_tome_osc_current_directory() {
        let encoded = BASE64_STANDARD.encode("/tmp/project");
        assert_eq!(
            parse_tome_osc(&format!("P;{encoded}")),
            Some("/tmp/project".to_string())
        );
    }

    #[test]
    fn resolve_initial_cwd_uses_process_cwd_by_default() {
        let resolved = resolve_initial_cwd(None).unwrap();
        assert_eq!(resolved, std::env::current_dir().unwrap());
    }

    #[test]
    fn resolve_initial_cwd_accepts_existing_directory() {
        let temp_dir = std::env::temp_dir();
        let resolved = resolve_initial_cwd(Some(temp_dir.to_string_lossy().to_string())).unwrap();
        assert_eq!(resolved, temp_dir);
    }

    #[test]
    fn resolve_initial_cwd_rejects_missing_directory() {
        let missing = std::env::temp_dir().join(format!("tome-missing-{}", Uuid::new_v4()));
        let err = resolve_initial_cwd(Some(missing.to_string_lossy().to_string())).unwrap_err();
        assert!(err.contains("does not exist"));
    }

    #[test]
    fn resolve_initial_cwd_rejects_files() {
        let temp_file = std::env::temp_dir().join(format!("tome-file-{}.txt", Uuid::new_v4()));
        std::fs::write(&temp_file, "test").unwrap();

        let err = resolve_initial_cwd(Some(temp_file.to_string_lossy().to_string())).unwrap_err();
        assert!(err.contains("not a directory"));

        std::fs::remove_file(temp_file).unwrap();
    }

    // --- OutputParser tests ---

    #[test]
    fn parser_plain_text() {
        let mut parser = OutputParser::new();
        let events = parser.parse("hello world");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], ParsedEvent::Output("hello world".to_string()));
    }

    #[test]
    fn parser_alternate_screen_enter() {
        let mut parser = OutputParser::new();
        let events = parser.parse("\x1b[?1049h");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], ParsedEvent::AlternateScreen(true));
    }

    #[test]
    fn parser_alternate_screen_exit() {
        let mut parser = OutputParser::new();
        let events = parser.parse("\x1b[?1049l");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], ParsedEvent::AlternateScreen(false));
    }

    #[test]
    fn parser_alternate_screen_with_surrounding_text() {
        let mut parser = OutputParser::new();
        let events = parser.parse("before\x1b[?1049hafter");
        assert_eq!(events.len(), 3);
        assert_eq!(events[0], ParsedEvent::Output("before".to_string()));
        assert_eq!(events[1], ParsedEvent::AlternateScreen(true));
        assert_eq!(events[2], ParsedEvent::Output("after".to_string()));
    }

    #[test]
    fn parser_osc133_block_event_bel() {
        let mut parser = OutputParser::new();
        let events = parser.parse("\x1b]133;A\x07");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "prompt_start".to_string(),
                exit_code: None,
            })
        );
    }

    #[test]
    fn parser_osc133_block_event_st() {
        let mut parser = OutputParser::new();
        let events = parser.parse("\x1b]133;C\x1b\\");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "command_start".to_string(),
                exit_code: None,
            })
        );
    }

    #[test]
    fn parser_osc133_command_end_with_exit_code() {
        let mut parser = OutputParser::new();
        let events = parser.parse("\x1b]133;D;0\x07");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "command_end".to_string(),
                exit_code: Some(0),
            })
        );
    }

    #[test]
    fn parser_strips_other_osc_sequences() {
        let mut parser = OutputParser::new();
        // OSC 0 (set title) should be stripped
        let events = parser.parse("before\x1b]0;my title\x07after");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], ParsedEvent::Output("before".to_string()));
        assert_eq!(events[1], ParsedEvent::Output("after".to_string()));
    }

    #[test]
    fn parser_incomplete_osc_buffered() {
        let mut parser = OutputParser::new();
        // Incomplete OSC (no terminator) — should buffer
        let events = parser.parse("text\x1b]133;A");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], ParsedEvent::Output("text".to_string()));

        // Now complete it
        let events = parser.parse("\x07more text");
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "prompt_start".to_string(),
                exit_code: None,
            })
        );
        assert_eq!(events[1], ParsedEvent::Output("more text".to_string()));
    }

    #[test]
    fn parser_full_block_lifecycle() {
        let mut parser = OutputParser::new();
        // Simulate: prompt_start → prompt text → input_start → user input → command_start → output
        let input = "\x1b]133;A\x07$ \x1b]133;B\x07ls\x1b]133;C\x07file1 file2";
        let events = parser.parse(input);

        assert_eq!(events.len(), 6);
        assert_eq!(
            events[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "prompt_start".to_string(),
                exit_code: None,
            })
        );
        assert_eq!(events[1], ParsedEvent::Output("$ ".to_string()));
        assert_eq!(
            events[2],
            ParsedEvent::Block(BlockEventData {
                event_type: "input_start".to_string(),
                exit_code: None,
            })
        );
        assert_eq!(events[3], ParsedEvent::Output("ls".to_string()));
        assert_eq!(
            events[4],
            ParsedEvent::Block(BlockEventData {
                event_type: "command_start".to_string(),
                exit_code: None,
            })
        );
        assert_eq!(events[5], ParsedEvent::Output("file1 file2".to_string()));

        // command_end comes in a separate parse call (simulating chunked reads)
        let events2 = parser.parse("\x1b]133;D;0\x07");
        assert_eq!(events2.len(), 1);
        assert_eq!(
            events2[0],
            ParsedEvent::Block(BlockEventData {
                event_type: "command_end".to_string(),
                exit_code: Some(0),
            })
        );
    }

    #[test]
    fn parser_multiple_chunks() {
        let mut parser = OutputParser::new();

        let events1 = parser.parse("hello ");
        assert_eq!(events1.len(), 1);
        assert_eq!(events1[0], ParsedEvent::Output("hello ".to_string()));

        let events2 = parser.parse("world");
        assert_eq!(events2.len(), 1);
        assert_eq!(events2[0], ParsedEvent::Output("world".to_string()));
    }
}

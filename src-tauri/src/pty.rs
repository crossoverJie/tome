use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
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
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    _master: Box<dyn MasterPty + Send>,
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

    pub fn create_session(&self, app: AppHandle) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();

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
            let zshrc_content = format!(
                "[[ -f \"{user_zdotdir}/.zshrc\" ]] && source \"{user_zdotdir}/.zshrc\"\n"
            );
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
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn write_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or("Session not found")?;
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
}

// --- Output Parser ---

enum ParsedEvent {
    Output(String),
    Block(BlockEventData),
    AlternateScreen(bool),
}

struct BlockEventData {
    event_type: String,
    exit_code: Option<i32>,
}

struct OutputParser {
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
                            if osc_body.starts_with("133;") {
                                let osc_content = &osc_body[4..];
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
            events.push(ParsedEvent::Output(
                self.buffer[output_start..].to_string(),
            ));
        }
        self.buffer.clear();
        events
    }
}

fn find_osc_end(s: &str) -> Option<usize> {
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

fn parse_osc133(content: &str) -> Option<BlockEventData> {
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

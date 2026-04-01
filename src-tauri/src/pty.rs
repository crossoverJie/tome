use crate::completion::CompletionResponse;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use unicode_width::UnicodeWidthChar;
use uuid::Uuid;
use vte::{Params, Parser as VteParser, Perform};

const WIDE_CONTINUATION: char = '\0';
const CURSOR_PROBE_RETRY_BUDGET: u8 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum TerminalEvent {
    #[serde(rename = "output")]
    Output { session_id: String, data: String },
    #[serde(rename = "raw_output")]
    RawOutput { session_id: String, data: String },
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
    #[serde(rename = "git_branch")]
    GitBranch {
        session_id: String,
        branch: Option<String>,
    },
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    _master: Box<dyn MasterPty + Send>,
    shell: String,
    runtime: Arc<Mutex<SessionRuntime>>,
}

struct SessionRuntime {
    current_dir: PathBuf,
    screen: VirtualScreen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScreenPosition {
    row: usize,
    col: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingCursorMove {
    Direct {
        target: ScreenPosition,
    },
    AlignColumn {
        target: ScreenPosition,
        safe_col: usize,
    },
    MoveRow {
        target: ScreenPosition,
        safe_col: usize,
    },
    FinalHorizontal {
        target: ScreenPosition,
    },
}

impl PendingCursorMove {
    fn final_target(self) -> ScreenPosition {
        match self {
            Self::Direct { target }
            | Self::AlignColumn { target, .. }
            | Self::MoveRow { target, .. }
            | Self::FinalHorizontal { target } => target,
        }
    }
}

struct VirtualScreen {
    rows: usize,
    cols: usize,
    cells: Vec<Vec<char>>,
    wrapped: Vec<bool>,
    cursor: ScreenPosition,
    saved_cursor: Option<ScreenPosition>,
    input_anchor: Option<ScreenPosition>,
    pending_cursor_move: Option<PendingCursorMove>,
    pending_probe_rounds: u8,
    parser: VteParser,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl VirtualScreen {
    fn new(rows: usize, cols: usize) -> Self {
        Self {
            rows: rows.max(1),
            cols: cols.max(1),
            cells: vec![vec![' '; cols.max(1)]; rows.max(1)],
            wrapped: vec![false; rows.max(1)],
            cursor: ScreenPosition { row: 0, col: 0 },
            saved_cursor: None,
            input_anchor: None,
            pending_cursor_move: None,
            pending_probe_rounds: 0,
            parser: VteParser::new(),
        }
    }

    fn resize(&mut self, rows: usize, cols: usize) {
        self.rows = rows.max(1);
        self.cols = cols.max(1);
        self.cells = vec![vec![' '; self.cols]; self.rows];
        self.wrapped = vec![false; self.rows];
        self.cursor = ScreenPosition {
            row: self.cursor.row.min(self.rows - 1),
            col: self.cursor.col.min(self.cols - 1),
        };
        self.input_anchor = self.input_anchor.map(|anchor| ScreenPosition {
            row: anchor.row.min(self.rows - 1),
            col: anchor.col.min(self.cols - 1),
        });
    }

    fn feed(&mut self, data: &str) {
        let mut parser = std::mem::replace(&mut self.parser, VteParser::new());
        for byte in data.bytes() {
            parser.advance(self, byte);
        }
        self.parser = parser;
    }

    fn report_cursor_position(
        &mut self,
        row: usize,
        col: usize,
        set_anchor: bool,
    ) -> Option<String> {
        self.cursor = ScreenPosition {
            row: row.min(self.rows - 1),
            col: col.min(self.cols.saturating_sub(1)),
        };

        if set_anchor {
            self.input_anchor = Some(self.cursor);
            self.clear_pending_cursor_move();
            return None;
        }

        let anchor = self.input_anchor?;
        self.continue_pending_cursor_move(anchor, true)
    }

    fn clear_input_anchor(&mut self) {
        self.input_anchor = None;
        self.clear_pending_cursor_move();
    }

    fn move_cursor_to(
        &mut self,
        target_row: usize,
        target_col: usize,
        staged: bool,
    ) -> Option<String> {
        let anchor = self.input_anchor?;
        let current = self.cursor;
        let target = self.clamp_to_editable_region(
            ScreenPosition {
                row: target_row.min(self.rows - 1),
                col: target_col.min(self.cols.saturating_sub(1)),
            },
            anchor,
        );

        if target == current {
            self.clear_pending_cursor_move();
            return None;
        }

        self.pending_cursor_move = Some(if staged && target.row != current.row {
            let safe_col = self.vertical_safe_col(current, target, anchor);
            if current.col != safe_col {
                PendingCursorMove::AlignColumn { target, safe_col }
            } else {
                PendingCursorMove::MoveRow { target, safe_col }
            }
        } else {
            PendingCursorMove::Direct { target }
        });
        self.pending_probe_rounds = CURSOR_PROBE_RETRY_BUDGET;
        self.continue_pending_cursor_move(anchor, false)
    }

    fn clear_pending_cursor_move(&mut self) {
        self.pending_cursor_move = None;
        self.pending_probe_rounds = 0;
    }

    fn vertical_safe_col(
        &self,
        current: ScreenPosition,
        target: ScreenPosition,
        anchor: ScreenPosition,
    ) -> usize {
        if current.row == anchor.row || target.row == anchor.row {
            anchor.col
        } else {
            0
        }
    }

    fn continue_pending_cursor_move(
        &mut self,
        anchor: ScreenPosition,
        consume_retry_budget: bool,
    ) -> Option<String> {
        let mut pending_move = self.pending_cursor_move?;
        if pending_move.final_target() == self.cursor {
            self.clear_pending_cursor_move();
            return None;
        }

        if consume_retry_budget {
            if self.pending_probe_rounds == 0 {
                self.pending_cursor_move = None;
                return None;
            }
            self.pending_probe_rounds = self.pending_probe_rounds.saturating_sub(1);
        }

        loop {
            match pending_move {
                PendingCursorMove::Direct { target } => {
                    if target == self.cursor {
                        self.clear_pending_cursor_move();
                        return None;
                    }

                    self.pending_cursor_move = Some(pending_move);
                    let sequence = self.movement_sequence(self.cursor, target);
                    self.cursor = target;
                    return Some(sequence);
                }
                PendingCursorMove::AlignColumn { target, safe_col } => {
                    if self.cursor.col == safe_col {
                        pending_move = PendingCursorMove::MoveRow { target, safe_col };
                        continue;
                    }

                    let next = ScreenPosition {
                        row: self.cursor.row,
                        col: safe_col,
                    };
                    self.pending_cursor_move = Some(pending_move);
                    let sequence = self.movement_sequence(self.cursor, next);
                    self.cursor = next;
                    return Some(sequence);
                }
                PendingCursorMove::MoveRow { target, safe_col } => {
                    if self.cursor.col != safe_col {
                        pending_move = PendingCursorMove::AlignColumn { target, safe_col };
                        continue;
                    }

                    if self.cursor.row == target.row {
                        pending_move = PendingCursorMove::FinalHorizontal { target };
                        continue;
                    }

                    let next = ScreenPosition {
                        row: target.row,
                        col: safe_col,
                    };
                    self.pending_cursor_move = Some(pending_move);
                    let sequence = self.movement_sequence(self.cursor, next);
                    self.cursor = next;
                    return Some(sequence);
                }
                PendingCursorMove::FinalHorizontal { target } => {
                    if self.cursor.row != target.row {
                        pending_move = PendingCursorMove::MoveRow {
                            target,
                            safe_col: self.vertical_safe_col(self.cursor, target, anchor),
                        };
                        continue;
                    }

                    if self.cursor.col == target.col {
                        self.clear_pending_cursor_move();
                        return None;
                    }

                    self.pending_cursor_move = Some(pending_move);
                    let sequence = self.movement_sequence(self.cursor, target);
                    self.cursor = target;
                    return Some(sequence);
                }
            }
        }
    }

    fn clamp_to_editable_region(
        &self,
        target: ScreenPosition,
        anchor: ScreenPosition,
    ) -> ScreenPosition {
        let editable_end_row = self.editable_end_row(anchor);
        let row = target.row.clamp(anchor.row, editable_end_row);
        let min_col = if row == anchor.row { anchor.col } else { 0 };
        let max_col = self.editable_row_max_col(row, anchor).max(min_col);
        let col = self
            .snap_click_col(row, target.col.clamp(min_col, max_col))
            .clamp(min_col, max_col);

        ScreenPosition { row, col }
    }

    fn editable_end_row(&self, anchor: ScreenPosition) -> usize {
        let mut row = anchor.row;
        while row < self.rows - 1 {
            let next_row = row + 1;
            if self.wrapped[row] || next_row <= self.cursor.row || self.row_has_content(next_row) {
                row += 1;
                continue;
            }
            break;
        }

        row.min(self.rows - 1)
    }

    fn editable_row_max_col(&self, row: usize, anchor: ScreenPosition) -> usize {
        let occupied = self.last_occupied_col(row).unwrap_or({
            if row == anchor.row {
                anchor.col
            } else {
                self.cursor.col
            }
        });

        if row == self.cursor.row {
            occupied.max(self.cursor.col)
        } else {
            occupied
        }
    }

    fn last_occupied_col(&self, row: usize) -> Option<usize> {
        self.cells.get(row).and_then(|line| line.iter().rposition(|ch| *ch != ' '))
    }

    fn row_has_content(&self, row: usize) -> bool {
        self.last_occupied_col(row).is_some()
    }

    fn vertical_movement_sequence(from_row: usize, to_row: usize) -> String {
        let mut sequence = String::new();
        let row_delta = to_row as isize - from_row as isize;
        if row_delta < 0 {
            sequence.push_str(&"\x1b[A".repeat((-row_delta) as usize));
        } else if row_delta > 0 {
            sequence.push_str(&"\x1b[B".repeat(row_delta as usize));
        }

        sequence
    }

    fn movement_sequence(&self, from: ScreenPosition, to: ScreenPosition) -> String {
        let mut sequence = Self::vertical_movement_sequence(from.row, to.row);

        let horizontal_steps = self.horizontal_steps(
            to.row.min(self.rows - 1),
            from.col.min(self.cols.saturating_sub(1)),
            to.col.min(self.cols.saturating_sub(1)),
        );
        if to.col < from.col {
            sequence.push_str(&"\x1b[D".repeat(horizontal_steps));
        } else if to.col > from.col {
            sequence.push_str(&"\x1b[C".repeat(horizontal_steps));
        }

        sequence
    }

    fn param_or(params: &Params, index: usize, default: usize) -> usize {
        params
            .iter()
            .nth(index)
            .and_then(|sub_params| sub_params.first())
            .map(|value| *value as usize)
            .filter(|value| *value != 0)
            .unwrap_or(default)
    }

    fn set_cursor(&mut self, row: usize, col: usize) {
        self.cursor = ScreenPosition {
            row: row.min(self.rows - 1),
            col: col.min(self.cols.saturating_sub(1)),
        };
    }

    fn scroll_up(&mut self) {
        if self.rows == 0 {
            return;
        }

        self.cells.remove(0);
        self.cells.push(vec![' '; self.cols]);
        self.wrapped.remove(0);
        self.wrapped.push(false);
        self.cursor.row = self.rows - 1;
    }

    fn clear_row(&mut self, row: usize) {
        if let Some(line) = self.cells.get_mut(row) {
            line.fill(' ');
        }
        if let Some(wrapped) = self.wrapped.get_mut(row) {
            *wrapped = false;
        }
    }

    fn display_width(c: char) -> usize {
        UnicodeWidthChar::width(c).unwrap_or(1).max(1)
    }

    fn clear_cell(&mut self, row: usize, col: usize) {
        let Some(line) = self.cells.get_mut(row) else {
            return;
        };

        if col >= line.len() {
            return;
        }

        if line[col] == WIDE_CONTINUATION && col > 0 {
            line[col - 1] = ' ';
        } else if col + 1 < line.len() && line[col + 1] == WIDE_CONTINUATION {
            line[col + 1] = ' ';
        }

        line[col] = ' ';
    }

    fn write_char(&mut self, row: usize, col: usize, c: char, width: usize) {
        self.clear_cell(row, col);
        if width == 2 && col + 1 < self.cols {
            self.clear_cell(row, col + 1);
        }

        if let Some(line) = self.cells.get_mut(row) {
            line[col] = c;
            if width == 2 && col + 1 < self.cols {
                line[col + 1] = WIDE_CONTINUATION;
            }
        }
    }

    fn normalize_row(&mut self, row: usize) {
        let Some(line) = self.cells.get_mut(row) else {
            return;
        };

        for col in 0..line.len() {
            if line[col] == WIDE_CONTINUATION {
                let has_wide_leader = col > 0 && Self::display_width(line[col - 1]) > 1;
                if !has_wide_leader {
                    line[col] = ' ';
                }
                continue;
            }

            if Self::display_width(line[col]) == 1
                && col + 1 < line.len()
                && line[col + 1] == WIDE_CONTINUATION
            {
                line[col + 1] = ' ';
            }
        }
    }

    fn snap_click_col(&self, row: usize, col: usize) -> usize {
        let Some(line) = self.cells.get(row) else {
            return col;
        };

        if line.get(col) == Some(&WIDE_CONTINUATION) {
            (col + 1).min(self.cols.saturating_sub(1))
        } else {
            col
        }
    }

    fn previous_boundary(&self, row: usize, col: usize) -> usize {
        if col == 0 {
            return 0;
        }

        let Some(line) = self.cells.get(row) else {
            return col.saturating_sub(1);
        };

        let mut candidate = col - 1;
        while candidate > 0 && line.get(candidate) == Some(&WIDE_CONTINUATION) {
            candidate -= 1;
        }
        candidate
    }

    fn next_boundary(&self, row: usize, col: usize) -> usize {
        if col >= self.cols.saturating_sub(1) {
            return col.min(self.cols.saturating_sub(1));
        }

        let Some(line) = self.cells.get(row) else {
            return (col + 1).min(self.cols.saturating_sub(1));
        };

        let cell = line.get(col).copied().unwrap_or(' ');
        let width = if cell == WIDE_CONTINUATION {
            1
        } else {
            Self::display_width(cell)
        };

        (col + width).min(self.cols.saturating_sub(1))
    }

    fn horizontal_steps(&self, row: usize, from_col: usize, to_col: usize) -> usize {
        if from_col == to_col {
            return 0;
        }

        let mut steps = 0;
        if to_col < from_col {
            let mut col = from_col;
            while col > to_col {
                let next = self.previous_boundary(row, col);
                if next == col {
                    break;
                }
                col = next;
                steps += 1;
            }
        } else {
            let mut col = from_col;
            while col < to_col {
                let next = self.next_boundary(row, col);
                if next == col {
                    break;
                }
                col = next;
                steps += 1;
            }

            // If we didn't reach the target, it might be due to wide chars not yet written
            // Trust the reported position and calculate remaining steps as single-width
            if col < to_col {
                steps += to_col - col;
            }
        }

        steps
    }
}

impl Perform for VirtualScreen {
    fn print(&mut self, c: char) {
        let width = Self::display_width(c).min(2);

        if self.cursor.col >= self.cols || (width == 2 && self.cursor.col + 1 >= self.cols) {
            if self.cursor.row < self.rows - 1 {
                self.wrapped[self.cursor.row] = true;
                self.cursor.row += 1;
                self.cursor.col = 0;
            } else {
                self.wrapped[self.cursor.row] = true;
                self.scroll_up();
                self.cursor.col = 0;
            }
        }

        self.write_char(self.cursor.row, self.cursor.col, c, width);

        if self.cursor.col + width >= self.cols {
            if self.cursor.row < self.rows - 1 {
                self.wrapped[self.cursor.row] = true;
                self.cursor.row += 1;
                self.cursor.col = 0;
            } else {
                self.wrapped[self.cursor.row] = true;
                self.scroll_up();
                self.cursor.col = 0;
            }
        } else {
            self.cursor.col += width;
        }
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\n' => {
                if self.cursor.row >= self.rows - 1 {
                    self.scroll_up();
                } else {
                    self.cursor.row += 1;
                }
            }
            b'\r' => self.cursor.col = 0,
            0x08 => self.cursor.col = self.cursor.col.saturating_sub(1),
            b'\t' => {
                let next_tab_stop = ((self.cursor.col / 8) + 1) * 8;
                self.cursor.col = next_tab_stop.min(self.cols.saturating_sub(1));
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], ignore: bool, action: char) {
        if ignore {
            return;
        }

        match (intermediates.first().copied(), action) {
            (Some(b'?'), _) => {}
            (_, 'A') => {
                let amount = Self::param_or(params, 0, 1);
                self.cursor.row = self.cursor.row.saturating_sub(amount);
            }
            (_, 'B') => {
                let amount = Self::param_or(params, 0, 1);
                self.cursor.row = (self.cursor.row + amount).min(self.rows - 1);
            }
            (_, 'C') => {
                let amount = Self::param_or(params, 0, 1);
                self.cursor.col = (self.cursor.col + amount).min(self.cols.saturating_sub(1));
            }
            (_, 'D') => {
                let amount = Self::param_or(params, 0, 1);
                self.cursor.col = self.cursor.col.saturating_sub(amount);
            }
            (_, 'G') => {
                let col = Self::param_or(params, 0, 1).saturating_sub(1);
                self.set_cursor(self.cursor.row, col);
            }
            (_, 'H') | (_, 'f') => {
                let row = Self::param_or(params, 0, 1).saturating_sub(1);
                let col = Self::param_or(params, 1, 1).saturating_sub(1);
                self.set_cursor(row, col);
            }
            (_, 'J') => {
                if Self::param_or(params, 0, 0) == 2 {
                    for row in 0..self.rows {
                        self.clear_row(row);
                    }
                }
            }
            (_, 'K') => {
                if let Some(line) = self.cells.get_mut(self.cursor.row) {
                    match Self::param_or(params, 0, 0) {
                        0 => {
                            for cell in &mut line[self.cursor.col..] {
                                *cell = ' ';
                            }
                        }
                        1 => {
                            for cell in &mut line[..=self.cursor.col] {
                                *cell = ' ';
                            }
                        }
                        2 => line.fill(' '),
                        _ => {}
                    }
                }
                self.normalize_row(self.cursor.row);
            }
            (_, 'P') => {
                let amount = Self::param_or(params, 0, 1).min(self.cols);
                if let Some(line) = self.cells.get_mut(self.cursor.row) {
                    let snapshot = line.clone();
                    for (col, cell) in
                        line.iter_mut().enumerate().take(self.cols).skip(self.cursor.col)
                    {
                        let source = col + amount;
                        *cell = if source < self.cols {
                            snapshot[source]
                        } else {
                            ' '
                        };
                    }
                }
                self.normalize_row(self.cursor.row);
            }
            (_, 'X') => {
                let amount = Self::param_or(params, 0, 1);
                if let Some(line) = self.cells.get_mut(self.cursor.row) {
                    let end = (self.cursor.col + amount).min(self.cols);
                    for cell in &mut line[self.cursor.col..end] {
                        *cell = ' ';
                    }
                }
                self.normalize_row(self.cursor.row);
            }
            (_, 's') => self.saved_cursor = Some(self.cursor),
            (_, 'u') => {
                if let Some(saved) = self.saved_cursor {
                    self.cursor = saved;
                }
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], ignore: bool, byte: u8) {
        if ignore || !intermediates.is_empty() {
            return;
        }

        match byte {
            b'D' => self.execute(b'\n'),
            b'E' => {
                self.execute(b'\n');
                self.execute(b'\r');
            }
            b'M' => {
                self.cursor.row = self.cursor.row.saturating_sub(1);
            }
            b'7' => self.saved_cursor = Some(self.cursor),
            b'8' => {
                if let Some(saved) = self.saved_cursor {
                    self.cursor = saved;
                }
            }
            _ => {}
        }
    }
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
        let runtime = Arc::new(Mutex::new(SessionRuntime {
            current_dir: initial_dir.clone(),
            screen: VirtualScreen::new(24, 80),
        }));
        let runtime_for_reader = Arc::clone(&runtime);

        // Spawn reader thread
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut parser = OutputParser::new();
            let mut utf8_decoder = Utf8ChunkDecoder::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = utf8_decoder.decode(&buf[..n]);
                        if data.is_empty() {
                            continue;
                        }
                        if let Ok(mut runtime) = runtime_for_reader.lock() {
                            runtime.screen.feed(&data);
                        }
                        let _ = app.emit(
                            "terminal-event",
                            TerminalEvent::RawOutput {
                                session_id: sid.clone(),
                                data: data.clone(),
                            },
                        );
                        let events = parser.parse(&data);

                        for event in events {
                            match event {
                                ParsedEvent::Output(text) => {
                                    let _ = app.emit(
                                        "terminal-event",
                                        TerminalEvent::Output {
                                            session_id: sid.clone(),
                                            data: text,
                                        },
                                    );
                                }
                                ParsedEvent::Block(block_event) => {
                                    let _ = app.emit(
                                        "terminal-event",
                                        TerminalEvent::Block {
                                            session_id: sid.clone(),
                                            event_type: block_event.event_type,
                                            exit_code: block_event.exit_code,
                                        },
                                    );
                                }
                                ParsedEvent::AlternateScreen(active) => {
                                    let _ = app.emit(
                                        "terminal-event",
                                        TerminalEvent::AlternateScreen {
                                            session_id: sid.clone(),
                                            active,
                                        },
                                    );
                                }
                                ParsedEvent::CurrentDirectory(path) => {
                                    let new_branch = get_git_branch(&PathBuf::from(&path));
                                    if let Ok(mut runtime) = runtime_for_reader.lock() {
                                        runtime.current_dir = PathBuf::from(&path);
                                    }
                                    let _ = app.emit(
                                        "terminal-event",
                                        TerminalEvent::CurrentDirectory {
                                            session_id: sid.clone(),
                                            path,
                                        },
                                    );
                                    let _ = app.emit(
                                        "terminal-event",
                                        TerminalEvent::GitBranch {
                                            session_id: sid.clone(),
                                            branch: new_branch,
                                        },
                                    );
                                }
                            }
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
            runtime,
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
        {
            let mut runtime = session
                .runtime
                .lock()
                .map_err(|_| "Failed to access session screen".to_string())?;
            runtime.screen.resize(rows as usize, cols as usize);
        }
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
                .runtime
                .lock()
                .map_err(|_| "Failed to access session cwd".to_string())?
                .current_dir
                .clone();
            (session.shell.clone(), current_dir)
        };

        crate::completion::request_completion(&shell, &current_dir, text, cursor)
    }

    pub fn get_current_directory(&self, session_id: &str) -> Result<String, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id).ok_or("Session not found")?;
        let current_dir = session
            .runtime
            .lock()
            .map_err(|_| "Failed to access session cwd".to_string())?
            .current_dir
            .clone();

        Ok(current_dir.to_string_lossy().to_string())
    }

    pub fn move_cursor_to_position(
        &self,
        session_id: &str,
        row: u16,
        col: u16,
        staged: bool,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or("Session not found")?;
        let sequence = {
            let mut runtime = session
                .runtime
                .lock()
                .map_err(|_| "Failed to access session screen".to_string())?;

            runtime.screen.move_cursor_to(
                row.saturating_sub(1) as usize,
                col.saturating_sub(1) as usize,
                staged,
            )
        };

        let Some(sequence) = sequence else {
            return Ok(());
        };

        session
            .writer
            .write_all(sequence.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session.writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn report_cursor_position(
        &self,
        session_id: &str,
        row: u16,
        col: u16,
        set_anchor: bool,
    ) -> Result<bool, String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or("Session not found")?;
        let follow_up_sequence = {
            let mut runtime = session
                .runtime
                .lock()
                .map_err(|_| "Failed to access session screen".to_string())?;
            runtime.screen.report_cursor_position(
                row.saturating_sub(1) as usize,
                col.saturating_sub(1) as usize,
                set_anchor,
            )
        };

        if let Some(sequence) = follow_up_sequence {
            session
                .writer
                .write_all(sequence.as_bytes())
                .map_err(|e| format!("Write error: {}", e))?;
            session.writer.flush().map_err(|e| format!("Flush error: {}", e))?;
            return Ok(true);
        }

        Ok(false)
    }

    pub fn clear_interactive_input_anchor(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id).ok_or("Session not found")?;
        let mut runtime = session
            .runtime
            .lock()
            .map_err(|_| "Failed to access session screen".to_string())?;
        runtime.screen.clear_input_anchor();
        Ok(())
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

/// Get the current git branch name for a given directory
/// Returns None if not in a git repository
fn get_git_branch(dir: &Path) -> Option<String> {
    // Try to read .git/HEAD directly (faster than running git command)
    let git_head = dir.join(".git/HEAD");
    if git_head.exists() {
        if let Ok(content) = std::fs::read_to_string(&git_head) {
            let content = content.trim();
            // HEAD contains: ref: refs/heads/main
            if let Some(branch_ref) = content.strip_prefix("ref: refs/heads/") {
                return Some(branch_ref.to_string());
            }
            // Detached HEAD contains just the commit hash
            if content.len() == 40 && content.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(format!("{}...", &content[..7]));
            }
        }
    }

    // Fallback: walk up parent directories looking for .git
    let mut current = dir;
    loop {
        let parent_git = current.join(".git/HEAD");
        if parent_git.exists() {
            if let Ok(content) = std::fs::read_to_string(&parent_git) {
                let content = content.trim();
                if let Some(branch_ref) = content.strip_prefix("ref: refs/heads/") {
                    return Some(branch_ref.to_string());
                }
                if content.len() == 40 && content.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Some(format!("{}...", &content[..7]));
                }
            }
        }

        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    None
}

struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    fn decode(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut output = String::new();

        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();

                    if valid_up_to > 0 {
                        let valid = std::str::from_utf8(&self.pending[..valid_up_to]).unwrap();
                        output.push_str(valid);
                        self.pending.drain(..valid_up_to);
                        continue;
                    }

                    match error.error_len() {
                        Some(invalid_len) => {
                            output.push_str(&String::from_utf8_lossy(&self.pending[..invalid_len]));
                            self.pending.drain(..invalid_len);
                        }
                        None => break,
                    }
                }
            }
        }

        output
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

    #[test]
    fn virtual_screen_clamps_clicks_before_prompt_anchor() {
        let mut screen = VirtualScreen::new(6, 20);
        screen.report_cursor_position(2, 8, true);
        screen.report_cursor_position(2, 14, false);

        let sequence = screen.move_cursor_to(2, 2, false).unwrap();

        assert_eq!(sequence, "\x1b[D".repeat(6));
        assert_eq!(screen.cursor, ScreenPosition { row: 2, col: 8 });
    }

    #[test]
    fn virtual_screen_moves_across_rows_with_vertical_then_horizontal_offsets() {
        let mut screen = VirtualScreen::new(6, 20);
        screen.report_cursor_position(1, 4, true);
        screen.report_cursor_position(3, 12, false);

        let sequence = screen.move_cursor_to(2, 6, false).unwrap();

        assert_eq!(sequence, format!("\x1b[A{}", "\x1b[D".repeat(6)));
        assert_eq!(screen.cursor, ScreenPosition { row: 2, col: 6 });

        let follow_up = screen.report_cursor_position(2, 12, false).unwrap();
        assert_eq!(follow_up, "\x1b[D".repeat(6));
        assert_eq!(screen.cursor, ScreenPosition { row: 2, col: 6 });
    }

    #[test]
    fn virtual_screen_counts_wide_characters_as_single_horizontal_steps() {
        let mut screen = VirtualScreen::new(4, 20);
        screen.report_cursor_position(1, 4, true);
        screen.print('你');
        screen.print('a');

        assert_eq!(screen.cursor, ScreenPosition { row: 1, col: 7 });
        assert_eq!(screen.cells[1][4], '你');
        assert_eq!(screen.cells[1][5], WIDE_CONTINUATION);

        let sequence = screen.move_cursor_to(1, 5, false).unwrap();

        assert_eq!(sequence, "\x1b[D");
        assert_eq!(screen.cursor, ScreenPosition { row: 1, col: 6 });
    }

    #[test]
    fn virtual_screen_mixed_width_text_uses_character_boundaries_for_left_moves() {
        let mut screen = VirtualScreen::new(4, 20);
        screen.report_cursor_position(1, 0, true);
        for ch in ['a', '中', 'b'] {
            screen.print(ch);
        }

        assert_eq!(screen.cursor, ScreenPosition { row: 1, col: 4 });

        let sequence = screen.move_cursor_to(1, 1, false).unwrap();

        assert_eq!(sequence, "\x1b[D".repeat(2));
        assert_eq!(screen.cursor, ScreenPosition { row: 1, col: 1 });
    }

    #[test]
    fn virtual_screen_recomputes_horizontal_steps_after_vertical_probe_for_mixed_width_rows() {
        let mut screen = VirtualScreen::new(4, 40);
        screen.report_cursor_position(0, 0, true);
        for ch in "nihao a 你好".chars() {
            screen.print(ch);
        }
        screen.execute(b'\n');
        screen.execute(b'\r');
        for ch in "  很好的 nice 你好啊".chars() {
            screen.print(ch);
        }

        screen.report_cursor_position(0, 11, false);
        let sequence = screen.move_cursor_to(1, 9, false).unwrap();
        assert_eq!(sequence, format!("\x1b[B{}", "\x1b[D".repeat(2)));

        let follow_up = screen.report_cursor_position(1, 20, false).unwrap();
        assert_eq!(follow_up, "\x1b[D".repeat(8));
        assert_eq!(screen.cursor, ScreenPosition { row: 1, col: 9 });
    }

    #[test]
    fn virtual_screen_retries_same_row_mixed_width_targets_after_probe() {
        let mut screen = VirtualScreen::new(2, 40);
        screen.report_cursor_position(0, 0, true);
        for ch in "你好啊 hello 天气好".chars() {
            screen.print(ch);
        }

        let sequence = screen.move_cursor_to(0, 7, false).unwrap();
        assert_eq!(sequence, "\x1b[D".repeat(9));

        let follow_up = screen.report_cursor_position(0, 9, false).unwrap();
        assert_eq!(follow_up, "\x1b[D".repeat(2));
        assert_eq!(screen.cursor, ScreenPosition { row: 0, col: 7 });
    }

    #[test]
    fn virtual_screen_handles_chinese_question_mark_input() {
        let mut screen = VirtualScreen::new(4, 40);
        screen.report_cursor_position(0, 0, true);

        // Simulate typing "你好？" (Hello?)
        screen.print('你');
        screen.print('好');
        screen.print('？');

        // Chinese question mark should occupy 2 columns
        assert_eq!(screen.cursor, ScreenPosition { row: 0, col: 6 });
        assert_eq!(screen.cells[0][0], '你');
        assert_eq!(screen.cells[0][1], WIDE_CONTINUATION);
        assert_eq!(screen.cells[0][2], '好');
        assert_eq!(screen.cells[0][3], WIDE_CONTINUATION);
        assert_eq!(screen.cells[0][4], '？');
        assert_eq!(screen.cells[0][5], WIDE_CONTINUATION);
    }

    #[test]
    fn virtual_screen_stages_multiline_moves_for_claude_style_targets() {
        let mut screen = VirtualScreen::new(6, 40);
        screen.report_cursor_position(0, 4, true);
        for ch in "first line".chars() {
            screen.print(ch);
        }
        screen.execute(b'\n');
        screen.execute(b'\r');
        for ch in "second line".chars() {
            screen.print(ch);
        }
        screen.execute(b'\n');
        screen.execute(b'\r');
        for ch in "third line".chars() {
            screen.print(ch);
        }

        screen.report_cursor_position(2, 10, false);

        let sequence = screen.move_cursor_to(0, 6, true).unwrap();
        assert_eq!(sequence, "\x1b[D".repeat(6));
        assert_eq!(screen.cursor, ScreenPosition { row: 2, col: 4 });

        let vertical_follow_up = screen.report_cursor_position(2, 4, false).unwrap();
        assert_eq!(vertical_follow_up, "\x1b[A".repeat(2));
        assert_eq!(screen.cursor, ScreenPosition { row: 0, col: 4 });

        let horizontal_follow_up = screen.report_cursor_position(0, 4, false).unwrap();
        assert_eq!(horizontal_follow_up, "\x1b[C".repeat(2));
        assert_eq!(screen.cursor, ScreenPosition { row: 0, col: 6 });

        assert_eq!(screen.report_cursor_position(0, 6, false), None);
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

    #[test]
    fn utf8_chunk_decoder_preserves_split_multibyte_sequences() {
        let mut decoder = Utf8ChunkDecoder::new();
        let first = decoder.decode(&[0xE2, 0x94]);
        let second = decoder.decode(&[0x80, b' ', 0xE2, 0x94, 0x82]);

        assert_eq!(first, "");
        assert_eq!(second, "─ │");
    }

    #[test]
    fn utf8_chunk_decoder_replaces_invalid_bytes_but_keeps_following_text() {
        let mut decoder = Utf8ChunkDecoder::new();
        let decoded = decoder.decode(&[0xFF, b'a', b'b', b'c']);

        assert_eq!(decoded, "�abc");
    }
}

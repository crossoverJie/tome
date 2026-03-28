# PRD: Tome — 轻量级 Block 终端

> **命名**: Tome（卷宗/典籍）— 命令历史如翻阅卷宗

## 当前进度

| 模块 | 状态 |
|------|------|
| 项目初始化（Tauri 2 + React + TS） | ✅ 已完成 |
| Rust 后端 — PTY 管理 | ✅ 已完成 |
| Rust 后端 — 终端解析（VTE + OSC 133） | ✅ 已完成 |
| 前端 — Block 视图 | ✅ 已完成 |
| 前端 — 输入编辑器（CodeMirror 6） | ✅ 已完成 |
| 前端 — 命令语法高亮 | ✅ 基础版已完成 |
| 前端 — 全屏程序模式（xterm.js） | ✅ 已完成 |
| Shell Integration — zsh | ✅ 已完成 |
| 基本快捷键（Cmd+K 清屏等） | ✅ 已完成 |
| 智能光标定位 | ⬚ 未开始 |
| 分屏 / 多标签页 | ✅ 已完成 |
| 工作目录追踪 | ✅ 已完成 |
| Git 分支显示 | ✅ 已完成 |
| 主题系统 | 🔶 暗色主题已完成，亮色/自定义待做 |
| CI / GitHub Actions | ✅ 已完成 |
| 构建与分发 | ⬚ 未开始 |

详细任务清单见 `docs/TODO.md`。

---

## 1. 背景与动机

### 1.1 痛点

当前使用 Warp 作为主力终端，但存在以下问题：

- AI 功能过于侵入，频繁误触，干扰工作流
- 功能膨胀，大量不需要的特性增加了认知负担和资源占用
- 核心需要的只是 **Block 模式** 和 **光标自由移动**，不需要为此忍受其他干扰

### 1.2 目标

构建一个 **轻量、专注、无 AI** 的 macOS 终端应用，保留 Warp 中真正有价值的交互创新（Block + 光标编辑），去掉一切不必要的功能。主要使用场景为配合 Code Agent 进行日常编程。

### 1.3 技术选型

**Rust + Tauri 2.x**

- Rust 后端：PTY 管理、转义序列解析、shell integration
- Tauri WebView 前端：Block UI 渲染、输入编辑器、xterm.js 集成
- 仅支持 macOS（未来可扩展至 Linux）

---

## 2. 核心功能

### 2.1 Block 模式（P0）

每次命令执行的输入 + 输出构成一个独立的 Block（Card），是整个应用的核心交互单元。

**功能描述：**

- 每个 Block 包含：命令输入行、命令输出、执行时间、退出状态码
- Block 之间有明确的视觉分隔
- 支持通过快捷键（↑/↓ 或自定义键）在 Block 之间导航选中
- 选中的 Block 支持：
  - 复制整个 Block 的输出内容
  - 折叠/展开输出
  - 快速滚动到上一个/下一个 Block
- Block 之间支持搜索（Cmd+F 全局搜索输出内容）

**技术实现：**

- 通过 Shell Integration（precmd / preexec hook）注入 OSC 标记序列
- 前端根据标记将终端输出切割为独立的 DOM Block
- 支持 zsh / bash / fish 的 shell integration

### 2.2 输入编辑器（P0）

命令输入区域是一个独立的文本编辑器组件，与输出区域分离。

**功能描述：**

- 支持鼠标点击任意位置移动光标
- 支持鼠标拖拽选中文本
- 支持多行输入（Shift+Enter 换行）
- 支持基本的文本编辑快捷键（Cmd+A, Cmd+C/V/X, Option+←/→ 等）
- 支持命令历史（↑/↓ 翻阅历史命令）
- 支持 Tab 补全（首版支持 zsh 的基础命令 / 路径补全，复杂 shell-native / Warp-style 菜单可后续增强）
- 输入区域固定在窗口底部
- **显示当前 Git 分支**（如 `$ (main)`），在 Git 仓库中自动检测并显示分支名
- **命令语法高亮**：输入的命令文本根据 shell 语法进行着色（命令、参数、路径、字符串、变量等区分颜色）
  - 命令名（command）：高亮显示内建命令、外部命令、别名
  - 参数（flags/options）：`-` 或 `--` 开头的选项使用独立颜色
  - 路径（paths）：文件/目录路径使用特定颜色，不存在的路径显示为红色/警告色
  - 字符串（strings）：单引号/双引号字符串使用字符串颜色
  - 变量（variables）：`$VAR` 或 `${VAR}` 形式的变量使用变量颜色
  - 管道与重定向符（|, >, <, >>）：使用操作符颜色
  - 错误检测：当输入的命令不存在于 PATH 中时，命令名显示为红色/警告色

**技术实现：**

- 使用 Web 编辑器组件（Monaco Editor 精简版 / CodeMirror / 自定义 contenteditable）
- 回车时将输入内容通过 Tauri IPC 发送给 Rust 后端写入 PTY
- 首版补全通过前端请求后端 completion API 实现：后端基于当前 shell 类型与会话 cwd 计算基础命令 / 路径候选，前端渲染简单候选菜单
- **优化：Tab 补全应忽略大小写匹配（如 `cd Doc` 和 `cd doc` 都能提示 `Documents` 目录）**
- **Git 分支检测**：Rust 后端读取 `.git/HEAD` 文件解析当前分支，通过 `OSC 633` 序列发送给前端
- **命令语法高亮实现方案**：
  - 方案 A（Shell Integration 方案）：通过 zsh/bash 的 `zsh-syntax-highlighting` 或 `ble.sh` 等机制，让 shell 在 OSC 133 标记中附带 token 类型信息，前端根据 token 类型应用对应颜色
  - 方案 B（前端自解析）：使用 CodeMirror 6 的语法分析能力，结合 shell 语法定义（类似 bash-language-server 的词法分析），在客户端解析命令并着色
  - 方案 C（混合方案）：前端基于基础规则快速高亮（字符串、变量、管道符），复杂语义（命令是否存在、路径是否有效）通过异步 IPC 请求后端确认
  - 推荐方案 C：首版使用 CodeMirror 6 的 stream parser 实现基础语法高亮，路径验证通过后端异步查询，命令存在性检测通过缓存的 PATH 列表匹配

### 2.3 全屏程序支持（P0）

当检测到全屏终端程序（vim、nano、htop、top 等）时，切换为传统终端模式。

**功能描述：**

- 自动检测 alternate screen buffer 切换
- 进入全屏模式时隐藏 Block UI 和输入编辑器，显示 xterm.js 全屏终端
- 退出全屏程序后自动恢复 Block 模式

**技术实现：**

- Rust 后端监测 PTY 输出中的 alternate screen buffer 转义序列（`\e[?1049h` / `\e[?1049l`）
- 前端维护两套视图，根据模式切换显示

### 2.4 智能光标定位（P0）

在 PTY 子进程（如 Claude Code、Copilot CLI、Codex 等 CLI 工具）的输入行中，支持鼠标点击移动光标。这类工具既不触发全屏模式，也不受输入编辑器管控，需要通过屏幕缓冲区追踪 + 方向键模拟来实现光标定位。**仅针对输入场景，不包括命令输出区域。**

**功能描述：**

- 当前台进程不是 shell prompt 时（即输入编辑器不活跃），鼠标点击输入行的文本位置可将光标移动到该处
- 仅作用于当前活跃的输入区域（CLI 工具的 prompt 输入行），不响应输出区域的点击
- 支持单行输入场景（如 CLI 工具的 prompt 输入行）
- 支持多行输入场景（如 Claude Code 的长 prompt 编辑区域），鼠标点击可跨行定位
- 对用户透明，体验与原生文本编辑器的鼠标点击一致

**技术实现：**

- Rust 后端通过 VT parser 维护一个**虚拟屏幕缓冲区**（Screen Buffer），实时追踪屏幕上每个字符的位置及当前光标坐标
- 前端监听鼠标点击事件，将点击的屏幕坐标（行、列）通过 Tauri IPC 发送给后端
- 后端对比「目标位置」与「当前光标位置」，计算行列偏移量
- 向 PTY 发送对应数量的方向键转义序列：
  - 水平移动：`\e[C`（→）/ `\e[D`（←）
  - 垂直移动：`\e[A`（↑）/ `\e[B`（↓）
- 通过 `\e[6n`（Cursor Position Report）校准实际光标位置，修正漂移

**已知限制：**

- 依赖 screen buffer 追踪的准确性，极端情况下可能出现偏移
- 对于自行接管终端渲染的复杂 TUI 程序（如带自定义 UI 框架的工具），可能无法正确识别可编辑区域
- 需要正确识别 prompt 前缀（彩色标记、图标等不可编辑区域）以避免光标越界

---

## 3. 通用功能

### 3.1 分屏（P1）

**功能描述：**

- 支持水平/垂直分屏
- 每个分屏是一个独立的终端会话（独立 PTY）
- **分屏时新 pane 应继承源 pane 的当前工作目录（而非默认进入用户 home 目录）**
- 当前实现：若源 pane 已上报当前工作目录，则新 pane 在创建会话时直接继承该目录；若 split 发生时源 pane 尚未上报 cwd，则保持默认启动行为
- 支持快捷键在分屏间切换焦点
- 支持拖拽调整分屏比例

**快捷键：**

- `Cmd+D`：垂直分屏
- `Cmd+Shift+D`：水平分屏
- `Cmd+W`：关闭当前分屏
- `Cmd+[` / `Cmd+]`：切换分屏焦点

### 3.2 多标签页（P1）

**功能描述：**

- 支持多个 Tab，每个 Tab 是一个独立终端会话
- `Cmd+T` 新建标签页
- `Cmd+W` 关闭标签页（无分屏时）
- `Cmd+数字` 切换标签页
- 标签页显示当前工作目录名称

### 3.3 主题与外观（P2）

**功能描述：**

- 内置亮色/暗色主题
- 跟随系统外观自动切换
- 支持自定义配色方案（兼容 iTerm2 颜色方案格式）
- 支持自定义字体和字号
- 默认使用等宽编程字体（推荐 JetBrains Mono / Fira Code）
- 命令语法高亮色定义：
  - `syntax.command`：命令名（内建命令、外部命令、别名）
  - `syntax.argument`：参数/选项（`-f`, `--flag`）
  - `syntax.path`：文件/目录路径（存在的路径）
  - `syntax.path.invalid`：无效路径（不存在的文件/目录）
  - `syntax.string`：单引号/双引号字符串
  - `syntax.variable`：环境变量（`$VAR`, `${VAR}`）
  - `syntax.operator`：管道符、重定向符（`|`, `>`, `<`, `>>`）
  - `syntax.error`：无效命令（PATH 中不存在的命令）
  - `syntax.comment`：注释（以 `#` 开头的内容）
  - `syntax.keyword`：shell 关键字（`if`, `for`, `while`, `function` 等）

### 3.4 快捷键（P1）

**终端操作：**

| 快捷键 | 功能 |
|--------|------|
| `Cmd+K` | 清屏（清除所有 Block） |
| `Cmd+F` | 全局搜索 |
| `Cmd+,` | 打开设置 |
| `Cmd+N` | 新建窗口 |
| `Cmd+`` | 窗口切换器 |

**窗口导航：**

| 快捷键 | 功能 |
|--------|------|
| `Cmd+1..9` | 切换到第 N 个窗口（窗口切换器激活时） |

**Block 导航：**

| 快捷键 | 功能 |
|--------|------|
| `Cmd+↑` | 选中上一个 Block |
| `Cmd+↓` | 选中下一个 Block |
| `Cmd+Shift+C` | 复制选中 Block 的输出 |
| `Enter`（Block 选中态） | 折叠/展开 Block |

### 3.5 窗口切换器（P2）

**功能描述：**

提供类似 macOS Mission Control 的窗口缩略图预览与快速切换功能，解决多窗口场景下的导航痛点。

- **触发方式**：`Cmd+``（反引号）打开窗口切换器 overlay
- **窗口预览**：以卡片形式展示所有 Tome 窗口的缩略图/信息
- **快速切换**：`Cmd+数字`（1-9）直接跳转到对应窗口
- **信息展示**：每个窗口卡片显示当前工作目录、标签页数、活跃命令状态

**MVP 方案（简化版）：**

- 每个窗口上报元数据：窗口标题、当前目录、活跃命令、标签页数
- 切换器显示为卡片列表（色块 + 文字标识）
- 使用 Tauri 原生 `WebviewWindow` API 实现窗口间通信与焦点切换

**完整方案（缩略图版）：**

- 每个窗口前端定期捕获 DOM/Canvas 生成缩略图 Base64
- 通过 Tauri IPC 广播缩略图到所有窗口
- 切换器显示真实窗口缩略图，支持实时刷新

**技术实现：**

- Rust 后端维护全局窗口注册表，窗口创建/销毁时同步状态
- 暴露 `get_windows()` IPC 命令获取所有窗口元数据
- 广播 `windows-changed` 事件通知窗口列表变化
- 前端新增 `WindowSwitcher` 组件，全屏 overlay 显示

### 3.6 其他通用功能（P2）

- **工作目录追踪**：标题栏/标签页显示当前 pwd，输入框显示当前 Git 分支
- **链接检测**：输出中的 URL 可点击打开
- **图片预览**：支持 iTerm2 内联图片协议（Sixel）
- **通知**：长时间运行的命令完成后发送系统通知
- **配置文件**：TOML 格式配置文件，支持所有可自定义项

### 3.6 构建与分发（P2）

**功能描述：**

- 通过 GitHub Actions CI 自动构建 macOS 安装包（`.dmg` / `.app`），支持 Intel 和 Apple Silicon
- 每次 Release tag 触发构建，自动上传产物到 GitHub Releases
- 支持 Homebrew Cask 安装：`brew install --cask crossoverJie/tap/tome`
- 维护独立的 `homebrew-tap` 仓库，CI 发版时自动更新 Cask formula

**技术实现：**

- GitHub Actions workflow 使用 `tauri-apps/tauri-action` 构建多架构（`x86_64` / `aarch64`）产物
- 构建产物：`Tome_x.x.x_x64.dmg`、`Tome_x.x.x_aarch64.dmg`（或 Universal Binary）
- 创建 `crossoverJie/homebrew-tap` 仓库，包含 Cask formula 指向 GitHub Releases 下载地址
- CI 发版后通过 GitHub Actions 自动提交 formula 更新到 tap 仓库

---

## 4. 技术架构

### 4.1 整体架构

```
┌─────────────────────────────────────────────┐
│                Tauri WebView                 │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │          Block 视图（DOM）            │   │
│  │  ┌─ Block ────────────────────────┐  │   │
│  │  │ $ ls -la                  0.02s│  │   │
│  │  │ drwxr-xr-x  5 user ...        │  │   │
│  │  │ -rw-r--r--  1 user ...        │  │   │
│  │  └────────────────────────────────┘  │   │
│  │  ┌─ Block ────────────────────────┐  │   │
│  │  │ $ git status              0.1s │  │   │
│  │  │ On branch main ...             │  │   │
│  │  └────────────────────────────────┘  │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      xterm.js（全屏程序模式）         │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │         输入编辑器（底部固定）         │   │
│  │  $ git commit -m "feat: add block"   │   │
│  └──────────────────────────────────────┘   │
│                                              │
└──────────────────┬──────────────────────────┘
                   │ Tauri IPC (invoke / event)
┌──────────────────┴──────────────────────────┐
│              Rust Backend                    │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │  PTY Manager │  │  Shell Integration   │  │
│  │  (portable-  │  │  Parser (OSC 序列)   │  │
│  │   pty)       │  │                      │  │
│  └─────────────┘  └──────────────────────┘  │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │  VT Parser  │  │  Config Manager      │  │
│  │  (vte crate)│  │  (TOML)              │  │
│  └─────────────┘  └──────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

### 4.2 关键 Rust Crate

| Crate | 用途 |
|-------|------|
| `tauri` 2.x | 应用框架 |
| `portable-pty` | 跨平台 PTY 管理 |
| `vte` | 终端转义序列解析 |
| `tokio` | 异步运行时 |
| `serde` / `toml` | 配置序列化 |

### 4.3 前端技术栈

| 技术 | 用途 |
|------|------|
| TypeScript + React | UI 框架 |
| xterm.js | 全屏终端模式 |
| CodeMirror 6 | 输入编辑器（轻量、可扩展） |
| CSS Variables | 主题系统 |

### 4.4 Shell Integration

Shell integration 是 Block 功能的基础。通过在用户的 shell 配置中注入 hook，在命令执行前后发送 OSC 转义序列：

```bash
# zsh 示例
__term_precmd() {
    # 命令结束标记，附带退出码
    printf '\e]133;D;%s\a' "$?"
    # 新 prompt 标记
    printf '\e]133;A\a'
}

__term_preexec() {
    # 命令开始执行标记
    printf '\e]133;C\a'
}

precmd_functions+=(__term_precmd)
preexec_functions+=(__term_preexec)
```

OSC 133 协议（FinalTerm 协议）标记：

- `A`：Prompt 开始
- `B`：Prompt 结束，用户输入开始
- `C`：命令开始执行
- `D;exitcode`：命令执行结束

---

## 5. 优先级与里程碑

### Phase 1 — MVP（4-6 周）

最小可用版本，覆盖核心功能：

- [x] Rust 后端：PTY 创建与管理
- [x] Rust 后端：终端输出读取与转发
- [x] 前端：基本 Block 视图渲染
- [x] 前端：输入编辑器（支持鼠标移动光标、基本编辑）
- [x] 前端：xterm.js 全屏模式切换
- [ ] 前端：输入编辑器命令语法高亮（命令/参数/路径/字符串/变量区分颜色）
- [ ] Rust 后端：虚拟屏幕缓冲区（Screen Buffer）维护
- [ ] 智能光标定位：鼠标点击通过方向键模拟移动 PTY 子进程光标
- [x] Shell Integration：zsh 支持
- [x] Block 导航与选中
- [x] 基本快捷键

### Phase 2 — 可用（3-4 周）

日常使用所需功能：

- [x] 分屏支持
- [x] 多标签页
- [ ] 命令历史浏览
- [x] Tab 补全（zsh 基础命令 / 路径补全）
- [ ] Block 搜索（Cmd+F）
- [ ] Block 折叠/展开
- [ ] Shell Integration：bash / fish 支持
- [ ] 长命令完成通知

### Phase 3 — 打磨（2-3 周）

体验优化：

- [ ] 主题系统（亮色/暗色/自定义）
- [ ] 字体设置
- [ ] 链接检测与点击
- [ ] 配置文件支持
- [x] 工作目录追踪
- [x] Git 分支显示
- [ ] 性能优化（大输出 Block 虚拟滚动）
- [ ] GitHub Actions CI 构建（macOS dmg，支持 Intel + Apple Silicon）
- [ ] Homebrew Cask 分发（crossoverJie/homebrew-tap）

---

## 6. 非目标

以下功能 **明确不做**：

- ❌ AI 功能（自动补全、命令建议、自然语言转命令等）
- ❌ 云同步 / 账号系统
- ❌ 内置包管理器 / 工作流引擎
- ❌ 远程 SSH 会话管理（使用 ssh 命令即可）
- ❌ Windows 支持（初期）

---

## 7. 成功指标

- 启动时间 < 500ms
- 输入延迟 < 16ms（1 帧）
- 内存占用 < 100MB（单标签页）
- 可完全替代 Warp 作为 Code Agent 编程的主力终端

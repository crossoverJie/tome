# Tome - 开发任务清单

基于 `docs/terminal-app-prd.md` 拆分，按优先级和依赖关系排列。

---

## Phase 1 — MVP（核心可用）

### 1.1 项目初始化
- [x] Tauri 2.x + React + TypeScript 项目脚手架搭建
- [x] Rust 依赖引入：`portable-pty`, `vte`, `tokio`, `serde`
- [x] 前端依赖引入：`xterm.js`, `codemirror 6`
- [x] 基本项目结构与模块划分

### 1.2 Rust 后端 — PTY 管理
- [x] PTY 创建（spawn shell 进程）
- [x] PTY 输出读取（异步读取 stdout）
- [x] PTY 输入写入（通过 Tauri IPC 接收前端输入）
- [x] PTY 生命周期管理（关闭、重启）
- [x] 环境变量与工作目录传递
- [x] PATH 目录缓存与命令存在性查询接口（用于输入编辑器语法高亮）

### 1.3 Rust 后端 — 终端解析
- [x] VT 转义序列解析（基于 `vte` crate）
- [x] Alternate screen buffer 检测（`\e[?1049h` / `\e[?1049l`）
- [x] OSC 133 Shell Integration 标记解析（A/B/C/D 标记）
- [x] 将解析结果通过 Tauri event 推送给前端
- [x] 路径存在性验证 IPC 接口（用于输入编辑器高亮）

### 1.4 前端 — Block 视图
- [x] Block 数据模型定义（命令、输出、退出码、执行时间）
- [x] Block 列表渲染（DOM 渲染命令输出）
- [x] Block 视觉分隔与样式
- [x] Block 导航与选中（Cmd+↑/↓）
- [x] 选中 Block 复制输出（Cmd+Shift+C）
- [x] 输出内容 ANSI 颜色渲染

### 1.5 前端 — 输入编辑器
- [x] CodeMirror 6 集成，固定在窗口底部
- [x] 鼠标点击移动光标、拖拽选中
- [x] 多行输入（Shift+Enter 换行）
- [x] 基本编辑快捷键（Cmd+A/C/V/X, Option+←/→）
- [x] 回车提交命令（通过 IPC 写入 PTY）
- [x] 命令历史浏览（↑/↓）
- [x] 历史导航模式优化（空输入时保留完整历史浏览）
- [x] 命令语法高亮（commands/arguments/paths/strings/variables 区分颜色）
  - [x] CodeMirror 6 stream parser 实现基础 shell 语法高亮
  - [x] 定义 syntax highlighter 主题 tokens（command/argument/path/string/variable/operator）
  - [x] 路径存在性验证（无效路径显示红色警告）
  - [x] 命令存在性验证（无效命令显示红色警告）
    - [x] Rust 后端缓存 PATH 目录列表并提供 IPC 查询接口
    - [x] 前端异步验证命令存在性
  - [x] 命令存在性验证改进（识别 shell 别名和函数）

### 1.6 前端 — 全屏程序模式
- [x] xterm.js 集成（隐藏状态）
- [x] 收到 alternate screen 事件时切换到 xterm.js 全屏视图
- [x] 退出全屏程序后恢复 Block 视图
- [x] 全屏模式下键盘输入直通 PTY
- [x] 全屏模式快捷键：Cmd+Backspace (Cmd+Del) 删除到行首
- [x] 全屏模式快捷键：Cmd+←/→ 跳转到行首/行尾
- [x] 全屏模式快捷键：Shift+Enter 软换行
- [x] 中文输入法标点符号支持（防止重复输入）

### 1.7 智能光标定位（CLI 工具输入行鼠标支持，仅输入场景）
- [x] Rust 后端维护虚拟屏幕缓冲区（Screen Buffer），实时追踪字符位置与光标坐标
- [x] 前端监听非编辑器区域的鼠标点击，将屏幕坐标通过 IPC 发送给后端
- [x] 后端对比目标位置与当前光标位置，计算行列偏移量
- [x] 向 PTY 发送对应数量的方向键转义序列（`\e[A/B/C/D`）模拟光标移动
- [x] 通过 `\e[6n`（Cursor Position Report）校准实际光标位置
- [x] 识别 prompt 前缀（不可编辑区域）防止光标越界
- [x] Claude/Codex 等 AI 工具光标同步优化

### 1.8 Shell Integration
- [x] zsh shell integration 脚本编写（precmd/preexec hook）
- [x] 应用启动时自动注入 shell integration
- [x] OSC 133 标记与 Block 切割联调

### 1.9 基本快捷键
- [x] Cmd+K 清屏
- [x] Cmd+N 新建窗口
- [x] Cmd+, 打开设置（占位）

---

## Phase 2 — 日常可用

### 2.1 分屏
- [x] 水平/垂直分屏（Cmd+D / Cmd+Shift+D）
- [x] 每个分屏独立 PTY 会话
- [x] 分屏间焦点切换（Cmd+[ / Cmd+]）
- [x] 拖拽调整分屏比例
- [x] Cmd+W 关闭分屏
- [x] 分屏时继承源分屏的当前工作目录（而非默认进入用户目录）

### 2.2 多标签页
- [x] Tab 数据模型与 UI
- [x] Cmd+T 新建标签页
- [x] Cmd+W 关闭标签页
- [x] Cmd+数字 切换标签页
- [x] 标签页显示当前工作目录

### 2.3 Block 增强
- [x] Block 折叠/展开
- [x] Block 搜索（Cmd+F 全局搜索输出内容）

### 2.4 补全与历史
- [x] Tab 补全（首版支持 zsh 的基础命令 / 路径补全与简单候选菜单，Warp-style 结构化补全仍待后续增强）
- [x] Tab 补全忽略大小写（如 `cd Doc` 和 `cd doc` 都能提示 `Documents` 目录）
- [x] 命令历史持久化与浏览（使用 Tauri FS API 保存到应用数据目录）
- [x] 历史导航模式优化（空输入时保留完整历史浏览）

### 2.5 Shell Integration 扩展
- [ ] bash shell integration 支持
- [ ] fish shell integration 支持

### 2.6 窗口切换器
- [ ] Rust 后端维护全局窗口注册表（窗口创建/销毁同步）
- [ ] 暴露 `get_windows()` IPC 命令获取窗口列表
- [ ] 广播 `windows-changed` 事件通知状态变化
- [ ] 前端 `WindowSwitcher` 组件（MVP 卡片列表版）
- [ ] `Cmd+`` 快捷键打开/关闭切换器
- [ ] `Cmd+数字` 快捷键快速切换窗口
- [ ] 窗口元数据上报（标题、目录、标签页数、活跃命令）
- [ ] 【可选】缩略图生成与同步（完整版）

### 2.7 通知
- [ ] 长时间命令完成后发送 macOS 系统通知

### 2.8 菜单栏 Agent Overview

为 macOS 菜单栏增加常驻入口，提供跨窗口、跨 tab、跨 pane 的统一 agent 总览面板。

**Phase 2.8.1 - Frontend: Window Snapshot Producer**
- [x] 窗口级快照聚合逻辑（汇总 tabs/pane tree/cwd/agent state/焦点信息）
- [x] 预览文本提取与清洗（ANSI/控制字符过滤，2-4 行摘要）
- [x] Agent 状态判定扩展（running / waiting_input / idle / error / unknown）
- [x] 快照上报节流机制（避免高频 IPC）
- [x] 快照触发事件：agent 状态变化、cwd 变化、tab/pane 操作、窗口焦点变化

**Phase 2.8.2 - Rust: Global Registry**
- [x] `AgentWorkspaceRegistry` 全局状态结构体
- [x] 窗口注册、更新、销毁接口
- [x] 异常退出清理机制（避免幽灵窗口）
- [x] 聚合状态统计（各状态 agent 数量）

**Phase 2.8.3 - Rust: Menu Bar Status Item**
- [x] macOS 菜单栏状态项初始化
- [x] 图标状态更新（无 agent/有运行中/异常态）
- [x] Popover 容器（Tauri webview window）

**Phase 2.8.4 - Overview UI**
- [x] 总览区组件（agent 总数、各状态数量、最近活跃时间）
- [x] 窗口分组列表组件
- [x] Agent 卡片组件（logo、状态、目录、位置、预览、时间）
- [ ] Hover tooltip（完整目录、长预览）
- [x] 空状态展示

**Phase 2.8.5 - Focus Handoff**
- [x] Rust → Frontend 聚焦事件接口
- [x] App.tsx 消费聚焦事件（切换 tab / pane）
- [x] 目标窗口激活逻辑
- [x] 窗口不存在时的自愈清理

**Phase 2.8.6 - 测试**
- [ ] 前端快照聚合单元测试
- [ ] 预览文本清洗单元测试
- [ ] Rust `AgentWorkspaceRegistry` 单元测试
- [ ] E2E 测试：多窗口场景、跳转验证、窗口关闭清理

---

## Phase 3 — 体验打磨

### 3.1 主题系统
- [x] CSS Variables 主题架构
- [x] 内置暗色主题
- [ ] 内置亮色主题
- [ ] 跟随系统外观自动切换
- [ ] 自定义配色方案（兼容 iTerm2 格式）
- [ ] 命令语法高亮色变量定义（syntax-command/argument/path/string/variable/operator/error）

### 3.2 字体与排版
- [x] 默认 JetBrains Mono / Fira Code
- [ ] 自定义字体与字号设置

### 3.3 配置系统
- [ ] TOML 配置文件读写
- [ ] 设置界面 UI

### 3.4 其他
- [x] 工作目录追踪（标题栏/标签页显示 pwd）
- [x] Git 分支显示（输入编辑器 prompt 显示当前分支）
- [x] 输出中 URL 链接检测与点击
- [ ] iTerm2 内联图片协议支持（Sixel）
- [ ] 大输出 Block 虚拟滚动性能优化
- [x] Running Block 内联进度输出降噪
- [x] 输出链接检测与交互（可点击 URL）
- [x] 进度条回车处理（`\r`）

### 3.5 全屏终端增强
- [x] Cmd+Backspace (Cmd+Del) 删除到行首
- [x] Cmd+←/→ 跳转到行首/行尾
- [x] Shift+Enter 软换行
- [x] 中文输入法标点符号支持（防止重复输入）
- [x] 智能光标定位（鼠标点击移动光标）
- [x] 全屏终端选择复制改进
- [x] Claude/Codex AI CLI 兼容层
- [x] 多 Pane 全屏状态独立管理
- [x] WebKit 白屏问题修复

### 3.6 Running Block 增强
- [x] Warp-style 交互式 Running Block
- [x] Running Block 控制移交（AI 工具等交互式命令）
- [x] REPL 和 TTY 工具支持
- [x] Sticky Header（滚动时固定显示）
- [x] 右侧忙碌指示器
- [x] 内联进度输出降噪

### 3.7 Tab Bar 增强
- [x] 键盘快捷键提示（显示 Cmd+数字）

### 3.8 构建与分发
- [x] GitHub Actions workflow 搭建（基于 `tauri-apps/tauri-action`）
- [ ] 支持 macOS 双架构构建（x86_64 + aarch64）或 Universal Binary
- [ ] Release tag 触发自动构建，上传 `.dmg` 到 GitHub Releases
- [ ] 创建 `crossoverJie/homebrew-tap` 仓库
- [ ] 编写 Homebrew Cask formula（指向 GitHub Releases 下载地址）
- [ ] CI 发版后自动更新 tap 仓库中的 formula（版本号 + SHA256）

---

## 性能目标

- [ ] 启动时间 < 500ms
- [ ] 输入延迟 < 16ms
- [ ] 内存占用 < 100MB（单标签页）

---

## 验证方法

### CI 检查

```bash
# 前端检查
pnpm build          # TypeScript 编译
pnpm test           # 单元测试
pnpm format:check   # 格式检查

# Rust 检查（cd src-tauri/）
cargo test
cargo clippy -- -D warnings
cargo fmt -- --check
```

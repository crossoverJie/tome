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

### 1.3 Rust 后端 — 终端解析
- [x] VT 转义序列解析（基于 `vte` crate）
- [x] Alternate screen buffer 检测（`\e[?1049h` / `\e[?1049l`）
- [x] OSC 133 Shell Integration 标记解析（A/B/C/D 标记）
- [x] 将解析结果通过 Tauri event 推送给前端

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

### 1.6 前端 — 全屏程序模式
- [x] xterm.js 集成（隐藏状态）
- [x] 收到 alternate screen 事件时切换到 xterm.js 全屏视图
- [x] 退出全屏程序后恢复 Block 视图
- [x] 全屏模式下键盘输入直通 PTY

### 1.7 智能光标定位（CLI 工具输入行鼠标支持，仅输入场景）
- [ ] Rust 后端维护虚拟屏幕缓冲区（Screen Buffer），实时追踪字符位置与光标坐标
- [ ] 前端监听非编辑器区域的鼠标点击，将屏幕坐标通过 IPC 发送给后端
- [ ] 后端对比目标位置与当前光标位置，计算行列偏移量
- [ ] 向 PTY 发送对应数量的方向键转义序列（`\e[A/B/C/D`）模拟光标移动
- [ ] 通过 `\e[6n`（Cursor Position Report）校准实际光标位置
- [ ] 识别 prompt 前缀（不可编辑区域）防止光标越界

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

### 2.2 多标签页
- [x] Tab 数据模型与 UI
- [x] Cmd+T 新建标签页
- [x] Cmd+W 关闭标签页
- [x] Cmd+数字 切换标签页
- [ ] 标签页显示当前工作目录

### 2.3 Block 增强
- [ ] Block 折叠/展开
- [ ] Block 搜索（Cmd+F 全局搜索输出内容）

### 2.4 补全与历史
- [ ] Tab 补全（发送 Tab 字符到 PTY，解析返回）
- [ ] 命令历史持久化与浏览

### 2.5 Shell Integration 扩展
- [ ] bash shell integration 支持
- [ ] fish shell integration 支持

### 2.6 通知
- [ ] 长时间命令完成后发送 macOS 系统通知

---

## Phase 3 — 体验打磨

### 3.1 主题系统
- [x] CSS Variables 主题架构
- [x] 内置暗色主题
- [ ] 内置亮色主题
- [ ] 跟随系统外观自动切换
- [ ] 自定义配色方案（兼容 iTerm2 格式）

### 3.2 字体与排版
- [x] 默认 JetBrains Mono / Fira Code
- [ ] 自定义字体与字号设置

### 3.3 配置系统
- [ ] TOML 配置文件读写
- [ ] 设置界面 UI

### 3.4 其他
- [ ] 工作目录追踪（标题栏/标签页显示 pwd）
- [ ] 输出中 URL 链接检测与点击
- [ ] iTerm2 内联图片协议支持（Sixel）
- [ ] 大输出 Block 虚拟滚动性能优化

### 3.5 构建与分发
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

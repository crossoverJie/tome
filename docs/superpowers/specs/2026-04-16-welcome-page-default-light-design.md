# Welcome Page + Default Light Theme Design

## Summary

Tome 将采用窗口级 `viewMode` 作为首页切换机制，引入一个真正的欢迎页首页，并将默认视觉收敛到以下两份设计稿：

- 欢迎页默认主题：`superdesign/design_iterations/welcome_design_2.html`
- 终端工作区默认主题：`superdesign/design_iterations/terminal_design_2.html`

本次只落地默认 light 主题，但样式结构和状态模型要按“欢迎页主题 + 终端主题成组切换”设计，后续可以把另外两套设计稿接入为可切换主题，不在本次实现正式主题切换 UI。

## Current State

当前代码结构与 PRD 的欢迎页需求存在明显缺口：

- [docs/terminal-app-prd.md](docs/terminal-app-prd.md) 已定义欢迎页、返回主页快捷键和 `viewMode: 'welcome' | 'terminal'`
- [src/App.tsx](src/App.tsx) 当前直接渲染 `TabBar + SplitPaneContainer`，没有窗口级欢迎页状态
- [src/components/PaneView.tsx](src/components/PaneView.tsx) 内部已经具备稳定的 session、input、block、fullscreen 模式处理逻辑
- [src/App.css](src/App.css) 当前默认是暗色系 token，与 `terminal_design_2.html` 的浅色极简风格不一致
- [superdesign/gallery.html](superdesign/gallery.html) 目前只是多张静态设计稿的陈列页，还没有明确标记默认主题与后续主题的关系

因此，这次设计不是单纯“套一层样式”，而是要补齐首页状态、输入桥接、最近目录数据和默认 light 视觉体系。

## Decision

采用窗口级欢迎页方案，而不是“特殊 tab”或“首个 pane 内嵌”。

### Why this approach

- 符合 PRD 对“返回主页”的语义，欢迎页是整个窗口的首页，不是终端工作区中的一个子节点
- 不污染现有 tab / pane 模型，分屏、聚焦、session 生命周期可以继续保持原有实现
- 动画更自然，欢迎页上滑退出、终端从下方进入的过渡可以在 `App` 顶层完成
- 后续主题切换也更清晰，可以把欢迎页与终端工作区视为一组主题资源，而不是零散组件样式

## Design

### 1. Window-Level View Mode

在 `App` 顶层增加窗口级状态：

```ts
type ViewMode = "welcome" | "terminal";
```

行为约束如下：

- 应用启动默认进入 `welcome`
- 用户在欢迎页提交命令后：
  - 切换到 `terminal`
  - 将命令提交给当前聚焦 pane 的 session
  - 播放欢迎页退出 / 终端进入动画
- `Cmd+Shift+H` 在终端态返回欢迎页
- 切回欢迎页时不销毁现有 tabs、panes、sessions、blocks
- 欢迎页只是入口态覆盖层，不参与 pane 树结构

这意味着 `showSettings`、tab 管理、pane 管理、session 管理都继续留在 `terminal` 工作区内；欢迎页只在顶层切换显示。

### 2. Welcome Page Structure

新增 `WelcomeView`，作为独立组件挂在 `App` 顶层。布局直接吸收 `welcome_design_2.html` 的视觉语言，但全部改为真实数据驱动。

欢迎页包含以下模块：

#### Logo / Branding

- `◈` 图标 + `Tome`
- 默认欢迎语：`Your command, beautifully`
- 欢迎副文案可保留占位，但不在本次引入复杂自定义设置

#### System Info

展示四个信息卡片，视觉按 `welcome_design_2.html`：

- `OS`
- `Shell`
- `CPU`
- `Memory`

其中数据策略如下：

- `OS`、`Shell`：后端提供稳定只读接口
- `CPU`：优先从后端一次性获取静态信息
- `Memory`：如果实时值获取复杂，V1 可先展示稳定摘要值，不做高频刷新

如果后端信息获取实现成本过高，允许 V1 退化为只展示 `OS` 和 `Shell` 的真实值，`CPU/Memory` 保留卡片结构但使用保守占位文本；布局不改。

#### Recent Directories

欢迎页显示最近 3-5 个工作目录，列表项包含：

- 目录路径
- 简短目录名
- Git 分支（若存在）
- 最近访问顺序

数据来源不应复用 command history，而应建立独立的“最近工作目录 registry”。

建议数据结构：

```ts
interface RecentDirectoryItem {
  path: string;
  label: string;
  gitBranch: string | null;
  lastUsedAt: number;
}
```

更新规则：

- 监听 pane 的 `currentDirectory` 变化
- 同路径去重，只保留最近一次
- 最多保留 5 条
- 写入本地持久化

点击最近目录的行为：

- 优先作为欢迎页输入的上下文选择
- 进入终端后，用于后续命令执行或新建 tab 初始化 cwd
- 不在欢迎页直接打开新 session

#### Command Input

欢迎页底部输入区保留“大输入框”视觉，但不要新写一套命令编辑能力。

推荐做法：

- 复用现有 `InputEditor` 的交互模型
- 通过 `variant="welcome" | "terminal"` 或外层包装组件区分样式
- 保持历史、补全、路径校验、命令校验逻辑只有一份

提交行为：

- Enter 提交
- 空输入不切换页面
- 有输入时先切到 `terminal`，再提交到当前 pane

#### Shortcut Hints

欢迎页底部展示 PRD 已确定的提示：

- `Cmd+K`
- `↑↓`
- `Cmd+Shift+H`

这里只做静态提示，不新增交互。

### 3. Command Submission Bridge

欢迎页落地的核心不是 UI，而是“顶层如何把命令交给当前 pane”。

当前 `sendInput` 只在 `PaneView -> useTerminalSession` 内部使用，因此需要在顶层增加一个统一命令提交桥接能力。

建议约束：

- `App` 维护“提交命令到当前聚焦 pane”的统一入口
- `PaneView` 或 `useTerminalSession` 暴露一个可由顶层调用的 submit 能力
- 欢迎页不直接依赖具体 session 实现细节

推荐行为：

1. 欢迎页输入命令
2. `App` 读取当前 active tab + focused pane
3. 若该 pane 尚未初始化 session，先确保 session ready
4. 切到 `terminal`
5. 把命令提交给目标 pane

这样可以避免欢迎页和终端输入链路分叉。

### 4. Terminal Workspace Theme Convergence

终端工作区不重写现有组件结构，而是将默认视觉收敛到 `terminal_design_2.html` 的 light token 和层级语言。

#### Global Tokens

将默认 token 从暗色改为浅色：

- `--bg-primary`
- `--bg-secondary`
- `--bg-block`
- `--bg-input`
- `--text-primary`
- `--text-secondary`
- `--border-color`
- `--accent`

同时保留未来主题扩展所需的变量组织方式，避免再次散落硬编码颜色。

#### App Shell

`App` 外层调整为：

- 浅灰背景
- 中心白色主工作区容器
- 更轻的边框和阴影

目标是让真实应用接近设计稿中的居中“设备画布”观感，但不牺牲现有 pane 布局能力。

#### Tab Bar

`TabBar` 保留功能，但视觉改成更轻的浅色顶部条：

- 浅边框
- 更轻 hover
- active tab 使用 indigo / subtle ring 表现
- 保留快捷键与关闭按钮，不增加多余装饰

#### Block

`Block` 保留现有 DOM 结构和运行态语义，不直接照搬设计稿里的彩色 segment prompt。

V1 只吸收这些设计特征：

- 白底 card
- 浅边框
- hover 阴影更轻
- 选中态为淡 indigo ring
- success / error 左侧状态条保留
- output 区字体、留白和背景改成 light 主题可读方案

不在本次新增这些设计稿中的示意字段：

- runtime version segment
- execution time 彩色 segment
- shell prompt 彩条组合头部

原因是这些字段在当前 block 数据结构中没有稳定来源，强行引入会让实现范围膨胀。

#### Input Editor

底部命令输入区改成 `terminal_design_2.html` 的浅色输入面板风格：

- 白底
- 细边框
- 轻阴影
- 更舒展的 padding
- branch / cwd / placeholder 颜色切换为 light token

`InputEditor` 的能力保持不变，重点是外观和容器结构变化。

#### Other Overlays

以下组件需要同步 light token，避免局部仍然保持暗色：

- `RunningCommandBar`
- `SearchOverlay`
- `FullscreenTerminal` 的非 xterm 外层容器
- pane focus 边框

### 5. Theme Extensibility

虽然本次只落地默认 light 主题，但结构上要为后续三套主题切换留出扩展点。

建议引入成组主题定义：

```ts
interface TomeThemeDefinition {
  id: string;
  label: string;
  welcomeVariant: string;
  terminalVariant: string;
  tokens: Record<string, string>;
}
```

V1 只注册一个默认主题：

- `default-light`
  - `welcomeVariant = welcome_design_2`
  - `terminalVariant = terminal_design_2`

未来主题：

- `neon-dark`
- `cyberpunk`

本次不实现切换 UI，只保证样式层和状态层不是一次性写死。

### 6. Gallery Repositioning

`superdesign/gallery.html` 这次不再是单纯“多稿件展示墙”，而要转为“默认样式映射页 + 未来主题预留页”。

调整目标：

- 顶部明确说明当前默认组合：
  - Welcome: `welcome_design_2.html`
  - Terminal: `terminal_design_2.html`
- 其他两套主题明确标记为 future themes
- 分组结构调整为：
  - `Default Pair`
  - `Future Themes`
- 补充简短说明：
  - 哪些页面会真正落地到应用
  - 哪些视觉元素只吸收语言，不逐项产品化

gallery 本身的视觉也应切换到 light 默认 token，与最终产品默认样式保持一致。

`superdesign/metadata.json` 目前为空，V1 可以不依赖它驱动页面；若保留，建议补最小元数据结构：

```json
[
  {
    "id": "welcome-design-2",
    "type": "welcome",
    "theme": "default-light",
    "status": "default",
    "sourceFile": "./design_iterations/welcome_design_2.html"
  }
]
```

## Data / API Changes

### Frontend Types

建议新增：

```ts
type ViewMode = "welcome" | "terminal";

interface RecentDirectoryItem {
  path: string;
  label: string;
  gitBranch: string | null;
  lastUsedAt: number;
}

interface WelcomeSystemInfo {
  os: string;
  shell: string;
  cpu?: string;
  memory?: string;
}
```

### Tauri Commands

建议新增一个只读系统信息接口：

```ts
get_system_info(): {
  os: string;
  shell: string;
  cpu?: string;
  memory?: string;
}
```

不要把这部分塞进现有 `create_session` 返回值里；欢迎页在 session 之外也需要展示这些内容。

### Persistence

新增本地持久化项：

- `recentWorkingDirectories`
- 可选：`selectedThemeId`

不要求本次新增 `lastViewMode` 恢复逻辑，默认启动仍进入欢迎页。

## Testing Scope

至少覆盖以下场景：

### Welcome Flow

- 应用首次启动进入欢迎页
- 欢迎页输入命令后切到终端并正常执行
- 空输入不会错误切换
- `Cmd+Shift+H` 返回欢迎页时不清空已有终端状态

### Directory History

- cwd 更新时 recent directories 正确去重
- recent directories 正确按时间排序
- 最多保留 5 条
- 分支为空时 UI 不崩溃

### Input Bridge

- 欢迎页命令能进入当前聚焦 pane
- 当前 pane 尚未初始化 session 时仍能提交成功
- 多 tab / 分屏场景下命令进入正确 pane

### Light Theme Visual Regression

- `TabBar`
- `Block`
- `InputEditor`
- `RunningCommandBar`
- `SearchOverlay`

以上组件在默认主题下不再残留暗色 token。

### Gallery

- 默认 pair 标记正确
- future themes 仍可预览
- 页面说明与默认映射一致

## Assumptions

- 本次不实现完整主题切换 UI，只预留成组 theme 扩展点
- 默认启动仍进入欢迎页，不自动恢复到上次停留的 terminal 视图
- 欢迎页输入能力复用现有 `InputEditor` 交互模型，而不是新写一套编辑器
- `terminal_design_2.html` 中部分示意性信息不会全部产品化，只吸收视觉语言和信息层级
- 如果 `CPU/Memory` 的后端获取成本偏高，V1 可以先以保守静态信息落地，不影响欢迎页整体布局

# Tome Menu Bar Agent Overview Design

## Summary

为 `tome` 增加一个 macOS 菜单栏常驻入口，用于全局展示所有已打开窗口中的 code agent。该入口的目标不是替代主窗口，而是提供一个低摩擦的全局总览面板，让用户可以在任意时刻快速回答下面几个问题：

- 当前一共有哪些 agent 在运行
- 它们分别属于哪个窗口 / tab / pane
- 当前处于运行中、等待输入、空闲还是异常
- 最近在做什么
- 我能否一键跳回对应位置继续操作

V1 采用 `menu bar status item + popover` 形态，不做真实截图缩略图，而是使用结构化轻量预览：agent logo、目录、状态、最近输出摘要、所属窗口信息。点击任意 agent 条目后，激活目标窗口并聚焦到对应 tab / pane。

## Goals

- 提供跨窗口、跨 tab、跨 pane 的统一 agent 总览能力
- 在不打断当前工作流的前提下，快速查看 agent 当前状态
- 支持从菜单栏一键跳转到目标 agent 所在位置
- 与现有 `pane` 级 agent 检测和 `tab` 级聚合逻辑复用，避免重复实现

## Non-Goals

- V1 不在菜单栏中直接操作 agent 生命周期，不支持 stop / restart / send input
- V1 不展示真实 WebView 截图或 live thumbnail
- V1 不引入复杂过滤器、搜索器、排序器
- V1 不改变现有主窗口 tab bar 和 pane 内部交互模型

## Product Shape

### Entry Surface

菜单栏中新增一个 Tome 图标，常驻显示应用整体状态：

- 无活跃 agent：默认图标
- 有运行中 agent：显示 activity dot 或数量 badge
- 存在异常 agent：显示警示态

点击图标弹出固定宽度的 `popover`，定位为 “Agent Overview”。

### Popover Information Architecture

popover 从上到下分为三层：

1. 总览区
- 显示当前 agent 总数
- 显示 `running / waiting-input / idle / error` 数量
- 显示最近活跃时间，例如 `Last activity 8s ago`

2. 分组区
- 按窗口分组展示
- 每个窗口分组头部显示窗口标题、当前目录摘要、tab 数量、pane 数量
- 默认展开当前有活跃 agent 的窗口分组

3. Agent 卡片列表
- 每个 agent 一张紧凑卡片
- 信息包括：
  - agent logo 和类型：Claude / Codex / OpenCode / Copilot
  - 状态标签：Running / Waiting / Idle / Error
  - 当前目录短名
  - 所属位置：`Window 2 · tab-name · pane 3`
  - 最近输出摘要，限制 2-4 行或约 120-180 字符
  - 最近活跃时间

### Primary Interaction

- 点击 agent 卡片：激活目标窗口，并聚焦到对应 tab / pane
- 点击窗口头：激活该窗口
- hover agent 卡片：展示完整目录和更长的 tooltip

V1 只支持 “看 + 跳转”，不在菜单栏中直接执行 agent 控制命令。

## UX Decisions

### Why Menu Bar Instead of Main Window Toolbar

主窗口 toolbar 只能服务当前窗口，无法回答“所有打开的 code agent 现在都在做什么”。`tome` 已经支持多窗口，agent 工作状态天然是全局信息，因此入口必须脱离单窗口上下文。

### Why Lightweight Preview Instead of Real Thumbnail

真实缩略图需要持续采集各窗口 WebView 内容，会引入明显的同步、性能和复杂度成本；而菜单栏 popover 的主要任务是高密度扫描，不是视觉回放。对该场景更有价值的是：

- agent 类型
- 所在目录
- 当前状态
- 最近输出摘要
- 一键跳转

因此 V1 采用结构化文本预览，V2 再考虑 hover 后惰性请求静态 thumbnail。

### Why Group by Window

用户最终跳回去操作时，目标对象首先是“哪个窗口”，其次才是窗口里的 tab / pane。按窗口分组既符合 macOS 多窗口心智，也能降低列表噪音。

## Architecture

### Current Constraint

当前仓库中的 agent 状态只保存在每个窗口的前端内存里：

- `PaneView` 通过 `onAgentStateChange` 上报 pane agent 状态
- `App.tsx` 维护当前窗口自己的 `paneAgentMap`
- `sessionState.ts` 只提供前端进程内 registry

Rust 后端当前没有全局窗口级 agent registry，因此菜单栏无法直接读取“所有窗口”的统一状态。

### Proposed Architecture

新增一层后端全局注册中心 `AgentWorkspaceRegistry`，由所有前端窗口持续上报自身快照。菜单栏 popover 只消费该 registry，不直接依赖某个具体窗口的前端状态。

数据流如下：

1. 每个窗口在前端维护本窗口完整快照
2. 当前窗口状态发生变化时，将窗口快照上报到 Rust 后端
3. Rust 后端更新全局 `AgentWorkspaceRegistry`
4. Rust 根据 registry 更新菜单栏图标状态
5. 菜单栏 popover 打开时读取 registry 生成展示数据
6. 用户点击某个 agent 条目后，由 Rust 激活目标窗口并通知前端聚焦指定 tab / pane

## Data Model

### Frontend Snapshot Model

前端每个窗口应生成一个窗口级快照，至少包含：

- `windowLabel`
- `windowTitle`
- `isFocused`
- `updatedAt`
- `tabs[]`

每个 tab 至少包含：

- `tabId`
- `tabLabel`
- `rootPaneId`
- `focusedPaneId`

每个 pane 至少包含：

- `paneId`
- `cwd`
- `agentKind`
- `agentStatus`
- `isFocused`
- `lastActivityAt`
- `previewText`
- `sessionId`

### Agent Status Enum

为菜单栏统一定义明确状态，而不是只依赖现在的 `isActive`：

- `running`
- `waiting_input`
- `idle`
- `error`
- `unknown`

V1 的判定规则可以先保守一些：

- fullscreen / interactive 且检测到 agent：`running`
- agent 存在但近期无活动：`idle`
- agent 输入区活跃但等待用户输入：`waiting_input`
- 会话异常关闭或快照不完整：`error` 或 `unknown`

如果短期内无法稳定识别 `waiting_input`，V1 可先降级为 `running / idle / unknown`，但数据结构仍保留完整枚举。

### Preview Text

预览文本不应来自 DOM 抓图，而应来自已存在的终端状态数据：

- 优先取当前 pane 最近输出的尾部片段
- 对 ANSI、控制字符、超长空白进行清洗
- 合并为 2-4 行摘要
- 长度超限时截断并附省略号

这样预览生成成本最低，也最稳定。

## Implementation Outline

### 1. Frontend: Window Snapshot Producer

在 React 层新增窗口级快照聚合逻辑，汇总：

- tabs
- pane tree
- pane cwd
- pane agent state
- 当前焦点信息
- pane 预览文本

快照应在以下事件后触发上报：

- pane agent 状态变化
- cwd 变化
- tab 创建、关闭、切换
- pane 分裂、关闭、聚焦变化
- 窗口 focus / blur
- 预览文本变化

### 2. Rust: Global Registry

在 Tauri 后端新增全局状态：

- `AgentWorkspaceRegistry`
- 以窗口 label 为主键存储窗口快照
- 支持窗口注册、更新、销毁
- 提供菜单栏消费的聚合视图

同时为窗口关闭和异常退出提供清理机制，避免 registry 残留脏窗口。

### 3. Rust: Menu Bar Status Item

macOS 下新增 menu bar status item：

- 初始化图标
- 根据 registry 计算状态并更新图标/徽记
- 点击后显示 popover

popover 可以优先采用一个专用 Tauri webview window 或 macOS 原生容器承载；实现上优先选择与当前栈兼容、开发成本最低的方案。对于 `tome` 当前代码结构，优先建议复用 Tauri webview 内容承载 overview UI，而不是纯原生 AppKit 手工绘制列表。

### 4. Overview UI

新增一个专用 overview 前端页面或视图，用于：

- 渲染总览指标
- 渲染窗口分组和 agent 卡片
- 处理跳转事件

视觉上应明显区别于主终端窗口，避免误认为这是另一个终端实例。建议：

- 紧凑列表布局
- 使用现有 agent logo 资源
- 使用状态色点和状态 pill
- 使用次级文字展示目录与位置

### 5. Focus Handoff

点击 agent 后端到前端需要支持精确聚焦：

1. 激活目标窗口
2. 让对应 tab 成为 active tab
3. 聚焦对应 pane
4. 如目标窗口已不存在，则忽略跳转并刷新 registry

这要求新增一个从 Rust 发往前端的聚焦事件接口，现有 `App.tsx` 需要能够消费这个事件并切换到指定 tab / pane。

## File/Module Direction

以下是建议的职责划分，不要求完全照此命名，但边界应保持一致：

- `src/utils/agentStatus.ts`
  - 扩展 agent 状态模型、格式化和展示辅助逻辑

- `src/App.tsx`
  - 产出窗口级快照
  - 负责向后端同步窗口快照
  - 消费 “聚焦指定 tab / pane” 事件

- `src/hooks/sessionState.ts`
  - 若继续保留前端 registry，则仅负责窗口内状态缓存，不承担全局注册职责

- `src-tauri/src/lib.rs`
  - 注册新命令
  - 管理 `AgentWorkspaceRegistry`
  - 管理菜单栏入口和跳转事件

- 新增 overview 视图模块
  - 专门负责菜单栏面板 UI

## Rollout Plan

### V1

- 菜单栏状态项
- 全局 registry
- 结构化轻量预览
- 按窗口分组
- 点击跳转到目标窗口 / tab / pane

### V1.1

- 更准确的 `waiting_input` 判定
- 更好的异常态表达
- 更完整的最近活动时间和 tooltip

### V2

- hover 或选中时惰性请求静态 thumbnail
- 过滤器：只看 running / 只看当前 workspace
- 快捷操作：复制路径、复制最近输出

## Risks

### 1. 状态同步频率过高

如果每次终端输出都全量上报窗口快照，会导致 IPC 频繁、菜单栏刷新抖动。需要做增量更新或节流，建议对 overview 快照上报进行短时间合并。

### 2. 状态语义不足

当前前端只有 `agentKind + isActive`，对 `waiting_input`、`error` 的判断能力不够。V1 应允许状态回退为较粗粒度，避免为了完美分类而卡住方案。

### 3. 窗口关闭后的脏数据

多窗口场景下，若窗口关闭未触发清理，菜单栏会展示幽灵 agent。需要在窗口销毁时做明确 unregister，并在聚焦失败时做自愈清理。

### 4. 预览摘要噪音

终端尾部输出可能包含 ANSI、进度字符、空白重复或无意义 spinner 文本。必须做清洗和归一化，否则 overview 可读性会很差。

## Acceptance Criteria

- 当存在多个 Tome 窗口时，菜单栏可以展示所有窗口中的 agent，而不是仅当前窗口
- 菜单栏图标能反映是否有活跃 agent
- popover 中每个 agent 至少显示类型、状态、目录、所属位置和轻量预览
- 点击任意 agent 后，可正确激活目标窗口并聚焦到对应 tab / pane
- 关闭某个窗口后，其 agent 不再出现在 overview 中
- 在没有任何 agent 时，菜单栏仍可打开，但显示空状态
- overview 不会因为高频终端输出而明显卡顿或闪烁

## Testing Strategy

### Frontend

- 为窗口级快照聚合逻辑补单元测试
- 为预览文本清洗逻辑补单元测试
- 为 overview UI 补渲染测试和点击跳转测试

### Rust

- 为 `AgentWorkspaceRegistry` 补单元测试
- 验证窗口注册、更新、销毁、异常清理
- 验证聚合状态统计结果

### End-to-End

- 打开两个 Tome 窗口，分别创建不同 agent，确认 overview 正确分组
- 在一个窗口中切换 tab / split pane，确认 overview 位置更新正确
- 关闭窗口，确认 overview 立即移除
- 点击 agent 卡片，确认跳转到正确窗口和 pane

## Defaults Chosen

- 入口形态：菜单栏常驻 status item
- 面板形态：popover，不是传统纯文本菜单
- 预览形态：轻量结构化摘要，不是真实缩略图
- 核心交互：总览 + 跳转，不在菜单栏中直接控制 agent
- 分组方式：按窗口分组
- V1 技术重点：先补后端全局 registry，再做 overview UI

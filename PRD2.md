# Myrmidon 通用 AI 工作流引擎 — PRD v2

> ⚠️ **已归档 — 被 PRD4 取代**。本文档不再作为实施依据；实施请看 `PRD4.md`（v1 基准）+ `PRD5.md`（平台化架构守则）。保留原位仅供 PRD4/PRD5 中"PRD2 §X"引用溯源。

> 版本：0.2.0-draft｜状态：已归档｜取代关系：本文档是 PRD1.md 的演进版本
> PRD1.md 描述软件开发专用编排器（定型，不再更新）
> PRD2.md 描述通用工作流引擎（当前开发重心）

---

## 1. 产品定位更新

### 1.1 从"软件开发编排器"到"通用 AI 工作流引擎"

**PRD1.md 定位**：Myrmidon 是 AI 软件开发外包公司的运营中枢，对外与甲方沟通，对内协调 pm/arch/coder/qa/security/ui 等专业 AI Agent 完成软件交付。

**PRD2.md 定位**：Myrmidon 是**通用 AI 工作流引擎**，能够描述和执行任意领域的有向图工作流，软件开发工作流是其内置模板之一。

**适用场景举例**：

| 领域 | 工作流示例 |
|------|-----------|
| 软件开发（敏捷） | 需求 → PRD → 设计 → 并行开发 → QA → 交付（PRD1.md 已描述） |
| 软件开发（瀑布） | 同上但严格串行，每阶段有人工门控 |
| 电商运营 | 选品分析 → 上架文案 → 定价策略 → 活动排期 → 数据复盘 |
| 自媒体创作 | 选题 → 脚本 → 配音 → 剪辑 → 发布 → 数据分析 |
| 内容审核 | 内容摄取 → AI 粗筛 → 人工复核 → 发布 / 驳回 |

### 1.2 核心设计原则（继承 PRD1.md，新增）

原有原则全部保留（见 PRD1.md §1.2）。新增：

| 原则 | 说明 |
|------|------|
| **单一真相源格式** | WorkflowDef JSON 是唯一落库格式，存 SQLite + `.myrmidon/workflows/{id}.json`；TypeScript DSL / Desktop 画布 / YAML 均为编写便利，最终产出 WorkflowDef |
| **引擎与模板分离** | 引擎不知道"软件开发"，只知道节点类型和边；软件开发工作流是通过模板注册的 |
| **节点即插件** | 每种节点类型（NodeType）都是可注册的 NodeExecutor，内置类型可被自定义类型覆盖 |
| **通用不等于灵活无边界** | 工作流结构在启动前静态定义，引擎按 DAG 推进；节点内的 AI 行为受 Constitution 约束 |

---

## 2. 工作流定义语言（TypeScript DSL）

用户通过 `defineWorkflow()` 函数描述工作流，该函数在运行时求值产出 WorkflowDef JSON：

```typescript
import { defineWorkflow } from 'myrmidon';

export const myWorkflow = defineWorkflow({
  id: 'content-creation',
  version: '1.0.0',
  name: '自媒体内容创作流水线',
  nodes: [
    {
      id: 'topic-research',
      type: 'agent',
      name: '选题研究',
      agentRole: 'researcher',
      executor: 'sonnet',
      artifacts: {
        consumes: [],
        produces: [
          { id: 'topic-brief', path: 'content/topic-brief.md' },
        ],
      },
      outputValidator: { required: ['topic-brief'] },
      humanApproval: {
        message: '选题方向已生成，请确认',
        timeoutMs: 600_000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject', 'defer'],
        onReject: 'topic-research',
      },
    },
    {
      id: 'script-writing',
      type: 'agent',
      name: '脚本撰写',
      agentRole: 'writer',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'topic-brief' }],
        produces: [{ id: 'script', path: 'content/script.md' }],
      },
    },
    {
      id: 'qa-check',
      type: 'human_approval',
      name: '内容审核',
      humanApproval: {
        message: '脚本已完成，请审核',
        timeoutMs: 1_800_000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject'],
        onReject: 'script-writing',
      },
    },
  ],
  edges: [
    { from: 'topic-research', to: 'script-writing', condition: 'approved' },
    { from: 'topic-research', to: 'topic-research', condition: 'rejected' },
    { from: 'script-writing', to: 'qa-check', condition: 'success' },
    { from: 'qa-check', to: 'script-writing', condition: 'rejected' },
  ],
});
```

`myrmidon.config.ts` 中通过 `workflows` 字段引用：

```typescript
export default defineConfig({
  // ... 原有配置（PRD1.md 定义的字段全部保留）
  workflows: ['./workflows/content-creation.ts', './workflows/software-dev-agile.ts'],
});
```

---

## 3. 内置节点类型（NodeType）

| type | 说明 | 关键字段 |
|------|------|---------|
| `agent` | 派发给 AI executor 执行，fresh session per invocation | `agentRole`, `executor`, `artifacts` |
| `human_approval` | 等待人工确认（TUI banner + IM 通知），支持超时策略 | `humanApproval.timeoutMs`, `onTimeout`, `onReject` |
| `condition` | 读取上游产物/状态，按条件选择出边 | `edge.condition` 表达式 |
| `parallel_fork` | 同时启动多个子节点 | 无额外字段，由出边隐式定义 |
| `join` | 等待所有上游并行节点完成后继续 | 无额外字段，由入边隐式定义 |
| `transform` | 无 AI，纯函数转换产物（格式转换、摘要截取） | `transform.fn` |
| `trigger` | 工作流入口节点（手动、定时、Webhook） | `trigger.type` |
| `loop` | 循环子图，直到 condition 满足（如 QA→Dev 修复循环） | `loop.maxIterations` |

所有节点类型均可通过 `engine.registerExecutor(executor)` 注册自定义实现覆盖内置行为。

---

## 4. 节点能力矩阵（每节点支持的扩展点）

| 扩展点 | 说明 | 作用时机 |
|--------|------|---------|
| `skills` | 注入 Agent 宪法的 Skill 列表 | dispatch 时 |
| `mcpTools` | 允许使用的 MCP 工具白名单 | dispatch 时 |
| `plugins` | 节点级 Plugin，可替换节点内置行为 | 注册时 |
| `hooks.pre` | 执行前钩子（skill / 脚本 / 通知 / 变换） | 节点开始前 |
| `hooks.post` | 执行后钩子（成功时） | 节点完成后 |
| `hooks.onError` | 错误钩子 | 节点失败时 |
| `inputValidator` | 前置校验：检查所有 `consumes` 产物 status=ready | 节点开始前 |
| `outputValidator` | 后置校验：检查 `produces` 文件存在且格式合法 | 节点完成后 |
| `humanApproval` | 人工介入门控 | 节点完成后（可循环） |
| `retry` | 失败自动重试策略 | 校验失败 / 节点失败时 |
| `timeoutMs` | 节点级超时，覆盖 workflow 级默认值 | 节点运行时 |

---

## 5. CLI 命令更新

### 5.1 `myrmidon workflow`（新增命令组）

```
myrmidon workflow <subcommand>

子命令:
  list              列出所有已注册工作流（从 myrmidon.config.ts 读取）
  load <path>       从 DSL 文件加载工作流定义到 SQLite
  validate <id>     校验工作流定义（节点类型合法、边引用合法、无孤立节点）
  show <id>         显示工作流定义详情（节点/边/配置）
  runs [id]         列出工作流的历史运行记录

示例:
  myrmidon workflow list
  myrmidon workflow validate software-dev-agile
  myrmidon workflow show content-creation
  myrmidon workflow runs software-dev-agile
```

### 5.2 `myrmidon start`（更新）

新增 `--workflow` 选项，允许指定运行哪个工作流：

```
myrmidon start [options]

选项:
  --workflow <id>    指定工作流 ID（默认: myrmidon.config.ts 中第一个 workflow）
  --no-tui           无头模式（继承 PRD1.md 定义）
  --resume           从中断点恢复（继承 PRD1.md 定义）
  --run-id <id>      恢复指定 run-id 的历史运行

示例:
  myrmidon start                              # 使用默认工作流
  myrmidon start --workflow content-creation  # 指定工作流
  myrmidon start --resume                     # 恢复上次中断
```

### 5.3 其余命令

`myrmidon init / status / resume / config / worktree / agent / log / notify / skills` 均继承 PRD1.md 定义，不变。

---

## 6. 产物系统（Artifacts）

工作流中的数据流动通过"产物"显式声明，取代 PRD1.md 中隐式的"输出文件"概念。

**产物生命周期**：

```
节点开始前：inputValidator 检查 consumes 产物 status = 'ready'
节点执行中：AI Agent 在指定路径写入文件
节点完成后：outputValidator 校验 produces 文件存在且格式合法
           → status 更新为 'ready'（合法）或 'invalid'（不合法）
           → 下游节点的 inputValidator 自动解锁
```

**产物引用格式**：

```typescript
// 节点声明产出
produces: [
  { id: 'prd-doc', path: 'docs/design/prd/prd-v1.md' },
  { id: 'wireframe', path: 'docs/design/wireframes/wireframe-v1.md' },
]

// 下游节点声明消费
consumes: [
  { id: 'prd-doc' },   // 引用上游产出的 id，路径由引擎自动解析
]
```

与 PRD1.md 的 task.produces / task.consumes 语义相同，但提升到工作流引擎层统一管理。

---

## 7. 软件开发工作流（内置模板）

PRD1.md 中描述的完整软件开发工作流（需求 → PRD → 设计 → 开发 → QA → 交付）作为内置模板提供：

- 模板 ID：`software-dev-agile`（敏捷）、`software-dev-waterfall`（瀑布）
- 位置：`src/core/templates/software-dev-agile.ts`
- 节点和 agentRole 定义继承 PRD1.md §4（pm/arch/coder/qa/security/ui）
- 用户可以 fork 内置模板（`myrmidon workflow show software-dev-agile > my-workflow.ts`）后修改

**内置模板的节点构成**：

```
trigger → requirements(agent:pm) → prd(agent:pm) → design(agent:arch)
→ sprint-plan(agent:pm) → [parallel_fork]
    → coding-1..N(agent:coder)
  [join] → qa(agent:qa) → [condition]
    ↗ passed → sprint-delivery(human_approval)
    ↘ failed → bug-fix(agent:coder) → qa（loop）
```

---

## 8. 配置更新（myrmidon.config.ts 新增字段）

在 PRD1.md §9.1 基础上，新增以下顶层字段：

```typescript
export default defineConfig({
  // ... 全部 PRD1.md 字段保持不变 ...

  // 新增：工作流注册列表
  // 可以是 .ts 文件路径（DSL）或内置工作流 ID
  workflows: [
    'software-dev-agile',              // 内置模板，直接引用 ID
    './workflows/content-creation.ts', // 自定义工作流 DSL 文件
  ],
});
```

`WorkflowConfig`（节点级定时器覆盖）：

```typescript
// 在 defineWorkflow 中设置，非 myrmidon.config.ts 顶层
config?: {
  maxParallelNodes?: number;       // 默认 3
  defaultTimeoutMs?: number;       // 默认 1_800_000 (30min)
  timers?: {
    workflowPollMs?: number;       // T1，默认 30_000
    heartbeatMs?: number;          // T2，默认 15_000
    clientTimeoutMs?: number;      // T3，默认 60_000
    stuckDetectionMs?: number;     // T4，默认 60_000
    consistencyMs?: number;        // T5，默认 300_000
    externalDepWatchMs?: number;   // T6，默认 60_000
  };
};
```

---

## 9. 新增 SQLite 表

在 PRD1.md §6.5 已有 9 张表基础上，新增以下 4 张表（迁移脚本追加，不破坏现有结构）：

```sql
-- 工作流定义存储
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  name        TEXT NOT NULL,
  def_json    TEXT NOT NULL,       -- WorkflowDef JSON 全文
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 工作流执行实例
CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,  -- UUID
  workflow_id   TEXT NOT NULL,
  status        TEXT NOT NULL,     -- 'running'|'paused'|'completed'|'failed'
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  context_json  TEXT               -- 运行时变量（项目名、客户信息等）
);

-- 节点执行状态（每节点每次运行一行）
CREATE TABLE node_executions (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  status        TEXT NOT NULL,    -- 'pending'|'running'|'completed'|'failed'|'skipped'|'waiting_human'
  attempt       INTEGER DEFAULT 1,
  agent_id      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  error         TEXT,
  output_json   TEXT
);

-- 产物注册表
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  status       TEXT NOT NULL,     -- 'pending'|'ready'|'invalid'
  created_at   TEXT NOT NULL
);
```

---

## 10. TUI 更新（概念，Sub-4 实现）

TUI 整体继承 PRD1.md §3 定义（5 个 Tab），新增/调整：

**Tab 1 Overview**：右侧摘要从"WORKFLOW PHASE"改为"WORKFLOW NODES"，展示当前运行的工作流节点状态图（文本版有向图）：

```
WORKFLOW: content-creation
  ✅ topic-research  →  🔄 script-writing  →  ○ qa-check
```

**Tab 4 Cron**：系统定时器描述从"workflow-poll"改为通用名称，业务等待项显示当前 `waiting_human` 节点的 humanApproval 信息。

**Desktop 画布**（远期，Sub-Desktop）：n8n 风格拖拽编辑工作流，本质是 WorkflowDef JSON 的可视化编辑器，与引擎完全解耦，生产产出同样的 WorkflowDef。

---

## 11. 发布路线图（更新）

| 子项目 | 内容 | 状态 |
|--------|------|------|
| Sub-1 Foundation & CLI | 项目脚手架、配置、数据库、运行时检测、init 命令 | ✅ 已完成 |
| Sub-2 Workflow Engine | WorkflowDef schema、引擎、节点执行器、Dispatcher、WorktreeManager、定时器、NotificationBus、4 张新表、workflow 命令、软件开发敏捷模板 | 🔄 进行中 |
| Sub-3 Advanced Runtime | Worktree 高级管理、多运行时完整适配、dispatch 优化 | ⏳ 待开始 |
| Sub-4 TUI | Ink 实现完整 5-Tab TUI、实时节点状态图 | ⏳ 待开始 |
| Sub-5 Notifications | Slack / 企业微信 / Email 通知渠道 | ⏳ 待开始 |
| Sub-6 Skills & MCP | Skills 包管理、MCP lifecycle、dispatch 集成 | ⏳ 待开始 |
| Sub-Desktop | Desktop 画布编辑器（Electron / Tauri） | 🔮 远期 |

---

## 12. 与 PRD1.md 的关系总结

| 方面 | PRD1.md | PRD2.md |
|------|---------|---------|
| 定位 | 软件开发专用编排器 | 通用 AI 工作流引擎 |
| 工作流格式 | 硬编码 Phase 1-7 状态机 | WorkflowDef JSON（任意有向图） |
| 节点类型 | 固定：pm/arch/coder/qa/security/ui | 可注册：8 种内置 + 自定义 |
| 软件开发支持 | 完整描述 | 通过内置模板提供，效果等同 |
| 领域扩展 | 不支持 | 通过 defineWorkflow() 自定义 |
| CLI 命令 | 完整定义（继续有效） | 新增 `workflow` 命令组 |
| 配置 | myrmidon.config.ts §9.1 | 新增 `workflows` 顶层字段 |
| SQLite 表 | 9 张表（继续有效） | 新增 4 张表（迁移追加） |

**兼容性原则**：PRD2.md 中所有设计均在 PRD1.md 基础上**追加**，不破坏现有实现。Sub-1 已实现的代码无需修改。

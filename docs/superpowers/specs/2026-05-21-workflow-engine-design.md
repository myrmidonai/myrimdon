# Myrmidon Workflow Engine Design Spec

**日期**: 2026-05-21  
**状态**: 待实施  
**取代**: 原 Sub-2"Orchestrator Core"方案

---

## 1. 设计目标

将 Myrmidon 从"软件开发专用 orchestrator"升级为**通用 AI 工作流引擎**，具备：

- 任意领域可用（软件开发、电商运营、内容创作等）
- 工作流节点支持 plugin、hook、skill、MCP、human-approval、input/output validator
- 单一落库格式（WorkflowDef JSON），多种编写方式（TypeScript DSL / Desktop 画布 / YAML）
- TUI 实时监控；Desktop 拖拽编辑（后续子项目）
- 软件开发工作流作为内置模板

---

## 2. 核心原则

1. **单一真相源**：WorkflowDef JSON 是唯一落库格式，存 SQLite + `.myrmidon/workflows/{id}.json`
2. **引擎与模板分离**：引擎不知道"软件开发"，只知道节点类型和边
3. **节点即插件**：每种 node type 都是可注册的 NodeExecutor，内置类型可被自定义类型覆盖
4. **SQLite 是执行状态的唯一来源**：崩溃后从 SQLite 完整恢复，不依赖内存状态
5. **RuntimeAdapter 抽象**：executor（claude-code/opencode 等）通过接口调用，不硬编码

---

## 3. WorkflowDef JSON Schema

落库格式。所有写法（DSL / 画布 / YAML）最终产出此结构。

```typescript
interface WorkflowDef {
  id: string;                    // 'software-dev-agile'
  version: string;               // '1.0.0'
  name: string;
  description?: string;
  nodes: NodeDef[];
  edges: EdgeDef[];
  config?: WorkflowConfig;
}

interface NodeDef {
  id: string;                    // 节点唯一 ID，图内引用用
  type: NodeType;                // 见第 4 节
  name: string;
  description?: string;

  // 执行配置（agent 节点专用）
  agentRole?: string;            // 'pm' | 'arch' | 'coder' | ...
  executor?: string;             // 引用 myrmidon.config.ts executors.{key}
  skills?: string[];             // .myrmidon/skills/ 中的 skill 名
  mcpTools?: string[];           // 允许使用的 MCP tool 名
  plugins?: PluginRef[];         // 节点级 plugin

  // 产物规约（输入/输出文件声明）
  artifacts?: {
    consumes: ArtifactRef[];     // 本节点需要的上游产物
    produces: ArtifactDef[];     // 本节点产出的产物
  };

  // 验证器
  inputValidator?: ValidatorDef;   // 执行前校验输入产物
  outputValidator?: ValidatorDef;  // 执行后校验输出产物

  // Hook（节点生命周期钩子）
  hooks?: {
    pre?: HookDef[];             // 执行前
    post?: HookDef[];            // 执行后（成功）
    onError?: HookDef[];         // 执行失败
  };

  // 人工介入
  humanApproval?: HumanApprovalDef;

  // 重试策略
  retry?: {
    maxAttempts: number;         // 默认 3
    backoffMs: number;           // 默认 5000
  };

  // 节点级超时（覆盖 workflow 级默认值）
  timeoutMs?: number;
}

interface EdgeDef {
  from: string;                  // 源节点 id
  to: string;                    // 目标节点 id
  condition?: string;            // 'approved' | 'rejected' | 'success' | 'failure' | 表达式
  label?: string;                // 画布展示用
}

interface WorkflowConfig {
  maxParallelNodes?: number;     // 默认 3
  defaultTimeoutMs?: number;     // 默认 1800000 (30min)
  timers?: {                     // 覆盖内置定时器间隔
    workflowPollMs?: number;     // T1，默认 30000
    heartbeatMs?: number;        // T2，默认 15000
    clientTimeoutMs?: number;    // T3，默认 60000
    stuckDetectionMs?: number;   // T4，默认 60000
    consistencyMs?: number;      // T5，默认 300000
    externalDepWatchMs?: number; // T6，默认 60000
  };
}
```

---

## 4. 内置节点类型（NodeType）

| type | 说明 |
|------|------|
| `agent` | 派发给 AI executor 执行，fresh session per invocation |
| `human_approval` | 等待人工确认（TUI banner + IM 通知），支持超时策略 |
| `condition` | 读取上游产物/状态，按条件选择出边 |
| `parallel_fork` | 同时启动多个子节点（无依赖冲突时并行） |
| `join` | 等待所有上游并行节点完成后继续 |
| `transform` | 无 AI，纯函数转换产物（如格式转换、摘要截取） |
| `trigger` | 工作流入口节点（可配置为定时触发、Webhook、手动） |
| `loop` | 循环子图，直到 condition 满足（如 QA→Dev 修复循环） |

所有类型均可被自定义 NodeExecutor 覆盖或扩展（插件注册）。

---

## 5. 子系统详设

### 5.1 WorkflowEngine

**职责**：加载 WorkflowDef、推进执行状态、按图调度节点。

```
load(workflowId)   → 从 SQLite workflows 表 + json 文件读取 WorkflowDef
start()            → 初始化 node_executions 表，入口节点设为 pending
tick()             → T1 每次触发：检查 ready 节点 → dispatch → 检查完成 → advance
recover()          → 崩溃重启时从 SQLite node_executions 表恢复，续跑未完成节点
```

状态机是**节点级**（每个节点有自己的 status），而非全局单一状态：

```
node status: pending → running → completed | failed | skipped | waiting_human
```

全局 workflow 状态仅保存：`idle | running | paused | completed | failed`

### 5.2 NodeExecutor 注册表

```typescript
interface NodeExecutor {
  type: NodeType;
  execute(ctx: NodeContext): Promise<NodeResult>;
}

interface NodeContext {
  node: NodeDef;
  workflowId: string;
  runId: string;            // 本次执行 ID（重试时递增）
  db: Database;
  config: MyrmidonConfig;
  runtimeAdapter: RuntimeAdapter;
  notificationBus: NotificationBus;
}
```

引擎通过 `executor.execute(ctx)` 调用，不关心内部实现。自定义节点类型通过 `engine.registerExecutor(myExecutor)` 注入。

### 5.3 产物系统（Artifacts）

每个 `produces` 产物登记到 SQLite `artifacts` 表：

```sql
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,   -- 'prd-v1'
  workflow_id  TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  file_path    TEXT NOT NULL,      -- 相对项目根的路径
  status       TEXT NOT NULL,      -- 'pending' | 'ready' | 'invalid'
  created_at   TEXT NOT NULL
);
```

节点的 `inputValidator` 在执行前检查所有 `consumes` 产物的 `status = 'ready'`。`outputValidator` 在执行后校验 `produces` 文件存在且格式合法。校验失败 → 节点 status → `failed`，触发 retry 或 human_approval。

### 5.4 RuntimeAdapter

```typescript
interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  spawn(opts: SpawnOpts): Promise<SpawnedProcess>;
}

interface SpawnOpts {
  promptFile: string;        // .myrmidon/runtime/dispatch/{run-id}.json
  cwd: string;               // worktree 路径
  dbPath: string;            // myrmidon.db 绝对路径
  env: Record<string, string>;
}

interface SpawnedProcess {
  pid: number;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}
```

内置实现：`ClaudeCodeAdapter`、`OpenCodeAdapter`。通过 `config.executors.{key}.runtime` 选择。

### 5.5 Agent ↔ Engine 通信协议（文件约定）

```
Engine 写 → .myrmidon/runtime/dispatch/{run-id}.json    (DispatchPrompt)
Agent 写  → SQLite agents 表 status='completed'
Agent 写  → .myrmidon/runtime/continue/{run-id}.md       (上下文不足时请求中断)
Engine 读 → T1 轮询 agents 表 + continue/ 目录
```

无进程信号依赖，crash-safe，与 executor 类型无关。

### 5.6 DispatchPrompt 结构

```typescript
interface DispatchPrompt {
  runId: string;
  node: { id: string; name: string; description: string };
  artifacts: { consumes: ResolvedArtifact[]; produces: ArtifactDef[] };
  constitution: {             // 来自 agentRoles 配置，强制注入
    role: string;
    allowedTools: string[];
    forbiddenTools: string[];
    skills: string[];
    mcpTools: string[];
    contextRecoveryInstructions: string;
    outputLanguage: string;
  };
  dbPath: string;             // agent 写回状态用
  continueFile: string;       // 上下文压力时写入的文件路径
  maxTokenBudget: number;     // dispatch.maxDispatchPromptTokens
}
```

### 5.7 HumanApproval 规格

```typescript
interface HumanApprovalDef {
  message: string;                          // banner 显示的消息
  timeoutMs?: number;                       // 默认 600000 (10min)
  onTimeout: 'auto_approve' | 'auto_reject' | 'escalate';
  notifyChannels?: string[];                // 默认 all
  allowedActions: ('approve'|'reject'|'defer')[];
  onReject?: string;                        // reject 时跳转的节点 id（循环）
}
```

触发时：写 `workflow.pending_confirmation`，NotificationBus.notify('human_intervention')，TUI banner 激活，T3 计时。

### 5.8 Hook 与 Plugin

```typescript
interface HookDef {
  type: 'skill' | 'script' | 'notify' | 'transform';
  ref: string;              // skill 名 / 脚本路径 / 通知渠道
  args?: Record<string, unknown>;
}

interface PluginRef {
  id: string;               // plugin 注册名
  config?: Record<string, unknown>;
}
```

Plugin 通过 `engine.registerPlugin(plugin)` 注册，可替换任意内置行为。

### 5.9 TimerManager（T1-T6）

| ID | 名称 | 默认间隔 | 职责 |
|----|------|---------|------|
| T1 | `workflow-poll` | 30s | 主推进：检查 ready 节点、dispatch、advance |
| T2 | `agent-heartbeat` | 15s | PID 存活检测 |
| T3 | `client-timeout` | 60s | 人工确认超时检查 |
| T4 | `stuck-detection` | 60s | Agent stuck 规则（4条） |
| T5 | `state-consistency` | 300s | SQLite vs git worktree 一致性 |
| T6 | `external-dep-watch` | 60s | 外部依赖文件 mtime 变化 |

overlap 保护：同一定时器上次未完成则 skip，写 `timer_events` 表。

### 5.10 NotificationBus

```typescript
type NotifyEvent =
  | 'human_intervention'     // 需要人工操作
  | 'node_completed'
  | 'node_failed'
  | 'workflow_completed'
  | 'agent_stuck'
  | 'phase_changed'
  | 'error';

interface NotificationBus {
  notify(event: NotifyEvent, payload: unknown): Promise<void>;
}
```

Sub-2 实现 `ConsoleBus`（控制台输出）。Sub-5 实现 `SlackBus` / `WeComBus` / `EmailBus`，通过 `config.notifications.channels` 注册。

---

## 6. TypeScript DSL

```typescript
// myrmidon.config.ts 或独立 workflow 文件
import { defineWorkflow } from 'myrmidon';

export const softwareDevWorkflow = defineWorkflow({
  id: 'software-dev-agile',
  version: '1.0.0',
  name: '软件开发（敏捷）',
  nodes: [
    {
      id: 'requirements',
      type: 'agent',
      name: '需求收集',
      agentRole: 'pm',
      executor: 'sonnet',
      skills: ['requirements-gathering'],
      artifacts: {
        consumes: [],
        produces: [
          { id: 'requirements-raw', path: 'docs/requirements/raw/requirements-raw.md' },
          { id: 'modules', path: 'docs/requirements/modules.md' },
        ],
      },
      outputValidator: { required: ['requirements-raw', 'modules'] },
      humanApproval: {
        message: '需求摘要已完成，请确认',
        timeoutMs: 600000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject', 'defer'],
        onReject: 'requirements',
      },
    },
    // ... 更多节点
  ],
  edges: [
    { from: 'requirements', to: 'prd', condition: 'approved' },
    { from: 'requirements', to: 'requirements', condition: 'rejected' },
  ],
});
```

`defineWorkflow()` 运行时求值 → 产出 WorkflowDef JSON → 存 SQLite。

---

## 7. 新增 SQLite 表

在 Sub-1 已有 9 张表基础上新增：

```sql
-- 工作流定义存储
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  name        TEXT NOT NULL,
  def_json    TEXT NOT NULL,        -- WorkflowDef JSON 全文
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 工作流执行实例
CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,   -- UUID
  workflow_id   TEXT NOT NULL,
  status        TEXT NOT NULL,      -- 'running'|'paused'|'completed'|'failed'
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  context_json  TEXT               -- 运行时变量（如项目名、客户信息）
);

-- 节点执行状态（每节点每次运行一行）
CREATE TABLE node_executions (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  status        TEXT NOT NULL,     -- 'pending'|'running'|'completed'|'failed'|'skipped'|'waiting_human'
  attempt       INTEGER DEFAULT 1,
  agent_id      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  error         TEXT,
  output_json   TEXT              -- 节点输出（如 condition 的计算结果）
);

-- 产物注册表
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  status       TEXT NOT NULL,    -- 'pending'|'ready'|'invalid'
  created_at   TEXT NOT NULL
);
```

---

## 8. 文件结构

```
src/
  core/
    workflow/
      schema.ts           — WorkflowDef Zod schema + defineWorkflow()
      engine.ts           — WorkflowEngine：加载、推进、恢复
      executor-registry.ts — NodeExecutor 注册表
      executors/
        agent.ts          — agent 节点执行器
        human-approval.ts — human_approval 节点执行器
        condition.ts      — condition 节点执行器
        parallel.ts       — parallel_fork / join 执行器
        loop.ts           — loop 执行器
      dispatcher.ts       — DispatchPrompt 构建 + RuntimeAdapter 调度
      worktree.ts         — WorktreeManager：git worktree CRUD + 端口分配
      timers.ts           — TimerManager：T1-T6
      monitor.ts          — AgentMonitor：心跳 + stuck 检测
      notifications.ts    — NotificationBus 接口 + ConsoleBus
      runtime-adapter.ts  — RuntimeAdapter 接口 + ClaudeCodeAdapter + OpenCodeAdapter
      worktree.ts         — WorktreeManager：git worktree CRUD（创建/删除/列表），端口分配（basePort + 偏移）
    templates/
      software-dev-agile.ts    — 内置软件开发（敏捷）工作流模板
      software-dev-waterfall.ts — 内置软件开发（瀑布）工作流模板
  cli/
    commands/
      start.ts            — myrmidon start [--workflow <id>]
      stop.ts             — myrmidon stop
      status.ts           — myrmidon status
      workflow.ts         — myrmidon workflow list/load/validate
```

---

## 9. Sub-2 交付范围（本次实施）

**包含：**
- WorkflowDef Zod schema + `defineWorkflow()` DSL
- WorkflowEngine（load / start / tick / recover）
- NodeExecutor 注册表 + 5 种内置执行器（agent / human_approval / condition / parallel_fork+join / loop）
- Dispatcher + RuntimeAdapter（ClaudeCodeAdapter + OpenCodeAdapter stub）
- WorktreeManager
- TimerManager（T1-T6）
- AgentMonitor
- NotificationBus 接口 + ConsoleBus
- 新增 4 张 SQLite 表（workflows / workflow_runs / node_executions / artifacts）
- `myrmidon start / stop / status / workflow` 命令
- 内置模板：`software-dev-agile`（作为默认模板和功能验证）
- SIGTERM 优雅关机

**不包含（后续子项目）：**
- TUI 渲染（Sub-4）
- Slack/WeChat/Email 通知渠道（Sub-5）
- Skills 解析器 / MCP lifecycle（Sub-6）
- Desktop 画布编辑器（远期）

---

## 10. 与 Sub-1 的关系

Sub-1 的所有产出直接复用，无需修改：
- `openDatabase()` → 新增 4 张表通过迁移脚本追加
- `MyrmidonConfigSchema` → 追加 `workflows` 字段（数组，引用 workflow id）
- `loadConfig()` → 不变
- `MyrmidonError` / `logger` → 不变
- `RuntimeId` / `detectRuntimes()` → 直接被 RuntimeAdapter 使用

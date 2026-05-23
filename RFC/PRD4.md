# Myrmidon
## 通用自治工作流运行时
### Product Requirements Document — PRD4（最终融合版）

版本：1.0｜状态：定稿｜取代关系：本文档取代 PRD1 / PRD2 / PRD3

---

## 1. 产品定位

### 1.1 是什么

Myrmidon 是一个**通用自治工作流运行时**。

用户描述"期望的世界状态"（工作流定义），Myrmidon 持续协调 AI Agent 和人类协作者，将现实世界推进到该状态，并在运行过程中持续维护一致性。

### 1.2 通用性：任何领域的工作流

软件开发只是内置模板之一。系统对"工作流是什么"没有假设。

| 领域 | 示例工作流 |
|------|-----------|
| 软件开发（敏捷） | 需求 → PRD → 设计 → 并行开发 → QA → Sprint 交付 |
| 小说写作 | 大纲 → 章节撰写 → 人工审阅 → 修订 → 终稿 |
| 视频制作 | 脚本 → 分镜 → 人工确认 → 剪辑 → 字幕 → 发布 |
| 自媒体运营 | 选题研究 → 脚本撰写 → 配音 → 发布 → 数据复盘 |
| 内容审核 | 内容摄取 → AI 粗筛 → 人工复核 → 决策 |
| 产品运营 | 选品分析 → 上架文案 → 定价策略 → 活动排期 |

### 1.3 本质：Runtime，不是 Pipeline

```
CI/CD Pipeline 问：我们执行到第几步了？
Myrmidon     问：世界现在是我期望的样子吗？
```

Myrmidon 不"跑完"，它"维护"。工作流是对期望世界状态的声明，Runtime 持续驱动现实向其靠拢。

### 1.4 与前序版本的关系

| PRD | 贡献 | 本文档的处理 |
|-----|------|-------------|
| PRD1 | Agent 角色体系、Worktree 隔离、Agent 宪法、MCP/Skills、Scrum 文档 | 全部继承，泛化为通用机制 |
| PRD2 | 通用工作流引擎、TypeScript DSL、节点类型、Artifact 系统 | 全部继承并扩展 |
| PRD3 | 一致性运行时哲学、Reconciliation、Bounded Autonomy、Human Validator | 全部继承，补充技术方案 |

### 1.5 目标用户（v1）

**v1 唯一目标用户**：独立开发者 / 小型技术团队（2–8 人）

> *决策理由：聚焦单一用户群让 v1 MVP 范围可控。企业级用户（SSO、审计日志、RBAC）是 v2+ 的事。*

v1 典型场景：
- 1 个人用 Myrmidon 跑自己的副业项目
- 3–5 人团队共享 1 个 Myrmidon 实例，各自的工作流独立运行

v1 **不覆盖**：多租户隔离、企业 SSO、大规模并发（>10 个并发 workflow run）

---

## 2. 核心设计原则

### P1 — Runtime 是世界状态的唯一权威

Agent 只能提议（produce artifacts）。Runtime 决定所有状态变更。  
Agent 无权宣布完成、无权直接修改系统状态、无权绕过验证。

### P2 — Artifact 是唯一真相

世界状态 = 磁盘上的 artifact 集合 + 它们的验证结果。  
Memory、Summary、Agent 的话，不是真相。  
Runtime 状态 ≠ Artifact 现实时，以 Artifact 为准。

### P3 — 验证决定完成，Human 是一等公民 Validator

验证系统分三层，均为正式 Validator：

| 层 | 类型 | 可信度 |
|----|------|--------|
| 自动化验证 | 编译、测试、lint、构建 | 高，完全可信 |
| AI 辅助验证 | 截图对比设计稿、结构分析 | 中，参考用 |
| 人工验证 | 人类确认 UI/内容语义 | 最终权威 |

对于无法完全自动化的 artifact（UI 外观、内容质量），人工验证是进入 `valid` 的必要条件。

### P4 — 持续 Reconciliation

系统后台持续检测 Runtime 认知 vs Artifact 现实的偏差。  
上游 artifact 变化时，下游 artifact 自动标记为 `stale`，相关节点暂停。  
`stale` 只传播标记，不触发自动重执行（避免级联重跑）。

### P5 — Worker 是无状态的瞬时认知单元

每次执行注入最小必要上下文，结束立即销毁。  
系统不依赖长 session、长 memory、长上下文。

### P6 — 有界自治，失败必须收敛

循环不能无限。每次失败必须带来信息增量。  
- 有界重试：耗尽后暂停等待人类指导（非 abort）  
- 结构化反馈注入：人类拒绝时提供结构化原因，注入下次 Agent 上下文  
- 升级路径：失败 N 次 → 通知人类；失败 N+M 次 → 暂停要求明确指导

### P7 — 非目标与反模式（明确不做什么）

> *显式记录"不做什么、为什么"，防止实施时有人好心加了违背核心哲学的功能。以下每条都是硬约束。*

| 反模式（禁止）| 为什么 | 正确做法 |
|--------------|--------|---------|
| **LLM 决定流程走向** | 不可控、不可复现、无法审计 | 工作流结构启动前静态定义，引擎按 DAG 推进（P1）|
| **Agent 自报"任务完成"** | Agent 的话不是真相，会幻觉完成 | 完成由 Validator 裁决，Artifact 是唯一真相（P2/P3）|
| **依赖长 session / 长 memory** | AI 认知漂移，上下文腐化 | Worker 无状态，每次注入最小上下文（P5）|
| **stale 触发自动重执行** | 级联重跑，烧光 API 预算 | stale 只传播标记，由调度/人工决策（P4）|
| **无限重试直到成功** | 原地打转，无信息增量 | 有界重试 + 相似度检测 + 升级人工（P6）|
| **可视化即真相**（n8n 模式）| 代码与画布双向同步地狱 | DSL 为唯一真相，画布是投影（见 PRD5 P5-8）|
| **内核出现领域词汇**（coder/端口/DOM）| 破坏"通用 OS"定位 | 领域内容只进模板（§4.6）|
| **CLI/Worker 直接写 SQLite** | 绕过唯一写者，状态不一致 | 一切状态变更走 Runtime（§12.1）|
| **业务代码直接 `db.prepare`/`fs.readFile` 产物** | 锁死单机，无法平台化 | 走 StateStore/ArtifactStore 抽象（PRD5 P5-1）|

**v1 明确不做**（推到 v2+，避免范围爆炸）：多租户隔离、企业 SSO/RBAC/审计、>10 并发 run、OS 级沙箱（Docker/Firecracker）、自动验证外部状态（轮询 URL）。

---

## 3. 产品形态

### 3.1 运行模式

Myrmidon 以**持续运行的后台进程**存在，CLI 命令向 Runtime 发送指令。

| 模式 | 说明 | 适用 |
|------|------|------|
| **托盘应用**（默认） | 关闭窗口最小化到系统托盘，Runtime 继续运行 | 本地开发机 |
| **Daemon 模式** | 纯后台服务，`myrmidon daemon start/stop` | 服务器、无头环境 |

`myrmidon start --workflow X` = 向 Runtime 发送指令，不是启动新进程。

### 3.2 CLI 命令

```
# 安装
npx myrmidon@latest <command>
npm install -g myrmidon

# Runtime 管理
myrmidon daemon start/stop/status
myrmidon status                        # 查看所有活跃 workflow

# 工作流
myrmidon init                          # 初始化项目
myrmidon workflow list/load/validate/show/runs
myrmidon start [--workflow <id>] [--resume] [--run-id <id>]

# 人工审核
myrmidon review list                   # 待审核队列
myrmidon review show <artifact-id>     # 查看对比视图
myrmidon review approve <artifact-id>
myrmidon review reject <artifact-id> --category <type> --detail "..."

# 可观测性 / Debug
myrmidon inspect <artifact-id>         # 查看 artifact 当前状态及 stale 原因链
myrmidon log <run-id>                  # 事件流
myrmidon replay <run-id>               # 重放到某时间点

# 运维
myrmidon worktree list/clean           # Git worktree 管理
myrmidon gc [--dry-run]                # 清理过期 run、orphan snapshot、dead validation 记录
```

`myrmidon inspect <artifact-id>` 输出格式示例：

```
artifact: homepage-screenshot
  status:   stale
  reason:   upstream artifact 'login.tsx' changed
    checksum was: sha256:abc123
    checksum now: sha256:def456
    changed at:   2026-05-22T09:00:00Z
  downstream affected: [homepage-screenshot, qa-report]
  suggestion: run 'myrmidon start --resume' or manually approve current version
```

### 3.3 TUI（5 Tab）

| Tab | 内容 |
|-----|------|
| Overview | 活跃 workflow 的 Artifact 有效性图（非"步骤进度"）|
| Review Queue | 待人工验证列表，含设计稿 vs 实现的并排对比 |
| Agents | 当前运行中的 Worker 状态和日志 |
| Events | Append-only 事件流 + Reconciliation 日志 |
| Config | 定时器、通知渠道、配置检查 |

### 3.4 通知与 IM 集成

当工作流需要人工介入时，通过配置渠道推送通知（含可直接回复的快捷操作）：
- 本地：系统托盘通知
- 远程：Slack / 企业微信 / Email / Webhook

---

## 4. 工作流系统

### 4.1 TypeScript DSL

```typescript
import { defineWorkflow } from 'myrmidon';

// 示例：小说写作工作流
export const novelWorkflow = defineWorkflow({
  id: 'novel-writing',
  version: '1.0.0',
  name: '小说写作流水线',

  nodes: [
    {
      id: 'outline',
      type: 'agent',
      name: '故事大纲',
      agentRole: 'story-architect',
      executor: 'claude-code',
      artifacts: {
        produces: [{ id: 'outline', path: 'novel/outline.md' }],
      },
      outputValidator: { required: ['outline'] },
      humanApproval: {
        message: '大纲已生成，请确认方向',
        timeoutMs: 3_600_000,
        onTimeout: 'auto_approve',
        onReject: 'outline',             // 拒绝后回到本节点
      },
    },
    {
      id: 'chapter-1',
      type: 'agent',
      name: '第一章',
      agentRole: 'writer',
      executor: 'claude-code',
      artifacts: {
        consumes: [{ id: 'outline' }],
        produces: [{ id: 'chapter-1', path: 'novel/chapter-01.md' }],
      },
      retry: { maxAttempts: 3, backoffSeconds: [60, 300, 600] },
    },
    {
      id: 'review-chapter-1',
      type: 'human_approval',
      name: '第一章审阅',
      humanApproval: {
        message: '第一章已完成，请审阅',
        timeoutMs: 86_400_000,
        onTimeout: 'auto_approve',
        onReject: 'chapter-1',
      },
    },
  ],

  edges: [
    { from: 'outline', to: 'chapter-1', condition: 'approved' },
    { from: 'chapter-1', to: 'review-chapter-1', condition: 'success' },
    { from: 'review-chapter-1', to: 'chapter-1', condition: 'rejected' },
  ],
});
```

### 4.2 内置节点类型

| type | 说明 | 关键字段 |
|------|------|---------|
| `agent` | 派发给 AI Worker，每次新 session | `agentRole`, `executor`, `artifacts` |
| `human_approval` | 人工验证门控（Human Validator） | `timeoutMs`, `onTimeout`, `onReject` |
| `condition` | 按表达式选择出边 | `edge.condition` |
| `parallel_fork` | 并行启动多个分支 | 由出边隐式定义 |
| `join` | 等待所有并行分支完成 | 由入边隐式定义 |
| `transform` | 纯函数转换产物（无 AI） | `transform.fn` |
| `trigger` | 入口节点（手动/定时/Webhook） | `trigger.type` |
| `loop` | 循环子图直到 condition 满足 | `loop.maxIterations` |

### 4.3 节点能力矩阵

| 扩展点 | 说明 |
|--------|------|
| `agentRole` | 指定 Worker 类型，决定加载哪套 Constitution |
| `executor` | 指定运行时（claude-code / kimi / gemini-cli / custom）|
| `skills` | 注入 Skill 列表（追加到 Agent 宪法）|
| `mcpTools` | 允许使用的 MCP 工具白名单 |
| `artifacts.consumes/produces` | 显式声明数据依赖 |
| `inputValidator` | 节点开始前校验 consumes artifact 状态 |
| `outputValidator` | 节点完成后校验 produces artifact |
| `humanApproval` | 人工验证门控配置 |
| `hooks.pre/post/onError` | 节点级钩子 |
| `retry` | 失败重试策略 |
| `timeoutMs` | 节点级超时 |
| `constitution` | 覆盖默认 Agent 宪法（高级用法）|

### 4.4 调度器 Formal Rules

> *这是实现层最容易出现"靠猜"的地方，必须形式化。*

**Node Readiness（节点何时可调度）**

节点 N 可被调度，当且仅当：

```
ready(N) = 
  ALL incoming edges satisfied   （所有入边条件成立）
  AND ALL consumes artifacts are valid   （所有消费产物状态为 valid）
  AND N.status == 'pending'   （节点本身未在运行）
  AND N is not paused by bounded-autonomy   （未因重试耗尽而暂停）
```

**Edge Condition 求值规则**

`condition` 字段是**预定义字符串枚举**，不是任意表达式（避免 eval 安全问题）：

| condition 值 | 满足条件 |
|-------------|---------|
| `'success'` | 源节点 status = `completed`，且所有 produces artifacts = `valid` |
| `'failed'` | 源节点 status = `failed`（重试耗尽）|
| `'approved'` | human_approval 节点的 human validator 决定 = `valid` |
| `'rejected'` | human_approval 节点的 human validator 决定 = `invalid` |
| `'always'` | 无条件（源节点完成即触发，无论结果）|

`condition` 节点（type = `condition`）可额外使用 `expr` 字段，值为 **JSON Logic 表达式**（引用 workflow run context 变量）：

```typescript
{
  id: 'route',
  type: 'condition',
  edges: [
    { to: 'premium-path', expr: { '>': [{ var: 'context.user_tier' }, 1] } },
    { to: 'basic-path',   expr: { '<=': [{ var: 'context.user_tier' }, 1] } },
  ]
}
```

JSON Logic 求值器是沙箱化的（无 IO、无副作用）。变量来源限于 `workflow_run.context_json`。

**Join 语义**

`join` 节点等待**所有**上游并行分支完成（AND 语义）。没有 OR 语义（不需要时不提供，避免歧义）。

```
join ready = ALL upstream parallel_fork branches reach a terminal state
             (completed | failed | skipped)
```

若某分支失败：join 节点进入 `failed` 状态，触发该节点的重试策略。

### 4.5 内置模板

| 模板 ID | 领域 | 说明 |
|---------|------|------|
| `software-dev-agile` | 软件开发 | 需求→PRD→设计→并行开发→QA→Sprint 交付 |
| `software-dev-waterfall` | 软件开发 | 严格串行，每阶段有人工门控 |
| `content-creation` | 自媒体 | 选题→脚本→配音→剪辑→发布 |
| `novel-writing` | 小说创作 | 大纲→章节→审阅→修订→终稿 |
| `video-production` | 视频制作 | 脚本→分镜→剪辑→字幕→发布 |

用户可 fork 任意内置模板：`myrmidon workflow show software-dev-agile > my-workflow.ts`

### 4.6 预置模板规范

> *设计原则：内核不知道任何领域。所有领域特定内容（角色、产物规范、领域规约）只能存在于模板中，绝不进入运行时内核。模板可以预制多套，覆盖不同领域。*

**内核 vs 模板的边界（硬约束）：**

| 归内核（通用，与领域无关） | 归模板（领域特定） |
|---------------------------|-------------------|
| DAG 调度、状态机推进、condition/join 求值 | 节点的具体角色（pm / writer / moderator）|
| Artifact 生命周期、stale 传播、Reconciliation | artifact 的领域规范（DOM Contract / 分镜格式）|
| 七层上下文管理、Worker 生命周期 | 角色的代码规约 / 写作规约 / 审核标准 |
| 有界自治、重试、相似度检测 | 领域专属验证器（Playwright / 字幕对齐检查）|
| 三层配置架构（role→executor→binding）| 角色定义的具体内容 |
| Runtime 检测、进程清理 | 领域专属工具（端口分配 / Figma MCP）|

**模板结构（每套预置模板必须包含）：**

```typescript
interface WorkflowTemplate {
  id: string;                       // 'software-dev-agile'
  domain: string;                   // 'software-development' | 'writing' | ...
  workflow: WorkflowDef;            // §4.1 的 DAG 定义

  // 领域角色库：填充内核的三层配置（见 §5.2）
  roles: Record<string, AgentRoleDef>;

  // 领域产物规范：每种 artifact_type 的领域格式约束 + 验证器路由
  artifactSpecs?: Record<string, ArtifactSpec>;

  // 领域规约：注入对应角色 Constitution 的领域规则
  conventions?: Record<string, ConventionDef>;

  // 领域专属配置（如软件开发的端口分配、monorepo）
  domainConfig?: Record<string, unknown>;
}
```

**多套模板示例（同一内核，不同领域填充）：**

| 模板 | 角色库 | 产物规范 | 领域配置 |
|------|--------|---------|---------|
| `software-dev-agile` | pm / arch / coder / qa / security / ui / devops | DOM Contract、API spec、SQL migration | 端口分配、monorepo |
| `novel-writing` | story-architect / writer / editor | 大纲结构、章节连贯性 | — |
| `video-production` | scriptwriter / director / editor / colorist | 分镜格式、字幕对齐 | 渲染产物大小 |
| `content-moderation` | moderator | 审核决策记录 | 置信度阈值 |

新增领域 = 写一套新模板（角色 + 产物规范 + 规约），**不改内核一行代码**。这是"通用 OS"的核心检验标准。

---

## 5. Agent Worker 系统

### 5.1 通用 Worker 角色

任何 `defineWorkflow` 中的 `agentRole` 字符串都是有效的 Worker 角色。系统为软件开发模板内置以下角色，其他领域可自定义：

| 内置角色（软件开发） | 职责 |
|---------------------|------|
| `pm` | 需求整理、PRD、Epics/Sprint 规划 |
| `arch` | 技术评审、详细设计、任务拆分 |
| `coder` | SQL 设计、API 设计、编码实现 |
| `qa` | 测试用例生成、测试执行、Issue 报告 |
| `security` | 安全审查 |
| `ui` | UI/UX 设计、原型生成 |

### 5.2 Agent 宪法（Constitution）

每个 Worker 角色对应一套宪法，在 Agent 执行时注入为 `CLAUDE.md` + `.claude/rules/`：

```typescript
type AgentConstitution = {
  role: string
  systemPrompt: string           // 角色描述和基本行为准则
  allowedTools: string[]         // 允许的工具列表（代码层强制）
  forbiddenActions: string[]     // 明确禁止的行为
  allowedMCPTools: string[]      // MCP 工具白名单
  requiredSkills: string[]       // 必须加载的 Skill
  outputSchema: JSONSchema       // 输出必须满足的结构约束
  maxContextTokens: number       // 上下文 token 预算
}
```

**宪法约束示例（pm 角色）：**
- allowedTools: `[Read, Write, Edit, WebSearch]`
- forbiddenActions: `["执行 shell 命令", "修改 src/ 目录下文件", "访问其他 worktree"]`
- requiredSkills: `["doc-coauthoring", "brainstorming"]`

宪法在 `myrmidon.config.ts` 中注册，也可以在 `defineWorkflow` 的节点级 `constitution` 字段中覆盖。

### 5.3 MCP 工具与 Skills 配置

```typescript
// myrmidon.config.ts 中配置
export default defineConfig({
  agents: {
    'coder': {
      executor: 'claude-code',
      allowedMCPTools: ['filesystem', 'git', 'github'],
      skills: ['frontend-design', 'webapp-testing', 'test-driven-development'],
    },
    'ui': {
      executor: 'claude-code',
      allowedMCPTools: ['filesystem', 'browser-playwright'],
      skills: ['frontend-design', 'canvas-design'],
    },
  },
});
```

节点级 `mcpTools` 和 `skills` 字段可以在 workflow 层追加（不能超出角色宪法允许范围）。

#### 5.3.1 三层配置架构（通用机制）

> *这是内核的通用配置机制，与领域无关。具体角色（pm/writer/moderator）由模板填充。三层解耦的目的：换模型不动角色、改角色不动工作流、调工作流不动模型。*

配置分三层，逐层解析为一个 Worker session：

```
┌─ 层1: agentRoles ──────────────────────────────┐
│ 角色能力边界（与具体模型、工作流无关）           │
│   allowedTools / forbiddenActions               │
│   systemPromptFile / requiredSkills             │
│   tokenProfile                                  │
│   ← 模板填充具体角色定义                          │
├─ 层2: executors ───────────────────────────────┤
│ runtime × model 组合（与角色、工作流无关）       │
│   { runtime: 'claude-code', model: 'opus-4-7' } │
│   maxContextTokens                              │
├─ 层3: agents（工作流绑定）─────────────────────┤
│ 声明工作流中某角色用哪个 executor                │
│   { role: 'coder', executor: 'sonnet', count }  │
│   skills/mcpTools 可在此覆盖层1默认值            │
└─────────────────────────────────────────────────┘
        │ Runtime 合并三层
        ▼
  一个 Worker session 的启动参数 + 注入宪法
```

```typescript
// 内核配置结构（通用）
agentRoles: {
  [role: string]: {                  // role 名由模板定义，内核不预设
    systemPromptFile: string,
    allowedTools: string[],
    forbiddenActions: string[],
    requiredSkills: string[],
    tokenProfile: 'budget' | 'balanced' | 'quality',
  }
},
executors: {
  [name: string]: {
    runtime: ExecutorType,           // §12.5
    model: string,
    maxContextTokens: number,
  }
},
agents: {
  [binding: string]: {
    role: string,                    // 引用 agentRoles
    executor: string,                // 引用 executors
    count?: number,                  // 并发实例数
    skills?: string[],               // 覆盖层1
    mcpTools?: string[],
  }
},
```

**解耦收益：**
- 切换模型（改 `executors`）→ 不影响角色定义和工作流
- 修改角色能力（改 `agentRoles`）→ 不影响模型选择和工作流
- 调整工作流绑定（改 `agents`）→ 可临时为某节点指定不同角色或执行器
- 新增领域角色 → 模板在 `agentRoles` 加条目并在 `agents` 绑定，内核无感

> 领域模板的高级覆盖（如软件开发的 per-app coderOverrides、reviewRules）见附录 `software-dev-agile` 模板，属模板内容，不进内核。

### 5.4 Agent 输入输出规范

每次 Worker 执行的输入由 Runtime 精确构建，包含且仅包含：

```
1. 任务描述（来自 WorkflowDef 节点定义）
2. 消费的上游 artifact 内容（consumes 列表）
3. 相关上下文文档（ADR、架构约束等，按需注入）
4. 上次失败的结构化反馈（如有）
5. Agent 宪法（CLAUDE.md 形式）
```

禁止注入：整个对话历史、无关 artifact、全局项目摘要。

输出规范：Agent 必须在 `artifacts.produces` 声明的路径写入文件，由 Runtime 的 `outputValidator` 校验。Agent 不得声明"任务完成"。

### 5.5 Worker 生命周期

```
创建（Runtime 调度）
  → 分配独立 git worktree
  → 注入最小上下文
  → 启动执行（claude-code / kimi / 其他）
  → 心跳监控
  → 执行完成 → 产物写入 worktree 输出路径
  → Runtime 读取产物，运行 outputValidator
  → 验证通过 → artifact 状态更新 → 销毁 Worker
  → 验证失败 → 触发重试策略 → 销毁 Worker
```

#### 5.5.1 七层上下文管理（通用机制）

> *P5 原则"Worker 是无状态瞬时认知单元"是目标，本节是其落地机制。与领域无关：任何领域的 AI Worker 都会遇到上下文积累污染。层次按作用范围从大到小排列。*

| 层 | 机制 | 触发时机 | 实现位置 |
|----|------|---------|---------|
| **1 Fresh Session Per Task** | 每次节点执行启动全新 session，不继承历史对话 | 每次 Worker 调度 | ExecutorManager dispatch |
| **2 In-Session 观测掩码** | 单 session 内保留最近 N 轮（默认 8）tool result，更早的替换为占位符，零 LLM 开销 | 每次 tool 调用后 | Claude Code PostToolUse hook |
| **3 Pre-Compaction Snapshot** | 上下文即将压缩时，写入 ≤2KB 结构化快照（active context + 最近决策 + 最近 exec） | 上下文接近压缩阈值 | PreCompact hook / Runtime |
| **4 Phase Handoff Anchor** | 阶段完成时写入关键状态锚点 JSON，注入下一阶段 prompt，Worker 无需重推导上阶段产出 | 每个阶段完成 | Runtime 阶段转换 |
| **5 Context Pressure Monitor** | 监控 session 上下文使用率，达 70% 发 wrap-up 信号 → Worker 写 continue 文件 → 新 session 续接 | 使用率 ≥ 70% | Runtime 轮询 |
| **6 沙箱化 Exec 输出** | 长命令输出写磁盘，只注入摘要（前 800 字符 + exit code + 耗时），Worker 需要时主动 Read | 长命令执行时 | Runtime exec wrapper |
| **7 工具结果截断** | 单次 tool 返回截断至 `toolResultMaxChars`（默认 800），大文件分段读取 | 每次 tool return | Runtime tool proxy |

**第 1 层是根本解法**：只要节点拆分得当（≤1 个上下文窗口），Worker 始终从干净窗口开始，上下文积累从根本消除。其余六层是辅助保障。

**continue 协议（第 5 层）**：上下文压力触发时，Worker 在 `.myrmidon/runs/{run_id}/{node_id}/continue.md` 写入：

```markdown
## Completed Work     已完成步骤
## Remaining Work     未完成步骤
## Decisions Made     本次决策
## Next Action        下一步精确动作（必须具体到函数/命令，不得写"继续"）
```

新 session 启动时读取 continue.md → 从 Next Action 继续 → 完成后删除。**恢复指令通过 Constitution 注入**（Session Start 优先检查 continue → snapshot → anchor → 正常开始）。

**配置（内核通用）：**

```typescript
contextManagement: {
  observationMasking: { enabled: true, keepRecentTurns: 8 },
  preCompactionSnapshot: { enabled: true, maxBytes: 2048 },
  phaseAnchors: { enabled: true },
  pressureMonitor: { enabled: true, threshold: 0.70 },
  sandboxedExec: { enabled: true, summaryMaxChars: 800 },
  toolResultMaxChars: 800,
}
```

### 5.6 Executor 输出标准协议

每个 executor 适配器（claude-code / kimi / gemini-cli / mock / custom）必须遵守以下标准接口。适配器负责将各 executor 的原生输出映射到此协议。

**标准目录结构（每次 Worker 执行）：**

```
.myrmidon/runs/{run_id}/{node_id}/
  continue.md       ← 上下文压力中断时写入（node 级，跨 attempt 持久；见 §5.5.1）
  {attempt}/
    context/          ← Runtime 注入的只读上下文（CLAUDE.md、consumes artifacts）
    output/           ← Worker 写入产物的目录（produces 路径相对此目录）
      sideEffects.json   ← 可选，声明外部副作用
    logs/
      heartbeat.json  ← Worker 周期写入，格式：{"ts": 1716300000, "status": "running"}
      stdout.log      ← 执行日志
      stderr.log
    exit_code         ← 执行结束后写入（0 = 成功，非 0 = 失败）
```

**心跳协议：**
- Worker 每 15 秒（`timers.heartbeatMs`）写入 `heartbeat.json`
- Runtime 读取 `heartbeat.json`，若 `ts` 距当前 > `stuckDetectionMs`（默认 120s）→ 判定为 Phantom Running

**退出语义：**

| exit_code | 含义 |
|-----------|------|
| `0` | 执行完成，produces 文件已写入 |
| `1` | 执行失败，触发重试策略 |
| `2` | 上下文不足（token budget 耗尽），触发 `pause_for_human` |
| `3` | 主动声明放弃（artifact 需求不可满足），触发 `pause_for_human` |

适配器负责将 executor 的原生退出码/错误映射到以上 4 种语义。

### 5.7 Git Worktree 隔离

每个 Worker 执行在独立的 git worktree 中进行：

```
repo/
  .git/
  .myrmidon/
    runs/
      {run_id}/
        {node_id}/
          {attempt}/
            context/        ← 注入的上下文文件（只读）
            output/         ← Agent 写入产物
            logs/           ← 执行日志 + 心跳
            progress.json   ← Agent 实时进度（TUI 读取）
  worktrees/
    {run_id}-{node_id}-{attempt}/   ← git worktree add
```

**Worktree 清理规则：**
- Worker 执行完毕且产物验证通过 → 自动清理
- 产物已合并到主分支 → 自动清理
- Reconciliation 检测到孤立 worktree → 自动清理
- 清理前产物已归档到 artifact store

### 5.8 进程生命周期与资源清理（通用机制）

> *P11.5 把"Worktree 泄漏"列为长期运行不应发生的故障，本节是兑现该承诺的机制。与领域无关：任何 spawn 外部执行器进程的运行时都必须清理子进程。*

ExecutorManager 启动每个 Worker 时，注册其 PID 及所有子进程到 `executor_procs` 表：

```sql
CREATE TABLE executor_procs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,       -- 对应 node_executions.id
  pid         INTEGER NOT NULL,
  proc_type   TEXT NOT NULL,       -- 'executor' | 'child' | 'aux-server'
  port        INTEGER,             -- 若占用端口（领域模板特性，如软件开发的 dev/test server）
  started_at  TEXT NOT NULL,
  killed_at   TEXT
);
```

**清理触发时机**：节点正常完成 / 失败 / pause_for_human / 手动停止 / Runtime 收到 SIGTERM。

**清理流程（严格顺序，不可跳过）：**

```
1. 向 executor 主进程 SIGTERM，等待最多 10s
2. 10s 未退出 → SIGKILL
3. 遍历该 session 的子进程（executor_procs）：
   按 proc_type 倒序清理（aux-server → child → executor）
   每个先 SIGTERM(5s)，超时 SIGKILL
4. 更新 executor_procs.killed_at
5. 释放占用端口（若有），更新 node_executions 状态
```

任何步骤失败（kill 失败、端口仍占用）→ 记录 `cleanup-error`，写审计日志 + 告警通知。

**孤儿进程兜底**：Reconciliation 周期扫描（§8）检查 `executor_procs` 中是否存在已无对应 session 的进程，发现则清理并告警。

> **端口管理是领域特性，不在内核**：端口分配（dev-server/test-server、`basePort + taskId % 1000`）只在软件开发模板需要——小说写作、视频制作不起服务。内核只负责"如果声明了 port 就在清理时释放"，分配规则见 `software-dev-agile` 模板。

---

## 6. Artifact 系统

### 6.1 Artifact 类型

artifact_type 决定**哪些 Validator 自动匹配**，其余行为一致。类型收敛为 6 个 core type + 用户自定义：

| core type | 默认匹配 Validator | 示例 |
|-----------|------------------|------|
| `document` | 文件存在性 + schema 检查（如有）| PRD、ADR、大纲、脚本 |
| `source_code` | tsc / lint / 构建 | `.ts`、`.sql`、`.tsx` 文件 |
| `test_output` | 解析测试报告 pass/fail | 测试报告 JSON、覆盖率报告 |
| `screenshot` | Playwright 截图对比设计稿 | UI 截图、原型截图 |
| `build_artifact` | 文件存在性 + 大小检查 | 构建产物、bundle |
| `external_state` | 无自动验证，强制进入 `needs_review` | 已发布内容、已发邮件、已部署服务 |

用户在 `defineWorkflow` 的 `artifact_type` 字段可填任意字符串（自定义类型），匹配不到内置 Validator 时仅执行文件存在性验证。

> *不需要 15 个细分类型。类型决定 Validator 路由，其余用 artifact metadata 字段描述。*

### 6.2 Artifact 生命周期状态

```
pending
  → generating        (Worker 正在产出)
  → needs_validation
      → [自动验证，高置信度] → valid          ✅ 可被下游消费
      → [自动验证，失败]     → invalid        ❌ 触发重试策略
      → [自动验证，低置信度] → needs_review   ⏳ 进入 Review Queue（置信度 < 阈值）
      → [节点要求人工验证]   → needs_review   ⏳ 进入 Review Queue
                               → valid        ✅ 人工确认通过（可 force_valid 覆盖自动结论）
                               → invalid      ❌ 含 StructuredFeedback
  → stale             ⚠️  上游依赖变化，需重新验证
  → orphaned          🗑️  关联 execution 已消失
```

**状态数量收敛**：移除单独的 `borderline` 状态——"低置信度通过"和"需要人工验证"的语义相同，统一为 `needs_review`，Validator 在 `validation_results` 表记录 `confidence < threshold` 的原因。状态机更干净，实现更简单。

### 6.3 Artifact 粒度最佳实践

Artifact 拆分的粒度直接决定 stale 传播的范围：粒度太粗 → 一个微小改动让整个世界 invalidate；粒度适当 → 只影响真正受影响的下游。

**推荐**：每个逻辑独立的产物是一个 artifact（一个组件、一个 API 接口、一份测试报告），而不是"整个前端"或"整个项目"是一个 artifact。

```typescript
// 不好：粒度太粗
produces: [{ id: 'all-frontend', path: 'src/' }]

// 好：细粒度，stale 只传播到真正依赖的下游
produces: [
  { id: 'login-component', path: 'src/components/Login.tsx' },
  { id: 'navbar-component', path: 'src/components/Navbar.tsx' },
]
```

> *这是 artifact 依赖图发挥作用的前提。细粒度是用户的责任，系统无法自动判断"什么应该是一个 artifact"。*

### 6.4 依赖图与 Stale 传播

每个 artifact 声明 `dependsOn` 列表。当上游 artifact 内容变化（checksum 不同）：

1. 遍历依赖图，将所有直接和间接下游 artifact **批量**标记为 `stale`（单 SQLite 事务，最大递归深度 10 层）
2. 关联节点自动暂停，不启动新 Worker
3. 调度器或人工决策：重新生成 stale artifact，还是接受现有版本

**不触发自动重执行**，避免级联重跑消耗大量 API 调用。

### 6.5 系统可从 Artifact 重建

删除所有 session、memory、agent 对话记录后，系统仍能从以下来源完整重建状态：
- 文件系统上的 artifact 内容 + checksum
- 事件日志（append-only）
- WorkflowDef JSON

---

## 7. 验证系统

### 7.1 工程验证（完全自动化）

| 验证器 | 触发 artifact 类型 |
|--------|-------------------|
| TypeScript 编译 | `source` |
| 单元测试 / 集成测试 | `test`, `source` |
| ESLint / Biome | `source` |
| 构建完整性 | `build_output` |
| SQL 迁移语法 | `migration` |
| API Schema 合法性 | `api_spec` |

### 7.2 UI 多层验证

| 层 | 自动化程度 | 验证内容 |
|----|-----------|---------|
| Structural | 高 | DOM 结构、组件层级、可访问性（axe）|
| Design Token | 高 | 颜色、字体、间距是否符合设计规范 |
| Responsive | 中 | 多断点截图对比 |
| Interaction | 中 | Playwright E2E 交互流程 |
| Semantic（语义层）| **只能人工** | 视觉层级、CTA 突出性、品牌一致性 |

语义层验证必须由 Human Validator 完成，系统不追求自动化。

### 7.3 治理验证

- ADR 合规性（新的架构决策不得违反已有 ADR）
- 工具使用合规性（Agent 使用的工具是否在宪法 allowedTools 范围内）
- Worktree 访问边界（Agent 是否越权访问其他 worktree）

### 7.4 Human Validator 工作界面

当 artifact 进入 `needs_review`，TUI 的 Review Queue 展示：

```
┌─────────────────────────────────────────────────────────┐
│ 待审核：homepage-screenshot                              │
│ 节点：ui-implementation（第 1 次）                       │
├──────────────────────┬──────────────────────────────────┤
│ 设计稿（Figma 导出） │ 实现截图（Playwright）            │
│ [图片]               │ [图片]                            │
├──────────────────────┴──────────────────────────────────┤
│ Design Token 差异：spacing-lg 期望 24px，实际 20px       │
├─────────────────────────────────────────────────────────┤
│ [通过]  [拒绝 ▼]  [推迟]                                │
│ 拒绝原因：○ 布局问题  ○ Token 不符  ○ 逻辑错误  ○ 其他  │
│ 详细说明：___________                                    │
└─────────────────────────────────────────────────────────┘
```

拒绝原因（结构化）自动注入下次 Agent 执行上下文，使循环收敛。

### 7.5 Validator 优先级规则

当多个 Validator 对同一 artifact 得出不同结论时（例如：screenshot_diff 说"不同"，Human Validator 说"通过"）：

> **Human Validator 的决定覆盖所有自动化 Validator 的结论。**

规则简单：
- Human 说 `valid` → artifact 状态设为 `valid`，无论任何自动化 Validator 的结果
- Human 说 `invalid` → artifact 状态设为 `invalid`，附带 StructuredFeedback

Human override 记录在 `validation_results` 表中，含以下字段：
- `validator_type = 'human'`
- `force_valid = true`（当 human 批准了存在失败自动化 Validator 的 artifact）
- `overrides_validator_ids`：被覆盖的自动化 Validator ID 列表

**约束**：Human 无法 force_valid 以下情况（系统拒绝，不允许覆盖）：
- artifact 文件在文件系统上不存在（Missing 状态）
- artifact 处于 `orphaned` 状态

force_valid 事件写入 event log，类型为 `ARTIFACT_FORCE_VALIDATED`。这是不可删除的审计记录。

### 7.6 验证诚实性原则

当前技术条件下，对于完整软件开发工作流：
- **~70% 工作**：完全自主完成（后端逻辑、测试、文档）
- **~30% 工作**：需人工介入（UI 语义、架构决策、需求澄清）

系统设计目标不是消灭这 30%，而是让这 30% 的人工介入高效、有依据、快速。

---

## 8. Reconciliation 引擎

### 8.1 持续对账循环

Runtime 后台运行两层对账：

| 层 | 机制 | 频率 | 目的 |
|----|------|------|------|
| 事件驱动 | artifact 写入后立即触发 checksum 比较 | 实时 | 正常执行路径 |
| 周期扫描 | 全量 checksum 扫描 | 可配置（默认 5 分钟）| 兜底，捕获手动改文件、crash 遗留 |

**Reconciliation Storm 防护（三个关键细节）**

不加保护的 Reconciliation 可能自爆：一个热点 artifact 频繁写入 → 无限触发扫描 → 依赖图全量传播 → 系统过载。

三个机制共同防护：

1. **Debounce（去抖）**：同一 artifact 在 500ms 窗口内的多次写入事件合并为一次 checksum 更新。避免文件频繁写入触发重复扫描。

2. **Batch Stale Propagation（批量传播）**：stale 标记通过 SQLite 事务批量写入，不逐行提交。一次 Reconciliation 触发的所有 stale 标记在单个事务中完成，原子可见。

3. **Dependency Depth Limit（深度限制）**：stale 传播最大递归深度为 10 层（可配置）。超过深度的下游节点整体标记为 `stale`（不再递归），并在 Reconciliation 日志中记录 `depth_limit_reached`。防止无限深依赖链导致的栈溢出或性能崩溃。

> *最重要的防护已经存在：stale 不触发自动重执行。以上三个是性能层面的加固，不改变语义。*

### 8.2 检测内容

- artifact 文件是否仍存在（Missing）
- artifact 内容是否与记录 checksum 一致（Changed）
- stale artifact 的下游是否仍在推进（应暂停但未暂停）
- 长时间 `running` 无心跳的节点（Phantom Running）
- 孤立 worktree（执行已结束，目录仍存在）
- 人工审核超时处理

### 8.3 漂移处理

| 漂移类型 | 处理 |
|---------|------|
| artifact 消失 | 标 `invalid`，通知，触发重试策略 |
| artifact 内容变化 | 标 `stale`，传播到下游 |
| Phantom Running（无心跳 > 阈值）| 标 `failed`，触发重试 |
| 孤立 Worktree | 自动清理，产物归档 |
| 审核超时 | 按 `onTimeout` 策略执行（auto_approve / escalate）|

---

## 9. 有界自治模型

### 9.1 重试策略

节点级配置，耗尽后行为为 `pause_for_human`（非 abort）：

```typescript
retry: {
  maxAttempts: 3,
  backoffSeconds: [60, 300, 900],
  on_exhausted: 'pause_for_human',
}
```

### 9.2 失败升级路径（三档）

不是所有失败都值得打断人类。三档响应策略，节点级可配置触发阈值：

| 档位 | 触发条件 | 行为 |
|------|---------|------|
| `auto_retry` | 失败次数 < `notify_threshold` | 按 backoff 自动重试，不通知 |
| `notify_and_wait` | 失败次数 ≥ `notify_threshold` | 发 IM 通知但**不阻塞** workflow；人类可选择介入或让系统继续重试 |
| `pause_for_human` | 失败次数 ≥ `maxAttempts` 或相似度触发 | 完全阻塞该分支，等人类提供明确指导才能继续 |

```typescript
retry: {
  maxAttempts: 5,
  notifyThreshold: 2,           // 第 2 次失败起发 IM，但不阻塞
  backoffSeconds: [30, 60, 180, 600, 1800],
  on_exhausted: 'pause_for_human',
  similarityThreshold: 0.92,    // 触发 pause_for_human（不等 maxAttempts）
}
```

> *`notify_and_wait` 是关键的新档位：人类收到提醒可以选择介入，但系统不傻等。减少不必要的 workflow 停顿。*

### 9.3 结构化反馈注入

人类拒绝 artifact 时必须提供：

```typescript
type StructuredFeedback = {
  category: 'layout_wrong' | 'token_mismatch' | 'logic_error'
           | 'requirement_gap' | 'quality_insufficient' | 'other'
  location?: string          // 哪个区域 / 哪段内容
  expected?: string          // 期望是什么
  detail: string             // 自由文本
}
```

此反馈与 artifact 绑定，下次该节点执行时注入 Agent 上下文：
> "上次你生成的内容被拒绝，原因：[category] - [detail]。期望：[expected]。请针对性修改。"

### 9.4 输出相似度检测（防原地打转）

当 Agent 连续失败重试时，若每次产出的内容与上次高度相似，说明 Agent 没有真正吸收反馈，继续重试只是浪费调用。

**检测机制（文件级 hash diff）：**

1. 每次 attempt 完成后，计算所有 produces 文件的 SHA-256 集合：`Set<{path, sha256}>`
2. 与上次 attempt 的文件集合对比：计算**变化文件比例** = 内容发生变化的文件数 / 总文件数
3. 若变化比例 < 0.08（即 92% 的文件内容完全没变，可配置），触发 `pause_for_human`
4. 通知内容：`"Agent 对反馈没有响应（第 N 次产出中 N 个文件与上次完全相同），请提供更明确的指导"`

> *设计决策：文件级 SHA-256 集合对比是 O(n) where n = 文件数，不受单文件大小影响，天然支持多文件输出（多文件 diff、大型 codebase），且结果比编辑距离更直观可解释（"X 个文件没变"比"相似度 94%"更清晰）。*

```typescript
retry: {
  maxAttempts: 3,
  similarityThreshold: 0.92,   // 超过此相似度触发 pause_for_human
  on_exhausted: 'pause_for_human',
}
```

### 9.5 调度层 Stuck 检测（通用机制）

> *§9.4 检测的是"单节点反复产出相同内容"。本节检测的是"调度层面"的卡死——节点之间的病态循环和依赖缺失。两者互补。与领域无关：任何 DAG 工作流都可能出现。*

Reconciliation（§8）每轮扫描时，基于 `node_executions` 历史额外判定两条调度级 stuck 规则：

**规则 A — 振荡（Oscillation）**

```
条件: 最近 N 次节点调度出现 A→B→A→B 模式（默认 N=4）
含义: 两个节点互相解除对方的 stale/blocked，形成环路，永不收敛
处理: 暂停涉及的两个节点 → pause_for_human，附调度历史
示例: node-X → node-Y → node-X → node-Y → 触发
```

**规则 B — 依赖产物持续缺失**

```
条件: 同一节点连续 N 次（默认 N=2）因相同的 consumes artifact 不存在/invalid 而无法启动
含义: 上游产物从未正确产出，下游空转无意义
处理: 标记下游节点 pause_for_human，提示检查上游节点
```

> *这是 PRD1 stuck 检测的领域无关内核。原 PRD1 还有"ENOENT 文件路径""同错误码"等规则——那些是文件系统/代码领域的具体形态，归 `software-dev-agile` 模板的领域验证器，不进内核。内核只认"artifact 缺失"这个通用概念。*

```typescript
// 内核配置（通用）
stuckDetection: {
  oscillationWindow: 4,            // A→B→A→B 检测窗口
  missingDepConsecutive: 2,        // 依赖缺失连续次数
}
```

---

## 10. Human Governance

### 10.1 人类角色

人类是**校准者（Calibrator）**，不是执行者。

**负责**：产品方向、ADR 架构决策、UI 语义最终验收、高风险仲裁  
**不负责**：重复工程执行、手动触发每一步、格式化/文档/测试日常运行

### 10.2 审批门控

内置 `human_approval` 节点类型覆盖以下场景：

| 场景 | 示例节点 | 超时策略 |
|------|---------|---------|
| PRD 确认 | `prd-approval` | 工作时间内 1 小时，超时人工介入 |
| 架构决策（ADR）| `arch-approval` | 无超时，必须人工确认 |
| UI 验收 | `ui-approval` | 可配置 auto_approve |
| Sprint 交付 | `sprint-delivery` | 可配置 auto_approve |
| 高风险仲裁 | 自动升级 | 必须人工确认 |

ADR 一经批准即为不可变治理产物，任何后续工作流节点不得绕过。

### 10.3 人工审核队列自动触发条件

- artifact 需要语义层人工验证
- 节点达到最大重试次数
- Reconciliation 检测到无法自动修复的漂移
- Entropy 指标超过阈值

---

## 11. 可靠性模型

### 11.1 事件溯源（Append-only Event Log）

所有 Runtime 行为记录为 JSONL 事件流：

```jsonl
{"id":"uuid","ts":1716300000,"type":"WORKFLOW_STARTED","run_id":"...","workflow_id":"..."}
{"id":"uuid","ts":1716300060,"type":"NODE_STARTED","run_id":"...","node_id":"outline","attempt":1}
{"id":"uuid","ts":1716300120,"type":"ARTIFACT_PRODUCED","artifact_id":"...","path":"novel/outline.md","checksum":"sha256:abc"}
{"id":"uuid","ts":1716300121,"type":"VALIDATION_PASSED","artifact_id":"...","validator":"output-schema"}
{"id":"uuid","ts":1716300200,"type":"HUMAN_REVIEW_REQUESTED","artifact_id":"...","node_id":"outline"}
{"id":"uuid","ts":1716303800,"type":"HUMAN_APPROVED","artifact_id":"...","reviewer":"user"}
{"id":"uuid","ts":1716303801,"type":"NODE_COMPLETED","run_id":"...","node_id":"outline"}
{"id":"uuid","ts":1716303900,"type":"ARTIFACT_STALE","artifact_id":"chapter-1","reason":"upstream_changed","upstream":"outline"}
```

事件日志是 Replay、Recovery、Rebuild 的唯一来源。

**Event Idempotency（幂等写入）**

每条事件包含 `idempotency_key`，格式为 `{run_id}:{event_type}:{entity_id}:{attempt}`。事件写入使用 `INSERT OR IGNORE`（SQLite）——相同 idempotency_key 的重复写入被静默忽略。

这保证：Worker 心跳超时导致的节点重启不会产生重复事件；Reconciliation 重复扫描不会产生重复的 stale 事件。

`idempotency_key` 字段已包含在 §12.3 的 events 表定义中（`TEXT UNIQUE`，配合 `INSERT OR IGNORE`）。

**时序保证**：v1 是单进程 Runtime（SQLite 单写者），事件天然有序，不需要分布式时钟。`ts` 字段使用 `Date.now()`（毫秒）。同一毫秒内有多个事件时，以 events 表的自增 `seq` 列为准（严格单调递增，保证插入顺序）。`ts` 仅用于展示和时间范围查询，排序一律用 `seq`。

### 11.2 快照 + 增量重放

每个节点完成后写一个 state snapshot：

```
.myrmidon/runs/{run_id}/snapshots/
  snapshot_001_node-outline.json
  snapshot_002_node-chapter-1.json
```

启动时：加载最新 snapshot + 重放其后的事件（不从头重放）。

### 11.3 崩溃恢复

Runtime 重启后：
1. 加载最新 snapshot，重放后续事件，重建 workflow 状态
2. 对所有 `running` 状态节点：检查心跳记录
   - 有最近心跳 → 等待（可能 Worker 仍在运行）
   - 无心跳超过阈值 → 标 `failed`，触发重试策略
3. 恢复 Reconciliation 循环
4. 继续执行

用户体验：重启后自动从中断处继续，无需手动操作。

**冲突裁决规则（事件日志 vs SQLite 表）**

若 Runtime 重启时发现事件日志与 SQLite 表中的 workflow 状态不一致：

> **事件日志永远是 Source of Truth。SQLite 表是事件日志的投影（projection）。**

处理方式：从最近 snapshot 开始，重放事件日志，重新生成所有 SQLite 表中的运行时状态。SQLite 表的不一致视为损坏，清空重建（仅针对受影响的 run_id）。

> *设计依据：事件日志是 append-only 的，是最难被意外损坏的数据结构。SQLite 表是为查询效率而存在的缓存，不是 authority。*

### 11.4 三层状态机参考（实现对齐用）

实现时需要同时维护三个状态机，它们之间有联动关系：

**WorkflowRun 状态机**

```
created → running → paused → running  （人工介入后恢复）
                 → completed
                 → failed              （所有重试耗尽）
                 → cancelled           （人工取消）
```

**NodeExecution 状态机**

```
pending → running → completed   （产物通过 Validator）
                 → failed        （Validator 失败 + 重试耗尽）
                 → waiting_human （需要人工 Review 或 Approval）
        → paused                 （相似度触发 / budget_cap 触发）
        → skipped                （condition 不满足，边未激活）
```

**Artifact 状态机（见 §6.2）**

```
pending → generating → needs_validation → valid / invalid / needs_review → stale / orphaned
```

**联动规则：**
- 任意 artifact 进入 `needs_review` → 关联 NodeExecution 进入 `waiting_human`
- 所有 NodeExecution 进入 terminal state → WorkflowRun 进入 terminal state
- WorkflowRun 进入 `paused` → 所有 `running` NodeExecution 进入 `paused`

### 11.5 长期稳定性保证

系统长期运行后不应发生：
- **世界状态漂移**（Runtime 认为的 ≠ 磁盘上的）
- **幻觉完成**（artifact 未真正 valid，系统认为完成）
- **上下文腐化**（过期认知影响后续决策）
- **Worktree 泄漏**（孤立目录堆积）
- **无限循环**（无信息增量地重复失败）

---

## 12. 技术方案

### 12.0 语言选型（ADR）

**决策**：v1–v2 使用 **Node.js / TypeScript**。Go 不作为整体重写选项，仅保留为 v3 云端控制面的**局部可选实现**。

**理由**：

| 因素 | 判断 |
|------|------|
| **TypeScript DSL 是产品核心** | `defineWorkflow()`（§4.1）是 TS 函数，workflow 定义本身就是 TS 代码。换语言要么牺牲 DSL 体验，要么陷入双语言维护。这是最强绑定 |
| **`npx myrmidon` 零安装分发** | §3.2 明确的卖点，Node 原生优势。Go 的单二进制换不来这个体验 |
| **负载是 IO 密集，非 CPU/并发密集** | 引擎的工作是 spawn 外部 runtime 进程 + 轮询 + SQLite 读写。agent 是外部进程，不是要并行计算的对象——Go 的 goroutine/性能优势在此用不上 |
| **生态契合** | Ink（TUI）、better-sqlite3、各 runtime CLI 的调用都在 Node 生态内顺手 |

**Go 的真实利好点及隔离方式**：

Go 的优势（静态二进制、goroutine 管理 worker 池、容器友好）只在 **v3 云端高并发控制面**才有意义。届时**可单独用 Go 重写控制面**（Scheduler / ExecutionBackend，见 PRD5 P5-1），而 DSL / CLI / TUI 保持 TS——靠 PRD5 的接口抽象（StateStore / ArtifactStore / ExecutionBackend / Scheduler）隔离，是干净的局部替换，不是整体重写。

> *不现在用 Go 的根本原因：v1 的瓶颈是"管好外部进程 + 状态一致性"，不是计算性能。提前为 v3 才出现的并发需求换语言，会损害 v1 最核心的 DSL 体验和分发方式，是过早优化。*

---

### 12.1 运行时架构

```
myrmidon-runtime（持续运行，托盘 or daemon）
  ├── RuntimeKernel      唯一状态权威，写 SQLite + 事件日志
  ├── WorkflowEngine     DAG 调度，状态机推进（含 condition 求值、join 判定）
  ├── ReconciliationLoop 周期对账 + dirty-bit 传播
  ├── ExecutorManager    Worker 生命周期管理
  ├── ValidatorBus       验证调度，结果写回 RuntimeKernel
  ├── NotificationBus    Slack / 企业微信 / 托盘通知
  └── IPCServer          Unix socket，接受 CLI 指令

myrmidon CLI（短生命周期，完全无状态）
  └── IPCClient → IPCServer（JSON-RPC over Unix socket）
```

**边界规则（硬约束）：**
- **CLI = 无状态 thin client**：CLI 不读写 SQLite，不操作文件系统，不持有任何 workflow 状态。所有 CLI 命令本质上是向 Runtime 发送 IPC 请求并打印响应。
- **Runtime = 唯一写者**：只有 Runtime 进程写 SQLite、写 artifact 状态、写事件日志。CLI、Worker、外部工具不得直接写 SQLite（只读查询可以）。
- **IPC = 唯一入口**：所有状态变更（包括 review 操作）必须通过 IPC，不存在"直接修改数据库"的快捷路径。

### 12.2 进程通信（IPC）

Unix socket 路径：`~/.myrmidon/runtime.sock`（可通过 `MYRMIDON_SOCKET` 覆盖）

认证：状态变更命令需在请求中携带 `token` 字段（见 §12.6.1）。

```typescript
// IPC 请求类型
type IPCRequest =
  // 只读命令（无需 token）
  | { cmd: 'runtime.ping' }
  | { cmd: 'runtime.status' }
  | { cmd: 'workflow.status';  runId: string }
  | { cmd: 'review.list' }
  // 状态变更命令（需 token）
  | { cmd: 'workflow.start';   token: string; workflowId: string; context: Record<string, string> }
  | { cmd: 'workflow.resume';  token: string; runId: string }
  | { cmd: 'workflow.pause';   token: string; runId: string }
  | { cmd: 'review.approve';   token: string; artifactId: string }
  | { cmd: 'review.reject';    token: string; artifactId: string; feedback: StructuredFeedback }
  | { cmd: 'runtime.stop';     token: string }

type IPCResponse<T> = { ok: true; data: T } | { ok: false; error: string; code?: 'UNAUTHORIZED' }
```

### 12.3 SQLite 数据模型

> *设计决策：所有持久化结构都携带 `schema_version` 整数字段（从 1 开始）。迁移策略：启动时读取 `PRAGMA user_version`；若版本低于当前代码版本，顺序执行迁移函数（`migrate_v1_to_v2` 等），每个函数在同一事务中完成。不引入外部迁移框架（如 Flyway），保持零依赖。*

```sql
-- 数据库版本（SQLite PRAGMA）
-- PRAGMA user_version = 1;   ← 每次 schema 变更递增

-- 工作流定义（从 PRD2 继承）
CREATE TABLE workflows (
  id TEXT PRIMARY KEY, version TEXT, name TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  def_json TEXT NOT NULL, created_at TEXT, updated_at TEXT
);

-- 工作流运行实例（从 PRD2 继承）
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY, workflow_id TEXT, workflow_version TEXT,
  workflow_def_snapshot TEXT NOT NULL,  -- 创建时 WorkflowDef JSON 的完整快照（运行期间定义变更不影响此 run）
  status TEXT,   -- 'running'|'paused'|'completed'|'failed'
  started_at TEXT, completed_at TEXT, context_json TEXT,
  cost_usd REAL DEFAULT 0,              -- 累计 LLM API 调用费用估算（美元）
  snapshot_path TEXT  -- 最新 state snapshot 路径
);

-- 节点执行记录（从 PRD2 继承，新增字段）
CREATE TABLE node_executions (
  id TEXT PRIMARY KEY, run_id TEXT, node_id TEXT,
  status TEXT,   -- 'pending'|'running'|'completed'|'failed'|'waiting_human'|'paused'
  attempt INTEGER DEFAULT 1, agent_id TEXT,
  started_at TEXT, completed_at TEXT, last_heartbeat_at TEXT,
  worktree_path TEXT, error TEXT, output_json TEXT,
  cost_usd REAL DEFAULT 0,              -- 本次执行 LLM API 费用估算
  output_similarity REAL                -- 与上次 attempt 产出的相似度（0–1），用于防原地打转
);

-- 产物注册表（从 PRD2 继承，新增字段）
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, workflow_id TEXT, run_id TEXT,
  node_id TEXT, execution_id TEXT,
  file_path TEXT, artifact_type TEXT,
  status TEXT,   -- 'pending'|'generating'|'needs_validation'|'valid'|'invalid'|'stale'|'needs_review'|'orphaned'
  checksum TEXT, created_at TEXT, validated_at TEXT
);

-- Artifact 依赖关系（新增）
CREATE TABLE artifact_deps (
  artifact_id TEXT, depends_on TEXT,
  PRIMARY KEY (artifact_id, depends_on)
);

-- Append-only 事件日志（新增）
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- 单调递增排序键，同 run 内事件保序
  id TEXT NOT NULL UNIQUE, run_id TEXT,
  ts INTEGER NOT NULL, type TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,            -- INSERT OR IGNORE 防重复（见 §11.1）
  schema_version INTEGER NOT NULL DEFAULT 1,  -- event payload 的格式版本
  payload_json TEXT
);
CREATE INDEX idx_events_run_seq ON events(run_id, seq);

-- 执行器进程注册表（见 §5.8，进程/端口清理）
CREATE TABLE executor_procs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,       -- 对应 node_executions.id
  pid         INTEGER NOT NULL,
  proc_type   TEXT NOT NULL,       -- 'executor' | 'child' | 'aux-server'
  port        INTEGER,             -- 若占用端口（领域模板特性）
  started_at  TEXT NOT NULL,
  killed_at   TEXT
);

-- 验证结果（新增）
CREATE TABLE validation_results (
  id TEXT PRIMARY KEY, artifact_id TEXT, execution_id TEXT,
  validator_id TEXT, validator_type TEXT,  -- 'automated'|'ai_assisted'|'human'
  passed INTEGER, evidence_json TEXT,
  reviewed_by TEXT, ts INTEGER
);

-- 结构化反馈日志（新增）
CREATE TABLE feedback_log (
  id TEXT PRIMARY KEY, artifact_id TEXT, execution_id TEXT,
  reviewer TEXT, category TEXT, location TEXT,
  expected TEXT, detail TEXT, ts INTEGER
);
```

### 12.4 myrmidon.config.ts（完整结构）

```typescript
export default defineConfig({
  // ── 项目信息 ──
  project: { name: string; version: string },

  // ── Runtime 模式 ──
  runtime: {
    mode: 'tray' | 'daemon' | 'inline',  // inline = 命令行直接运行，不常驻
    socketPath?: string,
    dbPath?: string,                      // 默认 .myrmidon/runtime.db
  },

  // ── 工作流注册 ──
  workflows: string[],  // 文件路径或内置模板 ID

  // ── Agent 三层配置（见 §5.3.1）──
  // 层1: 角色能力边界（具体角色由模板填充，内核不预设 pm/coder）
  agentRoles: {
    [role: string]: {
      systemPromptFile: string,
      allowedTools: string[],
      forbiddenActions: string[],
      requiredSkills: string[],
      tokenProfile: 'budget' | 'balanced' | 'quality',
    }
  },
  // 层2: runtime × model 组合
  executors: {
    [name: string]: {
      runtime: 'claude-code' | 'kimi' | 'gemini-cli' | string,  // §12.5
      model: string,
      maxContextTokens: number,
    }
  },
  // 层3: 工作流绑定（声明某角色用哪个 executor，可覆盖层1）
  agents: {
    [binding: string]: {
      role: string,                  // 引用 agentRoles
      executor: string,              // 引用 executors
      count?: number,                // 并发实例数
      allowedMCPTools?: string[],
      skills?: string[],             // 覆盖层1默认
      constitution?: Partial<AgentConstitution>,
    }
  },

  // ── 通知渠道 ──
  notifications: {
    slack?: { webhookUrl: string; channel: string },
    wecom?: { key: string },
    email?: { smtp: SmtpConfig; to: string[] },
  },

  // ── 费用控制（强制 hook，不只是记录）──
  cost: {
    budget_cap_usd?: number,        // 单个 workflow run 的费用硬上限
                                    // 超出时：暂停 run（pause_for_human）+ IM 通知
                                    // 不是软警告，是强制停止
    warn_at_usd?: number,           // 费用达到此值时发出预警通知（不暂停）
    per_node_cap_usd?: number,      // 单个节点单次执行的费用上限
                                    // 超出时：节点标 failed，触发重试策略（不直接暂停 run）
  },

  // ── 上下文管理（见 §5.5.1 七层上下文管理）──
  contextManagement: {
    observationMasking: { enabled: true, keepRecentTurns: 8 },
    preCompactionSnapshot: { enabled: true, maxBytes: 2048 },
    phaseAnchors: { enabled: true },
    pressureMonitor: { enabled: true, threshold: 0.70 },
    sandboxedExec: { enabled: true, summaryMaxChars: 800 },
    toolResultMaxChars: 800,
  },

  // ── 调度层 Stuck 检测（见 §9.5）──
  stuckDetection: {
    oscillationWindow: 4,            // A→B→A→B 振荡检测窗口
    missingDepConsecutive: 2,        // 依赖产物缺失连续次数
  },

  // ── 定时器（毫秒）──
  timers: {
    reconciliationMs: number,     // 默认 300_000 (5min)
    heartbeatMs: number,          // 默认 15_000
    stuckDetectionMs: number,     // 默认 120_000
    reviewTimeoutMs: number,      // 默认 3_600_000 (1hr)
  },

  // ── 测试基础设施（仅用于开发/测试环境）──
  test?: {
    mockExecutor?: boolean,       // 启用 mock executor，从 fixture 读取输出
    mockReviewer?: boolean,       // 启用 mock reviewer，允许通过 IPC 以编程方式审批
    fixturesDir?: string,         // fixture 文件目录，默认 .myrmidon/test/fixtures/
    fakeClock?: boolean,          // 使用假时钟，用于超时测试
  },
});
```

### 12.5 多运行时支持

```typescript
// 节点 executor 字段支持
type ExecutorType =
  | 'claude-code'    // Anthropic Claude Code CLI（当前主要）
  | 'opencode'       // 开源替代
  | 'kimi'           // Kimi Codex
  | 'gemini-cli'     // Google Gemini CLI
  | 'mock'           // 测试用，从 fixturesDir 读取输出
  | string           // 自定义，通过 engine.registerExecutor() 注册
```

每个 executor 适配器负责：启动进程、注入上下文、监听心跳、读取输出。

**Runtime 自动检测与安装引导（通用机制）：**

`myrmidon init` / `daemon start` 启动时检测可用 runtime：

| Runtime ID | 检测命令 | 安装文档 |
|-----------|----------|----------|
| `claude-code` | `claude --version` | https://claude.ai/code |
| `opencode` | `opencode --version` | https://opencode.ai |
| `gemini-cli` | `gemini --version` | https://github.com/google-gemini/gemini-cli |
| `kimi` | `kimi --version` | https://github.com/MoonshotAI/kimi-codex |

检测分支处理：

```
检测到 1 个  → 自动选用，写入 config
检测到 0 个  → 输出安装引导（列出各 runtime 安装命令），非零退出，不继续
检测到 ≥2 个 → 交互选择默认 runtime（daemon 模式取 config 显式值，无则报错）
config 已显式指定 → 跳过检测，仅校验该 runtime 可用，不可用则报错附安装方式
```

检测结果写入 SQLite `meta` 表（`runtime.detected` / `runtime.selected`），供 TUI Config Tab 展示。

---

### 12.6 安全模型

> *设计原则：简单够用。v1 面向本地单用户/小团队，不引入 JWT/OAuth 等复杂方案。主要防御目标：防止 Agent 生成的脚本通过 IPC 自批 review，以及防止配置文件泄露 API 密钥。*

**12.6.1 IPC 会话 Token**

Runtime 启动时生成随机 token（32 字节十六进制），写入 `~/.myrmidon/auth.token`（权限 chmod 600）：

```
规则：
- 所有状态变更命令（workflow.start, review.approve/reject, runtime.stop）
  必须在请求头中携带 Authorization: Bearer <token>
- 只读命令（runtime.ping, workflow.status, review.list）无需 token
- Agent 的执行环境中不注入 token（Agent 无法自批 review）
- CLI 从 auth.token 文件读取，用户无需手动输入
```

> *决策依据：防止 Agent 生成的 shell 脚本调用 IPC 自批自己的 artifact。最简实现，无需 TLS 或公钥体系，因为 Unix socket 本身已限制在本机。*

**12.6.2 配置文件密钥安全**

配置中的敏感字段（API Key、Webhook URL）使用环境变量引用格式，不直接写值：

```typescript
// myrmidon.config.ts — 正确写法
notifications: {
  slack: {
    webhookUrl: { $env: 'SLACK_WEBHOOK_URL' },  // 引用环境变量
    channel: '#dev-workflow',
  },
  wecom: { key: { $env: 'WECOM_KEY' } },
},
agents: {
  coder: {
    executor: 'claude-code',
    apiKey: { $env: 'ANTHROPIC_API_KEY' },
  },
},
```

`myrmidon init` 时自动：
1. 创建 `.myrmidon.env`（列出所需环境变量的示例文件）
2. 将 `.myrmidon.env` 和 `myrmidon.secrets.ts` 加入 `.gitignore`

> *决策依据：{ $env: 'VAR' } 模式比直接写值更安全，且无需引入 Vault 等外部依赖。macOS Keychain 集成留作 v2 特性。*

**12.6.3 Agent 执行环境隔离（Worktree 沙箱）**

Agent 执行时的 worktree 环境约束：

- 仅注入本节点必需的环境变量（最小权限原则）
- `MYRMIDON_AUTH_TOKEN` 不注入 Agent 环境
- Worktree 路径不包含其他 run 的上下文
- Agent 无法通过文件系统访问 `~/.myrmidon/auth.token`

**文件系统访问限制（Agent Constitution 层强制）：**

```typescript
// 每个 Worker 宪法中强制包含以下禁止规则
forbiddenActions: [
  "访问 .myrmidon/ 目录（Runtime 内部目录）",
  "访问其他 worktree 的路径（worktrees/其他run/）",
  "写入 worktree 根目录以外的路径（context/ 目录只读）",
  "执行 IPC 命令（Unix socket 调用）",
  "读取 auth.token 文件",
]
```

> *这是 Agent Constitution（CLAUDE.md 规则）层面的约束，而非 OS 级沙箱（v1 不引入 Docker/Firecracker，避免复杂度）。v2+ 考虑 OS 级沙箱。现阶段假设 Agent 遵守宪法，配合 IPC token 机制形成双层防护。*

---

### 12.7 Schema 版本管理

> *设计原则：最小侵入。不引入外部迁移框架，用 SQLite 内置 PRAGMA + 代码内迁移函数解决。*

**版本追踪：**
- SQLite 使用 `PRAGMA user_version` 存储数据库 schema 版本（整数，从 1 开始）
- JSONL 事件文件中每条事件含 `schema_version` 字段，标识 payload 格式版本
- Snapshot JSON 文件含顶层 `schema_version` 字段

**迁移策略（代码侧）：**

```typescript
// 启动时执行
async function runMigrations(db: Database) {
  const current = db.pragma('user_version', { simple: true }) as number;
  const target = CURRENT_SCHEMA_VERSION;  // 代码中的常量

  for (let v = current + 1; v <= target; v++) {
    const migrate = MIGRATIONS[v];        // 函数映射 { 2: migrateV1toV2, ... }
    db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${v}`);
    })();
  }
}
```

每个迁移函数是原子事务，失败则 Runtime 启动失败并输出明确错误（不静默损坏数据）。

---

### 12.8 副作用声明机制

部分 Agent 节点需要产生文件系统之外的副作用（发送邮件、调用外部 API、部署到云端）。这些副作用无法由 Reconciliation 引擎自动检测，需要显式声明。

**解决方案：声明 + 确认（Terraform plan 风格）**

节点执行完成后，若 Agent 的 `sideEffects.json` 输出文件不为空，Runtime 在执行副作用前暂停并展示确认：

```json
// output/sideEffects.json（Agent 写入）
{
  "effects": [
    {
      "type": "http_call",
      "description": "POST https://api.stripe.com/v1/prices — 创建新价格条目",
      "reversible": false
    },
    {
      "type": "email",
      "description": "发送通知邮件给 user@example.com",
      "reversible": false
    }
  ]
}
```

Runtime 展示确认界面（TUI + IM 通知）：
```
⚠️  节点 deploy-price 将执行以下外部操作：
  1. POST https://api.stripe.com/v1/prices（不可逆）
  2. 发送邮件至 user@example.com（不可逆）
[确认执行]  [取消]
```

> *设计决策：副作用声明完全可选。大多数纯文件操作的节点不需要此机制。这不是"Terraform 计划"那样的完整执行计划，而是一个轻量的"告知 + 确认"钩子。`sideEffects.json` 不存在视为无外部副作用，直接推进。*

---

### 12.9 Checksum 策略

> *设计原则：快路径优先，避免不必要的 I/O。*

**分层检测策略：**

```
1. 事件驱动检测（chokidar）
   ├── 文件写入 / 删除 → 立即触发 checksum 更新
   └── 覆盖率：artifact 路径的直接变化

2. 快速预检（mtime + size）
   ├── mtime 未变 AND size 未变 → 跳过全量 hash，认为未变
   └── 开销：单次 stat() 系统调用

3. 全量哈希（SHA-256）
   ├── 仅在 mtime 或 size 变化时计算
   ├── 文件 > 10MB → 仅用 mtime+size，不计算 SHA-256
   └── 开销：仅在真正需要时

4. 周期全量扫描（兜底）
   └── 默认每 5 分钟对所有 valid artifact 执行快速预检
       若有变化则升级到全量哈希
```

artifact 存储格式：

```typescript
type ArtifactChecksum = {
  mtime: number     // Unix timestamp（毫秒）
  size: number      // 字节数
  sha256?: string   // 可选；文件 > 10MB 时不存储
}
```

---

### 12.10 Workflow Run 版本隔离

**问题**：用户修改 `myrmidon.config.ts` 或 workflow DSL 文件时，正在运行的 workflow run 不应受到影响。

**解决方案**：在 `workflow_runs` 表中存储 `workflow_def_snapshot`（见 §12.3），in-flight run 始终使用创建时的 WorkflowDef 快照。

规则：
- `myrmidon workflow load` 更新 `workflows` 表 → 不影响任何 `status = 'running'` 的 run
- 新 `myrmidon start` 使用最新 WorkflowDef → 新 run
- `myrmidon start --resume --run-id X` → 使用原始 snapshot 继续

> *设计决策：最简实现是在创建 run 时 JSON.stringify(workflowDef) 存入 workflow_def_snapshot 列，读取时 JSON.parse。不需要版本分支、Git tag 或外部版本仓库。*

---

### 12.11 非文件 Artifact（外部状态）

部分工作流节点的产物不是本地文件（例如：已发布的博客文章、已部署的服务、已发送的邮件）。这类 artifact 无法通过 checksum 自动验证。

**处理方式：`external_state` artifact 类型**

```typescript
// workflow DSL 中声明
artifacts: {
  produces: [
    {
      id: 'post-published',
      type: 'external_state',               // 非文件 artifact
      description: '文章已发布到 Ghost CMS',
      verificationUrl: 'https://blog.example.com/post-slug',  // 可选，人工确认链接
    }
  ]
}
```

`external_state` artifact 的验证规则：
- 自动验证器不适用
- 自动进入 `needs_review` 状态
- Human Validator 确认后标记为 `valid`
- `stale` 传播规则相同（上游变化 → 标记 stale → 提示人工重确认）

> *设计决策：不尝试自动验证外部状态（轮询 URL、调用外部 API），因为这会引入大量边缘情况。简单地路由到人工确认是最可靠的。*

---

### 12.12 测试基础设施

> *设计原则：测试不依赖真实 AI 调用，避免测试成本和不确定性。*

**Mock Executor**

当 `test.mockExecutor: true` 时，executor 不启动真实 AI 进程，而是：
1. 读取 `fixturesDir/{node_id}/{attempt}.json` 作为节点输出
2. 若 fixture 文件不存在，读取 `fixturesDir/{node_id}/default.json`
3. 输出文件内容来自 fixture 的 `files` 字段

```json
// .myrmidon/test/fixtures/coder/1.json
{
  "status": "completed",
  "files": {
    "src/login.ts": "export function login() { /* ... */ }"
  },
  "cost_usd": 0.002
}
```

**Mock Reviewer**

当 `test.mockReviewer: true` 时，新增 IPC 命令用于自动化测试：

```typescript
| { cmd: 'test.review.approve'; artifactId: string }
| { cmd: 'test.review.reject'; artifactId: string; feedback: StructuredFeedback }
```

这些命令不需要 `auth.token`（仅在 `test.mockReviewer: true` 模式下可用，生产环境禁用）。

**Fake Clock**

当 `test.fakeClock: true` 时，Runtime 内部定时器（heartbeat、reconciliation、review timeout）通过可控时钟驱动，允许测试跳过时间。

**World Reconstruction Test（每次 Release 必跑）**

验证"系统不依赖 memory/session 作为 Source of Truth"的专项测试：

```typescript
// 测试步骤：
// 1. 用 mock executor 跑完一个完整 workflow（若干节点）
// 2. 记录最终 workflow 状态（所有 artifact 状态、节点状态）
// 3. 删除：所有 session 文件、所有 snapshot、SQLite 中的投影表内容
// 4. 保留：event log JSONL、artifact 文件内容
// 5. Runtime 重启，从 event log 重建状态
// 6. assert：重建后的状态 === 步骤 2 记录的状态

// 如果这个测试失败：
// 说明某处把 truth 写进了 memory/snapshot 而没有写进 event log
// 必须修复，不允许上线
```

> *这是整个系统可靠性设计的"集成压测"，不是功能测试。作为 CI 必须步骤，每次 release 跑一次。*

---

### 12.13 Runtime GC（垃圾回收）

长期运行后会积累：已完成 run 的旧事件、orphan snapshot、dead validation 记录、已清理 worktree 的残留元数据。不处理会导致 SQLite 膨胀和查询变慢。

**GC 策略（简单规则，不过度工程化）：**

| 资源 | 保留策略 | 归档/删除 |
|------|---------|---------|
| completed run 的事件日志 | 最近 30 天（可配置）| 超出部分移到 `events_archive` 表 |
| failed/cancelled run | 最近 7 天 | 超出部分删除（artifact 文件保留）|
| orphan snapshot 文件 | 对应 run 已 completed/failed | 删除 snapshot 文件，不删 artifact |
| 已清理 worktree 的元数据 | worktree 确认不存在后 | 删除 `node_executions.worktree_path` 关联记录 |
| dead validation_results | 对应 artifact 已 orphaned | 删除 |

**触发方式：**
- `myrmidon gc`：手动触发，`--dry-run` 先预览
- 自动 GC：Runtime 启动时检查，以及每天凌晨 3 点（可配置）

```
myrmidon gc --dry-run
  would archive: 1,240 events (runs older than 30d)
  would delete:  3 orphan snapshots
  would delete:  47 dead validation_results
  total size freed: ~2.4MB
```

---

## 13. 商业模式

> *v1 是开源工具，通过后续 SaaS 层变现。核心 Runtime 保持可自托管。*

| 层级 | 价格 | 内容 |
|------|------|------|
| **个人版（开源）** | 免费 | 完整 Runtime 功能，本地自托管，无限 workflow |
| **团队版（SaaS）** | $20–50 / 人 / 月 | 云端 Runtime、团队共享状态、Web Review UI、多成员通知、备份 |
| **企业版（未来）** | 按需报价 | SSO、审计日志、RBAC、私有部署支持 |

货币化触发点：团队协作（多人共享同一 Runtime）和云端托管（不想自己运维）。核心 AI 执行费用由用户自己的 API key 承担，Myrmidon 不代理 AI 调用。

---

## 14. 发布路线图

### MVP 定义（v1 可交付产品）

> **目标**：5–6 周内交付一个独立开发者能真正用起来的版本。
>
> MVP = Sub-2 完整版 + Sub-3 轻量版 + Sub-4 核心版 + 基础 CLI 输出
>
> MVP **不包含**：完整 TUI（Sub-6）、Slack 通知（Sub-7）、托盘应用（Sub-8）

**MVP 可交付标准**：
- [ ] `software-dev-agile` 内置模板**完整可运行**（不是占位符），能跑通完整 PM→代码→QA 流程
- [ ] Reconciliation 基础功能：checksum 扫描 + stale 传播 + crash recovery
- [ ] 有界重试 + 结构化反馈注入
- [ ] `myrmidon review list/approve/reject` 命令（CLI 文字输出，非 TUI）
- [ ] Mock Executor + Mock Reviewer（测试基础设施）
- [ ] 基础费用追踪（`myrmidon status` 显示累计费用）

| 子项目 | 内容 | 目标 |
|--------|------|------|
| **Sub-1** Foundation & CLI | 项目脚手架、配置、SQLite 初始化、运行时检测、init 命令 | ✅ 已完成 |
| **Sub-2** Workflow Engine | WorkflowDef schema、DAG 引擎、8 种节点执行器、Artifact 系统、基础 Validator、SQLite 完整表结构、workflow 命令、**完整可运行的 software-dev-agile 模板** | 🔄 进行中 |
| **Sub-3** Reconciliation（轻量）| Append-only 事件日志、checksum 扫描（mtime+size 预检 + SHA-256）、dirty-bit 传播、Phantom Running 检测、快照 + 增量重放、崩溃恢复、基础可观测性（`myrmidon log --run-id`） | ⏳ MVP 核心 |
| **Sub-4** Bounded Autonomy | 有界重试、输出相似度检测、结构化反馈注入、失败升级路径、Review Queue CLI（文字输出）| ⏳ MVP 核心 |
| **Sub-5** Agent Constitution | MCP allowlist 强制、Skills 注入、Agent 宪法、多角色配置、IPC 安全 token | ⏳ MVP 后 |
| **Sub-6** TUI | Ink 实现完整 5-Tab TUI、Artifact 状态图、Review Queue 界面 | ⏳ MVP 后 |
| **Sub-7** Notifications | Slack / 企业微信 / Email 通知渠道、IM 双向交互 | ⏳ MVP 后 |
| **Sub-8** Runtime Modes | 托盘应用（Electron）、Daemon 模式、完整 IPC server | ⏳ MVP 后 |
| **Sub-Desktop** | n8n 风格画布编辑器（Electron/Tauri），WorkflowDef 可视化编辑 | 🔮 远期 |

---

## 15. 成功指标

| 类别 | 指标 |
|------|------|
| 自治能力 | 自主完成率（无人工介入节点占比）|
| 稳定性 | Reconciliation 漂移检测准确率、崩溃恢复成功率 |
| 循环健康 | 每次人工反馈后的循环收敛速度；原地打转触发率（相似度检测触发次数）|
| 人效 | 人工介入频率、单次审核耗时 |
| 运行时健康 | 孤立 Worktree 数量、幻觉完成率（被验证推翻的 agent 自报完成）|
| 成本 | 平均每 workflow run 费用（美元）；超出 budget_cap 的频率 |

---

## 16. 附录：内置模板简述

### A. 软件开发（敏捷）`software-dev-agile`

```
trigger → requirements(pm) → prd(pm) → [prd-approval:human]
→ design(arch) → [arch-approval:human]
→ sprint-plan(pm) → [parallel_fork]
    → coding-1..N(coder)
  [join] → qa(qa) → [condition]
    ↗ passed → [sprint-delivery:human]
    ↘ failed → bug-fix(coder) → qa [loop, max 5]
```

> 以下 A.1–A.3 是本模板的领域内容（角色库 / 产物规范 / 领域配置），填充 §4.6 定义的模板结构。**这些不进内核**——内核不知道"coder""DOM Contract""端口"是什么。其他领域模板（小说/视频）有各自的等价物。

#### A.1 角色库（填充内核三层配置的 agentRoles）

| 角色 | 定位 | allowedTools | forbiddenActions | 技能包（Skills）|
|------|------|-------------|------------------|----------------|
| `pm` | 需求/PRD/Epic-Sprint 规划 | Read, Write, WebFetch, WebSearch | Bash, Edit | requirements-gathering, prd-writing, epic-sprint-planning |
| `arch` | 技术评审/详细设计/任务拆分 | Read, Write, Edit | Bash, Agent | writing-plans, api-design, sql-design |
| `coder`（FE）| React/Vue 实现，测试先行 | Read, Write, Edit, Bash | git push --force | tdd-frontend, react-conventions, accessibility-impl |
| `coder`（BE）| API/DB/业务逻辑，测试先行 | Read, Write, Edit, Bash | DROP TABLE, git push --force | tdd-backend, api-design, sql-design, security-backend |
| `coder`（Mobile）| RN/Flutter 实现 | Read, Write, Edit, Bash | git push --force | rn-conventions, mobile-accessibility, offline-first |
| `qa` | 测试用例/执行/Bug 报告 | Read, Write, Bash | Edit, git commit | webapp-testing, api-testing, bug-report-writing |
| `security` | 安全审查（横切，按阶段注入）| Read, Bash | Write, Edit | security-owasp, dependency-audit, secret-scan |
| `ui` | 高保真设计/组件规范/Token | Read, Write, WebFetch | Bash, Edit | design-system, dom-contract-writing, accessibility-audit |
| `devops` | CI/CD/容器/IaC/监控 | Read, Write, Edit, Bash | kubectl delete namespace, terraform destroy | ci-cd-github-actions, docker-build, k8s-deploy |

> 完整的代码规约（React/Node/Go/Flutter 各端约定）、MCP 工具映射、Config 片段，作为模板随附的 `roles/*.md` 文件交付。每个角色的规约是 Constitution 注入内容，由本模板提供，非内核。

#### A.2 DOM Contract（本模板的 UI 产物规范）

软件开发模板为 `screenshot` / `source_code`(FE) 类 artifact 定义 **DOM Contract** —— ui / coder(FE) / qa 三方的唯一共同合约：

```markdown
## DOM Contract（机器可读）
### 必须存在的元素
| data-testid | HTML 类型 | 必要属性 | 条件 |
| email-input | input | type=email required | 始终 |
| submit-button | button | type=submit | 始终 |
| error-message | div | role=alert | 仅错误状态 |

### 状态机
| 状态 | submit-button | error-message | 触发 |
| idle | enabled | hidden | 初始 |
| loading | disabled | hidden | 提交中 |
| error | enabled | visible | 服务端 4xx |

### Playwright 必须覆盖的验收用例（qa 直接据此生成测试）
- [ ] 空 email 提交 → required 验证，不发请求
- [ ] 有效凭证 → 跳转，URL 变更
- [ ] WCAG AA：对比度 ≥ 4.5:1（axe-core）
```

- **ui** 填写 DOM Contract（与视觉规范同时产出，未填不得 status: completed）
- **coder(FE)** 实现时确保所有 `data-testid` 存在且符合状态机
- **qa** 从"Playwright 必须覆盖的验收用例"逐条生成测试，不解读叙述文字

> DOM Contract 是 Web 前端领域专属产物规范。内核只看到一个 `screenshot`/`source_code` 类型的 artifact 走验证流程；"DOM Contract 该长什么样"完全由本模板定义。

#### A.3 领域配置（端口分配 / monorepo）

本模板独有、其他领域不需要的配置：

```typescript
domainConfig: {
  // 端口分配（仅软件开发起 dev/test server 需要）
  portAllocation: 'basePort + taskId % 1000',   // 单项目 31000~31999

  // monorepo 多 app（v2 完整支持；v1 单 app）
  apps: {
    backend:  { root: 'apps/backend',  basePort: 31000, testCmd: 'npm test',
                coderOverrides: { systemPromptAppend, skills, additionalRules },
                reviewRules: { rulesFile, checklistItems } },
    frontend: { root: 'apps/frontend', basePort: 32000, testCmd: 'npm test', /* ... */ },
  },

  // 跨仓库依赖（FE/BE 分离时，watch BE 的 api spec 文件变更解锁 FE task）
  externalDependencies: [
    { name: 'backend-api-spec', path: '../be/docs/design/api.md', watchFor: 'changes' },
  ],
}
```

> `coderOverrides`（两层混合：base role + app 覆盖）和 `reviewRules`（arch/security 评审时注入 app 专属检查清单）是本模板对内核三层配置的领域扩展。内核的三层配置（§5.3.1）提供合并机制，具体覆盖内容由模板填充。

### B. 小说写作 `novel-writing`

```
trigger → outline(story-architect) → [outline-approval:human]
→ [parallel_fork: chapters 1..N]
    → chapter-N(writer) → [chapter-review:human, loop until approved]
  [join] → final-edit(editor) → [final-approval:human]
```

### C. 视频制作 `video-production`

```
trigger → script(scriptwriter) → storyboard(director)
→ [storyboard-approval:human]
→ [parallel_fork: rough-cut, music-selection, voiceover]
  [join] → assembly-edit(editor) → [edit-review:human, loop]
→ color-grade(colorist) → export → publish
```

### D. 内容审核 `content-moderation`

```
trigger(webhook) → ai-screening(moderator)
→ [condition: confidence > 0.95]
  ↗ high confidence → auto-decision
  ↘ low confidence  → [human-review:human]
→ publish / reject / escalate
```

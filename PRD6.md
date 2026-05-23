# Myrmidon
## 通用自治工作流运行时 —— 平台化融合版
### Product Requirements Document — PRD6

版本：1.0｜状态：定稿｜取代关系：**本文档是唯一权威规格**，融合并取代 PRD4 / PRD5，并吸收 RFC_260523 的平台化需求。PRD1–PRD5 与 RFC 全部归档于 `RFC/` 目录，仅作历史设计输入。

---

## 0. 本文档的定位

PRD4 给出了完整可实施的**单机自治工作流运行时**（静态 DAG、Artifact 即真相、Reconciliation、有界自治、事件溯源）。PRD5 指出从工具走向平台需预留的抽象。RFC_260523 进一步要求：**第一版做跨平台桌面单机版，第二版做云平台化（云端调度 + 本地多执行器），且第二版不能整体重构。**

PRD6 的核心架构决策回应了这个诉求，并把它推到更干净的形态：

> **云端架构是唯一架构。桌面版只是把同一套云服务（控制面 API + web + runner）打包为本地嵌入式部署。一套 monorepo、一套代码，靠「部署 profile」区分。desktop = 「一个租户的云」。**

因此不存在「v1 架构 vs v2 架构」，只有一个架构与三种部署 profile（`desktop` / `self-hosted` / `cloud`）。所谓 v1/v2 = 「先发 desktop profile，再开 cloud profile」，是运维/打包差异，**零重写**。

PRD4 的执行核（六大原则、静态 DAG、Artifact 系统、Reconciliation、有界自治、事件溯源）几乎原样保留；被推翻的主要是**语言选型与运行时拓扑**（见 §17）。

---

## 1. 产品定位

### 1.1 是什么

Myrmidon 是一个**通用自治工作流运行时**。用户声明「期望的世界状态」（工作流定义），Myrmidon 持续协调 AI Agent 与人类协作者，将现实推进到该状态，并持续维护一致性。

> CI/CD 问：执行到第几步了？　Myrmidon 问：世界现在是我期望的样子吗？

### 1.2 通用性

软件开发只是内置模板之一，内核对「工作流是什么」无任何领域假设。覆盖软件开发、小说写作、视频制作、自媒体运营、内容审核、产品运营等。

### 1.3 目标用户与形态

- **个人 / 小团队**：用 `desktop` profile，本地自托管，全功能离线可用。
- **团队自建**：`self-hosted` profile，团队共用一台服务器。
- **SaaS 用户**：`cloud` profile，云端控制面 + 本地执行器，多租户。

三者同一套代码。

---

## 2. 核心设计原则

### 执行核原则（继承 PRD4，仍为硬约束）

- **P1 — 控制面是世界状态的唯一权威。** Agent 只能提议（produce artifacts）；无权宣布完成、无权直接改系统状态、无权绕过验证。
- **P2 — Artifact 是唯一真相。** 世界状态 = 磁盘/对象存储上的 artifact 集合 + 验证结果。Memory、Summary、Agent 的话都不是真相。
- **P3 — 验证决定完成，Human 是一等公民 Validator。** 三层验证：自动化（编译/测试/lint，高可信）、AI 辅助（参考）、人工（最终权威）。Human 决定覆盖一切自动结论。
- **P4 — 持续 Reconciliation。** 上游 artifact 变化 → 下游标 `stale`、相关节点暂停。**`stale` 只传播标记，绝不自动触发重执行。**
- **P5 — 执行器 Worker 是无状态瞬时认知单元。** 每次注入最小上下文，结束即销毁。（**仅约束执行器 Agent；数字人 Agent 是另一类，见 §6.2，允许持久记忆。**）
- **P6 — 有界自治，失败必须收敛。** 有界重试 → 耗尽后 `pause_for_human`（非 abort）；结构化反馈注入下次上下文；相似度检测防原地打转。

### 平台原则（PRD6 新增）

- **P8 — 一套代码，多部署 profile。** 任何功能不得硬依赖某一 profile 专有的服务；profile 差异只体现在「换实现」（StateStore/ArtifactStore/Auth 等接口的不同实现）。
- **P9 — 控制面与执行面分离，执行器永远在本地。** 控制面（API/引擎/调度）可部署在桌面进程或云端；执行器（runner）永远跑在用户本地机器。v1→v2 只是控制面搬家。
- **P10 — 多租户感知从第一天起。** 数据模型恒带租户/项目维度；隔离强度按 profile（desktop 单租户，cloud 强 RBAC）。

### P7 — 非目标与反模式（明确不做，硬约束）

| 反模式（禁止）| 为什么 | 正确做法 |
|--------------|--------|---------|
| **LLM 决定流程走向** | 不可控、不可复现、无法审计 | 工作流结构启动前静态定义（聊天/AI 只在**作者期**生成 JSON，运行期纯静态）|
| **Agent 自报"任务完成"** | Agent 的话不是真相 | 完成由 Validator 裁决，Artifact 是唯一真相 |
| **依赖长 session / 长 memory（执行器）** | 认知漂移、上下文腐化 | 执行器 Worker 无状态、最小上下文 |
| **stale 触发自动重执行** | 级联重跑、烧光预算 | stale 只传播标记，由调度/人工决策 |
| **无限重试直到成功** | 原地打转 | 有界重试 + 相似度检测 + 升级人工 |
| **可视化即真相**（n8n 模式）| 双向同步地狱 | **JSON 为唯一真相，画布是投影** |
| **内核出现领域词汇**（coder/端口/DOM）| 破坏通用定位 | 领域内容只进模板 |
| **业务代码直接碰 DB/FS/本地 spawn** | 锁死单机，无法平台化 | 一律走 StateStore / ArtifactStore / ExecutionBackend / Scheduler 抽象 |
| **功能硬依赖某 profile 专有服务** | 破坏一套代码 | 走接口抽象，按 profile 换实现 |

---

## 3. 架构总览

```
┌──────────────── CONTROL PLANE（唯一状态权威，网络化）────────────────┐
│  部署：desktop=桌面进程内嵌 / self-hosted=团队服务器 / cloud=云集群    │
│   • RuntimeKernel        StateStore（事件日志 + 投影）                  │
│   • WorkflowEngine       静态 DAG 调度 / condition / join / 状态机      │
│   • Scheduler            per-run 租约 + fencing token（第一天就生效）   │
│   • ReconciliationLoop / ValidatorBus                                   │
│   • ConversationHub      事件溯源会话（channels）                       │
│   • Digital-human Agents 长期成员（数字人）                             │
│   • API Server           gRPC / WebSocket + AuthProvider                │
└──────▲────────────────────────────────────▲───────────────────────────┘
       │ 网络协议（客户端/IM）                │ 网络协议（控制面 ↔ runner）
       │                                      │ localhost | 局域网 | 云
┌──────┴───────────┐            ┌─────────────┴──────────────────────────┐
│ Human 成员        │            │ Machine Runner（永远 LOCAL，1..N 跨机） │
│ 自带 IM(多channel)│            │  • ExecutionBackend  本地 spawn 执行器  │
│ 外部 IM(绑1channel)│           │  • 托管 执行器 Agent INSTANCE（瞬时）    │
└──────────────────┘            │  • ArtifactStore     本地 FS / S3        │
                                │  • worktree / 进程·端口清理              │
                                └──────────────────────────────────────────┘

DSL/SDK：TS npm 包（可选，产出 WorkflowDef JSON）   引擎只认 JSON
前端 UI：web(React) → Tauri/Electron 壳，走网络协议连控制面（瘦客户端）
```

**不变量：**
- 执行器永远在本地 runner（所有 profile）。控制面相对位置可变。
- 控制面 = 唯一状态权威（P1），但**网络化**，不是单进程；一切变更走网络协议 + token。
- 执行恒为静态 DAG（PRD4 不变）；聊天/可视化/AI 都是**作者期**封装，收敛到同一份 WorkflowDef JSON。

---

## 4. 语言与技术栈 ADR（取代 PRD4 §12.0）

**决策：引擎（控制面 + runner）+ CLI 用 Go；编排放弃 TS 代码 DSL，改为 JSON/YAML + 可视化 + AI 生成；前端 UI 为 web(JS/TS)。**

| 因素 | 判断 |
|------|------|
| 难点已变为分布式协调正确性 + 跨机部署 | Go 主场；Temporal/Argo/Cadence 同类选择 |
| 跨机 runner 部署 | Go 静态二进制，桌面壳可直接内嵌 |
| 并发（多 run、租约、fencing）| goroutine 模型稳健 |
| WorkflowDef 本就是 JSON | 引擎读 JSON，不必内嵌 TS 求值器；多语言/多运行时天然兼容 |
| 富可视化画布 + 聊天 UI | 浏览器即 JS，前端必为 web；作为网络协议上的瘦客户端 |

**编排作者面三条路（都直出 WorkflowDef JSON，JSON 即唯一真相）：**
1. JSON/YAML 直写 + JSON Schema 校验（编辑器 `$schema` 联想）
2. 可视化编辑器（拖拽 → 结构化 patch 回写 JSON）
3. AI 生成（聊天描述 → 产出 JSON → 人审 → 落库）

**契约源单一化：** WorkflowDef schema、网络协议类型，统一用 protobuf / JSON Schema 定义，**codegen 出 Go 结构体 + TS 类型**，两端类型安全。

**扩展逃生口：** `transform` / 自定义逻辑先用声明式（JSON Logic）；真需要可编程时，挂 **WASM（wazero）或 Lua（gopher-lua）沙箱插件**——比内嵌 JS 更干净、可沙箱、多语言。

> 放弃 TS 代码 DSL 的代价仅两条：作者期类型检查从编译期降到 schema 校验（够用）；`transform` 内联函数降级为声明式（反更合 P7 禁 eval）。且可逆——日后可加「只产 JSON 的 SDK」，引擎零依赖。

---

## 5. 实例 / 项目 / 工作空间 / 成员模型

### 5.1 层级

```
Account → Instance(Org) → Project → Workspace
```

- **Instance（组织/实例）**：账号下的隔离单元。desktop 下通常单实例；cloud 下多租户。
- **Project**：实例下的项目，指定一个 **Workspace**。
- **Workspace = 本地路径 或 S3 路径**。决定该项目 ArtifactStore 的后端实现：本地路径→本地 FS；`s3://`→S3。内核只调 `put/get/stat/exists`。

### 5.2 成员（人 + AI，统一成员表）

实例成员 = **Human 成员** ∪ **Digital-human Agent 成员**。`@mention` 目标只能是成员，**永远不是执行器 Agent**。

### 5.3 Machine Runner

- 实例可注册 **1..N 个 machine runner**（本机 / 局域网 / 远程）。每个 runner 向控制面注册（网络地址、状态、心跳）。
- desktop profile 默认内置 1 个本地 runner，可再加局域网 runner。
- runner 托管「执行器 Agent 实例」，并持有本地 ArtifactStore。

---

## 6. Agent 模型（两类，严格区分）

### 6.1 执行器 Agent（Executor）——「临时工」

- `spec → instance`：从 spec 创建，跑完一个工作流节点即销毁。**无状态**（P5）。跑在 runner 上，由 ExecutionBackend spawn 外部执行器 CLI。
- **不可被 @mention**。

#### 6.1.1 ExecutorAgentSpec —— 硬约束契约（核心）

每个执行器 Agent 由一份 **硬约束 spec** 定义；spec 可由人手写、模板提供、或 **AI 生成**，但**一经设定即由运行时强制执行**（代码层 + Constitution 层双重）。这是 PRD4「每个 Agent 节点有固定输入/执行/产出/验证」承诺的落地形态。

```typescript
interface ExecutorAgentSpec {
  id: string;
  role: string;                       // 角色名（领域含义由模板赋予，内核不预设）

  // —— 执行器绑定 ——
  executor: string;                   // 引用 executors（runtime × model，见 §15）
  tokenProfile: 'budget'|'balanced'|'quality';
  maxContextTokens: number;

  // —— 能力硬边界（代码层强制）——
  systemPrompt: string;               // 注入为 CLAUDE.md / 角色宪法
  allowedTools: string[];
  forbiddenActions: string[];         // 明确禁止（如 git push --force、DROP TABLE）
  allowedMCPTools: string[];          // MCP 工具白名单
  requiredSkills: string[];           // 必须注入的 Skill

  // —— 输入规范（in spec）——
  inputSpec: {
    consumes: { id: string; type: string; required: boolean }[];
    inputValidator?: ValidatorRef;    // 节点开始前校验 consumes 状态
  };

  // —— 输出规范（out spec）——
  outputSpec: {
    produces: { id: string; path: string; type: ArtifactType; required: boolean }[];
    outputValidator?: ValidatorRef;   // 节点完成后校验 produces
  };

  // —— 产物规范（artifact spec）——
  // 每种产物的领域格式约束 + 验证器路由（如 DOM Contract、API schema）
  artifactSpecs?: Record<string, ArtifactSpec>;

  // —— 验证规范（validator spec）——
  // 该节点产物适用的验证器集合及其层级（automated / ai_assisted / human）
  validatorSpecs?: ValidatorSpec[];

  // —— 门控与重试 ——
  humanApproval?: HumanApprovalSpec;
  retry?: RetrySpec;
  hooks?: { pre?: HookRef; post?: HookRef; onError?: HookRef };
}
```

> **AI 生成硬约束**：允许「描述角色 → AI 产出一份 ExecutorAgentSpec（含 in/out/artifact/validator spec）」，但产出物是**待人审的硬约束 JSON**，审批后落库即成为运行时强制的契约——AI 参与的是作者期，不是运行期决策（不破 P7）。

### 6.2 数字人 Agent（Digital-human）——长期成员

- **长期活跃**，作为实例成员与 Human 并列；有持久身份 + **持久 memory**（P5 不约束此类）。
- **可被 @mention**。`@mention 目标 = {human} ∪ {数字人}`。
- **动作策略（per-agent 配置）：**
  - `workflow-only`（默认推荐）：只能通过编排/触发工作流产生真实变更 → 全程过 validator → 保 P2/P3。
  - `direct`：可不开工作流直接动作（答疑、读、轻量操作、定时任务）。**显式 opt-in，且这些动作不享 artifact/验证保证**——刻意的取舍，用于 assistant/coordinator/relay 角色。
  - `both`：按交互自行决定。
- **协调链**：`human @assistant → @orchestrator → workflow`。数字人可 @ 另一数字人或触发工作流。
- **托管**：desktop 下数字人跑在控制面（桌面进程）；真活授权下放到 runner 的执行器去做。

```typescript
interface DigitalHumanAgentSpec {
  id: string;
  name: string;
  systemPrompt: string;
  memoryRef: string;                  // 持久 workspace memory 引用
  allowedMCPTools: string[];
  skills: string[];
  actionPolicy: 'workflow-only'|'direct'|'both';   // 默认 workflow-only
  authorizedWorkflows?: string[];     // 可触发/编排的工作流白名单
  channels: string[];                 // 默认参与的 channel
}
```

---

## 7. 工作流系统（继承 PRD4 §4）

### 7.1 WorkflowDef（JSON，唯一真相）

工作流 = `{ id, version, name, nodes[], edges[] }`，以 JSON 持久化。作者面三条路均收敛到此。运行期使用 `workflow_def_snapshot`（§16），定义变更不影响在飞 run。

### 7.2 节点类型

| type | 说明 | 关键字段 |
|------|------|---------|
| `agent` | 派发执行器 Agent，每次新 session | ExecutorAgentSpec（§6.1.1）|
| `human_approval` | 人工验证门控 | `timeoutMs`, `onTimeout`, `onReject` |
| `condition` | 按表达式选择出边 | `expr`（JSON Logic）|
| `parallel_fork` | 并行启动多分支（支持数据驱动 fan-out）| 出边隐式定义 |
| `join` | 等待所有并行分支（AND 语义）| 入边隐式定义 |
| `transform` | 声明式产物转换（JSON Logic；复杂逻辑升级为 agent/WASM 节点）| `transform.expr` |
| `trigger` | 入口（手动/定时/Webhook/Connector）| `trigger.source` |
| `loop` | 循环子图直到 condition | `loop.maxIterations` |
| `subworkflow` | 一个节点引用另一 WorkflowDef（PRD5 P5-2，预留）| `ref`, `inputMapping`, `outputMapping` |

> 调度器从一开始就支持节点是子图（不假设扁平）。

### 7.3 调度器 Formal Rules

**Node Readiness**：
```
ready(N) = 所有入边条件成立 AND 所有 consumes artifacts = valid
           AND N.status == 'pending' AND N 未被有界自治暂停
```

**Edge Condition（预定义枚举，禁 eval）**：`success` / `failed` / `approved` / `rejected` / `always`。`condition` 节点额外用沙箱化 **JSON Logic** `expr`，变量仅来自 `workflow_run.context_json`。

**Join 语义**：等所有上游并行分支到 terminal（completed|failed|skipped），AND 语义，无 OR。分支失败 → join 进 `failed`，触发其重试策略。

### 7.4 内核 vs 模板分离（硬约束）

| 归内核（通用）| 归模板（领域）|
|---|---|
| DAG 调度、状态机、condition/join | 具体角色（pm/writer/moderator）|
| Artifact 生命周期、stale 传播、Reconciliation | artifact 领域规范（DOM Contract / 分镜格式）|
| 七层上下文管理、Worker 生命周期 | 角色代码/写作/审核规约 |
| 有界自治、重试、相似度 | 领域专属验证器（Playwright/字幕对齐）|
| 三层配置机制（role→executor→binding）| 角色定义具体内容 |

新增领域 = 写一套新模板（角色 + 产物规范 + 规约），**不改内核一行**。

### 7.5 内置模板

`software-dev-agile`、`software-dev-waterfall`、`content-creation`、`novel-writing`、`video-production`、`content-moderation`。详见 §附录 与 `RFC/PRD4.md §16`。

### 7.6 三层配置（继承 PRD4 §5.3.1）

`agentRoles`（能力边界，模板填充）→ `executors`（runtime×model）→ `agents`（工作流绑定）。换模型不动角色、改角色不动工作流、调工作流不动模型。

---

## 8. 编排作者面

- **JSON/YAML 直写** + JSON Schema 校验。
- **可视化编辑器**：拖拽节点/连线/配参，产出结构化 patch 回写 WorkflowDef JSON。无法可视化表达的高级逻辑（数据驱动 fan-out、WASM/Lua 节点）显示为「代码节点」占位，不破坏回写。
- **AI 生成**：聊天描述 → 产出 WorkflowDef JSON / ExecutorAgentSpec → 人审 → 落库。

**铁律**：JSON 为唯一真相，画布为投影；作者期可动态生成，运行期纯静态（保可复现/可审计）。

---

## 9. 对话与 IM 协作

### 9.1 会话 = 事件溯源日志，Channel = 同步单元

- **Channel** = 会话单元 + 同步单元，每个 channel 有自己的事件溯源日志（按 `seq` 定序、`idempotency_key` 去重）。**控制面的这条日志是唯一真相。**
- **自带 IM（应用 web/桌面 UI）= 多 channel 客户端**（类 Slack 侧栏）。
- **外部 IM（微信/Telegram/Slack/...）= 绑定到指定的一个 channel**（单 channel 窗口，刻意简单）。
- **多个外部 IM 绑同一 channel → 内容完全同步一致**（皆为同一日志的投影）。
- 同步边界 = channel：扇出 = 在一个 channel 内投递给「所有绑到该 channel 的外部 IM + 正在看该 channel 的自带 IM 客户端」。无跨异构渠道 N-to-M 同步。
- v1：投递扇出做掉；逐渠道已读回执尽力而为，完整 read-receipt 推后。

**Channel 作用域（默认）**：每个 Project 一个 channel（项目 room），可再建。

### 9.2 @mention 路由（ConversationHub）

- `@human` → 跨该成员所属 channel 通知。
- `@数字人` → 派发给该 agent，按动作策略处理（回话 / 触发工作流 / 再 @ 其他成员）。
- @mention 是「自动建任务/工作流节点」的触发点。

### 9.3 工作流 ↔ 会话统一（关键）

- 数字人编排/触发 WorkflowDef → 真活落静态 DAG。
- 工作流的人工介入点（`human_approval`：架构决策、验收、合并）**作为消息回灌对应 channel** 并扇出通知。
- **聊天里点「通过/拒绝」= 调 review.approve/reject（网络协议 + token）。** PRD4 的 Review Queue 与聊天合一——人不管开哪个渠道都能直接 work。

### 9.4 线程粒度

`Instance → Project → Channel → Task → (0..N) workflow run`。Task 的人类消息 + 数字人消息 + 工作流生命周期事件交织在同一 channel 日志，过程可视化天然成立、可重放。

---

## 10. Artifact 系统（继承 PRD4 §6）

### 10.1 类型（6 core + 自定义）

`document` / `source_code` / `test_output` / `screenshot` / `build_artifact` / `external_state`。类型决定默认匹配的 Validator，其余行为一致。自定义类型匹配不到内置 Validator 时仅做文件存在性验证。

### 10.2 生命周期

```
pending → generating → needs_validation
   → valid / invalid / needs_review（含 force_valid 人工覆盖）
   → stale（上游变化）/ orphaned（关联 execution 消失）
```

### 10.3 粒度与 Stale 传播

细粒度（一个组件/接口/报告一个 artifact）。上游 checksum 变 → 批量标下游 `stale`（单事务，最大递归深度 10）。**不触发自动重执行。**

### 10.4 可从 Artifact 重建

删除所有 session/memory/对话后，系统仍能从「artifact 内容 + checksum」「事件日志」「WorkflowDef JSON」完整重建。

---

## 11. 验证系统（继承 PRD4 §7）

- **工程验证（全自动）**：tsc、单测/集成、ESLint/Biome、构建、SQL 迁移、API schema。
- **UI 多层**：Structural / Design Token / Responsive / Interaction（自动）+ **Semantic（仅人工）**。
- **治理验证**：ADR 合规、工具使用合规、worktree 访问边界。
- **Validator 优先级**：**Human 决定覆盖一切自动结论。** Human override 记 `validation_results`（`force_valid`、`overrides_validator_ids`）。Human 不可 force_valid 缺失/orphaned 的 artifact。`ARTIFACT_FORCE_VALIDATED` 写事件日志，不可删审计。
- **诚实性**：约 70% 自主完成，约 30% 需人工（UI 语义、架构决策、需求澄清）。目标是让这 30% 高效有据。

---

## 12. Reconciliation 引擎（继承 PRD4 §8）

- **两层对账**：事件驱动（写入即 checksum 比较）+ 周期扫描（默认 5 分钟全量预检）。
- **Storm 防护**：Debounce（500ms 合并）+ Batch 传播（单事务）+ 深度限制（10 层）。
- **检测**：artifact 缺失（→invalid）、内容变化（→stale）、Phantom Running（无心跳>阈值→failed）、孤立 worktree（清理归档）、审核超时（按 onTimeout）。
- **Checksum 分层**（下沉为 ArtifactStore 实现细节）：事件驱动 → mtime+size 预检 → SHA-256（>10MB 仅 mtime+size）；S3 后端用 ETag/版本号。

---

## 13. 有界自治模型（继承 PRD4 §9）

- **重试**：`maxAttempts` + `backoffSeconds[]`，耗尽 → `pause_for_human`。
- **三档升级**：`auto_retry`（<notifyThreshold）/ `notify_and_wait`（≥notifyThreshold，发 IM 不阻塞）/ `pause_for_human`（≥maxAttempts 或相似度触发）。
- **结构化反馈注入**：人类拒绝必填 `{category, location?, expected?, detail}`，与 artifact 绑定，注入下次执行上下文。
- **相似度检测（防原地打转）**：文件级 SHA-256 集合比对，变化文件比例 < 阈值（默认 0.08）→ `pause_for_human`。
- **调度层 Stuck 检测**：振荡（A→B→A→B，窗口 4）、依赖产物持续缺失（连续 2 次）→ `pause_for_human`。

---

## 14. Human Governance（继承 PRD4 §10）

人类是**校准者**：负责产品方向、ADR、UI 语义验收、高风险仲裁；不负责重复执行。`human_approval` 节点覆盖 PRD 确认、ADR、UI 验收、Sprint 交付、高风险仲裁。ADR 一经批准为不可变治理产物，后续节点不得绕过。

---

## 15. 可靠性模型与平台抽象

### 15.1 事件溯源（继承 PRD4 §11，时序模型改写）

- 所有行为记为 append-only JSONL 事件（`events` 表，`seq` 单调递增排序）。事件日志是唯一真相，投影表可重建。
- **Event Idempotency**：`idempotency_key = {run_id}:{type}:{entity}:{attempt}`，`INSERT OR IGNORE`。
- **快照 + 增量重放**：每节点完成写 snapshot；启动加载最新 snapshot + 重放后续事件。
- **崩溃恢复**：重启重建状态；`running` 节点查心跳（无心跳超阈值→failed→重试）。**冲突裁决：事件日志永远是 Source of Truth，投影表损坏则清空重建。**
- **World Reconstruction Test**：删 session+snapshot+投影表，仅留事件日志 + artifact，重启后状态须一致。**发布闸门，必跑。**

**时序模型（取代 PRD4 §11.1 单进程假设）：**

> **per-run 单写者 + fencing token，从第一天起生效。** 同一 run 的事件只由当前持有该 run 租约的控制面实例写；不同 run 可并行。集群并发度 = 并发 run 数。故障转移：持租约实例崩 → 租约超时 → 别的实例接管，从事件日志 replay。fencing token（单调递增）防脑裂——旧实例过期租约的写入被 StateStore 拒绝。

### 15.2 平台抽象（PRD5 P5-1，v1 全部动真格）

因 v1 即「网络化控制面 + 跨机 runner」，四抽象不是 no-op，而是真实现：

```typescript
interface StateStore {            // v1 SQLite / cloud Postgres
  appendEvent(e: Event): Promise<void>;
  readEvents(runId, since?): AsyncIterable<Event>;
  projection<T>(table, query): Promise<T[]>;
  transaction<T>(fn): Promise<T>;
}
interface ArtifactStore {         // v1 本地FS / S3
  put(id, content): Promise<Checksum>;
  get(id): Promise<Readable>;
  stat(id): Promise<{mtime; size; sha256?}>;
  exists(id): Promise<boolean>;
}
interface ExecutionBackend {      // 网络 spawn 到 runner
  spawn(opts): Promise<WorkerHandle>;
  heartbeat(handle): Promise<HeartbeatStatus>;
  kill(handle, signal): Promise<void>;
}
interface Scheduler {             // per-run 租约 + fencing
  claim(runId): Promise<Lease|null>;
  renew(lease): Promise<void>;
  release(lease): Promise<void>;  // Lease 含单调递增 fencingToken
}
```

| 抽象 | desktop | self-hosted | cloud |
|---|---|---|---|
| StateStore | SQLite | SQLite/Postgres | Postgres |
| ArtifactStore | 本地FS / S3 | 本地/NFS/S3 | S3 |
| ExecutionBackend | 本机 + 局域网 runner | 本地池 | 用户本地 runner |
| Scheduler | 单实例租约+fencing | 单实例 | 分布式租约（Postgres advisory lock / etcd）|

> DB 选型决策：**先 SQLite 一把梭**（desktop + 小规模 cloud），真到规模再加 Postgres 实现（接口隔离，换实现不改业务）。

### 15.3 长期稳定性保证

不应发生：世界状态漂移、幻觉完成、上下文腐化、worktree 泄漏、无限循环。

---

## 16. 数据模型

> 所有持久化结构带 `schema_version`；启动按 `PRAGMA user_version` 顺序执行迁移函数，每个迁移原子事务，零外部框架。**多租户列从第一天起存在**（desktop 单值，cloud 隔离）。

```sql
-- 平台层（PRD6 新增）
CREATE TABLE instances ( id TEXT PRIMARY KEY, account_id TEXT, name TEXT, created_at TEXT );
CREATE TABLE projects  ( id TEXT PRIMARY KEY, instance_id TEXT, name TEXT,
                         workspace_uri TEXT, created_at TEXT );      -- 本地路径 或 s3://
CREATE TABLE members   ( id TEXT PRIMARY KEY, instance_id TEXT,
                         kind TEXT,            -- 'human' | 'digital_human'
                         display_name TEXT, spec_json TEXT );        -- 数字人存 DigitalHumanAgentSpec
CREATE TABLE machine_runners ( id TEXT PRIMARY KEY, instance_id TEXT,
                         address TEXT, status TEXT, last_heartbeat_at TEXT );
CREATE TABLE channels  ( id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT );
CREATE TABLE channel_bindings ( id TEXT PRIMARY KEY, channel_id TEXT, member_id TEXT,
                         transport TEXT,       -- 'builtin'|'slack'|'wecom'|'telegram'|...
                         external_addr TEXT );
CREATE TABLE channel_messages ( seq INTEGER PRIMARY KEY AUTOINCREMENT,
                         id TEXT UNIQUE, channel_id TEXT, ts INTEGER,
                         author_member_id TEXT, author_kind TEXT,    -- human|digital_human|workflow
                         idempotency_key TEXT UNIQUE, payload_json TEXT );
CREATE TABLE agent_specs ( id TEXT PRIMARY KEY, instance_id TEXT,
                         kind TEXT,            -- 'executor' | 'digital_human'
                         spec_json TEXT );     -- ExecutorAgentSpec / DigitalHumanAgentSpec

-- 执行核（继承 PRD4 §12.3，加 instance_id/project_id 维度）
CREATE TABLE workflows ( id TEXT PRIMARY KEY, instance_id TEXT, project_id TEXT,
                         version TEXT, name TEXT, schema_version INTEGER DEFAULT 1,
                         def_json TEXT NOT NULL, created_at TEXT, updated_at TEXT );
CREATE TABLE workflow_runs ( id TEXT PRIMARY KEY, project_id TEXT, workflow_id TEXT,
                         workflow_version TEXT, workflow_def_snapshot TEXT NOT NULL,
                         status TEXT, started_at TEXT, completed_at TEXT,
                         context_json TEXT, cost_usd REAL DEFAULT 0, snapshot_path TEXT );
CREATE TABLE node_executions ( id TEXT PRIMARY KEY, run_id TEXT, node_id TEXT,
                         runner_id TEXT, status TEXT, attempt INTEGER DEFAULT 1, agent_id TEXT,
                         started_at TEXT, completed_at TEXT, last_heartbeat_at TEXT,
                         worktree_path TEXT, error TEXT, output_json TEXT,
                         cost_usd REAL DEFAULT 0, output_similarity REAL );
CREATE TABLE artifacts ( id TEXT PRIMARY KEY, project_id TEXT, run_id TEXT, node_id TEXT,
                         execution_id TEXT, file_path TEXT, artifact_type TEXT, status TEXT,
                         checksum TEXT, created_at TEXT, validated_at TEXT );
CREATE TABLE artifact_deps ( artifact_id TEXT, depends_on TEXT, PRIMARY KEY (artifact_id, depends_on) );
CREATE TABLE events ( seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, run_id TEXT,
                      ts INTEGER, type TEXT, idempotency_key TEXT UNIQUE,
                      schema_version INTEGER DEFAULT 1, payload_json TEXT );
CREATE INDEX idx_events_run_seq ON events(run_id, seq);
CREATE TABLE executor_procs ( id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,
                      pid INTEGER, proc_type TEXT, port INTEGER, started_at TEXT, killed_at TEXT );
CREATE TABLE validation_results ( id TEXT PRIMARY KEY, artifact_id TEXT, execution_id TEXT,
                      validator_id TEXT, validator_type TEXT, passed INTEGER,
                      evidence_json TEXT, reviewed_by TEXT, ts INTEGER );
CREATE TABLE feedback_log ( id TEXT PRIMARY KEY, artifact_id TEXT, execution_id TEXT,
                      reviewer TEXT, category TEXT, location TEXT, expected TEXT, detail TEXT, ts INTEGER );
```

---

## 17. 网络协议、安全与部署 profile

### 17.1 协议（取代 PRD4 §12.1/12.2）

- **控制面 ↔ runner、控制面 ↔ 客户端/IM**：gRPC / WebSocket（protobuf 契约，codegen Go+TS）。desktop 跑 localhost，cloud 跨网。
- **控制面 = 唯一写者**；CLI/客户端/runner/外部工具不得直接写 StateStore（只读查询可）。一切变更经协议。

### 17.2 安全

- **会话 Token**：状态变更命令需 `Authorization: Bearer <token>`；只读命令免 token。**执行器 Agent 环境不注入 token**（防自批 review）。
- **AuthProvider 抽象**：desktop = 本地 token / 近 no-op；cloud = SSO / RBAC。数据模型多租户感知，隔离强度按 profile。
- **密钥**：配置敏感字段用 `{ $env: 'VAR' }` 引用，不写值；init 自动建 `.myrmidon.env` 并入 `.gitignore`。
- **执行器隔离**：worktree 沙箱，最小权限环境变量；Constitution 层强制 forbiddenActions（禁访问 `.myrmidon/`、其他 worktree、token 文件、IPC 调用）。v1 不引入 OS 级沙箱。

### 17.3 部署 profile

| | `desktop` | `self-hosted` | `cloud` |
|---|---|---|---|
| 控制面+web+runner | 桌面壳内嵌，localhost | 团队服务器 | 云集群 |
| 租户 | 单租户 | 单/少租户 | 多租户 |
| Auth | 本地 token | 本地/简单 | SSO/RBAC |
| Runner | 内置 1 + 局域网 | 本地池 | 用户本地机 |
| 离线 | 全内嵌，自包含可离线 | 可离线 | 在线 |

**桌面壳职责**：监管内嵌 Go 进程（control-plane + runner 二进制）、端口、崩溃、升级；不硬依赖任何 cloud 专有服务（保离线）。

### monorepo 结构

```
/schema         protobuf/JSON Schema → codegen Go + TS（唯一契约源）
/control-plane  (Go) API/引擎/调度/reconciler/会话Hub/数字人托管
/runner         (Go) ExecutionBackend/ArtifactStore/执行器适配器
/cli            (Go) 静态二进制
/web            (TS/React) UI/可视化编辑器/聊天
/desktop        (Tauri/Electron) 内嵌 control-plane+runner 二进制 + 起 web
```

---

## 18. 多运行时执行器（继承 PRD4 §12.5）

```
ExecutorType = 'claude-code' | 'opencode' | 'kimi' | 'gemini-cli' | 'mock' | string
```

每个适配器：启动进程、注入上下文、监听心跳、读取输出，映射原生退出码到标准语义。**标准目录**（`.myrmidon/runs/{run_id}/{node_id}/{attempt}/{context,output,logs}`、`continue.md`、`exit_code`）、**心跳协议**（15s）、**退出语义**（0 完成 / 1 失败重试 / 2 上下文不足 pause / 3 主动放弃 pause）、**七层上下文管理** 均继承 PRD4 §5.5–5.8。Runtime 自动检测可用 runtime 并写 `meta` 表。

**span 回调（PRD5 P5-3 预留）**：适配器现在就吐 OpenTelemetry 风格 span（LLMCall/ToolCall），哪怕只写本地日志，避免日后改所有适配器。

---

## 19. 其他技术机制（继承 PRD4，详见 RFC/PRD4）

- **副作用声明**（§12.8）：节点输出 `sideEffects.json` 不空则执行前暂停确认（Terraform plan 风格）。
- **Checksum 策略**（§12.9）：见 §12 已述。
- **Run 版本隔离**（§12.10）：`workflow_def_snapshot` 保证在飞 run 不受定义变更影响。
- **非文件 artifact**（§12.11）：`external_state` 类型自动进 `needs_review`，人工确认。
- **测试基础设施**（§12.12）：Mock Executor（fixture）、Mock Reviewer（测试 IPC）、Fake Clock、World Reconstruction Test。
- **Runtime GC**（§12.13）：按保留策略归档/删除旧事件、orphan snapshot、dead validation；`myrmidon gc [--dry-run]`。

---

## 20. 商业模式（继承 PRD4 §13）

| 层级 | 价格 | 内容 |
|------|------|------|
| 个人版（开源）| 免费 | 完整 Runtime，本地自托管（desktop / self-hosted）|
| 团队版（SaaS）| $20–50/人/月 | cloud profile：云端控制面、团队共享、Web Review、备份 |
| 企业版 | 按需 | SSO、审计、RBAC、私有部署 |

核心 AI 执行费用由用户自己的 API key 承担。后续可加模板/连接器市场分成（PRD5 P5-7）。

---

## 21. 发布路线图（里程碑）

「全功能」很大，故 desktop profile 按可运行闸门增量交付：

| 里程碑 | 内容 | 可运行闸门 |
|---|---|---|
| **M0 骨架** | monorepo、`/schema` codegen、Go 控制面+runner 骨架、网络协议、SQLite StateStore、本地 ArtifactStore、事件日志、CLI、1 runner 注册 | runner 连上控制面，事件落库 |
| **M1 静态执行核（=PRD4 MVP，新底座）** | WorkflowDef 加载/校验、DAG 引擎、节点类型、执行器经 runner spawn（先 mock）、artifact 生命周期+验证器、Reconciliation、有界自治 | `software-dev-agile` 用 mock 端到端跑通 |
| **M2 成员+会话+IM** | channels（事件溯源）、自带 web IM、@mention 路由、数字人（先 workflow-only）、审批回灌聊天、首个外部 IM 连接器 | 聊天里 @数字人触发工作流并完成一次人工审批/合并 |
| **M3 作者面** | JSON/YAML 校验 → 可视化编辑器 → AI 生成，均回写 WorkflowDef JSON | 三条路都能产出可运行工作流 |
| **M4 多 runner + 真执行器** | 跨机 runner、Scheduler 租约+fencing 被并发压测、接入 claude-code | 多机并发跑多 run，故障转移不脑裂 |
| **M5 cloud profile** | Postgres、S3、多租户 Auth/RBAC、控制面上云 | 同代码以 cloud profile 起，桌面客户端改 endpoint 连云 |

---

## 22. 成功指标（继承 PRD4 §15）

自主完成率、Reconciliation 漂移检测准确率、崩溃恢复成功率、循环收敛速度、原地打转触发率、人工介入频率/耗时、孤立 worktree 数、幻觉完成率、平均每 run 费用、超 budget_cap 频率。

---

## 23. 附录：内置模板简述（继承 PRD4 §16）

### A. 软件开发（敏捷）`software-dev-agile`
```
trigger → requirements(pm) → prd(pm) → [prd-approval:human]
→ design(arch) → [arch-approval:human]
→ sprint-plan(pm) → [parallel_fork] → coding-1..N(coder)
[join] → qa(qa) → [condition] ↗ passed → [sprint-delivery:human]
                              ↘ failed → bug-fix(coder) → qa [loop, max 5]
```
角色库（pm/arch/coder(FE/BE/Mobile)/qa/security/ui/devops）、**DOM Contract**（ui/coder(FE)/qa 三方共同合约）、领域配置（端口分配 `basePort+taskId%1000`、monorepo、跨仓依赖）均为模板内容，**不进内核**。详见 `RFC/PRD4.md §16.A`。

### B–D. `novel-writing` / `video-production` / `content-moderation`
见 `RFC/PRD4.md §16.B–D`。

---

## 24. 与既往文档关系

| 文档 | 位置 | 状态 |
|------|------|------|
| PRD6（本文）| 根目录 | **唯一权威规格** |
| PRD4 | `RFC/PRD4.md` | 历史输入：执行核被 PRD6 §7–15 继承 |
| PRD5 | `RFC/PRD5.md` | 历史输入：平台抽象被 PRD6 §15.2 提级为 v1 实现 |
| RFC_260523 | `RFC/RFC_260523.md` | 历史输入：平台需求被 PRD6 §3–9 吸收 |
| PRD1/2/3、partyA | `RFC/` | 更早历史输入 |

### PRD6 相对 PRD4 的推翻清单

| PRD4 原文 | PRD6 改为 |
|---|---|
| §12.0 语言 = TS | **Go 引擎**；无 TS 代码 DSL；JSON/YAML+可视化+AI；WASM/Lua 逃生口 |
| §12.1 单进程 Kernel + Unix socket | **网络化控制面（gRPC/ws）+ 跨机 runner**；云优先 + desktop 嵌入式 profile |
| §12.2 IPC = Unix socket | 网络协议（token 认证泛化）|
| §11.1 单进程天然有序，不需分布式时钟 | **per-run 单写者 + fencing，第一天生效** |
| §1.5 v1 不做多租户 | **数据模型第一天多租户感知**；RBAC/SSO 强制按 profile 推到 cloud |
| MVP 排除 TUI/通知/托盘 | desktop profile 核心含 web UI + IM + 可视化编辑器 |
| PRD5 P5-8 可视化、P5-5 连接器列 v2/v3 | **提前**：可视化编辑器为核心；至少一个 IM 连接器为核心 |

**P7 反模式复核**：聊天是上层作者面、执行恒静态 → 「LLM 决定流程」未破；数字人默认 `workflow-only` → 「agent 自报完成」由 validator 裁决；其余原样保留。

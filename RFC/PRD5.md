# Myrmidon
## 通用自治工作流运行时 —— 平台化增量
### Product Requirements Document — PRD5

版本：1.0｜状态：定稿｜取代关系：本文档**不取代 PRD4**，是 PRD4 的平台化增量层

---

## 0. 本文档的定位

PRD4 已经是一个完整、可实施的**单机自治工作流运行时**（内核 + 模板分离、Artifact 真相、Reconciliation、有界自治、事件溯源）。

PRD5 不重写 PRD4，而是回答一个不同的问题：

> **当 Myrmidon 从"一个人/小团队的本地工具"长成"平台"时，今天的架构会在哪里崩？哪些抽象现在不预留，未来重构会很痛？**

本文档从三个外部视角审视 PRD4，提炼出 **9 个优化点**，并标注每个点的**紧迫度**（现在就要预留 / v2 / v3）。

PRD4 的所有设计继续有效。PRD5 只增不改——凡与 PRD4 冲突处，以"渐进迁移"方式处理，不破坏 v1。

---

## 1. 审视方法：三个镜子

| 镜子 | 代表 | 照出 PRD4 的什么 |
|------|------|----------------|
| **工作流引擎巨头** | Temporal, Airflow, Dagster, Prefect, AWS Step Functions, n8n, GitHub Actions, LangGraph/LangSmith | 成熟引擎有、PRD4 没有的能力（组合、批次、tracing、复用）|
| **各行各业** | 金融/医疗（合规）、制造/物流（长周期）、内容/电商（批量）、跨组织协作 | PRD4 的"通用"是否真通用，还是隐性偏软件开发 |
| **平台化未来** | 多租户 SaaS、生态市场、低代码 | 从工具到平台的架构断点和护城河 |

---

## 2. 九个优化点（按紧迫度排序）

### 🔴 P5-1　平台化演进路径与预留抽象（最紧迫）

**镜子**：Temporal（控制面/执行面分离）、Dagster（存储可插拔）

**PRD4 缺口**：
PRD4 §12.1 把架构钉死在"单进程 RuntimeKernel + SQLite 单写者 + 本地 spawn 进程"。§11.1 甚至明说"v1 单进程，事件天然有序，不需要分布式时钟"。这对 v1 是对的，但 PRD4 **没有给出从单机到平台的演进路径，也没有预留迁移所需的接口**。一旦走向云端多租户，SQLite→Postgres、单进程→分布式调度、本地 spawn→远程 machine 池，几乎是重写。

**PRD5 方案**：现在就把**四个接口**抽象出来（v1 只实现本地版，但接口先定），让未来迁移是"换实现"而非"重写"：

```typescript
// 1. 状态存储抽象（v1: SQLite；v3: Postgres）——管事件日志和投影
interface StateStore {
  appendEvent(e: Event): Promise<void>;       // append-only，唯一真相
  readEvents(runId: string, since?: number): AsyncIterable<Event>;
  projection<T>(table: string, query: Query): Promise<T[]>;  // 读模型
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// 2. 产物存储抽象（v1: 本地 FS；v3: S3/对象存储）——管 artifact 内容
//    ★ 分布式执行的硬依赖：worker 在远程 machine 写产物，控制面靠它对账
interface ArtifactStore {
  put(id: string, content: Buffer | Readable): Promise<Checksum>;
  get(id: string): Promise<Readable>;
  stat(id: string): Promise<{ mtime: number; size: number; sha256?: string }>;
  exists(id: string): Promise<boolean>;
  // Reconciliation §8 的 checksum 扫描走 stat()，不再直接碰本地 FS
}

// 3. 执行面抽象（v1: 本地 spawn；v2: 远程 machine RPC；v3: K8s Job）
interface ExecutionBackend {
  spawn(opts: SpawnOpts): Promise<WorkerHandle>;   // 本地进程 / 远程 machine / 容器
  heartbeat(handle: WorkerHandle): Promise<HeartbeatStatus>;
  kill(handle: WorkerHandle, signal: Signal): Promise<void>;
  // worker 完成后产物回传到 ArtifactStore（或直接写共享对象存储）
}

// 4. 调度面抽象（v1: 单进程 tick；v3: 多实例分布式租约）
//    ★ 语义：per-run 单写者，不是全局单写者
interface Scheduler {
  claim(runId: string): Promise<Lease | null>;    // v1 永远成功；v3 竞争租约
  renew(lease: Lease): Promise<void>;              // 持租约期间周期续约
  release(lease: Lease): Promise<void>;
  // Lease 含 fencingToken（单调递增）：StateStore 写入校验 token，
  // 旧实例租约过期后的写入被拒，防脑裂
}
```

**分布式下的两个关键语义（容易做错，必须写明）：**

1. **产物必须可寻址，不能假设在本地 FS。**
   PRD4 §6 的 Artifact = 本地文件 + checksum，§8 Reconciliation 扫本地 FS。但 machine runtime 下，worker 在远程 machine 的本地磁盘写产物，控制面看不到。所以**所有产物读写、checksum 对账一律走 `ArtifactStore`**——本地 FS 只是 v1 的一种实现，v3 换成 S3，语义不变。
   - *与 PRD4 §12.9 的对接*：§12.9 的分层 checksum 策略（mtime/size 快速预检 → SHA-256 全量）下沉为 **ArtifactStore 实现细节**。本地 FS 实现用 mtime/size；S3 等无 mtime 语义的后端用 ETag/版本号或直接比 SHA-256。内核只调 `stat()`，不关心后端怎么算。

2. **per-run 单写者，而非全局单写者。**
   PRD4 §11.1 的"单进程事件天然有序"在集群下若坚持全局单写者，等于没集群。正确模型：**同一个 run 的事件只由当前持有该 run 租约的实例写**；不同 run 由不同实例并行推进。
   - 每个 run 内事件仍严格有序（满足 §11.1 时序保证）
   - 集群并发度 = 并发 run 数（真集群）
   - 故障转移：持租约实例崩 → 租约超时 → 别的实例接管，从事件日志 replay 恢复（PRD4 §11.3 的崩溃恢复，现在跨实例生效）
   - fencing token 防脑裂：旧实例自以为持租约时的写入被 StateStore 拒绝

**演进三阶段（明确写进路线图）：**

| 阶段 | 控制面 | StateStore | ArtifactStore | ExecutionBackend | Scheduler |
|------|--------|-----------|---------------|------------------|-----------|
| **v1 单机**（PRD4）| 单进程 | SQLite | 本地 FS | 本地 spawn | claim 永远成功 |
| **v2 团队共享** | 单服务器 | SQLite/Postgres | 本地 FS / NFS | 本地 + 远程 machine 池 | per-run 单写者（单实例）|
| **v3 平台** | K8s 多实例 | Postgres + 对象存储 | S3/对象存储 | K8s Job / 裸金属池 | 分布式租约 + fencing（Postgres advisory lock / etcd）|

> *关键洞察：PRD4 的"事件日志是唯一真相、SQLite 表是投影"（§11.3）已经是 event-sourcing，天然适配 StateStore 抽象——v3 把投影换 Postgres、事件日志换 Kafka/对象存储，语义不变。这是 PRD4 做对的地基。PRD5 只是把它和另外三个面（产物、执行、调度）一起显式化。*
>
> *git worktree 是本地概念，分布式下的处理（远程 repo 副本 / 共享）偏软件开发模板，归模板层，不污染内核。*

**紧迫度**：🔴 **现在就要**。StateStore 和 ArtifactStore 尤其——v1 编码时若让业务代码直接 `db.prepare(...)` 或 `fs.readFile(...)`，三个月后这些调用散落全代码库，迁移即重写。Scheduler 的 per-run 单写者语义即使 v1 是 no-op，接口和 fencing token 字段也要先在。

---

### 🔴 P5-2　子工作流与工作流组合

**镜子**：GitHub Actions（reusable workflows）、Airflow（SubDAG/TaskGroup）、Temporal（child workflows）

**PRD4 缺口**：
PRD4 的 WorkflowDef 是**扁平的节点 + 边**。没有"一个节点本身是另一个工作流"的概念。后果：
- 复杂工作流（软件开发完整流程有几十个节点）无法分层，DSL 变成一大坨
- 公共子流程（如"代码评审循环""人工审批+通知"）无法复用，每个模板重复写
- 无法独立测试/版本化一个子流程

**PRD5 方案**：新增 `subworkflow` 节点类型：

```typescript
{
  id: 'review-cycle',
  type: 'subworkflow',
  ref: 'common/human-review-loop',   // 引用另一个 WorkflowDef
  version: '^1.0.0',
  inputMapping: { artifact: 'prd-doc' },     // 父→子产物映射
  outputMapping: { approved: 'prd-approved' }, // 子→父产物映射
}
```

子工作流有独立的 run 上下文，但其事件流挂在父 run 下（trace 可下钻）。stale 传播跨越父子边界。

> 这同时让"内置模板"可以由更小的"可复用子流程库"组合而成——`software-dev-agile` 里的"评审循环"和 `novel-writing` 里的"章节审阅"可以共用同一个 `human-review-loop` 子工作流。

**紧迫度**：🔴 **v1 后期或 v2 早期**。模板一旦变复杂（软件开发模板已经几十个节点）就立刻需要，越晚加迁移成本越高（扁平模型的假设会渗透进调度器）。

---

### 🔴 P5-3　细粒度可观测性 / Tracing

**镜子**：LangSmith、OpenTelemetry、Datadog

**PRD4 缺口**：
PRD4 §11 有 append-only 事件日志，§3.2 有 `myrmidon log/inspect/replay`，但粒度停在**节点级**（NODE_STARTED / ARTIFACT_PRODUCED）。缺**节点内部的 LLM 调用级 trace**：每次 LLM 请求的 token 数、延迟、工具调用、中间推理、重试。

后果：
- 成本优化无依据（§13 商业模式靠用户自己的 API key，但用户看不到钱花在哪个节点的哪次调用）
- 调试 Agent 行为只能看最终产物，看不到"它为什么这么做"
- 平台化后无法给团队提供"workflow 健康仪表盘"

**PRD5 方案**：在事件日志下增加 **span 层**（OpenTelemetry 兼容）：

```
WorkflowRun (trace)
 └─ NodeExecution (span)
     └─ LLMCall (span)  ← token_in/out, latency_ms, model, cost_usd, tool_calls
         └─ ToolCall (span)  ← tool_name, duration, result_size
```

- Executor 适配器负责把各 runtime 的原生输出映射为 span（claude-code 的 stream-json → span）
- span 写入事件日志（复用 §11 基础设施），可导出 OTLP 给 Datadog/Grafana
- `myrmidon trace <run-id>` 输出火焰图式的 span 树
- TUI 新增成本/延迟热点视图（哪个节点最烧钱、最慢）

**紧迫度**：🔴 **v2**。MVP 可以只有节点级日志，但平台化和成本治理离不开 span 级 tracing。Executor 适配器接口现在就该预留 span 回调，否则 v2 要改所有适配器。

---

### 🟡 P5-4　Partition / 批次执行

**镜子**：Dagster（partitioned assets）、Airflow（backfill）

**PRD4 缺口**：
PRD4 是**单次 run** 模型——一个 workflow 跑一次产出一组 artifact。但很多行业的工作流是**周期性批量**的：
- 内容审核：每天审一批内容（每条内容是一个 partition）
- 电商运营：每个商品类目跑一遍上架流程
- 自媒体：每个选题独立跑内容创作流水线

PRD4 只能为每批手动开 N 个 run，无法统一管理、无法 backfill（补跑历史某天）、无法看"按 partition 的完成矩阵"。

**PRD5 方案**：workflow 可声明 `partitionKey`：

```typescript
defineWorkflow({
  id: 'content-moderation',
  partition: {
    by: 'daily',                    // 'daily' | 'static-list' | 'dynamic'
    keyExpr: { var: 'context.date' },
  },
  // ...
})
```

- 每个 partition 是一个独立 run（隔离的 artifact、状态），但共享 workflow 定义
- `myrmidon run --partition 2026-05-22` 跑指定批次；`myrmidon backfill --from X --to Y` 补跑
- TUI 新增 partition 矩阵视图（行=partition，列=节点，格子=状态）
- Artifact 的 stale 传播限制在 partition 内（跨 partition 默认隔离）

**紧迫度**：🟡 **v2**。创意/审核/电商模板需要，软件开发模板不需要。可作为模板能力开关。

---

### 🟡 P5-5　触发器与连接器生态

**镜子**：n8n、Zapier（数百个 integration）

**PRD4 缺口**：
PRD4 §4.2 的 `trigger` 节点只有 manual/timer/webhook 三种**入口**，§12.8 的副作用声明只覆盖**出口**。缺一个**外部系统集成的统一抽象**——平台化和"各行各业通用"的关键。n8n 的护城河就是连接器生态。

PRD4 现在每接一个外部系统（GitHub issue 触发、Slack 消息触发、新文件落盘触发、数据库变更触发）都要写死。

**PRD5 方案**：定义 **Connector 抽象**（trigger 和 action 双向）：

```typescript
interface Connector {
  id: string;                       // 'github' | 'slack' | 's3' | ...
  triggers?: TriggerSource[];       // 该连接器能产生的事件（issue opened, message received）
  actions?: ConnectorAction[];      // 该连接器能执行的动作（create PR, send message）
  auth: AuthSpec;                   // OAuth / token / webhook secret
}

// workflow 中使用
{ id: 'on-issue', type: 'trigger',
  source: { connector: 'github', event: 'issue.labeled', filter: { label: 'ai-task' } } }
```

- 连接器是**插件**，不进内核——内核只认 `TriggerSource` 和 `ConnectorAction` 接口
- 内置连接器：webhook / timer / filesystem / git。其余（GitHub/Slack/Notion/...）社区贡献
- 副作用声明（§12.8）统一为"通过 connector action 执行"，确认机制不变

**紧迫度**：🟡 **v2**。但接口现在定，避免每个集成各写各的。

---

### 🟡 P5-6　智能模型路由 / 动态 Executor 选择

**镜子**：OpenRouter、Martian、各家 LLM gateway

**PRD4 缺口**：
PRD4 §5.3.1 三层配置里，节点的 `executor`（runtime×model）是**静态指定**的。但成本治理（§13 靠用户 API key、§12.4 有 budget_cap）的最大杠杆是**让简单任务用便宜模型**。PRD4 现在要么全程 opus（贵），要么手动给每个节点选模型（繁琐且静态）。

**PRD5 方案**：executor 支持**路由策略**：

```typescript
executors: {
  'auto': {
    strategy: 'cost-aware',         // 'fixed' | 'cost-aware' | 'escalating'
    candidates: ['haiku', 'sonnet', 'opus'],
    rules: {
      escalateOn: 'validation_failed',  // 失败后自动升级到更强模型重试
      complexityHint: 'node.contextEstimate',  // 按任务复杂度预选
    }
  }
}
```

- `escalating` 策略：先用便宜模型，失败重试时自动升级（和 §9 有界自治结合——重试不只是"再试一次"，而是"换更强的脑子试"）
- 路由决策记入 span（P5-3），可复盘"自动路由省了多少钱、误判了几次"

**紧迫度**：🟡 **v2**。降本是平台卖点，但 v1 静态指定够用。

---

### 🟢 P5-7　模板 / Skill / 连接器市场（Marketplace）

**镜子**：n8n template library、GitHub Marketplace、Zapier app directory

**PRD4 缺口**：
PRD4 有"内置模板"概念（§4.6），但模板是**内置的、封闭的**。没有分发、版本、社区贡献机制。平台化的护城河往往是生态——别人贡献模板/角色/连接器，网络效应。

**PRD5 方案**：
- 模板、角色库、skill、连接器统一为**可发布单元**，有 `id@version`、依赖声明、签名
- `myrmidon registry search/install/publish <unit>`
- 官方 registry + 私有 registry（团队内部）
- 模板可声明"基于哪个模板 fork"，形成衍生关系
- 商业模式（§13）增加一层：**认证模板/连接器市场分成**

**紧迫度**：🟢 **v3**。生态是平台成熟期的事，但 P5-1（StateStore）、P5-5（Connector 接口）现在预留，市场才有可发布的"单元"。

---

### 🟢 P5-8　DSL ↔ 可视化双向同步

**镜子**：n8n（可视化优先）、Retool、Temporal（代码优先，可视化只读）

**PRD4 缺口**：
PRD4 §14 把画布编辑器列为远期（Sub-Desktop），定位是"WorkflowDef 的可视化编辑器"。但没解决 n8n 这类工具的**核心难题：代码和可视化的双向同步**——可视化拖出来的改动如何回写 DSL，DSL 手改后画布如何更新，且不丢注释/逻辑分支。

**PRD5 方案**：
- 确立 **DSL 为唯一真相，画布为投影 + 编辑器**（学 Temporal，不学 n8n 的"可视化即真相"）
- 画布编辑产出 **WorkflowDef JSON 的结构化 patch**，回写时只改对应 DSL 节点，保留手写部分
- 无法可视化表达的高级逻辑（动态 condition、自定义 executor）在画布上显示为"代码节点"占位，不破坏

**紧迫度**：🟢 **v3**。但"DSL 为真相"的原则要现在定，否则画布做出来又走 n8n 的老路。

---

### 🟢 P5-9　合规框架（强合规行业）

**镜子**：金融/医疗/法律行业、GDPR、SOC2

**PRD4 缺口**：
PRD4 §11.1 的核心是 **append-only event log**（不可删除审计）。但这与 **GDPR 删除权 / 数据保留上限**直接矛盾——用户要求删除其数据时，append-only 日志怎么办？另外缺 PII 脱敏、数据驻留（地域）、访问审计。

**PRD5 方案**：
- **Crypto-shredding**：敏感字段加密存储，"删除"= 销毁密钥（日志结构不变，内容不可解）。解决 append-only vs 删除权的矛盾
- PII 标记 + 自动脱敏（artifact metadata 声明敏感字段）
- 数据驻留：StateStore（P5-1）按租户配置存储区域
- 访问审计：谁在何时 review/approve 了什么（PRD4 已有 force_valid 审计，扩展到读操作）

**紧迫度**：🟢 **v3（企业版）**。PRD4 §1.5 明确 v1 不做企业级，正确。但 **crypto-shredding 的字段加密要在 StateStore 接口（P5-1）设计时预留**，否则事后加密改造极痛。

---

## 3. 优化点 × 紧迫度 × 影响矩阵

| # | 优化点 | 紧迫度 | 现在必须预留的接口 | 完整实现 |
|---|--------|--------|------------------|---------|
| P5-1 | 平台化演进抽象 | 🔴 现在 | StateStore / ArtifactStore / ExecutionBackend / Scheduler | v2-v3 渐进 |
| P5-2 | 子工作流组合 | 🔴 v1 后期 | `subworkflow` 节点类型 | v2 |
| P5-3 | 细粒度 Tracing | 🔴 v2 | Executor 适配器 span 回调 | v2 |
| P5-4 | Partition 批次 | 🟡 v2 | workflow `partition` 字段 | v2 |
| P5-5 | 连接器生态 | 🟡 v2 | Connector 接口 | v2-v3 |
| P5-6 | 智能模型路由 | 🟡 v2 | executor `strategy` 字段 | v2 |
| P5-7 | 市场 Marketplace | 🟢 v3 | 可发布单元的 id@version | v3 |
| P5-8 | DSL↔可视化同步 | 🟢 v3 | "DSL 为真相"原则 | v3 |
| P5-9 | 合规框架 | 🟢 v3 | StateStore 字段级加密 | v3 |

---

## 4. 最重要的结论

**PRD4 不需要为了平台化而现在大改。** 它的 event-sourcing 地基（事件日志=真相，SQLite=投影）天然适配未来的分布式存储——这一点 PRD4 已经做对了。

**但有五个抽象必须在 v1 编码时就定下来**（只实现本地版，接口先定），否则未来迁移=重写：

1. **StateStore**（P5-1）—— 不要让业务代码直接 `db.prepare(...)`，全部走 StateStore
2. **ArtifactStore**（P5-1）—— 不要直接 `fs.readFile/writeFile` 产物，全部走 ArtifactStore；分布式执行的硬依赖
3. **ExecutionBackend**（P5-1）—— 本地 spawn 藏在接口后，未来换远程 machine / 容器
4. **Executor span 回调**（P5-3）—— 适配器现在就吐 span，哪怕只写本地日志
5. **`subworkflow` 节点类型**（P5-2）—— 调度器从一开始就支持节点是子图，别假设扁平

外加一条**语义约定**（不是接口，但同样现在就要定）：**事件写入是 per-run 单写者**（Scheduler 租约 + fencing token），不是全局单写者——这是集群化控制面的并发前提。

这些是"现在花一天、未来省三个月"的投资。其余五点（partition / 连接器 / 路由 / 市场 / 合规）都是 v2-v3 的功能增量，到时候按需做，架构上不会被卡住。

---

## 5. 与 PRD4 的关系

| 方面 | PRD4 | PRD5 |
|------|------|------|
| 定位 | 单机自治工作流运行时（完整可实施）| 工具→平台的演进增量 |
| 是否取代 PRD4 | — | 否，纯增量 |
| v1 MVP 影响 | 定义 MVP | 只要求 v1 预留 5 个抽象，不增 MVP 功能 |
| 主要受众 | 实施团队 | 架构决策者、长期路线规划 |

**建议**：PRD4 标 `定稿`，作为 v1 实施基准。PRD5 作为**架构守则**——v1 编码时遵守"5 个抽象必须定下来 + per-run 单写者语义"，功能增量按 v2/v3 路线推进。

# Myrmidon AI Agent Orchestrator — 产品需求文档（PRD）

> ⚠️ **已归档 — 被 PRD4 取代**。本文档不再作为实施依据；实施请看 `PRD4.md`（v1 基准）+ `PRD5.md`（平台化架构守则）。保留原位仅供 PRD4/PRD5 中"PRD1 §X"引用溯源。

> 版本：0.1.0-draft｜状态：已归档｜技术栈：Node.js / TypeScript

---

## 目录

1. [产品概述与核心概念](#1-产品概述与核心概念)
2. [CLI 命令设计](#2-cli-命令设计)
3. [TUI 界面设计](#3-tui-界面设计)
4. [Agent 角色与职责规范](#4-agent-角色与职责规范)
5. [协作工作流（全阶段）](#5-协作工作流全阶段)
6. [文档体系规范](#6-文档体系规范)
7. [Validator / Checker 逻辑设计](#7-validator--checker-逻辑设计)
8. [Worktree 管理脚本与 Git Flow](#8-worktree-管理脚本与-git-flow)
9. [配置规范](#9-配置规范)
   - 9.1 myrmidon.config.ts
   - 9.2 通知渠道配置
   - 9.3 Agent 宪法模板
   - 9.4 Skill 与 MCP 配置规范
10. [运行时规范](#10-运行时规范)
    - 10.6 定时器与事件调度系统
11. [发布路线图](#11-发布路线图)

---

## 1. 产品概述与核心概念

### 1.1 产品定位

**Myrmidon** 是一个 CLI / TUI 工具，充当"AI 软件开发外包公司"的运营中枢。它扮演**乙方（承包商）**的角色：对外与甲方（客户）沟通需求，对内协调多个专业 AI Agent 完成完整的软件交付流程，最终将项目成果提交甲方验收。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **编排非 LLM 驱动** | 工作流状态机由 orchestrator 代码固化，不由 LLM 决策流程走向，避免不可控性 |
| **节点输入/输出规范化** | 每个 Agent 节点有明确的输入格式、执行范围、禁止行为、输出产物和完成报告格式 |
| **SQLite 即状态，Markdown 即投影** | 运行时状态存储于 SQLite（WAL 模式，支持并发安全读写）；Markdown 文件是 SQLite 的"渲染投影"，用于 git 历史和人工 review，不驱动状态机。恢复时从 SQLite 重建，Markdown 仅作辅助 |
| **Task = 一个上下文窗口（铁律）** | 每个 Task 必须能在一个 Agent 上下文窗口内完成。arch 拆任务时必须满足此约束；orchestrator 在分配前做 token 估算预校验 |
| **Fresh Session Per Task（每任务新会话）** | 每个 Task 启动全新 Agent session。Dispatch prompt 由 orchestrator 精确构建（含任务计划、依赖摘要、决策记录），Agent 从干净窗口开始，不受历史积累污染 |
| **Tool Policy 代码层强制** | 每个 Agent 类型的工具权限在 orchestrator 代码层硬编码，不依赖 Agent 自律。规划类 Agent 不得执行 shell 命令；执行类 Agent 不得越权操作其他 worktree |
| **Agent 优先使用 Skill** | 每个 Agent 应优先调用配置的 Skill（如 frontend-design、webapp-testing），减少 LLM 自由发挥 |
| **宪法约束 Agent** | 通过 `CLAUDE.md` 和 `.claude/rules/` 为 Agent 设置硬性约束边界 |

### 1.3 角色定义

| 角色 | 类型 | 说明 |
|------|------|------|
| **甲方（Client）** | 人类用户 | 提出需求、审批交付物、做关键决策 |
| **乙方（Orchestrator）** | Myrmidon CLI | 甲方界面入口、内部工作流引擎 |
| **pm** | LLM Agent | 产品经理，负责需求整理、原型、PRD、Epics/Sprints 规划 |
| **arch** | LLM Agent | 架构师，技术评审、详细设计、任务拆分 |
| **coder(n)** | LLM Agent | 开发者（支持多个），SQL 设计、API 设计、编码实现 |
| **qa** | LLM Agent | 测试工程师，生成测试用例、执行测试、提交 issue |
| **security** | LLM Agent | 安全审查，识别安全风险 |
| **ui** | LLM Agent | UI/UX 设计师，生成设计稿、确保 WCAG 合规 |

---

## 2. CLI 命令设计

### 2.1 安装

```bash
# 零安装运行（推荐）
npx myrmidon@latest <command>

# 全局安装
npm install -g myrmidon

# 验证安装
myrmidon --version
```

### 2.2 命令总览

```
myrmidon <command> [subcommand] [options]

命令:
  init          初始化新项目
  start         启动 orchestrator（进入 TUI）
  status        查看当前工作流状态
  resume        从中断点恢复执行
  config        管理项目配置
  skills        Skill 包管理（安装 / 更新 / 列出）
  worktree      Worktree 生命周期管理
  agent         Agent 管理与监控
  log           查看运行日志
  notify        测试通知渠道
  version       显示版本信息
```

### 2.3 `myrmidon init`

初始化一个受 Myrmidon 管理的项目（新建或为已有项目添加 Myrmidon 支持）。

```
myrmidon init [project-name] [options]

选项:
  --lang <lang>         文档输出语言 (zh | en)
  --runtime <runtime>   Agent 运行时 (claude-code)
  --template <tpl>      项目模板 (default | web | mobile | saas | monorepo)
  --base-port <port>    Worktree 端口起始值
  --add                 为已有项目添加 Myrmidon 支持（不新建目录，不 git init）
  --yes                 跳过所有确认提示，使用推断值或默认值（CI 友好）
```

**三种调用模式:**

| 模式 | 命令 | 行为 |
|------|------|------|
| **交互向导** | `myrmidon init` | 无参数无选项，启动问答向导逐步收集配置 |
| **新建项目** | `myrmidon init <name> [--flags]` | 直接使用提供的参数，跳过向导 |
| **已有项目** | `myrmidon init --add [--flags]` 或在项目目录内 `myrmidon init` | 注入到当前目录，跳过 git init |

**交互向导（无参数时触发）:**

```
$ myrmidon init

? 新建项目还是为已有项目添加 Myrmidon 支持？
  ❯ 新建项目
    已有项目（在当前目录添加）

? 项目名称: my-ecommerce

? 文档语言:
  ❯ 中文 (zh)
    English (en)

? 项目模板:
  ❯ 默认 (default)
    Web 应用 (web)
    移动应用 (mobile)
    SaaS 平台 (saas)
    Monorepo (monorepo)

? Worktree 基础端口（当前端口冲突时可修改）: 31000

? Agent 运行时:  （正在检测已安装的运行时...）
  ✓ claude-code  v1.2.3
  ✗ opencode     未安装
  ✗ gemini-cli   未安装

  仅检测到 1 个运行时，自动选择 claude-code。
  （若需混合多 runtime，安装后重新运行 myrmidon init 或手动编辑 myrmidon.config.ts）

  检测到多个时示例:
  ❯ Claude Code   (claude-code)   v1.2.3
    OpenCode      (opencode)      v0.3.1
    Gemini CLI    (gemini-cli)    v0.2.0

以下配置将被创建:
  目录:   ./my-ecommerce/
  语言:   zh
  模板:   default
  端口:   31000
  运行时: claude-code（自动检测）

? 确认初始化？ (Y/n)
```

提供任意参数或选项时跳过向导，缺失的必填项报错退出（不静默补默认值）。  
`--yes` 则跳过向导并用默认值填充所有缺省选项（适合 CI / 脚本调用）。

**行为（新建项目 / 已有项目对比）:**

| 步骤 | 新建项目 | 已有项目（`--add`） |
|------|----------|---------------------|
| 创建项目目录 | ✅ 创建 `<name>/` | ❌ 跳过（用当前目录） |
| 目录结构 | 全量创建（见第 6 章） | 仅补全缺失目录 |
| `myrmidon.config.ts` | 生成 | 已存在→显示 diff，提示手动合并（不覆盖） |
| `CLAUDE.md` | 生成 | 追加 `## Myrmidon` 段落（若已有同名段落则跳过） |
| `.claude/rules/` | 生成全套规则文件 | 仅添加缺失的规则文件，已有文件不覆盖 |
| `.myrmidon/prompts/{role}.md` | 生成（每个内置角色各一个） | 仅添加缺失角色文件 |
| `git init` / develop 分支 | ✅ 执行 | ❌ 跳过（已有 repo） |
| `.gitignore` | 生成（含 `.env`、`.myrmidon/runtime/`、`.myrmidon/logs/`） | 追加缺失条目，不覆盖 |
| `.env.example` | 生成（含所有必填 key，值留空） | 追加缺失 key，已有 key 不覆盖 |
| `.env` | 不创建（用户手动复制 `.env.example` 填值） | 不创建 |
| template 检测 | 由 `--template` 指定 | 自动推断（检测 `apps/`、`package.json workspaces` 等） |

**已有项目迁移原则:**
- **追加不覆盖**：所有文本类文件（`.gitignore`、`CLAUDE.md`）只追加缺失内容
- **diff 提示**：结构性配置文件（`myrmidon.config.ts`）冲突时展示 diff，引导用户手动合并
- **幂等**：`myrmidon init --add` 可安全多次执行，已完成的步骤不重复执行
- **完成后校验**：init 结束时运行 `myrmidon config validate`，列出仍缺失或需手动补全的配置项

**`--template monorepo` 额外行为:**
- 生成 `apps/backend/` 和 `apps/frontend/` 目录结构
- 在 `myrmidon.config.ts` 中生成 `apps` 配置块（每个 app 独立 `basePort`，默认 31000/32000/…）
- 在 `task.md` 模板中加入必填的 `app` 字段

**示例:**
```bash
myrmidon init                                         # 交互向导
myrmidon init my-ecommerce --lang zh --base-port 4000 # 新建，直接模式
myrmidon init my-platform --template monorepo         # 新建 monorepo
myrmidon init --add --lang zh                         # 已有项目，部分参数
myrmidon init --add --yes                             # 已有项目，CI 模式
```

**分离项目联动（FE/BE 各自独立 myrmidon）:**
```
当 FE 依赖 BE 的 API spec 时，在 FE 项目的 myrmidon.config.ts 顶层声明（非 apps 内）：
  externalDependencies:
    - name: backend-api-spec
      path: ../my-backend/docs/design/architecture/api.md
      watchFor: changes   # orchestrator T6 定时器轮询检查，变更则解锁 downstream task
orchestrator 将 external dependency 视为虚拟 task，未变更时其 downstream task 保持 blocked。
```

### 2.4 `myrmidon start`

启动 orchestrator，进入 TUI 交互模式。

```
myrmidon start [options]

选项:
  --no-tui              无头模式运行（适合 CI / 远程服务器）
  --config <path>       指定配置文件路径
  --resume              启动时自动从上次中断点恢复

行为:
  1. 加载 myrmidon.config.ts
  2. 校验运行环境（git、runtime CLI 可用性）
  3. 打开 .myrmidon/runtime/myrmidon.db（首次初始化 schema；已有则恢复状态）
  4. 进入 TUI，等待甲方输入需求

--no-tui 模式（CI / 远程服务器）:
  - orchestrator 在 stdout 输出结构化 JSON 事件流（NDJSON 格式）
  - 甲方交互通过以下方式之一:
      1. stdin: echo '{"type":"client_message","text":"确认"}' | myrmidon start --no-tui
      2. REST API: orchestrator 在 localhost:3999 暴露本地 HTTP 接口（仅本地）
         GET  /api/status          返回当前工作流状态
         POST /api/message         发送甲方消息
         POST /api/confirm         确认当前待确认事项
      3. IM 通知渠道（配置 notifications 后）: 甲方在 Slack/企业微信中直接回复
  - 等待甲方确认时: 向所有已配置通知渠道发送请求，同时在 REST API 挂起等待
```

### 2.5 `myrmidon status`

```
myrmidon status [options]

选项:
  --sprint <id>         查看指定 sprint 状态
  --agent <name>        查看指定 agent 状态
  --json                以 JSON 格式输出
  --watch               持续监控，实时刷新（类似 watch 命令）

输出示例:
  Project:  my-ecommerce
  Phase:    Development
  Sprint:   sprint-02
  ┌──────────────┬────────────┬──────────────────────────────────┐
  │ Agent        │ Status     │ Current Task                     │
  ├──────────────┼────────────┼──────────────────────────────────┤
  │ orchestrator │ 🟢 Running │ Polling (next: 28s)              │
  │ coder1       │ 🟡 Working │ task-007: implement user auth    │
  │ coder2       │ 🟡 Working │ task-008: implement product CRUD │
  │ qa           │ ⚪ Waiting │ Pending coder1, coder2           │
  └──────────────┴────────────┴──────────────────────────────────┘

  Worktrees:
  ├── feature/task-007  port:4100  branch:feature/task-007
  └── feature/task-008  port:4200  branch:feature/task-008
```

### 2.6 `myrmidon resume`

```
myrmidon resume [options]

选项:
  --node <node-id>      从指定工作流节点恢复（覆盖自动检测）
  --agent <name>        只重启指定 agent
  --force               忽略状态校验强制恢复

行为:
  1. 打开 .myrmidon/runtime/myrmidon.db（SQLite integrity check）
  2. 从 SQLite 读取当前 workflow 状态（phase/sprint/node）
  3. 执行 Recovery Validator（见 7.6）
  4. 重新启动 orchestrator 轮询循环，从 workflow_node 继续推进
  5. 重启处于 error/stuck 状态的 agent
```

### 2.7 `myrmidon config`

```
myrmidon config <subcommand>

子命令:
  get <key>             读取配置项
  set <key> <value>     写入配置项
  list                  列出所有配置项
  validate              校验配置文件合法性
  edit                  用系统编辑器打开配置文件

示例:
  myrmidon config get basePort
  myrmidon config set notifications.clientTimeout.autoApproveMinutes 15
  myrmidon config list
```

### 2.8 `myrmidon worktree`

```
myrmidon worktree <subcommand>

子命令:
  create <task-id>      创建 worktree，自动分配端口
  list                  列出所有活跃 worktree 及其端口
  info <branch>         查询单个 worktree 的路径、端口、状态（JSON 输出）
  cleanup <branch>      删除 worktree，更新 SQLite status → 'cleaned'
  merge <branch>        将 worktree 分支合并至 develop
  ports                 显示当前端口分配表（所有 active worktree）
  register              [内部] orchestrator 注册新 worktree 到 SQLite（由 create 调用）

选项（create）:
  --base <branch>       基础分支，默认: develop
  --app <name>          monorepo 时必填，决定使用哪个 app.basePort

选项（info）:
  --field <key>         只输出指定字段值（path | port | task_id | status）

示例:
  myrmidon worktree create 7 --app backend
  myrmidon worktree list
  myrmidon worktree info feature/task-00007
  myrmidon worktree info feature/task-00007 --field path
  myrmidon worktree merge feature/task-00007
  myrmidon worktree cleanup feature/task-00007
  myrmidon worktree ports
```

### 2.9 `myrmidon agent`

```
myrmidon agent <subcommand>

子命令:
  list                  列出所有 agent 及其状态
  restart <name>        重启指定 agent
  logs <name>           实时查看 agent 日志
  assign <name> <task>  手动将任务分配给 agent
  pause <name>          暂停 agent（完成当前任务后停止）
  resume <name>         恢复已暂停的 agent

示例:
  myrmidon agent list
  myrmidon agent logs coder1 --tail 50
  myrmidon agent restart pm
```

### 2.10 `myrmidon log`

```
myrmidon log [options]

选项:
  --agent <name>        按 agent 过滤
  --level <level>       日志级别 (debug|info|warn|error)，默认: info
  --tail <n>            显示最后 n 行，默认: 100
  --follow              持续追踪新日志（类似 tail -f）
  --since <time>        显示指定时间之后的日志（如 '1h', '2024-01-01'）
  --json                JSON 格式输出

示例:
  myrmidon log --agent qa --level warn --follow
  myrmidon log --since 2h --json
```

### 2.11 `myrmidon notify`

```
myrmidon notify test [channel]    测试指定通知渠道
myrmidon notify send <message>    向所有已配置渠道发送消息
```

### 2.12 `myrmidon skills`

Skill 包管理器。从 `myrmidon.config.ts` 的 `skills.registry` 读取声明，将 skill 安装到 `skills.installDir`（默认 `.claude/skills/`）。

```
myrmidon skills <subcommand>

子命令:
  install [name]     安装所有注册 skill，或指定名称的单个 skill
  list               列出所有注册 skill 及安装状态（installed / missing / outdated）
  update [name]      更新所有 skill 到最新匹配版本，或指定名称的单个 skill
  remove <name>      移除已安装的 skill（保留 registry 声明）
  check              校验已安装 skill 完整性（checksum 验证，不安装）

选项（install / update）:
  --force            强制重新安装，即使已是最新版本
  --no-lock          不写入 skills.lock（不推荐）

示例:
  myrmidon skills install            # 一次性预装所有 registry skill（推荐在 CI 中执行）
  myrmidon skills install drawio     # 安装单个 skill
  myrmidon skills list               # 查看安装状态
  myrmidon skills update             # 更新全部
  myrmidon skills check              # 验证完整性
```

**安装行为（按 source type）：**

| source.type | 安装行为 | 安装后存储位置 |
|-------------|---------|--------------|
| `npm` | `npm install {package}@{version}`（写入临时 package.json）| `.claude/skills/{name}/` |
| `git` | `git clone {url} --branch {ref} --depth 1` | `.claude/skills/{name}/` |
| `npx` | 运行时 `npx {package}` 按需拉取，不持久化安装 | 无（每次新 session 按需获取）|
| `local` | 直接引用 `path`，不复制 | 原路径（不移动）|

**Dispatch 时的 Skill 可用性检查：**

```
dispatch 前:
  FOR EACH skill in agent.skills:
    resolved = registry.find(skill.name)
    IF resolved.source.type == 'local': 检查 path 存在
    IF resolved.source.type == 'npm' | 'git': 检查 .claude/skills/{name}/ 存在且 checksum 匹配
    IF resolved.source.type == 'npx': 跳过（运行时拉取）

    IF 缺失 AND config.skills.autoInstall == true:
      自动执行 myrmidon skills install {name}（记录 warn 日志，增加 dispatch 延迟）
    IF 缺失 AND config.skills.autoInstall == false:
      abort dispatch，错误: "Skill '{name}' not installed. Run: myrmidon skills install {name}"
```

---

## 3. TUI 界面设计

TUI 基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLIs）实现，支持鼠标点击与键盘双模式操作。

### 3.1 整体结构

```
MYRMIDON  <project>  ▶ <sprint>  📅 Day X/Y  ⏰ ±Nd
──────────────────────────────────────────────────────────────────────
1 Overview  2 Project  3 Agents  4 Cron ●  5 Log
──────────────────────────────────────────────────────────────────────
[ tab content area ]
──────────────────────────────────────────────────────────────────────
q Quit  1-5 Switch  Tab Focus  ↑↓ Scroll  Enter Select  ? Help  :lang zh/en
```

**Header**（常驻）：项目名、当前 sprint、天数进度（Day X/Y）、落后/超前天数。

**标签栏**：
- `1`–`5` 数字键直接跳转；鼠标可点击 Tab 标题
- `●` 红点角标：该 Tab 有待人工介入事项

### 3.2 人工介入通知（最高优先级）

**多层通知同时触发：**

| 层级 | 表现 |
|------|------|
| TUI 全局 banner | Tab 内容区顶部插入反色高亮行（覆盖所有 Tab，不可绕过） |
| TUI Tab 角标 | `●` 红点显示在对应 Tab 标题 |
| TUI 终端 bell | 可配置关闭 |
| IM 推送 | Slack / 企业微信（按配置） |
| Email | 按配置收件人 |

**Banner 样式**（红底白字，全宽）：
```
████  ⚠ 需要确认：sprint-02 交付物已就绪  Enter确认  r拒绝  e延期  8m后自动通过  ████
```

**按键**（banner 激活时拦截，优先于当前 Tab 默认按键）：
- `Enter` — 确认（不触发 chat 发送或卡片展开）
- `r` — 拒绝并输入备注
- `e` — 延期（输入延期时长）
- `i` — 跳转 Cron Tab 查看详情
- `Esc` — 暂时隐藏 banner（事项未处理，角标保留）
- `→` — 多条事项时切换到下一条

人工操作完成后：自动撤销 banner + 角标，并通知 IM 平台撤回提醒（平台支持时）。

### 3.3 Tab 1 — Overview（默认视图）

左右分屏：左侧 ~40% 会话，右侧 ~60% 摘要。

**左侧 CLIENT CHAT**：
- 滚动显示甲方 ↔ orchestrator 对话历史
- 底部输入框，`Enter` 发送，`Tab` 切换焦点

**右侧全局摘要**（只显示数字，不展开卡片）：
```
WORKFLOW                      AGENT PULSE
✅ Requirements               pm ○  arch ○
✅ PRD + Design               coder1 ● task-7  coder2 ● task-8
▶ Development  3/5 done      qa ○  sec ○  ui ○
○ QA / Delivery
                              TASKS   3✅  2🟡  8○
                              ISSUES  1🔴  0🟡  5✅
                              TIMERS  T1●  T2●  T4●  T5◐
```

### 3.4 Tab 2 — Project Kanban

三列：`PENDING` / `IN PROGRESS` / `DONE`

导航：`←→` 列间，`↑↓` 卡片间，`Enter` 展开/折叠，鼠标点击选中。

**卡片（折叠态）**：
```
┌─ task-00007 ──────────────────┐
│ 用户注册接口                   │
│ coder1 · sonnet · tdd-backend  │
│ mcp: playwright  port: :31007  │
└────────────────────────────────┘
```

**卡片（展开态）**：追加显示 acceptance criteria、blockedBy、关联 issue、预计 vs 实际耗时。

**底部时间线**（常驻）：
```
sprint-02  2026-05-21 → 2026-06-10  ████████░░░░  60%  剩 20d  落后 8d
```

### 3.5 Tab 3 — Agent Kanban

每 role 一行（折叠态），`Enter` 展开：

```
ROLE      INSTANCES   STATUS          CURRENT TASK
pm        1 / 1       ○ idle          —
coder     2 / 3       ● 2 working     task-00007, task-00008
qa        1 / 1       ○ waiting       —

[展开 coder]
  executor: claude-sonnet-4-6
  skills: tdd-backend, api-design
  allowed: Read Write Edit Bash(scope限)
  forbidden: git push, rm -rf
  instances: coder1(task-7 · 12m)  coder2(task-8 · 4m)  coder3(idle)
```

### 3.6 Tab 4 — Cron

上下两区：

**系统定时器**：
```
SYSTEM TIMERS        next    interval  status
● workflow-poll       3s      28s       running
● heartbeat           1s      3s        running
● stuck-detect        2s      55s       running
◐ client-timeout      —       —         paused
```
操作：`p` 暂停/恢复，`r` 手动触发。

**业务等待**：
```
BUSINESS WAITS           trigger    timeout    on-timeout
! sprint-02 交付确认 ●   甲方确认   8m left    auto-approve
○ daily report            23:00      —          send-report
○ arch review sign-off    arch确认   30min      escalate-pm
```
`!` + `●` 触发全局 banner。`Enter` 进入操作流程。

### 3.7 Tab 5 — Log（审计）

**树形导航**（左列选择，右侧显示日志）：
```
▼ coder1
  ● task-00007  2026-05-21T09:12  live
  ✅ task-00005  2026-05-21T08:30  12m  exit:success
▶ coder2  ▶ qa  ▶ arch
```

- `f` — live-tail 选中 session（自动跟随最新行）
- `Esc` — 退出 tail，返回树形
- `/` — 搜索日志内容
- `g` / `G` — 跳到顶部 / 底部；手动滚动时暂停 tail，`G` 恢复跟随

**审计日志存储**：
- 路径：`.myrmidon/logs/{agent-id}/{session-id}.jsonl`
- 每条记录：`ts`、`type`（input/output/tool_call/tool_result/error）、内容、`duration_ms`
- SQLite `agent_sessions` 表做索引（见 6.5）
- 保留策略：默认 30 天 / 1000 sessions，可配置（`audit.retention`）

### 3.8 交互通用规则

**鼠标支持**：点击 Tab 标题切换、点击卡片展开/折叠、点击 banner 按钮操作、滚轮滚动。键盘导航始终可用，鼠标为增强。

**溢出滚动**：各面板独立维护滚动状态，超出高度时右侧显示 mini scrollbar（`▐`），`↑↓` 或鼠标滚轮滚动。

**i18n**：语言包 `resources/i18n/{zh,en}.json`，键名全英文。`:lang zh/en` 热切换，持久化到 `tui.lang` 配置项，默认跟随 `LANG` 环境变量。

---

## 4. Agent 角色与职责规范

每个 Agent 节点均通过固定规范约束，格式如下：

### 4.1 规范结构（所有 Agent 通用模板）

```
输入规范:
  - 触发条件
  - 输入文件列表及格式要求

执行范围:
  - 授权行为（可以做什么）
  - 禁止行为（不能做什么）
  - 优先使用的 Skill

输出产物:
  - 文件路径
  - 文件格式和必需字段

完成报告格式:
  - 状态字段
  - 摘要字段
```

### 4.2 orchestrator

```yaml
触发: 持续运行（轮询驱动）
授权行为:
  - 读取所有项目文档和运行时状态
  - 向甲方发送消息（TUI 聊天 / IM 通知）
  - 接收甲方输入并写入需求文档
  - 分配任务给其他 Agent
  - 触发 worktree merge（通过 myrmidon worktree merge）
  - 创建和关闭 GitHub/GitLab PR（develop → main）
  - 更新工作流状态文件
禁止行为:
  - 直接修改项目源代码
  - 直接向 main 分支 push 代码
  - 自行做技术或产品决策
输出产物: SQLite `workflow` 表（持续更新）；STATE.md 异步刷新（派生缓存）
```

> **实现说明（单一职责）**：orchestrator 进程内部应拆分为独立子系统，各自只暴露接口、不相互直接依赖：
> - `WorkflowEngine`：状态机推进、阶段转换（读写 `workflow` 表）
> - `Dispatcher`：构建 dispatch prompt、启动 Agent session（见 6.4）
> - `TimerManager`：定时器注册与触发（见 10.6）
> - `AgentMonitor`：心跳检测、stuck 检测、进程存活（见 10.5）
> - `NotificationBus`：向外发送消息（TUI / IM / REST API），不依赖具体渠道实现
> - `TuiController`：TUI 渲染，只读取状态，不写入
>
> 这些子系统通过事件总线或回调解耦，便于单独测试和未来替换（如将 TUI 替换为 Web Dashboard 时只需替换 TuiController）。

### 4.3 pm（产品经理）

```yaml
触发:
  - orchestrator 确认需求收集完毕
  - orchestrator 要求生成/更新产品文档

输入规范:
  - docs/requirements/raw/requirements-raw.md（必须存在）
  - docs/requirements/modules.md
  - docs/requirements/tech-stack.md

授权行为:
  - 创建和修改 docs/design/wireframes/ 下的文档
  - 创建和修改 docs/design/prd/ 下的文档
  - 创建和修改 docs/backlog/backlog.md
  - 创建和修改 docs/epics/ 下的文档
  - 在评审中提出问题、修改设计文档
  - 使用 Skill: document-skills:docx, document-skills:pdf

禁止行为:
  - 修改 docs/requirements/ 下的原始需求（需通过 orchestrator）
  - 修改架构、SQL、API 设计文档
  - 操作 git、worktree、代码文件

输出产物:
  - docs/design/wireframes/wireframe-v{n}.md
  - docs/design/prd/prd-v{n}.md
  - docs/backlog/backlog.md
  - docs/epics/epic-{id}/epic.md
  - docs/epics/epic-{id}/sprints/sprint-{id}/sprint.md

完成报告格式:
  status: completed | blocked
  summary: "完成内容简述"
  artifacts: [文件路径列表]
  blockers: [阻塞项列表，status 为 blocked 时必填]
```

### 4.4 arch（架构师）

```yaml
触发:
  - orchestrator 要求技术评审
  - pm 要求任务拆分

输入规范:
  - docs/requirements/（全部）
  - docs/design/prd/prd-v{n}.md（最新版本）
  - docs/epics/epic-{id}/sprints/sprint-{id}/sprint.md

授权行为:
  - 创建和修改 docs/design/architecture/ 下的文档
  - 拆分任务到 docs/epics/.../tasks/task-{id}.md
  - 在评审中提出技术问题和建议
  - 修改 docs/requirements/tech-stack.md（需 orchestrator 与甲方确认后）

禁止行为:
  - 直接分配任务给 coder（通过 orchestrator 分配）
  - 操作 git、worktree、代码文件

输出产物:
  - docs/design/architecture/overview.md
  - docs/design/architecture/database.md（数据库设计）
  - docs/design/architecture/api.md（API 设计）
  - docs/epics/.../tasks/task-{id}.md

完成报告格式: 同 pm
```

### 4.5 coder(n)（开发者）

```yaml
触发: orchestrator 分配 task-{id}.md

输入规范:
  - docs/epics/.../tasks/task-{id}.md（必须存在且状态为 pending）
  - docs/design/architecture/（全部）
  - CLAUDE.md 和 .claude/rules/（Agent 宪法）

授权行为:
  - 在分配的 worktree 中编写代码
  - 运行单元测试
  - 提交代码到 feature/task-{id} 分支
  - 请求 orchestrator 执行 worktree merge
  - 更新任务状态文件

禁止行为:
  - 直接向 develop 或 main 分支 push（必须通过 worktree merge 流程）
  - 修改其他 coder 的 worktree
  - 修改设计文档（需通过评审提出意见）
  - 操作不在自己 worktree 范围内的文件

输出产物:
  - 代码变更（在 feature/task-{id} 分支）
  - 任务完成报告：docs/epics/.../tasks/task-{id}.md（更新 status 字段）

完成报告格式:
  status: completed | blocked | failed
  summary: "实现内容简述"
  changed_files: [变更文件列表]
  impact_scope: [影响范围描述]
  test_result: passed | failed
  worktree: feature/task-{id}
  merge_ready: true | false
  blockers: [...]
```

### 4.6 qa（测试工程师）

```yaml
触发:
  - orchestrator 通知 sprint 所有任务已合并至 develop

输入规范:
  - docs/epics/.../sprints/sprint-{id}/sprint.md
  - docs/test-cases/sprint-{id}/（全部测试用例）
  - develop 分支代码

授权行为:
  - 生成测试用例到 docs/test-cases/sprint-{id}/tc-{id}.md
  - 在 develop 分支运行集成测试（使用 Playwright MCP：browser_navigate、browser_click、browser_snapshot 等）
  - 创建 issue 文件 docs/epics/.../issues/issue-{id}.md（UI issue 必须填写 design_spec_ref 和 impact_scope）
  - 请求 orchestrator 将 issue 分配给 coder
  - 使用 Skill: webapp-testing（优先加载，覆盖 Playwright 测试全流程）

UI 测试生成规则（强制）:
  - 从 docs/design/ui/components/{name}.md 的 DOM Contract 中"Playwright 必须覆盖的验收用例"逐条生成 tc
  - 测试以 data-testid 定位元素，不以 CSS 类名或文本内容定位（防止样式变更导致测试失效）
  - 每条验收用例生成一个 tc，包含: precondition、steps（Playwright 操作）、expected_result
  - WCAG 验证使用 axe-core（Playwright 中注入）而非人工截图对比
  - bug fix 合并后: 对 issue 的 impact_scope 中所有 task 对应测试用例做回归，不仅限于最初失败项

禁止行为:
  - 在 feature 分支上运行集成测试
  - 直接修改代码
  - 操作 worktree

输出产物:
  - docs/test-cases/sprint-{id}/tc-{id}.md
  - docs/epics/.../issues/issue-{id}.md
  - 测试报告：.myrmidon/runtime/test-reports/sprint-{id}.json

完成报告格式:
  status: passed | failed
  tested_branch: develop
  test_cases_total: N
  test_cases_passed: N
  test_cases_failed: N
  issues: [issue-{id} 列表]
```

### 4.7 security（安全审查）

```yaml
触发: orchestrator 要求安全评审（设计评审阶段和代码评审阶段）

授权行为:
  - 审查设计文档、API 设计、数据库设计
  - 审查代码变更（develop 分支）
  - 创建安全 issue：docs/epics/.../issues/issue-{id}.md（标记 type: security）
  - 使用 Skill: security-review

禁止行为: 同 qa

输出产物: issue 文件（type: security）
```

### 4.8 ui（UI/UX 设计师）

```yaml
触发: pm 评审通过后，orchestrator 启动 UI 设计阶段

输入规范:
  - docs/design/wireframes/wireframe-v{n}.md（最终版本）
  - docs/design/prd/prd-v{n}.md（最终版本）

授权行为:
  - 创建和修改 docs/design/ui/ 下的设计文档
  - 在评审中提出设计问题
  - 使用 Skill: frontend-design:frontend-design, document-skills:canvas-design

禁止行为: 修改需求、架构、代码

输出产物:
  - docs/design/ui/ui-design-v{n}.md（页面级叙述：布局、配色、交互流程）
  - docs/design/ui/tokens.md（设计 Token：颜色、字体、间距）
  - docs/design/ui/components/{component-name}.md（**每个组件必须包含 DOM Contract 节**，见 6.3）

输出要求（强制）:
  每个 component 文件必须包含完整的 DOM Contract，含:
  - 必须存在的元素表（data-testid / HTML类型 / 必要属性 / 条件）
  - 状态机表（各状态下每个元素的表现）
  - Playwright 验收用例列表（qa 从此列表直接生成测试，不得遗漏）
  ui agent 不得在未填写 DOM Contract 的情况下提交 status: completed。
```

---

## 5. 协作工作流（全阶段）

> 工作流由 orchestrator 固化执行，不由 LLM 决策流程走向。每个阶段的推进条件必须满足才能进入下一阶段。

### 5.1 阶段总览

```
Phase 0: 需求收集
Phase 1: 需求评审 + 技术预评审
Phase 2: 低保真原型 + PRD 编写 → 多轮评审
Phase 3: 详细技术设计 → 多轮评审
Phase 4: UI 设计 → 多轮评审 → 甲方确认
Phase 5: Epics / Sprints 规划 → 评审
Phase 6: Sprint 开发（循环）
  6.1: 任务拆分
  6.2: 前置设计（SQL、API、测试用例）
  6.3: 并行开发（Worktree 管理）
  6.4: QA 测试 → Bug 修复循环
  6.5: Sprint 交付 → 甲方确认
Phase 7: 发布（develop → main）
```

### 5.2 Phase 0: 需求收集

**触发条件：** `myrmidon start` 首次运行

**流程：**

```
orchestrator → 甲方:
  "欢迎使用 Myrmidon！请描述您的项目需求。"

甲方: [输入项目描述]

orchestrator（引导式对话）:
  1. 确认项目类型（Web、移动端、API 服务等）
  2. 识别常见功能模块，逐一与甲方确认是否包含
  3. 按模块逐一深入确认功能需求
  4. 确认技术栈偏好（或无偏好）
  5. 确认非功能需求（性能、安全、合规等）
  6. 汇总需求，向甲方展示需求摘要请求确认

产出文件:
  - docs/requirements/raw/requirements-raw.md   # 原始对话记录
  - docs/requirements/modules.md                # 确认的模块列表
  - docs/requirements/tech-stack.md             # 技术栈偏好

完成条件: 甲方确认需求摘要
```

### 5.3 Phase 1: 需求评审 + 技术预评审

```
orchestrator → pm:  "请对需求文档进行评审，输出评审报告"
orchestrator → arch: "请对需求文档进行技术预评审，推荐技术栈"

pm 评审:
  - 检查需求完整性、歧义、业务连续性
  - 输出: 评审意见 or 通过确认

arch 评审:
  - 评估技术可行性
  - 推荐技术栈（需与甲方偏好对齐）
  - 输出: 技术评审意见 + 技术栈推荐

如有问题:
  orchestrator → 甲方: [向甲方澄清或确认技术栈]
  甲方确认后 → 更新 tech-stack.md

完成条件: pm 和 arch 均输出 status: passed
```

### 5.4 Phase 2: 低保真原型 + PRD

```
orchestrator → pm: "开始低保真原型设计和 PRD 编写"

评审循环（直至无评审意见）:
  pm 完成文档 →
  orchestrator 通知评审 [arch, coder(all), qa, security, ui] →
  各 Agent 输出评审意见 →
  pm 修改 →
  重复

完成条件: 所有评审方 status: approved，无未解决 comment
```

### 5.5 Phase 3: 详细技术设计

```
orchestrator → arch: "开始详细技术设计"

arch 输出:
  - docs/design/architecture/overview.md
  - docs/design/architecture/database.md
  - docs/design/architecture/api.md

评审循环:
  arch 完成 →
  orchestrator 通知评审 [pm, coder(all), qa, security] →
  各 Agent 评审 →
  arch 修改 →
  重复

完成条件: 所有评审方 status: approved
```

### 5.6 Phase 4: UI 设计

```
orchestrator → ui: "开始 UI 设计"

ui 输出:
  - docs/design/ui/ui-design-v{n}.md
  - docs/design/ui/tokens.md

评审循环:
  ui 完成 →
  orchestrator 通知评审 [pm, arch, coder(all), qa, security] →
  各 Agent 评审（重点: WCAG、可实现性）→
  ui 修改 →
  重复 →
  pm 宣布 status: approved →
  orchestrator → 甲方: "UI 设计已完成，请确认"

甲方确认（含超时规则，见第 9.4 节）

完成条件: 甲方确认通过
```

### 5.7 Phase 5: Epics / Sprints 规划

```
orchestrator → pm: "请规划 Epics 和 Sprints"

pm 输出:
  - docs/backlog/backlog.md
  - docs/epics/epic-{id}/epic.md（每个 epic）
  - docs/epics/epic-{id}/sprints/sprint-{id}/sprint.md（每个 sprint）

arch 评审 epics / sprints 规划

完成条件: arch status: approved
```

### 5.8 Phase 6: Sprint 开发循环

每个 sprint 执行以下子阶段：

#### 6.1 任务拆分

```
orchestrator → arch: "请对 epic-{id}/sprint-{id} 进行任务拆分"

arch 必须满足三个约束:
  1. 每个 task 必须能在单个 Agent 上下文窗口内完成（铁律）
     参考标准: ≤7 个步骤，≤8 个涉及文件，描述 <2000 字符
  2. 必须填写 sprint Boundary Map，明确每个 task 产出什么接口 / 消费什么上游接口
  3. 任务必须遵循内聚性拆分规则（见下文），不得以大小为唯一拆分依据

【任务粒度内聚性规则（防止跨 task 文件冲突）】

  BE 粒度规则:
    - 一个域实体的完整垂直切片 = 一个 task
      （entity + migration + repository + service + controller 同属一个 task）
    - 例外: 复杂实体（>3 关联关系）→ 拆为两个 task:
        task-A: entity + migration（type: infrastructure）
        task-B: repository + service + controller（type: entity，依赖 task-A）
    - 共享基础设施单独为 task（type: infrastructure）:
        auth middleware、exception filter、logging、base dto、db 连接配置
    - 同一文件（如 app.module.ts）不得被两个 task 同时修改

  FE 粒度规则:
    - 一个路由/页面（含页面专属子组件）= 一个 task（type: route）
    - 复杂页面（>4 个独立交互流程）→ 按用户流程拆分多个 task
    - 跨页面复用的共享组件 = 独立 task（type: shared），先于使用它的 route task 完成
    - 设计 Token、主题配置 = 独立 task（type: infrastructure），最先完成

  调度优先级（orchestrator 按此顺序 dispatch）:
    infrastructure（type: infrastructure）→ shared → entity → route → feature

  DAG 校验（arch 提交任务列表后，orchestrator 执行，见 7.2）:
    - 检测循环依赖（A→B→A）
    - 验证 consumes 中引用的每个接口都能在对应 dependency task 的 produces 中找到
    - 验证 infrastructure task 无 consumes（叶节点）
    - 任何校验失败 → 驳回整批任务，要求 arch 修正

arch 输出:
  - docs/epics/.../tasks/task-{id}.md（每个任务）
  - 更新 sprint.md 的 Boundary Map 部分

每个 task-{id}.md 字段:
  id, title, description, acceptance_criteria,
  assignee(空), estimated_hours, dependencies,
  status: pending
  # 必填字段:
  type: infrastructure | shared | entity | route | fix | test  # 内聚类型，影响调度优先级
  priority: 1-5           # 同优先级内的执行顺序（1=最高），同 type 内有多个 task 时使用
  steps: []               # 3-7 个具体步骤
  produces: []            # 本任务产出的接口/文件/函数（供 Boundary Map 使用）
  consumes: []            # 本任务依赖的上游产出（来自 dependencies task）
  context_estimate: small|medium|large   # orchestrator 预校验用（阈值见 9.1）
  app: backend | frontend | shared | root  # monorepo 时必填，决定 worktree 工作目录

sprint.md Boundary Map 示例:
  ## Boundary Map
  ### task-00007 → task-00009
  Produces:
    user.repository.ts → findById(), create(), updateById()
    user.entity.ts     → User interface
  Consumes: nothing (leaf)

  ### task-00008 → task-00009
  Produces:
    auth.service.ts → generateToken(), verifyToken()
  Consumes from task-00007:
    user.repository.ts → findById()
```

#### 6.2 前置设计（并行）

```
orchestrator（同时触发）:
  → coder(指定): "请为 sprint-{id} 设计 SQL 结构"
  → coder(指定): "请为 sprint-{id} 设计 API 接口"
  → qa: "请为 sprint-{id} 生成测试用例"

等待三者全部完成后进入 6.3
```

#### 6.3 并行开发

```
【自动并行调度】orchestrator 基于 task 的 Boundary Map 推导 IO 依赖图:
  - 无文件冲突的 task → 同时 dispatch 给多个 coder（并行）
  - 有依赖关系的 task → 等待上游 task 完成后再 dispatch（串行）
  - 冲突判定: 两个 task 的 produces/consumes 有重叠文件路径 → 串行

【Dispatch 模型 — Fresh Session Per Task】
orchestrator 为每个 pending 任务构建 dispatch prompt，包含:
  ┌─────────────────────────────────────────────┐
  │ task-{id}-PLAN.md       任务计划（含步骤）    │
  │ sprint-{id}.md 摘要     所属 sprint 目标      │
  │ Boundary Map 相关部分   本任务的 produces/consumes │
  │ 依赖 task 的 SUMMARY.md 上游产出摘要          │
  │ DECISIONS.md 摘要       架构决策记录           │
  │ 工具权限清单             本 coder 授权范围      │
  └─────────────────────────────────────────────┘
  → 启动全新 Agent session，不继承任何历史对话

orchestrator 为每个 pending 任务:
  1. 估算 context_estimate（small/medium/large），校验任务不超窗口
  2. 检查依赖 IO 图，确认无冲突可并行
  3. 触发: myrmidon worktree create feature/task-{id}
  4. 构建 dispatch prompt，启动 coder fresh session

coder{n} 执行（在 feature/task-{id} worktree 中）:
  1. 读取 dispatch prompt 中的任务计划
  2. 执行每个步骤，完成时在 task-{id}.md 中标记 [DONE:n]
  3. 如上下文接近满（约 70% 使用率）: 写 `.myrmidon/runtime/continue/{task-id}.md`（见下文），通知 orchestrator
  4. 运行单元测试
  5. 验证 acceptance_criteria（不能以"步骤全部执行"代替验证——要检查实际结果）
  6. 完成后提交完成报告（含 merge_ready: true）

continue.md 协议（上下文中断时写入 `.myrmidon/runtime/continue/{task-id}.md`，**不是** worktree 根目录）:
  ---
  task: task-00007
  step: 3
  total_steps: 6
  saved_at: 2024-01-15T14:30:00Z
  ---
  ## Completed Work
  - 已完成: user.entity.ts 和 user.repository.ts 实现
  ## Remaining Work
  - 步骤4: 实现 user.service.ts
  - 步骤5: 编写单元测试
  ## Decisions Made
  - 使用 TypeORM Repository 模式，原因: 与 arch 设计文档一致
  ## Next Action
  在 src/modules/user/user.service.ts 中实现 findById 和 create 方法，
  参考 docs/design/architecture/api.md#user-service

  恢复时: orchestrator 重新 dispatch，新 session 读取 continue.md → 删除 → 继续

orchestrator 检测到 merge_ready: true:
  1. 运行 Output Validator 校验完成报告
  2. 验证 worktree 内测试通过
  3. 触发: myrmidon worktree merge feature/task-{id}
  4. 将 task-{id}.md SUMMARY 写入 SQLite（供后续 task dispatch 使用）
  5. 更新 task-{id}.md status: completed
  6. 清理 worktree: myrmidon worktree cleanup feature/task-{id}
  7. 通知下一个等待此 task 产出的依赖 task 可以开始
```

#### 6.4 QA 测试 → Bug 修复

```
orchestrator 检测到 sprint 所有 task status: completed →
  → qa: "请对 develop 分支执行 sprint-{id} 测试"（fresh session dispatch）

qa 验证梯级（按强度从弱到强，优先使用更强的层次）:
  1. 静态验证: 文件存在，接口已导出，无 stub/console.log 替代实现
  2. 命令验证: npm test / lint 通过，构建成功
  3. 行为验证: API 响应正确，UI 流程可跑通
  4. 人工验证: 仅在前三层无法覆盖时才要求人工（最少使用）

qa 生成验证报告格式:
  ### 验证结果
  | # | 验收标准 | 状态 | 证据 |
  |---|---------|------|------|
  | 1 | 用户可注册 | ✓ PASS | POST /api/auth/register 返回 201 |
  | 2 | 登录返回 JWT | ✗ FAIL | 返回 500 — 缺少环境变量 |

  ### 文件检查
  | 文件 | 预期 | 状态 | 说明 |
  |------|------|------|------|
  | user.service.ts | 实现 findById | ✓ | 87行，非 stub |
  | auth.service.ts | 生成 JWT | ✗ STUB | 8行，只有 console.log |

测试失败:
  qa 创建 issue-{id}.md（含验证报告） →
  orchestrator 分配给对应 coder（fresh session dispatch，注入 issue 文件）→
  coder 创建 fix/issue-{id} worktree 修复 →
  merge 回 develop →
  orchestrator 通知 qa 重新测试（针对失败项做回归验证）

完成条件: qa status: passed（所有验收标准通过）
```

#### 6.5 Sprint 交付

```
orchestrator → 甲方: "sprint-{id} 开发完成，请确认交付内容"
附: 变更摘要、演示链接（develop 分支）

甲方确认（含超时规则）→ 进入下一 sprint
```

### 5.9 Phase 7: 发布

```
所有 sprints 完成 →
orchestrator 创建 PR: develop → main →
通知甲方和所有相关方 →
等待人类审批 →
合并后打 release tag

注: main 分支合并只能由人类通过 PR 审批触发，orchestrator 不自动合并。
```

---

## 6. 文档体系规范

### 6.1 目录结构

```
{project-root}/
│
├── .myrmidon/
│   ├── myrmidon.config.ts          # 项目配置（提交 git）
│   └── runtime/                    # 不提交 git
│       ├── myrmidon.db             # SQLite 状态数据库（WAL 模式）← 唯一真相源
│       ├── myrmidon.db-wal         # SQLite WAL 文件
│       ├── myrmidon.db-shm         # SQLite 共享内存文件
│       │
│       │   # 以下 Markdown 均为 SQLite 的"渲染投影"，供 git 历史和 review 使用
│       ├── STATE.md                # 当前工作流状态快照（派生缓存，非真相源）
│       │
│       ├── agents/                 # 各 agent 运行时辅助文件（状态存 SQLite）
│       │   ├── pm.pid              # 进程 ID（用于 alive check）
│       │   ├── coder1.pid
│       │   └── ...
│       ├── anchors/                # 阶段移交锚点（phase handoff anchors）
│       │   ├── requirements.json   # Phase 0→1 移交
│       │   ├── design.json         # Phase 2→3 移交
│       │   └── sprint-{id}.json    # Sprint 规划→开发 移交
│       ├── exec/                   # 沙盒命令输出（防止大输出污染 Agent 上下文）
│       │   └── {exec-id}.txt       # 完整 stdout/stderr，Agent 只收摘要
│       ├── last-snapshot.md        # 压缩前快照（≤2KB，供 Agent 恢复定向）
│       ├── logs/                   # Agent 日志
│       │   ├── orchestrator.log
│       │   ├── pm.log
│       │   └── ...
│       └── test-reports/           # 测试报告
│           └── sprint-{id}.json
│
├── docs/
│   ├── requirements/
│   │   ├── raw/
│   │   │   └── requirements-raw.md
│   │   ├── modules.md
│   │   └── tech-stack.md
│   │
│   ├── design/
│   │   ├── wireframes/
│   │   │   └── wireframe-v{n}.md
│   │   ├── prd/
│   │   │   └── prd-v{n}.md
│   │   ├── architecture/
│   │   │   ├── overview.md
│   │   │   ├── database.md
│   │   │   └── api.md
│   │   └── ui/
│   │       ├── ui-design-v{n}.md
│   │       ├── tokens.md
│   │       └── components/
│   │           └── {component-name}.md
│   │
│   ├── backlog/
│   │   └── backlog.md
│   │
│   ├── epics/
│   │   └── epic-{id}/              # id: 三位数字，如 001
│   │       ├── epic.md
│   │       └── sprints/
│   │           └── sprint-{id}/    # id: 三位数字
│   │               ├── sprint.md
│   │               ├── tasks/
│   │               │   └── task-{id}.md    # id: 五位数字
│   │               └── issues/
│   │                   └── issue-{id}.md   # id: 五位数字
│   │
│   └── test-cases/
│       └── sprint-{id}/
│           └── tc-{id}.md          # id: 五位数字
│
├── CLAUDE.md                       # Agent 宪法（提交 git）
├── DECISIONS.md                    # 架构决策记录（append-only，提交 git）
├── .claude/
│   ├── rules/                      # Agent 规则（提交 git）
│   │   ├── common.md               # 通用规则
│   │   ├── coding.md               # 代码规范
│   │   └── security.md             # 安全规则
│   └── skills/                     # Skill 目录（提交 git）
│       ├── {skill-name}/           # local 类型：项目本地编写（见 9.4.5）
│       │   └── {skill-name}.md
│       └── {installed-skill}/      # npm / git 类型：myrmidon skills install 安装（.gitignore）
│           └── ...
├── .myrmidon/
│   ├── myrmidon.config.ts          # 项目配置（提交 git）
│   ├── skills.lock                 # Skill 精确版本锁定（提交 git，类似 package-lock.json）
│   └── prompts/                    # Agent 角色系统提示词（提交 git）
│       ├── orchestrator.md         # myrmidon init 生成默认模板
│       ├── pm.md
│       ├── arch.md
│       ├── coder.md
│       ├── qa.md
│       ├── security.md
│       └── ui.md
│
└── .gitignore
    # 必须包含: .myrmidon/runtime/
```

### 6.2 文件命名规范

| 文件类型 | 命名格式 | 示例 |
|---------|---------|------|
| Epic | `epic-{3位数字}.md` | `epic-001.md` |
| Sprint | `sprint-{3位数字}.md` | `sprint-002.md` |
| Task | `task-{5位数字}.md` | `task-00007.md` | 全局递增，跨 sprint / epic 唯一 |
| Issue | `issue-{5位数字}.md` | `issue-00012.md` | 全局递增 |
| 测试用例 | `tc-{5位数字}.md` | `tc-00003.md` | 全局递增 |
| 设计文档版本 | `{type}-v{n}.md` | `prd-v3.md` |

### 6.3 文件格式规范

#### task-{id}.md

```markdown
---
id: task-00007
title: "实现用户注册接口"
epic: epic-001
sprint: sprint-002
assignee: coder1
status: pending | in_progress | completed | blocked | failed
type: entity                           # infrastructure | shared | entity | route | fix | test
priority: 2                            # 1=最高，同 type 内排序
estimated_hours: 4
dependencies: [task-00005, task-00006]
produces:
  - "src/modules/user/user.entity.ts → User"
  - "src/modules/user/user.repository.ts → findById(), create()"
  - "src/modules/user/user.service.ts → register()"
  - "POST /api/auth/register → 201 {userId, token}"
consumes:
  - "task-00005 → src/database/base.entity.ts → BaseEntity"
  - "task-00006 → src/modules/auth/auth.service.ts → hashPassword()"
context_estimate: medium              # small(<8K) | medium(<32K) | large(<100K)
app: backend                          # monorepo 时必填: backend | frontend | shared | root
worktree: feature/task-00007
created_at: 2024-01-15T10:00:00Z
updated_at: 2024-01-15T14:30:00Z
---

## 任务描述
[详细描述]

## 验收标准
- [ ] 标准1
- [ ] 标准2

## 参考文档
- docs/design/architecture/api.md#user-register

## 完成报告
（由 coder 填写）
status: completed
summary: ""
changed_files: []
impact_scope: ""
test_result: passed
merge_ready: true
```

#### issue-{id}.md

```markdown
---
id: issue-00012
title: "登录页面布局不符合设计稿"
type: bug | feature | security | performance | ui
sprint: sprint-002
related_task: task-00007
reporter: qa
assignee: coder1
status: open | in_progress | resolved | closed
priority: low | medium | high | critical
worktree: fix/issue-00012
design_spec_ref:                            # UI 问题必填，结构化引用（避免自由文本标题漂移）
  component_file: "docs/design/ui/components/login-form.md"
  acceptance_item: 3                        # DOM Contract "Playwright 必须覆盖的验收用例" 第几条（1-based）
  tc_id: "tc-00023"                         # 对应已生成的测试用例 ID（可选，便于回溯）
impact_scope: [task-00007]  # fix 合并后 qa 需对这些 task 的测试用例做回归
created_at: 2024-01-16T09:00:00Z
updated_at: 2024-01-16T11:00:00Z
---

## 问题描述
[详细描述，含截图引用或文档引用]

## 复现步骤
1. 步骤1
2. 步骤2

## 期望行为 vs 实际行为
期望: ...
实际: ...

## 参考
- docs/design/ui/ui-design-v2.md#login-page

## 修复报告
（由 coder 填写）
status: resolved
fix_summary: ""
changed_files: []
merge_ready: true
```

#### sprint-{id}.md

```markdown
---
id: sprint-002
epic: epic-001
title: "用户管理模块开发"
status: planning | in_progress | completed | delivered
start_date: 2024-01-15
end_date: 2024-01-26
goal: "完成用户注册、登录、权限管理功能"
---

## 任务列表
| Task ID | 标题 | 状态 | 负责人 |
|---------|------|------|--------|
| task-00007 | 实现用户注册接口 | completed | coder1 |

## 测试状态
qa_status: pending | in_progress | passed | failed
test_report: .myrmidon/runtime/test-reports/sprint-002.json

## 交付状态
client_confirmed: false | true | auto_approved
confirmed_at: ~
```

#### DECISIONS.md（架构决策记录）

```markdown
## D-{3位数字}  {YYYY-MM-DD}  {决策标题}

**决策**：{具体选择了什么}
**原因**：{为什么做此决定（约束、权衡、背景）}
**影响范围**：{受此决策影响的 task 或模块列表}
**决策者**：{arch | pm | orchestrator+甲方}
```

示例：
```markdown
## D-003  2024-01-15  JWT 无状态认证

**决策**：使用 JWT 替代 session-based 认证。
**原因**：水平扩展无需 session 共享，减少 Redis 依赖。
**影响范围**：所有 auth 相关 task（task-00003 ~ task-00006）。
**决策者**：arch
```

> 只追加，不修改历史记录。arch 在详细设计阶段创建并维护此文件；orchestrator 在每次 dispatch prompt 中注入最新的 DECISIONS.md 摘要（最近 6 条）。

#### components/{name}.md（UI 组件规范，含 DOM Contract）

```markdown
---
id: comp-login-form
title: "LoginForm 组件"
page: /login
designer: ui
status: draft | approved
version: 1
---

## 视觉规范
[颜色、间距、字体、响应式断点等叙述性描述，参考 tokens.md]

## DOM Contract（机器可读 — coder 实现此合约，qa 从此生成 Playwright 测试）

### 必须存在的元素
| data-testid        | HTML 类型 | 必要属性                              | 条件  |
|--------------------|-----------|--------------------------------------|-------|
| email-input        | input     | type="email" required aria-label="Email" | 始终  |
| password-input     | input     | type="password" required             | 始终  |
| submit-button      | button    | type="submit"                        | 始终  |
| error-message      | div       | role="alert"                         | 仅错误状态 |
| loading-indicator  | span      | aria-live="polite"                   | 仅加载状态 |

### 状态机
| 状态      | submit-button        | error-message | loading-indicator | 触发条件       |
|-----------|----------------------|---------------|--------------------|----------------|
| idle      | enabled，文字="登录" | hidden        | hidden             | 初始           |
| loading   | disabled，文字="登录中..." | hidden   | visible            | 提交中         |
| error     | enabled，文字="登录" | visible，显示服务端消息 | hidden  | 服务端 4xx     |
| success   | —                    | —             | —                  | 跳转 /dashboard|

### Playwright 必须覆盖的验收用例（qa 直接从此列表生成测试）
- [ ] 空 email 提交 → email-input 触发 required 验证，不发起请求
- [ ] 有效凭证提交 → 跳转 /dashboard，URL 变更
- [ ] 无效凭证提交 → error-message 可见，文字来自服务端响应
- [ ] 提交中状态 → submit-button 禁用，loading-indicator 可见
- [ ] Tab 键顺序：email-input → password-input → submit-button（顺序一致）
- [ ] Enter 键在任意 input 上触发提交
- [ ] WCAG AA：所有文字颜色对比度 ≥ 4.5:1（使用 axe-core 检测）

### 不检查项（排除范围，防止过度约束）
- 具体像素值、字体大小（参考 tokens.md，允许主题差异）
- 动画过渡时间
```

> **重要**：DOM Contract 是 ui agent、coder（FE）、qa 三方的**唯一共同合约**。
> - ui agent：填写 DOM Contract（与视觉规范同时产出）
> - coder（FE）：实现时确保所有 `data-testid` 存在且符合状态机定义
> - qa：从"Playwright 必须覆盖的验收用例"直接生成测试，不再解读叙述性文字

### 6.4 Dispatch Prompt Schema

orchestrator 为每个 task 构建的 dispatch prompt 遵循以下结构（TypeScript 类型定义，实现层必须满足）：

```typescript
interface DispatchPrompt {
  // 任务核心信息
  task: {
    id: string;                    // 'task-00007'
    title: string;
    description: string;
    steps: string[];               // 3-7 个步骤
    acceptanceCriteria: string[];
    contextEstimate: 'small' | 'medium' | 'large';
  };

  // Sprint / Epic 上下文（摘要，不含完整内容）
  sprintGoal: string;              // sprint.md 中的 goal 字段
  boundaryMap: {                   // 仅含本 task 相关的 produces/consumes 条目
    produces: string[];
    consumes: string[];
  };

  // 上游依赖摘要（来自已完成 dependency task 的 SUMMARY 字段）
  dependencySummaries: Array<{
    taskId: string;
    summary: string;               // task-{id}.md 的 summary 字段（≤200 字）
  }>;

  // 架构决策记录（最近 6 条，由 orchestrator 从 DECISIONS.md 提取）
  recentDecisions: Array<{
    id: string;                    // 'D-003'
    title: string;
    decision: string;
  }>;

  // Agent 宪法（代码层强制注入，不可由 agent 修改）
  constitution: {
    role: string;
    allowedTools: string[];
    forbiddenTools: string[];
    skills: string[];
    mcpTools: string[];
    contextRecoveryInstructions: string;  // 见 9.3 Session Start
    outputLanguage: string;              // project.lang
  };

  // App 特定覆盖（monorepo 时注入，见 9.1 apps.coderOverrides）
  appOverrides?: {
    appName: string;
    additionalRules: string;       // apps.{name}.coderOverrides.rulesFile 内容
    additionalSkills: string[];
  };
}
```

prompt 总 token 数由 `dispatch.maxDispatchPromptTokens`（默认 8000）控制；超出时按优先级截断：constitution → task → dependencySummaries → recentDecisions。

### 6.5 SQLite Schema（myrmidon.db）

真相源。所有运行时状态均在此，STATE.md 是其渲染投影。

```sql
-- 工作流主表（单行，id=1）
CREATE TABLE workflow (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  state                     TEXT NOT NULL DEFAULT 'IDLE',
  current_phase             TEXT,
  current_epic              TEXT,
  current_sprint            TEXT,
  workflow_node             TEXT,
  started_at                TEXT,
  updated_at                TEXT,
  pending_confirmation      TEXT,
  confirmation_requested_at TEXT,
  next_poll_at              TEXT
);

-- Agent 状态表
CREATE TABLE agents (
  name          TEXT PRIMARY KEY,   -- 'pm' | 'arch' | 'coder1' | ...
  status        TEXT NOT NULL,      -- 'idle' | 'working' | 'completed' | 'error' | 'stuck' | 'paused'
  current_task  TEXT,
  worktree      TEXT,
  started_at    TEXT,
  updated_at    TEXT,
  waiting_for   TEXT               -- JSON array of task_ids, nullable
);

-- Task 状态表
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,  -- 'task-00007'
  sprint        TEXT,
  assignee      TEXT,
  status        TEXT NOT NULL,     -- 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed'
  worktree      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  retry_count   INTEGER DEFAULT 0
);

-- Worktree 注册表
CREATE TABLE worktrees (
  branch      TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  task_id     INTEGER NOT NULL,      -- 对应 task 的全局 ID（用于端口计算）
  port        INTEGER NOT NULL,      -- 实际分配端口（= basePort + taskId % 1000）
  agent       TEXT,
  created_at  TEXT,
  status      TEXT DEFAULT 'active'  -- 'active' | 'merged' | 'cleaned'
);

-- Git 操作记录（不提交 git，仅本地审计）
CREATE TABLE git_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,   -- 'MERGE' | 'CLEANUP' | 'REBASE' | 'CREATE'
  branch      TEXT NOT NULL,
  target      TEXT,            -- merge 目标分支（如 'develop'）
  result      TEXT NOT NULL,   -- 'SUCCESS' | 'CONFLICT' | 'FAILED'
  detail      TEXT,            -- 错误信息或冲突文件列表（JSON）
  created_at  TEXT NOT NULL
);

-- 定时器事件记录（见 10.6）
CREATE TABLE timer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id    TEXT NOT NULL,        -- 'workflow-poll' | 'agent-heartbeat' | ...
  event       TEXT NOT NULL,        -- 'completed' | 'skipped' | 'error'
  created_at  TEXT NOT NULL,
  duration_ms INTEGER,
  detail      TEXT
);

-- Agent session 审计索引（日志文件见 3.7）
CREATE TABLE agent_sessions (
  id          TEXT PRIMARY KEY,          -- '{agent-id}-{timestamp}-{rand}'
  agent_id    TEXT NOT NULL,             -- 'coder1' | 'qa' | ...
  task_id     TEXT,                      -- 关联 task，可为空（如 orchestrator 自身 session）
  start_time  TEXT NOT NULL,
  end_time    TEXT,
  exit_status TEXT,                      -- 'success' | 'error' | 'timeout' | 'live'
  file_path   TEXT NOT NULL              -- .myrmidon/logs/{agent-id}/{id}.jsonl
);

-- 配置元数据
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

**STATE.md（派生投影示例）：**
```markdown
# STATE  2024-01-15T14:30:00Z
phase: development  sprint: sprint-002

| Agent   | Status  | Task       | Worktree            | Port |
|---------|---------|------------|---------------------|------|
| coder1  | working | task-00007 | feature/task-00007  | 4100 |
| coder2  | working | task-00008 | feature/task-00008  | 4200 |
| qa      | waiting | —          | —                   | —    |
```

### 6.6 Worktree 注册表（SQLite worktrees 表）

Worktree 注册数据存储在 SQLite `worktrees` 表（见 6.5 Schema）。  
`myrmidon worktree list` 输出来自此表；人工查看可运行：

```bash
myrmidon worktree list
# 或直接查询
sqlite3 .myrmidon/runtime/myrmidon.db "SELECT branch, path, port, agent, status FROM worktrees"
```

**查询示例输出：**
```
branch                    path                                      port  agent   status
feature/task-00007        ../worktrees/my-ecommerce-task-00007      4100  coder1  active
feature/task-00008        ../worktrees/my-ecommerce-task-00008      4200  coder2  active
feature/task-00009        ../worktrees/my-ecommerce-task-00009      4300  coder1  cleaned
```

---

## 7. Validator / Checker 逻辑设计

### 7.1 设计原则

所有 Validator 均为**非 LLM 代码逻辑**，快速执行，避免引入不可控性。校验失败时返回结构化错误，orchestrator 据此决定是重试、回退还是告警。

### 7.2 Input Validator（节点前置校验）

在 orchestrator 分配任务给 Agent 前执行，确保输入满足规范。

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  code: string;       // 错误码，如 "FILE_NOT_FOUND"
  path: string;       // 涉及的文件路径
  message: string;
}
```

**各节点 Input Validator 规则：**

| 节点 | 校验规则 |
|------|---------|
| pm（需求评审后） | `requirements-raw.md` 存在 && 非空 && `modules.md` 存在 |
| pm（PRD 编写） | `modules.md` && `tech-stack.md` 均存在且非空 |
| arch（技术设计） | `prd-v*.md` 最新版本存在 && pm status: approved |
| arch（任务拆分） | `sprint-{id}.md` status: planning && arch status: approved |
| coder | `task-{id}.md` 存在 && status: pending && 依赖 task 均为 completed && `context_estimate` 在阈值内 |
| qa（测试用例生成） | `sprint-{id}/sprint.md` 存在 && arch status: approved && UI task 对应 components/*.md 均含完整 DOM Contract |
| qa（执行测试） | 所有 sprint tasks status: completed && develop 分支存在 && security agent status: completed（无 critical/high open issue） |
| security | 目标文档或分支已存在 |

**任务 DAG 校验（arch 提交整批任务后立即执行，非 LLM，纯代码逻辑）：**

```typescript
function validateTaskDag(tasks: Task[]): ValidationResult {
  // 规则 1: 循环依赖检测（DFS + 标记）
  detectCycles(tasks);  // 抛出 CIRCULAR_DEPENDENCY 错误

  // 规则 2: produces/consumes 一致性
  for (const task of tasks) {
    for (const consume of task.consumes) {
      // consume 格式: "task-XXXXX → {artifact}"
      const [depTaskId, artifact] = parseConsume(consume);
      const depTask = tasks.find(t => t.id === depTaskId);
      if (!depTask) throw new Error(`UNKNOWN_DEPENDENCY: ${depTaskId}`);
      if (!depTask.produces.some(p => p.includes(artifact))) {
        throw new Error(`PRODUCES_MISMATCH: ${task.id} consumes ${artifact} from ${depTaskId}, but ${depTaskId}.produces doesn't include it`);
      }
    }
  }

  // 规则 3: infrastructure task 无 consumes（必须是叶节点）
  for (const task of tasks.filter(t => t.type === 'infrastructure')) {
    if (task.consumes.length > 0) {
      throw new Error(`INFRA_HAS_DEPS: infrastructure task ${task.id} must not have consumes`);
    }
  }

  // 规则 4: route/shared task 不能依赖同一 app 中比自己 priority 更低的 task
  // （防止调度顺序倒置）
  validatePriorityOrdering(tasks);
}
```

校验失败 → orchestrator 驳回整批任务，返回详细错误给 arch → arch 修正后重提交。

### 7.3 Output Validator（节点后置校验）

Agent 报告完成后，orchestrator 执行 Output Validator 确认产物符合规范。

**通用字段校验（所有 Agent）：**
- `status` 字段存在且值合法
- `summary` 字段存在且非空
- 所有声明的 `artifacts` 文件均已实际存在

**特定节点后置校验：**

| 节点 | 额外校验规则 |
|------|------------|
| pm（wireframe/PRD） | 文件头部 frontmatter 完整；包含必要章节标题 |
| arch（task 拆分） | 每个 `task-{id}.md` frontmatter 完整；`acceptance_criteria` 非空；`estimated_hours` 为正整数 |
| coder | `changed_files` 非空；`test_result: passed`；对应 worktree 分支存在且有提交 |
| qa（测试用例） | 每个 `tc-{id}.md` 包含 `steps` 和 `expected_result` 字段 |
| qa（测试报告） | `test_cases_total` == 已有 tc 文件数；`issues` 列表中每个 id 对应文件存在 |

### 7.4 Workflow State Checker（Orchestrator 轮询逻辑）

orchestrator 每 `pollIntervalSeconds`（默认 30 秒）执行一次状态检查。**所有状态读写直接操作 SQLite**，STATE.md 仅在检查后异步刷新（供人工 review）。

```
CHECK_LOOP:
  db = openDb('.myrmidon/runtime/myrmidon.db')

  // 查询所有 in_progress agent
  agents = db.query("SELECT * FROM agents WHERE status IN ('working','error')")

  FOR EACH agent:
    IF agent.status == 'completed':
      运行 Output Validator
      IF 校验通过:
        db.run("UPDATE workflow SET node = ? WHERE id = 1", nextNode)
        推进状态机至下一节点
      ELSE:
        db.run("UPDATE agents SET status = 'error' WHERE name = ?", agent.name)
        向 orchestrator 告警
        触发 stuck 检测（见 10.5）

  // 检查客户端超时
  pending = db.get("SELECT * FROM workflow WHERE pending_confirmation IS NOT NULL")
  IF pending:
    elapsed = now() - pending.confirmation_requested_at
    IF elapsed > warningMinutes: 发送提醒通知
    IF elapsed > autoApproveMinutes AND 在 autoApprove 时间范围内:
      db.run("UPDATE workflow SET pending_confirmation = NULL")
      自动标记 approved，推进流程

  // 检查 join 条件（所有依赖 task 完成）
  waiting = db.query("SELECT * FROM tasks WHERE status = 'waiting' AND ...")
  FOR EACH task IN waiting:
    deps_done = db.get("SELECT COUNT(*) = 0 ... WHERE status != 'completed'")
    IF deps_done: 触发 task 分配

  // 刷新 STATE.md（人工可读视图，非状态驱动）
  db.run("UPDATE workflow SET next_poll_at = ?", now() + pollInterval)
  refreshStateMdAsync()
```

### 7.5 File Format Validator（文件格式校验）

> **注意**：File Format Validator 操作对象是 Markdown 文档（docs/ 目录下的产物），与 SQLite 中的状态数据无关。

用于 `myrmidon status` 和 `myrmidon resume` 前的健康检查。

```typescript
// 校验所有 task 文件的 frontmatter 完整性
validateAllTaskFiles(sprintDir: string): ValidationResult

// 校验 SQLite worktrees 表与 git worktree list 一致
validateWorktreeRegistry(): ValidationResult

// 校验 SQLite workflow/agents 表与文件系统状态一致（task 文件存在性等）
validateStateConsistency(): ValidationResult
```

### 7.6 Recovery Validator（断点恢复前校验）

`myrmidon resume` 执行前运行，确保可安全恢复。

```
1. 校验 .myrmidon/runtime/myrmidon.db 存在且可打开（SQLite integrity check）
2. 从 SQLite 读取 current_phase/epic/sprint/node，校验对应文档存在
3. 对每个 SQLite 中 status = 'working' 的 agent:
   a. 检查对应 worktree 是否存在（coder）
   b. 检查 agent 进程是否仍在运行
   c. 如进程不在：UPDATE agents SET status = 'error' WHERE name = ?
      在 resume 时重新分配
4. 从 SQLite 读取 worktree 注册表，与 git worktree list 对比
5. 如有不一致：报告差异，询问用户是否继续
```

---

## 8. Worktree 管理脚本与 Git Flow

### 8.1 分支命名规范

| 分支类型 | 命名格式 | 示例 | 创建者 |
|---------|---------|------|--------|
| 主分支 | `main` | `main` | 初始化时创建 |
| 集成分支 | `develop` | `develop` | 初始化时创建 |
| 功能分支 | `feature/task-{id}` | `feature/task-00007` | orchestrator（worktree create）|
| 修复分支 | `fix/issue-{id}` | `fix/issue-00012` | orchestrator（worktree create）|
| 发布分支 | `release/{version}` | `release/1.0.0` | orchestrator（手动触发）|

### 8.2 端口分配机制

```
端口分配策略:
  app.basePort + taskId % 1000

  每个 app 有独立的 basePort，各占 1000 端口区间，互不重叠。
  task ID 全局唯一递增，% 1000 确保端口在区间内唯一。
  同时活跃的 worktree 远小于 1000，实践中不会碰撞。

单项目（顶层 basePort）:
  task-00007 → 31007
  task-00042 → 31042
  task-01005 → 31005  （1005 % 1000 = 5；与 task-00005 同端口，但不会同时活跃）

Monorepo（每 app 独立 basePort）:
  backend  basePort=31000: task-00007 → 31007
  frontend basePort=32000: task-00007 → 32007
  第三 app  basePort=33000: task-00007 → 33007

端口分配流程（worktree create 时）:
  1. 从 task.app 字段读取对应 app.basePort（单项目取顶层 basePort）
  2. port = basePort + taskId % 1000（确定性计算，无需分配表）
  3. 校验端口未被占用（lsof -i :{port}）
     - 未占用 → 继续
     - 已占用（碰撞，通常因 task-00005 与 task-01005 同端口）:
         port = basePort + taskId % 1000 + 500  # 偏移 500 重试一次
         若仍冲突 → 报错，要求人工手动指定 --port
  4. INSERT INTO worktrees（BEGIN IMMEDIATE 事务，防并发写冲突）

  同时活跃的 worktree 通常远小于 500，偏移 500 足以避免碰撞；
  若项目规模极大（>500 并发 worktree），改用 SQLite 端口租约表替代公式。
```

### 8.3 Worktree 生命周期脚本

以下脚本封装在 `myrmidon worktree` 命令中，也可单独作为 shell 脚本使用。

#### `worktree-create.sh`

```bash
#!/usr/bin/env bash
# myrmidon worktree create <task-id> [--base <branch>] [--app <name>]
# worktree 即 git 原生 worktree，此脚本只做: 计算端口 + git worktree add + 注册 SQLite
set -euo pipefail

TASK_ID="${1:?Task ID required (e.g. 7)}"
shift
BASE="develop"
APP=""

# 解析命名参数（避免 $2 同时被 BASE 和 APP 使用的冲突）
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --app)  APP="$2";  shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_BASE_REL=$(myrmidon config get git.worktreeBaseDir)
WORKTREE_BASE="$(cd "$PROJECT_ROOT" && realpath "$WORKTREE_BASE_REL")"

# 单项目取顶层 basePort；monorepo 取 apps.{app}.basePort
if [ -n "$APP" ]; then
  BASE_PORT=$(myrmidon config get "apps.${APP}.basePort")
else
  BASE_PORT=$(myrmidon config get basePort)
fi

# 端口 = basePort + taskId % 1000（确定性计算，无需分配表）
PORT=$(( BASE_PORT + TASK_ID % 1000 ))

# 校验端口未被占用
if lsof -i ":$PORT" &>/dev/null; then
  echo "ERROR: Port $PORT already in use (task-$(printf '%05d' $TASK_ID))." >&2
  exit 1
fi

BRANCH="feature/task-$(printf '%05d' $TASK_ID)"
PROJECT_NAME=$(basename "$PROJECT_ROOT")
WORKTREE_PATH="${WORKTREE_BASE}/${PROJECT_NAME}-task-$(printf '%05d' $TASK_ID)"

# git 原生命令，无额外封装
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE"

# 注册到 SQLite（记录 task_id 和 port，供 status 面板展示）
myrmidon worktree register \
  --task-id "$TASK_ID" \
  --branch  "$BRANCH" \
  --path    "$WORKTREE_PATH" \
  --port    "$PORT"

echo "✅ Worktree: $WORKTREE_PATH"
echo "   Branch:   $BRANCH"
echo "   Port:     $PORT"
```

#### `worktree-merge.sh`

```bash
#!/usr/bin/env bash
# myrmidon worktree merge <branch> [--target <branch>] [--app <name>]
set -euo pipefail

BRANCH="${1:?Branch name required}"
shift
TARGET="develop"
APP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --app)    APP="$2";    shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PROJECT_ROOT="$(git rev-parse --show-toplevel)"

# 从 SQLite 查询 worktree 路径（使用 info 子命令）
WORKTREE_PATH=$(myrmidon worktree info "$BRANCH" --field path)

# 读取 app 专属测试命令（monorepo：apps.{app}.testCmd；单项目：testCmd）
if [ -n "$APP" ]; then
  TEST_CMD=$(myrmidon config get "apps.${APP}.testCmd")
else
  TEST_CMD=$(myrmidon config get testCmd)
fi

# 在 worktree 中运行测试（确保测试通过才允许合并）
echo "Running tests in worktree: $TEST_CMD"
(cd "$WORKTREE_PATH" && eval "$TEST_CMD") || {
  echo "ERROR: Tests failed. Fix issues before merging." >&2
  exit 1
}

# 切换到目标分支，rebase 后合并（减少冲突）
git fetch origin "$TARGET"
git -C "$WORKTREE_PATH" rebase "origin/$TARGET" || {
  echo "ERROR: Rebase conflicts detected. Resolve conflicts in $WORKTREE_PATH then retry." >&2
  exit 1
}
git checkout "$TARGET"
git merge --no-ff "$BRANCH" -m "merge: $BRANCH → $TARGET"

echo "✅ Merged $BRANCH into $TARGET"
```

#### `worktree-cleanup.sh`

```bash
#!/usr/bin/env bash
# myrmidon worktree cleanup <branch>
set -euo pipefail

BRANCH="${1:?Branch name required}"
PROJECT_ROOT="$(git rev-parse --show-toplevel)"

# 从 SQLite 查询 worktree 路径（使用 info 子命令）
WORKTREE_PATH=$(myrmidon worktree info "$BRANCH" --field path)

# 移除 worktree
git worktree remove "$WORKTREE_PATH" --force

# 删除本地分支
git branch -d "$BRANCH" 2>/dev/null || git branch -D "$BRANCH"

# 更新 SQLite worktrees 表 status → 'cleaned'（cleanup 命令内部处理，无需单独调用）
myrmidon worktree register --branch "$BRANCH" --status cleaned

echo "✅ Worktree cleaned up: $BRANCH"
```

### 8.4 Git Flow 完整规范

```
分支保护规则:
  main:
    - 禁止直接 push
    - 只能通过 PR 合并
    - 合并前必须通过 CI 校验
    - 必须至少 1 人审批（人类审批，非 Agent）

  develop:
    - 禁止直接 push（Agent 通过 worktree merge 命令合并）
    - 合并前必须通过 worktree-merge.sh 中的测试
    - 合并策略: --no-ff（保留合并记录）

  feature/* / fix/*:
    - Agent 在 worktree 中操作，不影响主仓库
    - 完成后由 orchestrator 触发合并到 develop
    - 合并后立即删除（通过 cleanup）

合并职责矩阵:
  feature/task-* → develop:   orchestrator 触发，代码层自动合并
  fix/issue-*   → develop:   orchestrator 触发，代码层自动合并
  develop       → main:       orchestrator 创建 PR，人类审批并合并
  release/*     → main:       orchestrator 创建 PR，人类审批并合并

commit 规范（遵循 Conventional Commits）:
  feat(scope): 功能描述        # coder 新功能
  fix(scope): 修复描述         # coder bug 修复
  docs(scope): 文档变更        # pm/arch/ui 文档产出
  test(scope): 测试变更        # qa 测试用例
  refactor(scope): 重构        # coder 重构
  chore(scope): 杂项          # 配置变更等

  scope 示例: user-auth, product-crud, order-flow
```

### 8.5 测试策略

| 测试类型 | 在哪个分支运行 | 由谁触发 | 时机 |
|---------|-------------|---------|------|
| 单元测试 | `feature/task-*`（worktree 内）| coder 自测 | 开发完成后，merge 前 |
| 合并前测试 | `feature/task-*`（worktree 内）| worktree-merge.sh 自动 | merge 到 develop 前 |
| 集成测试 | `develop` | qa agent | sprint 所有 task 合并后 |
| 回归测试 | `develop` | qa agent（issue 修复后）| 每次 fix 合并后 |
| 验收测试 | `develop` | orchestrator 准备演示链接 | 交付甲方前 |

**端口使用示例：**

```
develop 分支（QA 测试环境）:  运行在主仓库，端口 3000/3001
feature/task-00007（coder1）: 运行在 worktree，端口 4100/4101
feature/task-00008（coder2）: 运行在 worktree，端口 4200/4201
fix/issue-00012（coder1）:    运行在 worktree，端口 4300/4301
```

### 8.6 多 Agent 并发冲突防护

```
文件锁机制:
  - 每个 task-{id}.md 在 assignee 写入时加文件锁
  - 同一时间只有一个 agent 可以修改同一文件
  - 锁文件: .myrmidon/runtime/locks/{file-hash}.lock

分支冲突预防:
  - worktree 创建时校验目标分支不存在
  - 合并到 develop 前 rebase 到最新 develop
  - develop 更新后广播通知所有活跃 worktree

merge 串行化:
  - orchestrator 维护 merge 队列
  - 同时只处理一个 merge 操作
  - merge 完成后通知下一个等待的 worktree rebase
```

---

## 9. 配置规范

> **阅读说明**：本章描述每个 Agent 的**技术配置**（用哪个模型、哪些 skill、哪些工具）。Agent 的**职责边界**（做什么、产出什么、禁止行为）在第 4 章定义。理解一个 Agent 需同时阅读第 4 章（职责）和本章（配置）。

### 9.1 myrmidon.config.ts

```typescript
import { defineConfig } from 'myrmidon';

export default defineConfig({
  project: {
    name: 'my-ecommerce',
    lang: 'zh',                    // 文档输出语言: 'zh' | 'en'
    description: 'B2B2C 电商平台',
  },

  // ─── TUI 配置 ────────────────────────────────────────────────────────────
  tui: {
    lang: 'zh',                    // 'zh' | 'en'，运行时可 :lang 热切换，默认跟随 LANG 环境变量
  },

  // ─── 审计日志配置 ─────────────────────────────────────────────────────────
  audit: {
    retention: '30d',              // 日志保留时长，或填数字表示最多 session 数（如 1000）
  },

  // 单项目端口公式: basePort + taskId % 1000（→ 31000~31999）
  // monorepo 时由 apps.{name}.basePort 各自独立，此值被忽略
  basePort: 31000,

  // ─── 执行器定义 ──────────────────────────────────────────────────────────
  // 声明可用的执行器（runtime + model 组合）。agents 中引用执行器名称。
  // runtime 字段可配置为任意已支持的运行时（见下方 Runtime 支持矩阵）。
  // 如不填 runtime，orchestrator 启动时自动检测（见 Runtime 自动检测规范）。
  executors: {
    'sonnet': {
      runtime: 'claude-code',        // 显式指定；省略则自动检测
      model: 'claude-sonnet-4-6',
      maxContextTokens: 200_000,
    },
    'opus': {
      runtime: 'claude-code',
      model: 'claude-opus-4-7',
      maxContextTokens: 200_000,
    },
    // 多 runtime 混合示例：
    // 'opencode-gpt4o':  { runtime: 'opencode',    model: 'gpt-4o',            maxContextTokens: 128_000 },
    // 'gemini-pro':      { runtime: 'gemini-cli',  model: 'gemini-2.0-pro',    maxContextTokens: 1_000_000 },
    // 'kimi-codex':      { runtime: 'kimi-codex',  model: 'kimi-k2',           maxContextTokens: 128_000 },
  },

  // ─── Agent 角色库 ─────────────────────────────────────────────────────────
  // 定义每种角色的能力边界、系统提示词、工具权限、默认 Skill / MCP。
  // 角色定义与工作流绑定解耦：修改角色定义不影响工作流逻辑，反之亦然。
  // 系统提示词存储在 .myrmidon/prompts/{role}.md（myrmidon init 生成默认模板）。
  agentRoles: {
    pm: {
      displayName: '产品经理',
      description: '负责需求整理、原型设计、PRD 编写、Epics/Sprints 规划',
      systemPromptFile: '.myrmidon/prompts/pm.md',  // 角色系统提示词（静态，session 启动时加载）
      allowedTools:  ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      forbiddenTools: ['Bash', 'Agent'],
      skills: [],      // 引用 skills.registry 中的 name，在此覆盖默认
      mcpServers: [],  // 引用 mcpServers 中的 name
      tokenProfile: 'balanced' as const,
    },
    arch: {
      displayName: '架构师',
      description: '技术评审、详细设计、任务拆分（含 DAG 校验）',
      systemPromptFile: '.myrmidon/prompts/arch.md',
      allowedTools:  ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      forbiddenTools: ['Bash', 'Agent'],
      skills: [],
      mcpServers: [],
      tokenProfile: 'quality' as const,   // arch 需要更详细的推理
    },
    coder: {
      displayName: '开发者',
      description: 'SQL / API 设计、编码实现、单元测试，在分配的 worktree 中工作',
      systemPromptFile: '.myrmidon/prompts/coder.md',
      allowedTools:  ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      forbiddenTools: ['Agent'],
      skills: [],
      mcpServers: [],  // 如需 Playwright 冒烟测试，在此添加
      tokenProfile: 'balanced' as const,
    },
    qa: {
      displayName: '测试工程师',
      description: '生成测试用例、执行 Playwright 端到端测试、提交 issue',
      systemPromptFile: '.myrmidon/prompts/qa.md',
      allowedTools:  ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      forbiddenTools: ['Agent'],
      skills: [],
      mcpServers: [],  // 在此添加 Playwright MCP
      tokenProfile: 'balanced' as const,
    },
    security: {
      displayName: '安全审查',
      description: '审查设计文档和代码变更，识别安全风险，提交 security issue',
      systemPromptFile: '.myrmidon/prompts/security.md',
      allowedTools:  ['Read', 'Glob', 'Grep'],
      forbiddenTools: ['Write', 'Edit', 'Bash', 'Agent'],
      skills: [],
      mcpServers: [],
      tokenProfile: 'quality' as const,
    },
    ui: {
      displayName: 'UI/UX 设计师',
      description: '生成设计稿、组件规范（含 DOM Contract）、设计 Token',
      systemPromptFile: '.myrmidon/prompts/ui.md',
      allowedTools:  ['Read', 'Write', 'Edit', 'Glob'],
      forbiddenTools: ['Bash', 'Agent'],
      skills: [],
      mcpServers: [],
      tokenProfile: 'balanced' as const,
    },
    orchestrator: {
      displayName: 'Orchestrator',
      description: '甲方界面、工作流推进、任务分配（内部角色，不通过 dispatch 启动）',
      systemPromptFile: '.myrmidon/prompts/orchestrator.md',
      allowedTools:  ['*'],   // orchestrator 不受工具限制
      forbiddenTools: [],
      skills: [],
      mcpServers: [],         // 在此添加 GitHub / GitLab MCP
      tokenProfile: 'balanced' as const,
    },
    // ── 自定义角色 ──────────────────────────────────────────────────────────
    // 可添加项目特定角色，例如:
    // 'data-engineer': {
    //   displayName: '数据工程师',
    //   description: '数据管道设计、ETL 实现、数仓建模',
    //   systemPromptFile: '.myrmidon/prompts/data-engineer.md',
    //   allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    //   forbiddenTools: ['Agent'],
    //   skills: ['dbt-workflow'],
    //   mcpServers: [],
    //   tokenProfile: 'balanced',
    // },
  },

  runtime: {
    maxRetries: 3,                 // Agent 失败最大重试次数
  },

  dispatch: {
    // 上下文窗口压力监控（见 10.2）
    contextPressureThreshold: 0.70, // 达到 70% 时发出 wrap-up 信号
    wrapUpSignalMessage: 'Context window is near capacity. Please write continue.md and exit.',

    // 分配 prompt 中注入的最大 token 数（来自 dispatch prompt 构建器）
    maxDispatchPromptTokens: 8000,

    // 工具结果单条最大长度（字符数，超出截断）
    toolResultMaxChars: 800,

    // token profile（控制 Agent 内联注释/推理详细程度）
    tokenProfile: 'balanced' as 'budget' | 'balanced' | 'quality',

    // context_estimate 阈值映射（用于 orchestrator 分配前预校验）
    // arch 填写 small/medium/large，orchestrator 拒绝超过 large 上限的任务
    contextEstimateThresholds: {
      small:  8_000,     // tokens — 简单 CRUD，≤3 文件
      medium: 32_000,    // tokens — 标准功能，≤8 文件（默认推荐）
      large:  100_000,   // tokens — 复杂功能，接近上限，需特别审查
      // 超过 large → orchestrator 拒绝 dispatch，要求 arch 拆分
    },
  },

  contextManagement: {
    // 观测掩码（in-session 上下文优化）
    observationMasking: {
      enabled: true,
      keepRecentTurns: 8,          // 保留最近 N 轮 tool result，更早的替换为占位符
    },

    // 预压缩快照（Claude Code 上下文压缩前写入）
    preCompactionSnapshot: {
      enabled: true,
      maxBytes: 2048,              // ≤2KB 快照文件
      path: '.myrmidon/runtime/last-snapshot.md',
    },

    // 阶段锚点（phase 切换时写入，注入下一 phase 的 dispatch prompt）
    phaseAnchors: {
      enabled: true,
      dir: '.myrmidon/runtime/anchors',
    },

    // 沙箱化命令输出（长输出写磁盘，只返回摘要给 Agent）
    sandboxedExec: {
      enabled: true,
      outputDir: '.myrmidon/runtime/exec',
      summaryMaxChars: 800,
    },
  },

  // ─── 工作流 Agent 绑定 ───────────────────────────────────────────────────
  // 声明工作流中各 agent 使用哪个角色（agentRoles）和执行器（executors）。
  // skills / mcpServers 未声明时继承 agentRoles 定义；声明则覆盖（override）。
  agents: {
    pm: {
      role: 'pm',                  // 引用 agentRoles.pm
      executor: 'sonnet',          // 引用 executors.sonnet
      enabled: true,
      // override: 项目特定 skill（在角色默认值基础上追加或替换）
      skills: [
        // 'drawio', 'document-skills:docx'
      ],
    },
    arch: {
      role: 'arch',
      executor: 'opus',            // arch 使用更强的模型
      enabled: true,
      skills: [
        // 'writing-plans', 'c4-diagrams'
      ],
    },
    coders: {
      role: 'coder',
      executor: 'sonnet',
      count: 2,                    // 并发 coder 数量
      skills: [
        // 'tdd-backend', 'debugging', 'local:nestjs-crud-gen'
      ],
      mcpServers: [
        // { name: 'playwright', package: '@playwright/mcp', args: [] }
      ],
    },
    qa: {
      role: 'qa',
      executor: 'sonnet',
      enabled: true,
      skills: [
        // 'webapp-testing', 'performance-audit'
      ],
      mcpServers: [
        // { name: 'playwright', package: '@playwright/mcp', args: [] }
      ],
    },
    security: {
      role: 'security',
      executor: 'opus',            // 安全审查需要更仔细的推理
      enabled: true,
      skills: [
        // 'security-review'
      ],
    },
    ui: {
      role: 'ui',
      executor: 'sonnet',
      enabled: true,
      skills: [
        // 'ui-ux-pro-max', 'wcag-checker', 'local:design-token-enforcer'
      ],
      mcpServers: [
        // { name: 'figma', package: '@figma/mcp-server', env: { FIGMA_TOKEN: '...' } }
      ],
    },
    orchestrator: {
      role: 'orchestrator',
      executor: 'sonnet',
      mcpServers: [
        // { name: 'github', package: '@github/mcp', env: { GITHUB_TOKEN: '...' } }
      ],
    },
  },

  // Monorepo 多 App 配置（--template monorepo 时生成）
  // 单项目时省略此配置块
  // 每个 app 独立 basePort，端口公式: basePort + taskId % 1000
  // 各 app 占用独立的 1000 端口区间，完全隔离，无需共享计算
  apps: {
    backend: {
      root: 'apps/backend',           // 相对于项目根目录
      testCmd: 'npm test',            // worktree 内运行单元测试的命令
      devCmd: 'npm run dev',          // dev server 启动命令
      basePort: 31000,                // 端口区间: 31000~31999（31000 + taskId % 1000）

      // ── per-app coder 覆盖（Option C 两层混合）────────────────────────────
      // dispatch 时与 agentRoles.coder 合并：agentRoles 提供基础能力边界，
      // coderOverrides 追加/覆盖 app 专属内容（优先级高于 agentRoles）
      coderOverrides: {
        systemPromptAppend: '.myrmidon/prompts/coder-backend.md',
        // 内容追加到 agentRoles.coder.systemPromptFile 之后，不替换
        // 典型内容: NestJS 目录规范、TypeORM 使用约束、DTO 命名规则等

        skills: [
          // 'tdd-backend', 'nestjs-crud-gen'
          // 在 agentRoles.coder.skills 基础上追加
        ],

        additionalRules: [
          // 代码规约规则（字符串或文件路径），注入 coder 的工具权限白名单之后
          // 示例: '不得使用 any 类型', '.claude/rules/backend-nestjs.md'
        ],
      },

      // ── per-app AI 评审规则 ────────────────────────────────────────────────
      // arch / security agent 评审此 app 代码时，orchestrator 额外注入这些规则
      reviewRules: {
        rulesFile: '.myrmidon/prompts/review-backend.md',
        // 典型内容: 分层架构边界检查、禁止直接访问 DB 层、必须有 DTO 校验等
        checklistItems: [
          // '所有 Controller 方法必须有对应 DTO 类型',
          // 'Service 层不得直接 import Repository 以外的类',
        ],
      },
    },

    frontend: {
      root: 'apps/frontend',
      testCmd: 'npm test',
      devCmd: 'npm run dev',
      basePort: 32000,                // 端口区间: 32000~32999，与 BE 完全隔离

      coderOverrides: {
        systemPromptAppend: '.myrmidon/prompts/coder-frontend.md',
        // 典型内容: React 组件规范、Tailwind 使用约束、data-testid 强制规则等
        skills: [],
        additionalRules: [],
      },

      reviewRules: {
        rulesFile: '.myrmidon/prompts/review-frontend.md',
        checklistItems: [
          // '所有交互元素必须有 data-testid',
          // '不得在组件内直接调用 API，必须通过 hook 或 service',
        ],
      },
    },
    // 第三个 app 示例: basePort: 33000
  },

  // 跨项目外部依赖（FE/BE 分离仓库时使用，项目级配置，不属于任何单个 app）
  externalDependencies: [
    // { name: 'backend-api-spec', path: '../my-backend/docs/design/architecture/api.md',
    //   watchFor: 'changes' }
    // orchestrator 轮询时检查该文件，变更则触发 FE 相关 task 解锁
  ],

  // 全局 MCP 服务器（所有 agent 均可使用，受各自 toolPolicy 约束）
  mcpServers: [
    {
      name: 'filesystem',
      package: '@modelcontextprotocol/server-filesystem',
      args: ['--root', '.'],          // 限制在项目根目录
    },
  ],

  git: {
    baseBranch: 'main',
    developBranch: 'develop',
    worktreeBaseDir: '../worktrees',  // worktree 存放目录（相对于项目根目录）
  },

  notifications: {
    enabled: false,
    channels: [],                     // 见 9.2

    clientTimeout: {
      warningMinutes: 5,              // 多少分钟后发送催促通知
      autoApproveMinutes: 10,         // 多少分钟后自动通过
      autoApproveTimeRange: {         // 仅在此时间范围内自动通过
        start: '20:00',               // 晚上 8 点
        end: '08:00',                 // 早上 8 点
      },
    },
  },

  stuckDetection: {
    enabled: true,
    // 规则详见 10.5
    sameErrorConsecutive: 2,         // 同一错误连续出现 N 次 → stuck
    sameUnitConsecutive: 3,          // 同一 unit 连续分配 N 次 → stuck
    oscillationWindow: 4,            // 最近 N 次分配中出现 A→B→A→B 模式 → stuck
    sameEnoentConsecutive: 2,        // 同一 ENOENT 路径连续出现 N 次 → stuck
    retryBudget: 2,                  // 每个 unit 最多自动重试 N 次才触发 stuck
  },

  // Skill 包管理（来源声明 + 安装策略）详见 9.4.2 和 myrmidon skills 命令（2.12）
  skills: {
    registry: [
      // 每条声明一个 skill 的来源，格式:
      //
      // npm 包（推荐用于公开发布的 skill）:
      // { name: 'drawio', source: { type: 'npm', package: '@myrmidon-skills/drawio', version: '^2.0.0' } }
      //
      // git 仓库（适合私有团队 skill 或指定版本）:
      // { name: 'ui-ux-pro-max', source: { type: 'git', url: 'https://github.com/team/skill.git', ref: 'v3.1.0' } }
      //
      // npx（每次 dispatch 按需拉取，无需安装，适合公共 skill 保持最新）:
      // { name: 'webapp-testing', source: { type: 'npx', package: 'superpowers-webapp-testing@latest' } }
      //
      // local（项目内编写，不安装，直接引用路径）:
      // { name: 'nestjs-crud-gen', source: { type: 'local', path: './.claude/skills/nestjs-crud-gen' } }
    ],
    installDir: '.claude/skills',    // npm / git 类型 skill 的安装目录
    autoInstall: true,               // dispatch 时发现 skill 未安装: true=自动安装 / false=报错中止
  },

  workflow: {
    // 可选: 禁用某些阶段（如跳过 UI 设计阶段）
    skipPhases: [],
    // 可选: 自定义每个阶段的最大等待时间（分钟）
    phaseTimeouts: {
      requirements: 1440,            // 24 小时
      review: 120,
      development: 4320,             // 3 天
    },
  },

  // ─── 内置定时器配置 ───────────────────────────────────────────────────────
  // 所有定时器均为强制内置（不可删除），只能通过 intervalSeconds 调节频率。
  // 设置低于 minSeconds 的值会被 orchestrator 拒绝并回退到 minSeconds。
  // 详见 Section 10.6。
  timers: {
    // T1: 主工作流轮询（状态推进、任务分配、join 条件检查）
    workflowPoll: {
      intervalSeconds: 30,           // 默认 30s；生产可调低至 10s，CI 可调高至 120s
      minSeconds: 5,
    },

    // T2: Agent 进程存活心跳（PID 文件 + 进程表检查）
    agentHeartbeat: {
      intervalSeconds: 15,           // 比 workflowPoll 更频繁，尽早发现崩溃
      minSeconds: 5,
    },

    // T3: 客户端确认超时检测（含自动通过规则）
    clientTimeoutCheck: {
      intervalSeconds: 60,           // 检查频率，实际超时规则见 notifications.clientTimeout
      minSeconds: 30,
    },

    // T4: Stuck 检测扫描（独立于主轮询，可单独调节）
    stuckDetection: {
      intervalSeconds: 60,
      minSeconds: 10,
    },

    // T5: 状态一致性校验（SQLite worktrees 表 vs git worktree list）
    stateConsistencyCheck: {
      intervalSeconds: 300,          // 5 分钟；不需要太频繁，代价稍高
      minSeconds: 60,
    },

    // T6: 外部依赖文件变更检测（仅 apps.externalDependencies 非空时生效）
    externalDepWatch: {
      intervalSeconds: 60,           // 轮询外部 API spec 文件是否有变更
      minSeconds: 10,
    },
  },
});
```

#### 三层架构引用链（工作流 → 执行器 → 角色）

以下示意图展示工作流阶段如何通过 `agents` → `agentRoles` → `executors` 三层配置解析为一个 Agent session：

**普通 Agent（以 arch 为例）：**

```
工作流阶段（State Machine）
        │
        │ 需要启动 "arch" agent
        ▼
agents.arch
  ├── role: 'arch'          ──► agentRoles.arch
  │                               ├── displayName: '架构师'
  │                               ├── systemPromptFile: '.myrmidon/prompts/arch.md'
  │                               ├── allowedTools: [Read, Write, Edit, Glob, Grep]
  │                               ├── forbiddenTools: [Bash, Agent]
  │                               ├── tokenProfile: 'quality'
  │                               └── mcpServers: []
  │
  └── executor: 'opus'      ──► executors.opus
                                  ├── runtime: 'claude-code'
                                  ├── model: 'claude-opus-4-7'
                                  └── maxContextTokens: 200_000
        │
        ▼
Claude Code session 启动参数:
  --model claude-opus-4-7
  --system-prompt .myrmidon/prompts/arch.md
  --allowed-tools Read,Write,Edit,Glob,Grep
  --max-tokens 200000
  + 动态注入: 任务计划 + 依赖摘要 + DECISIONS.md + Skill 配置
```

**Coder Agent（两层混合 — 含 per-app 覆盖）：**

```
工作流阶段（State Machine）
        │
        │ 需要启动 coder（task.app = 'backend'）
        ▼
agents.coders
  ├── role: 'coder'         ──► agentRoles.coder          【层1: 基础角色】
  │                               ├── systemPromptFile: '.myrmidon/prompts/coder.md'
  │                               ├── allowedTools: [Read, Write, Edit, Bash, Glob, Grep]
  │                               └── skills: []（基础通用 skill）
  │
  └── executor: 'sonnet'    ──► executors.sonnet
                                  ├── runtime: 'claude-code'
                                  └── model: 'claude-sonnet-4-6'
        │
        │ task.app = 'backend' → 读取 apps.backend.coderOverrides  【层2: app 覆盖】
        ▼
apps.backend.coderOverrides
  ├── systemPromptAppend: '.myrmidon/prompts/coder-backend.md'   # 追加到层1 prompt 之后
  ├── skills: ['tdd-backend', 'nestjs-crud-gen']                  # 追加到层1 skills
  └── additionalRules: ['.claude/rules/backend-nestjs.md']        # 追加到宪法规则

        │
        │ orchestrator 合并两层（层2 优先）
        ▼
Claude Code session 启动参数:
  --model claude-sonnet-4-6
  --system-prompt <merged: coder.md + coder-backend.md>
  --allowed-tools Read,Write,Edit,Bash,Glob,Grep
  + 动态注入: 任务计划 + 依赖摘要 + app 专属规则 + 合并后 Skill 列表

【arch / security 评审时额外注入 apps.backend.reviewRules】
  + reviewRules.rulesFile 内容（架构边界规则、安全检查清单）
  + reviewRules.checklistItems 逐条列出
```

**关键解耦点：**
- 修改基础角色能力（`agentRoles`）→ 不影响工作流逻辑和模型选择
- 修改 app 规约（`apps.{name}.coderOverrides`）→ 只影响该 app 的 coder，不影响其他 app 或其他角色
- 切换模型（`executors`）→ 不影响角色定义和工作流逻辑
- 调整工作流绑定（`agents`）→ 可独立为某阶段临时指定不同的角色或执行器
- 添加自定义角色（如 `data-engineer`）→ 只需在 `agentRoles` 新增条目，再在 `agents` 绑定

### 9.2 通知渠道配置

```typescript
// Slack
{
  type: 'slack',
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  channel: '#myrmidon-updates',
}

// 企业微信
{
  type: 'wecom',
  webhookUrl: process.env.WECOM_WEBHOOK_URL,
}

// Email（V2）
{
  type: 'email',
  smtp: { host: '', port: 465, user: '', pass: process.env.SMTP_PASS },
  to: ['client@example.com'],
}
```

### 9.3 Agent 宪法模板

初始化时生成的 `CLAUDE.md` 包含（由 orchestrator 在 dispatch 时根据 agent 类型动态注入）：

```markdown
# Project Constitution — {AgentName}

## Project Context
项目名称：{project.name}
技术栈：{techStack}
当前阶段：{currentPhase} / Sprint：{currentSprint}

## Agent Role
角色：{agentRole}
职责边界：{agentScope}

## Mandatory Rules（强制规则）
- 所有输出文件必须包含完整的 frontmatter
- 任务完成报告必须包含 status/summary/artifacts 字段
- 禁止修改不在授权范围内的文件
- 禁止直接操作 main 和 develop 分支
- 不得修改其他 worktree 的文件

## Session Start — Context Recovery（必须优先执行）
在开始任何工作前，按以下顺序检查：

1. **continue.md**：检查 `.myrmidon/runtime/continue/{task-id}.md` 是否存在。
   如存在，读取并从 `## Next Action` 部分继续，完成后删除该文件。

2. **Pre-compaction snapshot**：如 continue.md 不存在，检查
   `.myrmidon/runtime/last-snapshot.md`。如存在，读取以重建上下文，
   然后读取 task-{id}.md 确认当前任务状态。

3. **Phase anchor**：如以上均无，检查
   `.myrmidon/runtime/anchors/{currentPhase}.json`，
   读取以了解上一阶段的关键产物和决策。

4. 以上均无：正常从 dispatch prompt 中的任务计划开始。

## Context Window Management
- 当 orchestrator 发出 wrap-up 信号时，立即停止新工作：
  1. 将已完成步骤写入 `## Completed Work`
  2. 将未完成步骤写入 `## Remaining Work`
  3. 将本次决策写入 `## Decisions Made`
  4. 将下一步精确动作写入 `## Next Action`（必须足够具体，不得写"继续"）
  5. 保存到 `.myrmidon/runtime/continue/{task-id}.md`，然后退出

## Tool Policy
授权工具：{allowedTools}
禁止工具：{forbiddenTools}

## Skill Priority
优先使用配置的 Skill，不要自行发明实现方式：{agentSkills}

## Output Language
文档输出语言: {project.lang}
```

---

### 9.4 Skill 与 MCP 配置规范

#### 9.4.1 概念区分

| 概念 | 本质 | 示例 |
|------|------|------|
| **Skill** | 基于 prompt 的结构化工作流定义。Agent 通过 `Skill` 工具加载后，按预定步骤（输入→执行→输出）完成任务，减少自由发挥。 | `webapp-testing`：加载后按"生成测试用例 → 运行 Playwright → 写报告"流程执行 |
| **MCP（Model Context Protocol）** | 标准化工具扩展协议，通过 MCP 服务器为 Agent 提供外部能力（浏览器操作、API 调用、数据库查询等）。 | `@playwright/mcp`：提供 `browser_navigate`、`browser_click`、`browser_snapshot` 等工具 |

**核心原则（写入 Agent 宪法强制执行）：**
> Agent 遇到已配置 Skill 的任务类型时，**必须先调用 Skill 工具加载流程，然后按流程执行**，不得跳过 Skill 自行发挥。MCP 工具作为 Skill 执行流程中的操作手段，不得绕过 Skill 直接使用。

#### 9.4.2 Skill 声明与来源配置

Skill 分两层声明：**registry**（声明来源，供包管理器安装）和 **agents.skills**（声明哪个 agent 用哪些 skill）。

**第一层：`skills.registry`（声明 skill 来源）**

```typescript
// myrmidon.config.ts
skills: {
  // 声明本项目使用的所有 skill 及其来源
  registry: [
    // npm 包：从 npm registry 安装，支持语义版本
    {
      name: 'drawio',
      source: { type: 'npm', package: '@myrmidon-skills/drawio', version: '^2.0.0' },
    },

    // git 仓库：从私有或公开 git 仓库拉取，支持 tag / branch / commit hash
    {
      name: 'ui-ux-pro-max',
      source: { type: 'git', url: 'https://github.com/myteam/ui-skill.git', ref: 'v3.1.0' },
    },

    // npx：每次 dispatch 时按需拉取，不持久化安装（适合更新频繁的公共 skill）
    {
      name: 'webapp-testing',
      source: { type: 'npx', package: 'superpowers-webapp-testing@latest' },
    },

    // local：项目本地编写的 skill，直接引用路径，不安装
    {
      name: 'nestjs-crud-gen',
      source: { type: 'local', path: './.claude/skills/nestjs-crud-gen' },
    },
  ],

  // skill 安装目录（npm / git 类型安装到此处）
  installDir: '.claude/skills',

  // dispatch 前如发现 skill 未安装的处理策略:
  //   true  = 自动安装（增加 dispatch 延迟，适合开发环境）
  //   false = 中止 dispatch 并报错（适合 CI，要求预先 myrmidon skills install）
  autoInstall: true,
},
```

**第二层：`agents.{role}.skills`（声明各 agent 使用哪些 skill，引用 registry 中的 name）**

```typescript
agents: {
  pm: {
    skills: ['drawio', 'document-skills:docx'],
  },
  arch: {
    skills: ['writing-plans', 'c4-diagrams'],
  },
  ui: {
    skills: ['ui-ux-pro-max', 'wcag-checker'],
  },
  coders: {
    skills: ['tdd-backend', 'debugging', 'nestjs-crud-gen'],
  },
  qa: {
    skills: ['webapp-testing', 'performance-audit'],
  },
  security: {
    skills: ['security-review'],
  },
},
```

**`skills.lock` 文件（`.myrmidon/skills.lock`）：**

类似 `package-lock.json`，由 `myrmidon skills install` 生成，锁定 npm 包的精确版本号和 git 的 commit hash，确保 CI 与本地环境安装结果一致：

```json
{
  "drawio":        { "type": "npm", "package": "@myrmidon-skills/drawio", "resolved": "2.1.3", "integrity": "sha512-..." },
  "ui-ux-pro-max": { "type": "git", "url": "...", "ref": "v3.1.0", "commit": "a3f8c21" },
  "webapp-testing": { "type": "npx", "package": "superpowers-webapp-testing@latest" },
  "nestjs-crud-gen": { "type": "local", "path": "./.claude/skills/nestjs-crud-gen" }
}
```

orchestrator 在 dispatch 时将 agent 配置的所有 skills 注入宪法，**Agent 必须先加载对应 Skill 工具，再开始相关任务，不得跳过**。

#### 9.4.3 MCP 配置方式

MCP 服务器同样完全配置驱动，无预设列表。按两个层级配置：

**全局 MCP**（所有 agent 均可使用，受各自 toolPolicy 约束）：
```typescript
mcpServers: [
  {
    name: 'filesystem',
    package: '@modelcontextprotocol/server-filesystem',
    args: ['--root', '.'],
  },
  {
    name: 'figma',                       // 项目使用 Figma MCP 获取设计稿
    package: '@figma/mcp-server',
    env: { FIGMA_TOKEN: process.env.FIGMA_TOKEN },
  },
]
```

**Agent 级 MCP**（只挂载到指定 agent）：
```typescript
agents: {
  qa: {
    mcpServers: [
      { name: 'playwright', package: '@playwright/mcp', args: [] },
      { name: 'lighthouse', package: '@lhci/mcp', args: [] },
    ],
  },
  ui: {
    mcpServers: [
      { name: 'figma', package: '@figma/mcp-server',
        env: { FIGMA_TOKEN: process.env.FIGMA_TOKEN } },
    ],
  },
  orchestrator: {
    mcpServers: [
      { name: 'github', package: '@github/mcp',
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
      { name: 'linear', package: '@linear/mcp',      // 项目用 Linear 管理 issue
        env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY } },
    ],
  },
}
```

**MCP 服务器声明格式（三种启动方式）：**

```typescript
// 方式1: npm 包（自动 npx 启动）
{ name: 'playwright', package: '@playwright/mcp', args?: [], env?: {} }

// 方式2: 本地命令（自定义脚本）
{ name: 'my-api', command: 'node', args: ['./tools/mcp.js'], env?: {} }

// 方式3: 远程 SSE（已运行的 MCP 服务）
{ name: 'remote-tool', url: 'http://localhost:8080/sse', headers?: {} }
```

#### 9.4.4 Tool Policy 与 MCP 权限矩阵

orchestrator 在构建 dispatch prompt 时，将各 agent 的 MCP 工具白名单注入 Agent 宪法（代码层强制，Agent 无法自行授权）：

```typescript
// 各 Agent 的 MCP 工具权限（toolPolicy，在 orchestrator 代码中硬编码）
const toolPolicy: Record<string, { allowedMcpTools: string[] }> = {
  pm:           { allowedMcpTools: ['read_file', 'write_file', 'create_directory'] },
  arch:         { allowedMcpTools: ['read_file', 'write_file'] },
  coder:        {
    allowedMcpTools: [
      'read_file', 'write_file', 'create_directory',
      // Playwright: 只允许访问自己 worktree 的端口，localhost:{assignedPort} 开头
      'browser_navigate', 'browser_click', 'browser_snapshot', 'browser_fill_form',
    ]
  },
  qa:           {
    allowedMcpTools: [
      'read_file',
      'browser_navigate', 'browser_click', 'browser_snapshot',
      'browser_take_screenshot', 'browser_fill_form', 'browser_evaluate',
    ]
  },
  security:     { allowedMcpTools: ['read_file'] },
  ui:           { allowedMcpTools: ['read_file', 'write_file'] },
  orchestrator: { allowedMcpTools: ['*'] },  // orchestrator 不受限
};

// coder 的 Playwright 访问域限制（防止访问 develop 分支或其他 worktree）
// 注入到 coder dispatch prompt：
// "Playwright 工具只允许访问 http://localhost:{assignedPort} 到 http://localhost:{assignedPort+99}
//  禁止访问 develop 服务（端口 3000/3001），那是 qa 的测试域。"
```

#### 9.4.5 编写本地 Skill

团队定制的 Skill 放在项目仓库中，在 registry 中以 `type: local` 声明（不需要安装，路径直接引用）：

```
.claude/skills/{skill-name}/{skill-name}.md
```

格式遵循 superpowers skill 规范，必需字段：

```markdown
---
name: nestjs-crud-gen
description: 使用 NestJS + TypeORM 生成完整 CRUD 模块的标准流程
---

## 触发场景
当任务描述中包含"CRUD"、"增删改查"或需要生成 NestJS module 时加载。

## Checklist（按顺序执行）
1. 读取 docs/design/architecture/database.md 确认实体字段
2. 生成 {entity}.entity.ts
3. 生成 {entity}.repository.ts
4. 生成 {entity}.service.ts（含完整 CRUD 方法）
5. 生成 {entity}.controller.ts（RESTful 路由）
6. 注册到 app.module.ts
7. 运行单元测试确认通过
```

发布共享：将 `.claude/skills/` 下的目录推送到 git 仓库后，其他项目可以 `type: git` 引用。

#### 9.4.6 Agent 宪法注入（dispatch 时自动生成）

orchestrator 在每次 dispatch 前，根据 agent 类型的 `skills` 和 `mcpServers` 配置**动态生成**宪法注入内容，不依赖固定模板：

```markdown
## 本次 Session 配置的 Skill（必须优先使用）

在开始任何任务前，先确认是否有对应的 Skill 可用。**有 Skill 的场景必须先加载 Skill，不得跳过。**

已配置的 Skill（按优先级）：
{动态列出 agent.skills 列表，每条含 skill 名称和简要触发场景描述}

示例（当 qa agent 配置了 webapp-testing + performance-audit）：
  1. webapp-testing      — 执行任何端到端/UI 验收测试时加载
  2. performance-audit   — 执行性能评审时加载

不确定是否需要 Skill 时：先加载查看，不适用则按其指导适配。

## 本次 Session 可用的 MCP 工具

{动态列出此 agent 可访问的 MCP 工具名称列表，来自 agent.mcpServers + 全局 mcpServers}

工具权限约束（orchestrator 代码层强制，以下限制不可绕过）：
{动态注入 toolPolicy 中该 agent 的 allowedMcpTools 白名单}
{如有端口域限制，额外注入：Playwright 工具只允许访问 {assignedPortRange}}
```

orchestrator 的 dispatch 构建器负责将 skill 描述、MCP 工具列表和 toolPolicy 白名单渲染为具体文本，确保每个 Agent session 的宪法与 config 同步，不存在"配置更新但宪法未更新"的漂移风险。

---

## 10. 运行时规范

### 10.1 工作流状态机

> **状态源**：所有状态存储在 SQLite（`.myrmidon/runtime/myrmidon.db`），表 `workflow`。  
> `STATE.md` 是**派生缓存**，由 orchestrator 在每次轮询后异步写入，供人工 review，不驱动状态机。  
> 恢复时永远从 SQLite 读取，不信任 STATE.md。

```sql
-- workflow 表核心字段
CREATE TABLE workflow (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  state           TEXT NOT NULL,   -- 当前状态枚举值
  current_phase   TEXT,
  current_epic    TEXT,
  current_sprint  TEXT,
  workflow_node   TEXT,
  started_at      TEXT,
  updated_at      TEXT,
  pending_confirmation TEXT,       -- NULL or 'awaiting_client'
  confirmation_requested_at TEXT,
  next_poll_at    TEXT
);
```

```
状态定义:
  IDLE              → 等待甲方输入
  REQUIREMENTS      → Phase 0: 需求收集中
  REVIEW            → Phase 1: 评审中
  WIREFRAME_PRD     → Phase 2: 原型/PRD 中
  DETAILED_DESIGN   → Phase 3: 详细设计中
  UI_DESIGN         → Phase 4: UI 设计中
  SPRINT_PLANNING   → Phase 5: Sprint 规划中
  DEVELOPMENT       → Phase 6: 开发中
  QA_TESTING        → Phase 6.4: QA 测试中
  CLIENT_CONFIRM    → 等待甲方确认
  DELIVERY          → Phase 7: 发布中
  COMPLETED         → 项目完成

合法状态转换:
  IDLE → REQUIREMENTS
  REQUIREMENTS → REVIEW
  REVIEW → WIREFRAME_PRD
  WIREFRAME_PRD → DETAILED_DESIGN
  DETAILED_DESIGN → UI_DESIGN
  UI_DESIGN → CLIENT_CONFIRM → SPRINT_PLANNING
  SPRINT_PLANNING → DEVELOPMENT
  DEVELOPMENT → QA_TESTING
  QA_TESTING → DEVELOPMENT（失败，返工）
  QA_TESTING → CLIENT_CONFIRM
  CLIENT_CONFIRM → DEVELOPMENT（下一 sprint）
  CLIENT_CONFIRM → DELIVERY（最后一个 sprint）
  DELIVERY → COMPLETED

任意状态可转换到:
  ERROR（orchestrator 检测到不可恢复错误）

所有状态转换通过 SQLite 事务执行（BEGIN IMMEDIATE），确保并发安全。
转换后异步刷新 STATE.md。

**Security Agent 触发规则（并行子活动，不占用独立顶层状态）：**

Security agent 作为并行审查者嵌入在以下两个阶段内，通过 `agents` 表中独立行追踪（不阻塞主状态机推进，但其结果影响阶段完成条件）：

| 嵌入阶段 | 触发时机 | 审查对象 | 阻塞条件 |
|---------|---------|---------|---------|
| `DETAILED_DESIGN` | arch 完成 api.md 和 database.md 后 | API 设计、数据库设计、架构文档 | 如产出 critical 级别 issue → 阶段不得推进 |
| `QA_TESTING` | sprint 所有 task 合并至 develop 后（与 qa 并行） | develop 分支代码变更 | 如产出 critical/high 级别 issue → sprint 不得交付 |

```sql
-- security agent 状态在 agents 表中独立存在
-- orchestrator 在 DETAILED_DESIGN 和 QA_TESTING 开始时自动 dispatch security
-- 完成条件: security status = 'completed' AND 无 critical/high 未解决 issue
```
```

### 10.2 多层上下文管理

Myrmidon 采用**七层上下文管理策略**，从根本上解决 Agent 上下文积累问题，而非依赖单一压缩机制。层次按作用范围从大到小排列：

---

#### 层 1：Fresh Session Per Task（根本解法）

每个 Task 启动全新 Agent session。只要 Task 拆分得当（≤1个上下文窗口），Agent 始终从干净窗口开始，上下文积累从根本上被消除。这是最重要的一层，其他层都是辅助保障。

orchestrator 在 dispatch 时构建精确的 prompt，内容见 Phase 6.3。

---

#### 层 2：In-Session 观测掩码

对于单次 session 内积累的 tool result（bash 输出、文件读取等），保留最近 **8 轮**可见，更早的 tool result 替换为占位符，零 LLM 开销：

```
[result masked — within summarized history]
```

**实现**：配置 Claude Code `PostToolUse` hook，每次工具调用后统计 user 轮次，掩盖超出窗口的旧结果。

```typescript
// .claude/hooks/observation-mask.ts
// 触发: hooks.postToolUse
export function onPostToolUse({ messages }) {
  return maskOldToolResults(messages, { keepRecentTurns: 8 });
}
// 检测 bash 输出的 user message（以 "Ran `" 开头）
// 检测 toolResult role 的 message
// 超出 keepRecentTurns 的均替换为占位符 content block
```

---

#### 层 3：Pre-Compaction Snapshot

当 Claude Code 即将压缩上下文时，orchestrator 提前写入 ≤2KB 的结构化快照：

```
.myrmidon/runtime/last-snapshot.md
```

**快照内容优先级**（按重要性排列，字节不足时从后截断）：
1. 当前 active context（task id、当前步骤）
2. 最近 6 条排名靠前的 DECISIONS.md 记录
3. 最近 5 条 exec 历史（状态 + 目的）

**格式示例：**
```markdown
# GSD context snapshot (2024-01-15T14:30:00Z)

## Active context
task-00007 step:3/6 — 实现 Service 层（依赖 Repository 已完成）

## Recent decisions
- [D-003] 使用 JWT 无状态认证（由 arch 在 sprint-002 确认）
- [D-002] 用户表使用 UUID 主键（2024-01-14）

## Recent exec runs
- [exec-0042] 2.3s exit:0 — npm test user.repository.spec.ts
- [exec-0041] 0.8s exit:0 — typeorm migration:run
```

**触发时机**：claude code 的 `PreCompact` 事件（如果支持）；或 orchestrator 在检测到 Agent session 接近压缩阈值时主动写入。

**Agent 在 session 开始时自动读取**（见 9.3 Session Start 恢复流程）。

---

#### 层 4：阶段锚点（Phase Handoff Anchors）

每个阶段完成时，orchestrator 将关键状态写入锚点文件：

```
.myrmidon/runtime/anchors/{phase}.json
```

**格式：**
```json
{
  "phase": "sprint_planning",
  "completed_at": "2024-01-15T10:00:00Z",
  "sprint_id": "sprint-002",
  "tasks": ["task-00007", "task-00008", "task-00009"],
  "key_decisions": ["D-003", "D-004"],
  "artifacts": [
    "docs/epics/epic-001/sprints/sprint-002/sprint.md",
    "docs/epics/epic-001/sprints/sprint-002/tasks/task-00007.md"
  ],
  "boundary_map_summary": "task-00007 produces: UserEntity, UserRepository; consumes: —"
}
```

下一阶段的 dispatch prompt 自动注入对应锚点，Agent 无需重新推导上阶段产出。

---

#### 层 5：Context Pressure Monitor（70% 阈值）

orchestrator 通过 Claude Code SDK 监控每个 Agent session 的上下文使用率：

```
当 context_usage >= 70%:
  orchestrator → Agent: 发出 wrap-up 信号（见 9.3 Context Window Management）
  Agent: 写 continue.md → 退出
  orchestrator: 启动新 session，注入 continue.md 内容继续
```

**continue.md 路径**：`.myrmidon/runtime/continue/{task-id}.md`

**格式（见 Phase 6.3）**：Completed Work / Remaining Work / Decisions Made / Next Action（精确到下一个函数或命令）。

---

#### 层 6：沙箱化 Exec 输出

长输出命令（测试、构建、lint）不直接将完整输出返回 Agent，而是：

1. 完整输出写入 `.myrmidon/runtime/exec/{exec-id}.txt`
2. Agent context 中只注入摘要（前 800 字符 + exit code + 耗时）：

```
exec-0042 | 2.3s | exit:0 | npm test user.repository.spec.ts
---
PASS src/modules/user/user.repository.spec.ts
  UserRepository
    ✓ findById returns user (45ms)
    ✓ save persists entity (12ms)
[… full output in .myrmidon/runtime/exec/exec-0042.txt]
```

Agent 需要完整输出时，可主动 Read 该文件。

---

#### 层 7：工具结果截断

单个工具调用的返回内容在注入 Agent context 前截断至 `toolResultMaxChars`（默认 800 字符）。大文件 Read 操作返回截断提示，Agent 可使用 offset/limit 参数分段读取。

---

#### 各层触发时机汇总

| 层 | 触发条件 | 位置 |
|----|---------|------|
| 1 Fresh Session | 每次 Task 分配 | orchestrator dispatch |
| 2 观测掩码 | 每次 tool 调用后 | Claude Code PostToolUse hook |
| 3 Pre-compaction snapshot | 上下文即将压缩 | Claude Code PreCompact hook / orchestrator |
| 4 Phase anchors | 每个 Phase 完成 | orchestrator phase transition |
| 5 70% wrap-up | context_usage ≥ 70% | orchestrator 轮询 |
| 6 沙箱化 exec | 长命令执行时 | orchestrator exec wrapper |
| 7 工具结果截断 | 每次 tool return | orchestrator tool proxy |

### 10.3 异常恢复流程

```
场景1: Agent 进程崩溃
  orchestrator 轮询检测到 agent.status = 'working' 但进程不存在
  → db.run("UPDATE agents SET status = 'error' WHERE name = ?")
  → 检查 .myrmidon/runtime/continue/{task-id}.md 是否存在
  → 检查 .myrmidon/runtime/last-snapshot.md 是否存在
  → 重启 agent（新 session），dispatch prompt 中注入恢复文件内容
  → agent 从 continue.md 的 Next Action 或 snapshot 继续

场景2: orchestrator 重启
  myrmidon resume 执行时:
  → 打开 myrmidon.db（SQLite integrity check）
  → 从 SQLite 读取 workflow 表（当前 state/phase/sprint/node）
  → 校验所有 status = 'working' task 的 worktree 存在
  → 重新启动 orchestrator 轮询循环
  → 继续从 workflow_node 推进

场景3: Worktree merge 失败（冲突）
  orchestrator 检测到 merge 失败
  → 创建 issue-{id}.md（type: conflict），写入冲突信息
  → db.run("UPDATE tasks SET status = 'blocked' WHERE id = ?")
  → 通知 coder 解决冲突
  → coder 解决后调用 myrmidon worktree merge 重新触发

场景4: Stuck 检测触发（见 10.5）
  orchestrator 判定 agent 陷入 stuck 状态
  → db.run("UPDATE agents SET status = 'stuck' WHERE name = ?")
  → 升级为人工介入：发送通知，暂停相关 agent
  → 等待用户在 TUI 中处理（见 myrmidon agent 命令）
  → 用户确认后手动重启或跳过该 task
```

### 10.4 Git 操作记录

所有 git 操作本地记录，不提交 git（同时写入 SQLite `git_ops` 表）：

```
.myrmidon/runtime/git-ops.log
格式:
  [timestamp] [operation] [branch] [result]
  示例:
  2024-01-15T14:30:00Z MERGE feature/task-00007→develop SUCCESS
  2024-01-15T14:35:00Z CLEANUP feature/task-00007 SUCCESS
  2024-01-15T15:00:00Z MERGE feature/task-00008→develop CONFLICT
```

---

### 10.5 Stuck 检测规范

Stuck 检测在 orchestrator 的每次轮询循环结束时运行，基于 SQLite 中记录的 agent 执行历史（`agent_runs` 表）判断。

**四条判定规则（满足任一即为 stuck）：**

#### 规则 1：同一错误连续出现
```
条件: agent 最近 N 次完成报告中，error_code 字段值相同
默认 N = 2（config.stuckDetection.sameErrorConsecutive）
示例: 连续两次 "ENOENT /path/to/file" → stuck
```

#### 规则 2：同一 Task 连续分配
```
条件: 最近 N 次 task 分配记录中，task_id 相同
默认 N = 3（config.stuckDetection.sameUnitConsecutive）
豁免: 如果 agent 重试次数 < retryBudget（默认 2），不触发此规则
      （前两次失败允许自动重试，第三次才判 stuck）
示例: task-00007 失败 → 重试 → 失败 → 重试 → 失败（第3次）→ stuck
```

#### 规则 3：振荡（Oscillation）
```
条件: 最近 N 次 task 分配中出现 A→B→A→B 模式
默认 N = 4（config.stuckDetection.oscillationWindow）
示例: task-00007 → task-00008 → task-00007 → task-00008 → stuck
     （说明两个任务互相解除阻塞，形成环路）
```

#### 规则 4：同一缺失路径连续出现
```
条件: 最近 N 次错误中，ENOENT 的路径字符串相同
默认 N = 2（config.stuckDetection.sameEnoentConsecutive）
示例: 连续两次因找不到同一文件而失败
      → 说明前置依赖可能未正确产出，需要人工介入
```

**触发后行为：**
```
1. db.run("UPDATE agents SET status = 'stuck' WHERE name = ?")
2. 写入 stuck 事件到 SQLite agent_events 表
3. 发送通知（如配置了 notifications）
4. TUI 中该 agent 显示 🔴 STUCK 状态
5. 等待用户操作：
   myrmidon agent restart <name>   重新分配（清空历史重置规则）
   myrmidon agent assign <name> <task>  手动指定 task
   [s]kip in TUI                   跳过当前 task（标记 blocked）
```

**SQLite 相关表结构：**
```sql
CREATE TABLE agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT NOT NULL,
  task_id     TEXT,
  started_at  TEXT,
  completed_at TEXT,
  status      TEXT,   -- 'completed' | 'failed' | 'error'
  error_code  TEXT,
  retry_count INTEGER DEFAULT 0
);

CREATE TABLE agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT NOT NULL,
  event_type  TEXT,   -- 'stuck' | 'restart' | 'paused'
  detail      TEXT,   -- JSON: 触发规则、相关 task 等
  created_at  TEXT
);
```

---

### 10.6 定时器与事件调度系统

orchestrator 进程内置一个**定时器管理器（Timer Manager）**，负责按固定间隔触发各内置任务。所有定时器在 `myrmidon start` 时一起启动，在 `myrmidon resume` 时恢复；**不允许禁用，只能通过 `config.timers.*` 调整频率**。

#### 内置定时器一览

| ID | 名称 | 默认间隔 | 最小间隔 | 职责 |
|----|------|---------|---------|------|
| **T1** | `workflow-poll` | 30s | 5s | 主工作流推进：检查 agent 完成、分配新任务、检查 join 条件 |
| **T2** | `agent-heartbeat` | 15s | 5s | 检测 agent 进程存活（PID 文件 + OS 进程表） |
| **T3** | `client-timeout` | 60s | 30s | 检查甲方确认超时，发送催促通知或执行自动通过 |
| **T4** | `stuck-detection` | 60s | 10s | 对所有活跃 agent 运行 4 条 stuck 规则（见 10.5） |
| **T5** | `state-consistency` | 300s | 60s | 校验 SQLite worktrees 表与 `git worktree list` 一致性 |
| **T6** | `external-dep-watch` | 60s | 10s | 检查 `externalDependencies` 中的文件是否变更（仅配置了才生效）|

**重叠保护**：同一定时器的上一次执行未完成时，本次触发跳过（skip，不排队）。跳过事件写入 SQLite `timer_events` 表供诊断。

#### 事件驱动唤醒（被动通知）

定时器是保底机制。以下事件发生时，orchestrator **立即唤醒并执行对应处理**，不等待下一个定时器周期：

| 事件来源 | 事件 | 唤醒的处理逻辑 |
|---------|------|--------------|
| Agent 进程 | 写入完成报告到 SQLite（`agents.status = 'completed'`）| 立即触发 T1 的 Output Validator + 状态推进 |
| 文件系统 | `continue/{task-id}.md` 被创建（Agent 请求中断）| 立即触发 orchestrator 启动新 session 续接任务 |
| 文件系统 | `externalDependencies` 中的文件 mtime 变化（T6 检测到）| 解锁依赖此文件的 downstream tasks |
| IM 通知渠道 | 甲方通过 Slack/企业微信发送确认消息 | 立即解除 `CLIENT_CONFIRM` 阻塞，推进流程 |
| REST API | `POST /api/confirm`（--no-tui 模式）| 同上 |

事件唤醒与定时器互不干扰：定时器照常运行（防止事件丢失），事件只是让 orchestrator 提前响应。

#### Timer Manager 内部逻辑

```typescript
class TimerManager {
  private timers: Map<string, NodeJS.Timer> = new Map();
  private running: Set<string> = new Set();  // 正在执行中的 timer ID

  register(id: string, handler: () => Promise<void>, config: TimerConfig) {
    const interval = Math.max(config.intervalSeconds, config.minSeconds) * 1000;
    const timer = setInterval(async () => {
      if (this.running.has(id)) {
        // 重叠保护: 跳过并记录
        db.run("INSERT INTO timer_events VALUES (?,?,?)", [id, 'skipped', now()]);
        return;
      }
      this.running.add(id);
      const start = Date.now();
      try {
        await handler();
        db.run("INSERT INTO timer_events VALUES (?,?,?,?)",
          [id, 'completed', now(), Date.now() - start]);
      } catch (err) {
        db.run("INSERT INTO timer_events VALUES (?,?,?,?)",
          [id, 'error', now(), err.message]);
      } finally {
        this.running.delete(id);
      }
    }, interval);
    this.timers.set(id, timer);
  }

  // 事件驱动唤醒：立即执行指定 timer 的 handler（跳过间隔等待）
  async wake(id: string) {
    const handler = this.handlers.get(id);
    if (handler && !this.running.has(id)) await handler();
  }

  stopAll() {
    for (const timer of this.timers.values()) clearInterval(timer);
  }
}
```

#### SQLite timer_events 表

```sql
CREATE TABLE timer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id    TEXT NOT NULL,        -- 'workflow-poll' | 'agent-heartbeat' | ...
  event       TEXT NOT NULL,        -- 'completed' | 'skipped' | 'error'
  created_at  TEXT NOT NULL,
  duration_ms INTEGER,              -- 执行耗时（completed 时填写）
  detail      TEXT                  -- error message（error 时填写）
);
```

#### TUI 定时器状态面板

TUI 的 LOG 区域增加定时器状态条（`[Tab]` 可切换查看）：

```
TIMERS
  T1 workflow-poll      ✅ 28s ago  next: 2s   avg: 45ms
  T2 agent-heartbeat    ✅  3s ago  next: 12s  avg: 8ms
  T3 client-timeout     ✅ 42s ago  next: 18s  avg: 2ms
  T4 stuck-detection    ✅ 55s ago  next: 5s   avg: 12ms
  T5 state-consistency  ✅  4m ago  next: 1m   avg: 180ms
  T6 external-dep-watch ⚪ disabled (no externalDependencies)
```

`myrmidon status --json` 在输出中包含 `timers` 字段（各定时器的 lastRun / nextRun / avgDurationMs）。

---

### 10.7 Runtime 自动检测与安装引导

#### 支持的 Runtime 矩阵

| Runtime ID | 检测命令 | 安装文档 | 支持版本 |
|-----------|----------|----------|----------|
| `claude-code` | `claude --version` | https://claude.ai/code | ≥ 1.0 |
| `opencode` | `opencode --version` | https://opencode.ai | ≥ 0.1 |
| `gemini-cli` | `gemini --version` | https://github.com/google-gemini/gemini-cli | ≥ 0.1 |
| `kimi-codex` | `kimi --version` | https://github.com/MoonshotAI/kimi-codex | ≥ 0.1 |

#### 自动检测流程

`myrmidon init` 和 `myrmidon start` 启动时执行 Runtime 检测：

```
1. 遍历支持的 Runtime 列表，依次执行检测命令
2. 收集所有可用（exit code = 0）的 runtime
3. 分支处理：
   a. 检测到 1 个 → 自动使用，写入 myrmidon.config.ts executors[*].runtime
   b. 检测到 0 个 → 进入「无 Runtime」引导（见下）
   c. 检测到 ≥ 2 个 → 进入「多 Runtime」选择交互（见下）
4. 若 config 已有显式 runtime 配置 → 跳过自动检测，直接校验该 runtime 是否可用
```

#### 无 Runtime（0 个）引导

```
✗ 未检测到任何支持的 AI 运行时。

Myrmidon 需要至少一个运行时才能驱动 Agent。请安装以下之一：

  [1] Claude Code    npx @anthropic-ai/claude-code   https://claude.ai/code
  [2] OpenCode       npm install -g opencode          https://opencode.ai
  [3] Gemini CLI     npm install -g @google/gemini-cli
  [4] Kimi Codex     pip install kimi-codex

安装完成后重新运行 myrmidon init（或 myrmidon start）。
```

进程以非零退出码退出，不继续初始化。

#### 多 Runtime（≥ 2 个）交互选择

```
✓ 检测到多个可用运行时，请选择默认运行时：

  [1] claude-code   v1.2.3   ← 已安装
  [2] opencode      v0.3.1   ← 已安装
  [3] gemini-cli    v0.2.0   ← 已安装

选择 (1-3，或输入 runtime ID): 1

✓ 已选择 claude-code 作为默认 runtime。
  → 已写入 myrmidon.config.ts executors.sonnet.runtime = 'claude-code'

提示：可在 myrmidon.config.ts 中为不同 executor 指定不同 runtime 实现混合部署。
```

#### Runtime 不可用时的启动报错

若 `myrmidon start` 时发现 executor 配置的 runtime 不可用：

```
✗ Executor 'sonnet' 配置的 runtime 'opencode' 未检测到。

  检测命令失败：opencode --version
  安装方式：npm install -g opencode
            https://opencode.ai

安装完成后重新运行 myrmidon start。
若要切换到其他 runtime，运行：
  myrmidon config set executors.sonnet.runtime claude-code
```

#### Runtime 检测结果写入 SQLite

```sql
-- meta 表记录检测结果，供 TUI 状态面板展示
INSERT OR REPLACE INTO meta VALUES ('runtime.detected', '["claude-code","opencode"]');
INSERT OR REPLACE INTO meta VALUES ('runtime.selected', 'claude-code');
INSERT OR REPLACE INTO meta VALUES ('runtime.detected_at', '2026-05-21T09:00:00Z');
```

---

### 10.8 环境变量与 .env 加载规范

**启动时加载顺序**（后者覆盖前者）：
1. 系统环境变量
2. 项目根目录 `.env`（若存在，通过 `dotenv` 加载，不提交 git）
3. 命令行显式传入的变量（最高优先级）

**必填环境变量**（`myrmidon init` 生成的 `.env.example`）：
```bash
# Claude Code / Anthropic API
ANTHROPIC_API_KEY=           # 必填，执行器调用 claude-code 所需

# 通知渠道（按需填写）
SLACK_WEBHOOK_URL=
WECOM_WEBHOOK_URL=
SMTP_PASS=

# 外部集成（按需填写）
FIGMA_TOKEN=
GITHUB_TOKEN=
LINEAR_API_KEY=
```

**`.gitignore` 必须包含**：
```
.env
.myrmidon/runtime/
.myrmidon/logs/
```

启动时若 `ANTHROPIC_API_KEY` 未设置，orchestrator 立即退出并输出明确错误：
```
Error: ANTHROPIC_API_KEY is not set.
Copy .env.example to .env and fill in the required values.
```

---

### 10.8 进程生命周期与资源清理

**严格规范：执行器释放前必须清理所有子进程和端口，禁止任何进程/端口泄漏。**

#### 10.8.1 执行器子进程管控

每个 executor（agent session）启动时，orchestrator 注册其 PID 及所有子进程到 SQLite `executor_procs` 表：

```sql
CREATE TABLE executor_procs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,           -- 对应 agent_sessions.id
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  pid         INTEGER NOT NULL,
  port        INTEGER,                 -- 若该进程占用端口（dev server / test server）
  proc_type   TEXT NOT NULL,           -- 'executor' | 'dev-server' | 'test-server' | 'child'
  started_at  TEXT NOT NULL,
  killed_at   TEXT
);
```

#### 10.8.2 清理触发时机

以下任一情况发生时，orchestrator **必须**触发该 session 的完整清理流程：

| 触发条件 | 说明 |
|----------|------|
| task 正常完成 | agent 报告 exit:success |
| task 失败/错误 | agent 报告 exit:error 或 exit:timeout |
| Stuck 检测触发 | 见 10.5 |
| 手动 `myrmidon agent stop <id>` | 用户主动停止 |
| SIGTERM / SIGHUP / SIGINT | orchestrator 进程收到信号 |

#### 10.8.3 清理流程（严格顺序，不可跳过）

```
1. 向 executor 主进程发送 SIGTERM，等待最多 10s
2. 若 10s 内未退出，发送 SIGKILL
3. 遍历 executor_procs 表中该 session 的所有子进程：
   a. 按 proc_type 优先级倒序清理：test-server → dev-server → child → executor
   b. 每个进程先 SIGTERM（5s），超时则 SIGKILL
   c. 释放占用的端口（更新 worktrees.port 可用标记）
4. 更新 executor_procs.killed_at
5. 更新 agent_sessions.exit_status、end_time
6. 更新 agents 表 status → 'idle'
7. 释放 worktree 端口占用（不删除 worktree 目录，由 worktree cleanup 单独处理）
```

**任何步骤失败**（进程 kill 失败、端口仍被占用）：记录到 `agent_sessions.exit_status = 'cleanup-error'`，写入审计日志，并向 orchestrator 发出告警（TUI banner + IM）。

#### 10.8.4 Worktree 清理规范

Worktree 清理与进程清理**解耦但联动**：

| 阶段 | 动作 |
|------|------|
| task 完成后 | 自动触发进程清理（10.8.3），worktree **保留**（等待 merge） |
| `myrmidon worktree merge <branch>` 成功后 | 自动调用 `worktree cleanup`，删除目录，释放端口记录 |
| Stuck / 失败任务 | 进程清理后 worktree 保留，标记 `status=failed`，人工决定是否 cleanup |
| `myrmidon worktree cleanup <branch>` | 先确认进程已清理（若未清理则先执行 10.8.3），再删除目录，更新 SQLite `status=cleaned` |

**Stuck 检测（T4）额外职责**：检查 `executor_procs` 中是否存在已无对应 agent session 的孤儿进程，发现则立即清理并告警。

#### 10.8.5 端口泄漏兜底

orchestrator 启动时（T5 state-consistency 定时器每分钟执行）：
1. 读取 `worktrees` 表中所有 `status=active` 的端口
2. 对每个端口执行 `lsof -i :<port>`，检查实际占用进程
3. 若端口被占用但对应 session 已结束（`agent_sessions.exit_status != 'live'`）：立即 kill 占用进程，记录告警
4. 若端口未被占用但 worktrees 仍标记为 active：更新 SQLite，释放端口

---

## 11. 发布路线图

### V1（当前目标）

**核心工作流：**
- ✅ 全流程支持（需求 → 开发 → QA → 交付）
- ✅ Agent 角色规范（pm/arch/coder/qa/security/ui）
- ✅ Fresh Session Per Task（每任务新会话，无上下文污染）
- ✅ IO 依赖图调度（Task produces/consumes → 自动并行）

**CLI / TUI：**
- ✅ CLI 命令全集（init/start/status/resume/config/worktree/agent/log/notify）
- ✅ TUI 界面（Ink，含 WORKFLOW / AGENT MONITOR / CLIENT CHAT / LOG）

**状态管理：**
- ✅ SQLite 作为唯一运行时状态源（WAL 模式，并发安全）
- ✅ STATE.md 作为派生缓存（人工 review 用）
- ✅ 断点恢复（myrmidon resume 从 SQLite 重建）

**多层上下文管理：**
- ✅ In-session 观测掩码（保留最近 8 轮 tool result）
- ✅ Pre-compaction snapshot（≤2KB，last-snapshot.md）
- ✅ Phase handoff anchors（阶段锚点 JSON）
- ✅ Context pressure monitor（70% 阈值 wrap-up 信号）
- ✅ continue.md 中断/恢复协议
- ✅ 沙箱化 exec 输出（长命令摘要化）
- ✅ 工具结果截断（800 字符）

**Worktree / Git：**
- ✅ Worktree 管理脚本（git 原生调用 + taskId % 1000 确定性端口分配）
- ✅ Git Flow 规范（feature/fix/develop/main）
- ✅ merge 串行化队列

**质量保障：**
- ✅ 五层 Validator（Input/Output/WorkflowState/FileFormat/Recovery）
- ✅ 任务 DAG 校验（循环检测、produces/consumes 一致性、infrastructure 叶节点校验）
- ✅ 四层验证阶梯（Static/Command/Behavioral/Human）
- ✅ UI 验收链（DOM Contract → Playwright 测试一一对应，消除人工解读歧义）
- ✅ Stuck 检测（4 规则：同错误/同 unit/振荡/ENOENT）
- ✅ Tool Policy 代码层强制（含 Playwright MCP 端口域限制）
- ✅ Security agent 并行审查（嵌入 DETAILED_DESIGN 和 QA_TESTING 阶段）
- ✅ QA bug fix 回归：按 `impact_scope` 确定回归范围，不限于原失败项

**Skill 与 MCP：**
- ✅ Skill 优先级强制机制（写入 Agent 宪法，代码层 dispatch 时注入）
- ✅ 配置驱动 Skill 分配（在 `agentRoles` 或 `agents` 中按角色指定，无预设列表）
- ✅ Skill 包管理器（myrmidon skills install/list/update，4 种 source type，skills.lock）
- ✅ MCP 服务器配置（全局 mcpServers + 角色级覆盖）
- ✅ Tool Policy × MCP 权限矩阵（各 agent 类型白名单，代码层硬编码）
- ✅ 自定义 Skill（.claude/skills/ local 类型）和自定义 MCP 扩展机制

**配置：**
- ✅ 三层 Agent 配置架构（`agentRoles` 角色定义 → `executors` 执行器 → `agents` 工作流绑定）
- ✅ `agentRoles`：角色能力边界、systemPromptFile、工具白名单/黑名单、tokenProfile
- ✅ `executors`：runtime × model 解耦，支持未来多 runtime（opencode / gemini-cli）
- ✅ `agents`：工作流绑定层，可独立覆盖 skill / MCP，不影响角色定义
- ✅ `.myrmidon/prompts/{role}.md`：角色系统提示词（myrmidon init 生成默认模板，用户可定制）
- ✅ myrmidon.config.ts 完整配置体系（含 dispatch/contextManagement/stuckDetection/apps/mcpServers）
- ✅ contextEstimateThresholds（small/medium/large 映射到具体 token 数）
- ✅ apps 配置块（monorepo 多 app 支持）
- ✅ externalDependencies（分离项目跨仓库依赖声明）

**多项目拓扑：**
- ✅ --template monorepo（apps/ 目录结构 + 多 app 配置）
- ✅ task.md `app` 字段（worktree 工作目录和 testCmd 路由）
- ✅ 外部依赖声明（`externalDependencies` 顶层配置，FE/BE 分离时跨项目 API spec 联动）
- ✅ per-app coder 规约（`apps.{name}.coderOverrides`：两层混合，base role + app override 合并，各端独立约束）
- ✅ per-app AI 评审规则（`apps.{name}.reviewRules`：arch/security 评审时注入 app 专属检查清单）

**定时器与调度：**
- ✅ 内置定时器管理器（T1~T6，不可禁用，频率可配置，含重叠保护）
- ✅ 事件驱动唤醒（agent 完成信号、continue.md 创建、IM 确认、REST API 确认）
- ✅ timer_events SQLite 表（skipped/error/completed 全量记录，供诊断）
- ✅ TUI 定时器状态面板（lastRun / nextRun / avgDurationMs）

**其他：**
- ✅ --no-tui 模式（REST API + stdout NDJSON + IM 通知三合一交互）
- ✅ DECISIONS.md（架构决策记录，append-only，dispatch prompt 自动注入）

**运行时：**
- ✅ Runtime: Claude Code（V1 仅支持）

**V1 不包含：**
- ❌ IM 通知集成（V2）
- ❌ 多 Runtime 支持（V2）
- ❌ Email 通知（V2）
- ❌ monorepo 跨 app 并行 coder（同 sprint 内 FE/BE 任务真正并行，V2）

### V2

- IM 通知：Slack、企业微信集成
- 多 Runtime：opencode、Kimi Codex、Gemini CLI
- Email 通知渠道
- `myrmidon web`：Web Dashboard（只读状态监控）

### V3

- 可视化工作流配置（类 n8n，支持自定义流程节点）
- Plugin 系统（自定义 Agent 类型）
- 多项目管理（myrmidon workspace）
- 云端状态同步（团队协作）

---

## 12. 预置 Agent 角色模板库

基于真实软件研发团队分工，提供开箱即用的 Agent 角色预置模板。每个模板包含：角色定位、输入/输出材料规约、MCP 工具、技能包（Skills）、代码/设计规约、`myrmidon.config.ts` 配置片段。

> 使用方式：在 `myrmidon.config.ts` 的 `agentRoles` 中按需引入，覆盖或扩展默认值。

---

### 12.1 产品经理（PM）

**定位**：需求挖掘、用户故事拆解、PRD 撰写、Epic/Sprint 规划、甲方沟通代理。

**适用阶段**：Phase 0（需求收集）→ Phase 2（PRD）→ Phase 5（Sprint 规划）→ 交付确认。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| 甲方原始需求 | orchestrator 转发 | 自然语言 / 语音文字稿 |
| 竞品分析参考 | 人工提供 | Markdown / URL |
| 技术可行性反馈 | arch agent | `tech-review.md` |
| UI 初稿 | uiux agent | Figma URL / 截图 |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| 模块划分 | Markdown | `docs/requirements/modules.md` |
| PRD | Markdown（版本化） | `docs/prd/prd-v{n}.md` |
| Epic 列表 | Markdown | `docs/epics/epic-{id}.md` |
| Sprint 计划 | Markdown | `docs/sprints/sprint-{id}/sprint.md` |
| 甲方确认记录 | Markdown | `docs/decisions/client-confirm-{date}.md` |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'github',  package: '@github/mcp',   env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
  { name: 'linear',  package: '@linear/mcp',   env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY } },
  { name: 'figma',   package: '@figma/mcp-server', env: { FIGMA_TOKEN: process.env.FIGMA_TOKEN } },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `requirements-gathering` | 结构化需求挖掘（5W1H、JTBD 框架） |
| `prd-writing` | PRD 模板填写规范、验收标准书写 |
| `epic-sprint-planning` | Epic 拆分原则、Sprint 容量估算 |
| `user-story-mapping` | 用户旅程地图、优先级排序（MoSCoW） |
| `client-communication` | 甲方沟通话术、变更管控 |

**Constitution 要点**：
- 禁止直接修改代码文件（Read-only 访问源码用于理解上下文）
- 所有 PRD 变更必须版本化（`prd-v2.md` 不覆盖 `prd-v1.md`）
- 输出语言跟随 `project.lang` 配置

**Config 片段**：

```typescript
agentRoles: {
  pm: {
    systemPrompt: '.myrmidon/prompts/pm.md',
    allowedTools: ['Read', 'Write', 'WebFetch', 'WebSearch'],
    forbiddenTools: ['Bash', 'Edit'],   // 禁止执行命令或修改代码
    skills: ['requirements-gathering', 'prd-writing', 'epic-sprint-planning'],
    mcpTools: ['github', 'linear', 'figma'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read docs/prd/ 获取最新 PRD 版本，Read docs/sprints/ 了解当前 Sprint 状态',
  },
},
```

---

### 12.2 UI/UX 设计师（UIUX）

**定位**：高保真设计、设计系统维护、组件规范（DOM Contract）输出、与前端的设计交付。

**适用阶段**：Phase 4（UI 设计）→ Phase 6（组件规范持续维护）。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| PRD + 低保真线框 | pm agent | `prd-v*.md` + Figma URL |
| 品牌规范 | 人工提供 | Figma Library / `docs/design/brand.md` |
| 用户反馈 | orchestrator | 自然语言 |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| 高保真设计稿 | Figma（URL 记录在 doc） | `docs/design/ui/figma-links.md` |
| 设计 Token | JSON / CSS 变量 | `docs/design/tokens/tokens.json` |
| 组件规范（DOM Contract） | Markdown | `docs/design/ui/components/{name}.md` |
| 交互说明 | Markdown | `docs/design/ui/interactions.md` |
| 可访问性检查报告 | Markdown | `docs/design/ui/a11y-report.md` |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'figma', package: '@figma/mcp-server', env: { FIGMA_TOKEN: process.env.FIGMA_TOKEN } },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `design-system` | 设计 Token 规范、组件库管理 |
| `dom-contract-writing` | 将设计稿转为机器可读 DOM Contract（供 qa 直接生成 Playwright 测试） |
| `accessibility-audit` | WCAG 2.1 AA 合规检查清单 |
| `figma-handoff` | 设计交付标准（标注完整性、切图规范） |
| `responsive-design` | 断点规范、移动端适配规约 |

**关键规约**：
- 每个组件 `.md` 必须包含 DOM Contract（必须存在的元素、状态机、Playwright 测试用例列表）
- 设计 Token 命名：`--color-{category}-{variant}`，如 `--color-primary-500`
- 交互动效：duration ≤ 300ms，easing 使用 `ease-in-out`，尊重 `prefers-reduced-motion`

**Config 片段**：

```typescript
agentRoles: {
  uiux: {
    systemPrompt: '.myrmidon/prompts/uiux.md',
    allowedTools: ['Read', 'Write', 'WebFetch'],
    forbiddenTools: ['Bash', 'Edit'],
    skills: ['design-system', 'dom-contract-writing', 'accessibility-audit', 'figma-handoff'],
    mcpTools: ['figma'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read docs/design/ui/ 了解已完成的组件规范，Read docs/prd/ 获取功能要求',
  },
},
```

---

### 12.3 前端工程师（Frontend）

**定位**：Web 前端实现（React / Vue），基于组件规范和 API 合约开发，测试先行。

**适用阶段**：Phase 6（Sprint 开发）。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| 组件规范 / DOM Contract | uiux agent | `docs/design/ui/components/*.md` |
| API 合约 | backend agent | `docs/design/architecture/api.md`（OpenAPI） |
| 设计 Token | uiux agent | `docs/design/tokens/tokens.json` |
| Task 详情 | orchestrator | `task-{id}.md` |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| 组件源码 | TypeScript/JSX | `apps/frontend/src/components/` |
| 页面源码 | TypeScript/JSX | `apps/frontend/src/pages/` |
| 单元/集成测试 | Vitest + RTL | `apps/frontend/src/**/*.test.tsx` |
| Storybook Story | TypeScript | `apps/frontend/src/**/*.stories.tsx` |
| 完成报告 | Markdown | `task-{id}.md`（追加） |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'playwright', package: '@playwright/mcp' },
  { name: 'github',     package: '@github/mcp', env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `tdd-frontend` | React 组件 TDD：先写 RTL 测试，再实现组件 |
| `react-conventions` | React/TypeScript 代码规约（见下） |
| `vue-conventions` | Vue 3 Composition API 规约（按需） |
| `accessibility-impl` | ARIA 属性、键盘导航、焦点管理实现清单 |
| `performance-frontend` | Bundle 分析、懒加载、Core Web Vitals 优化 |
| `css-conventions` | CSS Modules / Tailwind 使用规约 |

**前端代码规约（React/TypeScript）**：

```
命名：组件 PascalCase，hooks useXxx，工具函数 camelCase，常量 SCREAMING_SNAKE
文件组织：组件与测试文件同目录，index.ts 仅做导出
组件规范：
  - 函数式组件，禁止 class 组件
  - Props 用 interface 定义，不用 type（便于 extends）
  - 禁止直接操作 DOM（useRef 例外）
  - 异步数据：React Query，禁止在 useEffect 内 fetch
状态管理：
  - Server state → React Query（@tanstack/query）
  - Client UI state → Zustand（禁止 Redux，除非项目已有）
  - 表单 → React Hook Form
测试：
  - 每个组件至少有正常渲染、用户交互、loading/error 状态三个用例
  - 禁止 snapshot 测试（除非 UI 稳定的纯展示组件）
  - 禁止 mock 内部实现，只 mock 边界（API、路由）
CSS：
  - 使用 CSS Modules 或 Tailwind，禁止 inline style（动态值除外）
  - 设计 Token 通过 CSS 变量引用，不硬编码颜色/间距
```

**Config 片段**：

```typescript
agentRoles: {
  frontend: {
    systemPrompt: '.myrmidon/prompts/frontend.md',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    forbiddenTools: ['Bash("rm -rf")', 'Bash("git push")', 'Bash("npm publish")'],
    skills: ['tdd-frontend', 'react-conventions', 'accessibility-impl', 'performance-frontend'],
    mcpTools: ['playwright', 'github'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read task-{id}.md 获取当前任务，Read docs/design/ui/components/ 获取组件规范，Read docs/design/architecture/api.md 获取 API 合约',
  },
},
```

---

### 12.4 后端工程师（Backend）

**定位**：API 实现、数据库设计、业务逻辑，测试先行，安全意识嵌入开发流程。

**适用阶段**：Phase 6（Sprint 开发）。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| API 设计文档 | arch agent | `docs/design/architecture/api.md` |
| 数据库 Schema | arch agent | `docs/design/architecture/db.md` |
| Task 详情 | orchestrator | `task-{id}.md` |
| 安全审查结论 | security agent | `docs/security/review-{sprint}.md` |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| API 实现 | 源码 | `apps/backend/src/` |
| 数据库迁移 | SQL / ORM 迁移文件 | `apps/backend/migrations/` |
| 单元测试 | 对应语言测试框架 | `apps/backend/src/**/*.test.{ts,py,go}` |
| 集成测试 | supertest / httpx / net/http/httptest | `apps/backend/tests/integration/` |
| API 更新记录 | Markdown（版本化） | `docs/design/architecture/api.md`（追加 changelog） |
| 完成报告 | Markdown | `task-{id}.md`（追加） |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'github', package: '@github/mcp', env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
  // 按数据库类型选一：
  { name: 'sqlite',     command: 'npx', args: ['@modelcontextprotocol/server-sqlite', '.myrmidon/runtime/myrmidon.db'] },
  // { name: 'postgres', package: '@modelcontextprotocol/server-postgres', env: { DATABASE_URL: process.env.DATABASE_URL } },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `tdd-backend` | API 先写测试（supertest/httpx），再实现路由 |
| `api-design` | OpenAPI 3.1 规范、RESTful 命名、错误码规约 |
| `sql-design` | 规范化设计、索引策略、迁移安全原则 |
| `nodejs-conventions` | Node.js/TypeScript 后端规约（见下） |
| `python-conventions` | Python/FastAPI 规约（按需） |
| `go-conventions` | Go 规约（按需） |
| `security-backend` | OWASP Top 10 后端防护清单、输入校验 |

**后端代码规约**：

```
通用：
  - 分层架构：Router → Controller（薄）→ Service（业务逻辑）→ Repository（DB）
  - Service 层不依赖 HTTP 框架（纯函数，可独立测试）
  - 错误类型化：不 throw 字符串，使用结构化 Error 类
  - 禁止在代码中硬编码密钥、URL、配置值

Node.js/TypeScript：
  - 路由参数/Body 用 Zod 校验，校验失败返回 422
  - 数据库 ORM 优先（Prisma / Drizzle），原生 SQL 仅性能关键路径
  - 测试：Vitest + supertest，数据库用真实 SQLite（不 mock）
  - 日志：Pino（JSON 格式），禁止 console.log 进入生产

Python：
  - 类型注解必须（Pydantic v2 用于数据校验）
  - FastAPI 路由函数只做参数解析 + 调用 service，禁止业务逻辑进路由
  - pytest + httpx，fixture 隔离 DB（每 test function 独立事务回滚）
  - 依赖注入通过 FastAPI Depends

Go：
  - 错误必须 wrap（fmt.Errorf("context: %w", err)），禁止忽略 error 返回值
  - 接口驱动设计（Repository、Service 均定义 interface，便于测试替换）
  - 表驱动测试（Table-driven tests）
  - 禁止 init() 函数有副作用
```

**Config 片段**：

```typescript
agentRoles: {
  backend: {
    systemPrompt: '.myrmidon/prompts/backend.md',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    forbiddenTools: ['Bash("rm -rf")', 'Bash("git push --force")', 'Bash("DROP TABLE")'],
    skills: ['tdd-backend', 'api-design', 'sql-design', 'nodejs-conventions', 'security-backend'],
    mcpTools: ['github', 'sqlite'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read task-{id}.md，Read docs/design/architecture/api.md 和 db.md，检查 migrations/ 最新迁移',
  },
},
```

---

### 12.5 移动端工程师（App）

**定位**：iOS / Android / React Native / Flutter 应用实现，适配多平台差异，与后端 API 对接。

**适用阶段**：Phase 6（Sprint 开发）。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| UI 设计 / 组件规范 | uiux agent | Figma URL + `docs/design/ui/components/` |
| API 合约 | backend agent | `docs/design/architecture/api.md` |
| 平台规范参考 | 人工提供 | iOS HIG / Material Design URL |
| Task 详情 | orchestrator | `task-{id}.md` |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| 应用源码 | RN/Flutter/Swift/Kotlin | `apps/mobile/src/` |
| 组件库 | 对应框架 | `apps/mobile/src/components/` |
| 单元测试 | Jest / flutter_test / XCTest | `apps/mobile/src/**/*.test.{tsx,dart,swift}` |
| 深链接配置 | JSON / plist | `apps/mobile/config/deep-links.json` |
| 完成报告 | Markdown | `task-{id}.md`（追加） |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'github', package: '@github/mcp', env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
  { name: 'playwright', package: '@playwright/mcp' },  // Web 端调试辅助
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `rn-conventions` | React Native 规约（见下） |
| `flutter-conventions` | Flutter/Dart 规约（见下） |
| `mobile-accessibility` | iOS VoiceOver / Android TalkBack 适配清单 |
| `mobile-performance` | 渲染性能、内存管控、冷启动优化 |
| `deep-link-setup` | Universal Link / App Link 配置规约 |
| `offline-first` | 本地缓存、离线队列、冲突解决策略 |

**移动端代码规约**：

```
React Native：
  - FlatList 替代 ScrollView 渲染长列表（禁止 ScrollView 内嵌大量子项）
  - 导航：React Navigation v7，屏幕组件不做业务逻辑（仅展示 + 触发 action）
  - 状态：Zustand（简单）或 Redux Toolkit（复杂），禁止在组件内直接 fetch
  - 网络：React Query（@tanstack/query-native），统一处理 loading/error
  - 平台差异：Platform.select()，禁止 Platform.OS === 'ios' 散落业务代码
  - 图片：统一使用 FastImage，禁止 URI 直接写死
  - 测试：Jest + RNTL，Native 模块必须 mock

Flutter：
  - Riverpod（推荐）或 Bloc 做状态管理，禁止裸 setState 用于复杂状态
  - Widget 树扁平化：抽 const widget，减少重建范围
  - 异步：使用 AsyncNotifier（Riverpod）或 BlocBuilder，禁止 FutureBuilder 嵌套
  - 测试：widget test + integration test（flutter_test），golden test 用于关键 UI
  - 平台适配：adaptive_dialog、Platform.isIOS 封装为 helper，不散落各处
  - 禁止 .toList() 在 build() 中执行耗时操作
```

**Config 片段**：

```typescript
agentRoles: {
  'app-mobile': {
    systemPrompt: '.myrmidon/prompts/app-mobile.md',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    forbiddenTools: ['Bash("rm -rf")', 'Bash("git push --force")'],
    skills: ['rn-conventions', 'mobile-accessibility', 'mobile-performance', 'offline-first'],
    mcpTools: ['github', 'playwright'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read task-{id}.md，Read docs/design/ui/components/ 获取组件规范，Read docs/design/architecture/api.md 获取接口文档',
  },
},
```

---

### 12.6 测试工程师（QA）

**定位**：测试用例设计、自动化测试执行、Bug 报告、回归验证，基于 DOM Contract 驱动。

**适用阶段**：Phase 6.3（测试用例预生成）→ Phase 6.4（测试执行）→ Bug 修复后回归。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| DOM Contract | uiux agent | `docs/design/ui/components/*.md` |
| API 合约 | backend agent | `docs/design/architecture/api.md` |
| Sprint 任务列表 | orchestrator | `sprint-{id}/sprint.md` |
| 验收标准 | task 文件 | `task-{id}.md` |
| 安全审查结论 | security agent | `docs/security/` |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| 测试用例 | Playwright TS / pytest | `tests/e2e/` `tests/api/` |
| 测试报告 | Markdown + JSON | `docs/qa/report-sprint-{id}.md` |
| Bug Report | Markdown | `docs/issues/issue-{id}.md` |
| 回归结果 | Markdown | `docs/qa/regression-{date}.md` |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'playwright', package: '@playwright/mcp' },
  { name: 'github',     package: '@github/mcp', env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `webapp-testing` | Playwright E2E 规约、Page Object Model |
| `api-testing` | REST/GraphQL 接口测试、状态码、Schema 校验 |
| `mobile-testing` | Detox（RN）/ flutter_driver 移动端自动化 |
| `performance-testing` | Lighthouse CI、k6 负载测试 |
| `accessibility-testing` | axe-core 集成、键盘导航验证 |
| `bug-report-writing` | 标准 Bug 报告格式：复现步骤、期望/实际、截图/日志 |
| `regression-strategy` | 回归范围界定、冒烟用例选取 |

**QA 规约**：

```
测试设计原则：
  - 直接从 DOM Contract 生成 Playwright selector（不依赖 CSS class 或 text，使用 data-testid）
  - 每个验收标准对应至少一个 Happy Path 用例 + 一个异常用例
  - API 测试必须覆盖：200 正常、4xx 参数错误、401/403 权限、5xx 服务错误

Playwright 规约：
  - 使用 Page Object Model，禁止 selector 散落用例代码
  - 等待用 expect(locator).toBeVisible()，禁止 page.waitForTimeout()
  - 每个用例独立，禁止用例间共享状态
  - 截图/视频仅在失败时保留（--reporter html）

Bug 报告必填字段：
  - 严重级别（Critical / High / Medium / Low）
  - 复现步骤（最小路径）
  - 期望行为 vs 实际行为
  - 环境（浏览器、OS、版本）
  - 截图或日志片段
  - 关联 task-id 或 acceptance criteria 编号
```

**Config 片段**：

```typescript
agentRoles: {
  qa: {
    systemPrompt: '.myrmidon/prompts/qa.md',
    allowedTools: ['Read', 'Write', 'Bash'],
    forbiddenTools: ['Edit', 'Bash("git commit")', 'Bash("git push")'],  // QA 不提交代码
    skills: ['webapp-testing', 'api-testing', 'performance-testing', 'accessibility-testing', 'bug-report-writing'],
    mcpTools: ['playwright', 'github'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read docs/design/ui/components/ 获取 DOM Contract，Read docs/design/architecture/api.md，Read sprint-{id}/sprint.md 确认测试范围',
  },
},
```

---

### 12.7 运维工程师（DevOps / SRE）

**定位**：CI/CD 流水线、容器化部署、基础设施即代码、监控告警、生产环境安全加固。

**适用阶段**：Phase 6（并行搭建）→ Phase 7（发布）→ 持续维护。

**输入/输出材料规约**：

| 输入 | 来源 | 格式 |
|------|------|------|
| 技术栈说明 | arch agent | `docs/design/architecture/` |
| 环境要求 | task / PRD | `task-{id}.md` |
| 安全审查结论 | security agent | `docs/security/` |
| 性能基线 | qa agent | `docs/qa/report-*.md` |

| 输出 | 格式 | 存放路径 |
|------|------|----------|
| CI/CD 流水线 | YAML | `.github/workflows/` |
| Dockerfile | Dockerfile | `apps/{name}/Dockerfile` |
| Docker Compose | YAML | `docker-compose.yml` / `docker-compose.prod.yml` |
| K8s Manifests | YAML | `infra/k8s/` |
| 监控配置 | YAML / JSON | `infra/monitoring/` |
| 部署文档 | Markdown | `docs/ops/deploy-{env}.md` |
| Runbook | Markdown | `docs/ops/runbook-{scenario}.md` |

**MCP 工具**：

```typescript
mcpTools: [
  { name: 'github', package: '@github/mcp', env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
  // 按云平台选用（V2+）:
  // { name: 'aws',   command: 'uvx', args: ['awslabs.core-mcp-server'] },
  // { name: 'gcp',   command: 'npx', args: ['@google-cloud/mcp'] },
]
```

**技能包**：

| Skill | 说明 |
|-------|------|
| `ci-cd-github-actions` | GitHub Actions 流水线规约（见下） |
| `docker-build` | 多阶段构建、最小化镜像、非 root 用户 |
| `k8s-deploy` | Manifest 规约、资源限制、健康检查 |
| `monitoring-setup` | Prometheus + Grafana、告警规则设计 |
| `security-hardening` | 镜像漏洞扫描、Secret 管理、最小权限原则 |
| `log-aggregation` | 日志格式标准化、ELK/Loki 接入 |
| `disaster-recovery` | 备份策略、RTO/RPO 设计、演练清单 |

**DevOps 规约**：

```
Docker：
  - 多阶段构建（builder + runtime），runtime 镜像只含运行时依赖
  - 基础镜像固定版本 tag（禁止 :latest），定期更新并记录变更
  - 运行用户非 root（USER node:node 或 USER 1001）
  - .dockerignore 排除 node_modules、.git、.env、测试文件
  - HEALTHCHECK 指令必须定义

GitHub Actions：
  - fail-fast: true，第一个失败立即停止
  - 依赖缓存：actions/cache 缓存 node_modules / pip / go mod
  - 并行执行：lint、test、build 三个 job 并行
  - 环境变量通过 GitHub Secrets 注入，禁止明文写入 workflow 文件
  - PR 检查：必须通过 lint + test + build，方可合并
  - 生产部署：需要手动 approval（environment: production + required_reviewers）

Kubernetes：
  - 所有 Deployment 必须设置 resources.requests 和 resources.limits
  - 禁止使用 :latest 镜像 tag（必须 digest 或精确版本）
  - 配置 readinessProbe 和 livenessProbe
  - 敏感配置通过 Kubernetes Secret 挂载，不通过 ConfigMap
  - 生产命名空间 RBAC 最小权限，禁止 cluster-admin

监控：
  - 服务必须暴露 /healthz 和 /metrics 端点
  - 告警规则：P99 延迟 > 500ms、错误率 > 1%、Pod 重启 > 3 次/小时
  - 日志格式：JSON 结构化，包含 trace_id、service、level、ts、msg 字段
```

**Config 片段**：

```typescript
agentRoles: {
  devops: {
    systemPrompt: '.myrmidon/prompts/devops.md',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    forbiddenTools: [
      'Bash("kubectl delete namespace")',
      'Bash("terraform destroy")',
      'Bash("rm -rf /"))',
    ],
    skills: ['ci-cd-github-actions', 'docker-build', 'k8s-deploy', 'monitoring-setup', 'security-hardening'],
    mcpTools: ['github'],
    outputLanguage: 'zh',
    contextRecoveryInstructions: 'Read docs/design/architecture/ 了解技术栈，Read infra/ 了解现有基础设施配置，Read docs/ops/ 获取已有运维文档',
  },
},
```

---

### 12.8 完整 agentRoles 配置参考

将以上模板整合到 `myrmidon.config.ts` 的 `agentRoles` 块，按实际团队角色选用：

```typescript
agentRoles: {
  // ── 产品 / 设计 ─────────────────────────────────────────────
  pm:         { systemPrompt: '.myrmidon/prompts/pm.md',        skills: ['requirements-gathering', 'prd-writing', 'epic-sprint-planning'],          allowedTools: ['Read','Write','WebFetch'],  forbiddenTools: ['Bash','Edit'],             mcpTools: ['github','linear','figma'] },
  uiux:       { systemPrompt: '.myrmidon/prompts/uiux.md',      skills: ['design-system', 'dom-contract-writing', 'accessibility-audit'],           allowedTools: ['Read','Write','WebFetch'],  forbiddenTools: ['Bash','Edit'],             mcpTools: ['figma'] },

  // ── 开发 ────────────────────────────────────────────────────
  frontend:   { systemPrompt: '.myrmidon/prompts/frontend.md',  skills: ['tdd-frontend', 'react-conventions', 'accessibility-impl'],                allowedTools: ['Read','Write','Edit','Bash'], forbiddenTools: ['Bash("git push")'],       mcpTools: ['playwright','github'] },
  backend:    { systemPrompt: '.myrmidon/prompts/backend.md',   skills: ['tdd-backend', 'api-design', 'sql-design', 'security-backend'],            allowedTools: ['Read','Write','Edit','Bash'], forbiddenTools: ['Bash("git push --force")'], mcpTools: ['github','sqlite'] },
  'app-mobile': { systemPrompt: '.myrmidon/prompts/app-mobile.md', skills: ['rn-conventions', 'mobile-accessibility', 'offline-first'],            allowedTools: ['Read','Write','Edit','Bash'], forbiddenTools: ['Bash("git push --force")'], mcpTools: ['github','playwright'] },

  // ── 质量 / 运维 ─────────────────────────────────────────────
  qa:         { systemPrompt: '.myrmidon/prompts/qa.md',        skills: ['webapp-testing', 'api-testing', 'bug-report-writing', 'accessibility-testing'], allowedTools: ['Read','Write','Bash'], forbiddenTools: ['Edit','Bash("git commit")'], mcpTools: ['playwright','github'] },
  devops:     { systemPrompt: '.myrmidon/prompts/devops.md',    skills: ['ci-cd-github-actions', 'docker-build', 'k8s-deploy', 'monitoring-setup'], allowedTools: ['Read','Write','Edit','Bash'], forbiddenTools: ['Bash("kubectl delete namespace")'], mcpTools: ['github'] },

  // ── 安全（横切，按 Phase 注入） ───────────────────────────────
  security:   { systemPrompt: '.myrmidon/prompts/security.md',  skills: ['security-owasp', 'dependency-audit', 'secret-scan'],                     allowedTools: ['Read','Bash'],               forbiddenTools: ['Write','Edit'],            mcpTools: ['github'] },
},
```

---

### 12.9 通用 Skills 目录

以下 Skill 文件存放于 `.myrmidon/skills/`，可在多个角色间复用：

| Skill 文件 | 适用角色 | 核心内容 |
|-----------|----------|----------|
| `requirements-gathering.md` | pm | 5W1H、JTBD 提问框架、需求完整性检查清单 |
| `prd-writing.md` | pm | PRD 模板、验收标准书写规范（SMART 原则） |
| `dom-contract-writing.md` | uiux, qa | DOM Contract 格式规范、data-testid 命名规则 |
| `tdd-frontend.md` | frontend | RTL 测试编写顺序、mock 边界、覆盖率要求 |
| `tdd-backend.md` | backend | 测试先行步骤、数据库集成测试（不 mock DB） |
| `react-conventions.md` | frontend | 组件设计、状态管理、性能优化检查项 |
| `nodejs-conventions.md` | backend | 分层架构、错误处理、日志规范 |
| `rn-conventions.md` | app-mobile | RN 性能、导航、跨平台适配规约 |
| `webapp-testing.md` | qa | Playwright POM、等待策略、数据隔离 |
| `api-testing.md` | qa | 接口覆盖矩阵、Schema 校验、边界条件 |
| `docker-build.md` | devops | 多阶段构建模板、.dockerignore 标准内容 |
| `ci-cd-github-actions.md` | devops | Actions 模板（lint+test+build+deploy 四阶段） |
| `security-owasp.md` | security | OWASP Top 10 检查清单、渗透测试范围定义 |
| `bug-report-writing.md` | qa | Bug 报告模板、严重性分级标准 |

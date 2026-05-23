# TUI Kanban 设计规格

**项目**: Myrmidon  
**日期**: 2026-05-21  
**状态**: 待实施

---

## 1. 目标

为 Myrmidon CLI 提供一套 TUI（Terminal UI）界面，支持：
- 实时监控 workflow 阶段、agent 状态、任务进度
- 客户（甲方）与 orchestrator 的对话
- 人工介入事项的醒目提示与内联操作
- 每个 executor/agent session 的完整审计日志
- 中英文界面切换

---

## 2. 整体布局

### 2.1 全局 Header

```
MYRMIDON  <project>  ▶ <sprint>  📅 Day X/Y  ⏰ ±Nd
```

始终显示：项目名、当前 sprint、天数进度、落后/超前天数。

### 2.2 标签栏

```
1 Overview  2 Project  3 Agents  4 Cron ●  5 Log
```

- `1`–`5` 数字键直接跳转
- `●` 红点角标：该 Tab 有待人工介入事项
- 需人工介入时全局 header 也闪烁高亮提示（不能只靠角标）

### 2.3 Statusbar（底部常驻）

```
q Quit  1-5 Switch  Tab Focus  ↑↓ Scroll  Enter Select  ? Help  :lang zh/en
```

---

## 3. 人工介入通知规格

**这是最高优先级 UI 事件，必须醒目。**

触发条件：
- 甲方需确认交付物
- arch/qa/security review 需人工 sign-off
- agent 卡住超过阈值，需人工决策
- 其他 `on-timeout: escalate` 的业务等待

**多层通知机制（同时触发）：**

| 层级 | 表现 |
|------|------|
| TUI Tab 角标 | `●` 红点显示在对应 Tab 标题上 |
| TUI 全局 banner | Header 下方插入一行反色高亮 banner（不可忽略） |
| TUI 音效（可选）| 终端 bell（可配置关闭） |
| IM 推送 | Slack / 企业微信（配置的渠道） |
| Email | 配置的收件人 |

**全局 banner 样式**（反色，红底白字，不能被 Tab 内容覆盖）：

```
████  ⚠ 需要确认：sprint-02 交付物已就绪  Enter确认  r拒绝  e延期  8m后自动通过  ████
```

**操作快捷键**（banner 激活时拦截，优先于当前 Tab 的默认按键）：
- `Enter` — 确认（banner 存在时拦截，不触发 chat 发送或卡片展开）
- `r` — 拒绝并输入备注
- `e` — 延期（输入延期时长）
- `i` — 跳转到 Cron Tab 查看详情
- `Esc` — 暂时关闭 banner 显示（事项仍未处理，角标保留）

多个待处理事项时 banner 显示第一条，`→` 切换到下一条。

人工操作完成后：撤销 TUI banner + 角标，并通知 IM 平台撤回提醒（平台支持时）。

---

## 4. Tab 1 — Overview（默认视图）

左右分屏：左侧 ~40% 会话区，右侧 ~60% 摘要区。

### 4.1 左侧：CLIENT CHAT

- 滚动显示甲方 ↔ orchestrator 对话历史
- 底部输入框，`Enter` 发送，`Tab` 切换焦点
- 人工介入时全局 banner 显示在 Tab 内容区顶部（覆盖所有 Tab，包括聊天区）

### 4.2 右侧：全局摘要（只显示数字，不展示卡片）

```
WORKFLOW
✅ Requirements
✅ PRD + Design
▶ Development  3/5 done
○ QA / Delivery

AGENT PULSE
pm ○  arch ○  coder1 ● task-7  coder2 ● task-8
qa ○  sec ○  ui ○

TASKS   3✅  2🟡  8○
ISSUES  1🔴  0🟡  5✅
TIMERS  T1●  T2●  T4●  T5◐
```

---

## 5. Tab 2 — Project Kanban

### 5.1 布局

三列：`PENDING` / `IN PROGRESS` / `DONE`

导航：`←→` 列间移动，`↑↓` 卡片间移动，`Enter` 展开/折叠

### 5.2 Task 卡片（折叠态）

```
┌─ task-00007 ──────────────────┐
│ 用户注册接口                   │
│ coder1 · sonnet · tdd-backend  │
│ mcp: playwright  port: :31007  │
└────────────────────────────────┘
```

显示字段：task-id、title、executor 实例、model、skills、MCP tools、端口

### 5.3 Task 卡片（展开态）

追加显示：
- acceptance criteria（编号列表）
- 依赖 task（blockedBy）
- 关联 issue（如有）
- 预计工时 vs 实际耗时

### 5.4 时间线（底部常驻）

```
sprint-02  2026-05-21 → 2026-06-10  ████████░░░░  60%  剩 20d  落后 8d
```

---

## 6. Tab 3 — Agent Kanban

### 6.1 折叠态（每 role 一行）

```
ROLE      INSTANCES   STATUS         CURRENT TASK
pm        1 / 1       ○ idle         —
arch      1 / 1       ○ idle         —
coder     2 / 3       ● 2 working    task-00007, task-00008
qa        1 / 1       ○ waiting      —
security  0 / 1       ○ idle         —
```

### 6.2 展开态（`Enter` 展开某 role）

```
[coder]
  executor: claude-sonnet-4-6
  skills: tdd-backend, api-design
  allowed tools: Read, Write, Edit, Bash（scope 限制）
  forbidden: git push, rm -rf
  instances:
    coder1  ● task-00007  running 12m
    coder2  ● task-00008  running 4m
    coder3  ○ idle
```

---

## 7. Tab 4 — Cron

上下两区：系统定时器 + 业务等待。

### 7.1 系统定时器

```
SYSTEM TIMERS        next    interval  status
● workflow-poll       3s      28s       running
● heartbeat           1s      3s        running
● stuck-detect        2s      55s       running
◐ client-timeout      —       —         paused
```

操作：`p` 暂停/恢复，`r` 手动触发

### 7.2 业务等待

```
BUSINESS WAITS          trigger    timeout    on-timeout
! sprint-02 交付确认 ●  甲方确认   8m left    auto-approve
○ daily report           23:00      —          send-report
○ arch review sign-off   arch确认   30min      escalate-pm
```

`!` + `●` 表示需人工介入（同时触发全局 banner）。  
`Enter` 进入操作流程（确认 / 拒绝+备注 / 延期）。

---

## 8. Tab 5 — Log（审计）

### 8.1 树形导航

左列：agent → session 树；右侧：选中 session 的日志内容

```
▼ coder1
  ● task-00007  2026-05-21T09:12  live
  ✅ task-00005  2026-05-21T08:30  12m  exit:success
▶ coder2
▶ qa
▶ arch
```

- `f` — 进入选中 session 的 live-tail 模式
- `Esc` — 退出 tail，返回树形
- `/` — 搜索日志内容

### 8.2 审计日志存储

**文件**：每 session 一个 JSONL 文件

路径：`.myrmidon/logs/{agent-id}/{session-id}.jsonl`

每条记录字段：
```json
{
  "ts": "2026-05-21T09:12:34.123Z",
  "type": "tool_call",
  "tool": "Write",
  "args": { "file_path": "/src/auth.ts" },
  "duration_ms": 42
}
```

type 枚举：`input` / `output` / `tool_call` / `tool_result` / `error`

**SQLite 索引**（`agent_sessions` 表）：

```sql
CREATE TABLE agent_sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  start_time  TEXT NOT NULL,
  end_time    TEXT,
  exit_status TEXT,         -- 'success' | 'error' | 'timeout' | 'live'
  file_path   TEXT NOT NULL
);
```

**保留策略**：默认 30 天 / 1000 sessions，可通过 `myrmidon config set audit.retention 30d` 配置。

---

## 9. 交互模型

### 9.1 鼠标支持

TUI 启用鼠标模式（Ink `useInput` + 终端鼠标事件）：

| 操作 | 效果 |
|------|------|
| 点击 Tab 标题 | 切换到对应 Tab |
| 点击 task 卡片 | 选中并展开/折叠 |
| 点击 agent role 行 | 展开/折叠详情 |
| 点击 banner 按钮 | 执行确认/拒绝/延期 |
| 滚轮 | 滚动当前焦点区域 |

键盘导航始终可用，鼠标为可选增强。

### 9.2 溢出滚动

每个面板独立维护滚动状态：
- 超出终端高度的内容可通过 `↑↓` 或鼠标滚轮滚动
- 滚动条以 `▐` 字符绘制在右侧边缘（mini scrollbar）
- `g` / `G` 跳到顶部 / 底部
- Log tail 模式下自动跟随最新行（`f` 键进入后），手动滚动时暂停自动跟随，按 `G` 恢复

---

## 10. 通知与 i18n

### 10.1 通知优先级

```
! 红色反色 banner（需立即操作）
● 角标（有新事件，不紧急）
  无标记（正常状态）
```

### 10.2 i18n

- 语言包：`resources/i18n/zh.json` / `en.json`，键名全英文
- 运行时切换：TUI 内输入 `:lang en` 或 `:lang zh` 热切换，无需重启
- 持久化：`myrmidon config set tui.lang zh`
- 默认语言：跟随 `LANG` 环境变量，fallback 到 `zh`

---

## 11. 与 PRD 的关联变更

本设计完成后，需在 PRD 补充：

1. **审计日志**：`agent_sessions` 表加入 Section 6.5 SQLite Schema
2. **环境变量**：补充 `ANTHROPIC_API_KEY`，`myrmidon init` 生成 `.env.example`，`.gitignore` 包含 `.env`
3. **dotenv 加载**：启动时自动加载 `.env`（或系统环境变量）
4. **TUI 配置项**：`tui.lang`、`audit.retention` 加入 Section 9.1 config schema

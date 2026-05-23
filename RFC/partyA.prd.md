# Myrmidon AI Agent Orchestrator PRD


## Overview

myrmidon 是一个 cli 工具,  同时支持 tui 交互方式

myrmidon 是作为 乙方的入口,  负责与甲方的对接需求, 然后 负责内部的 AI agent 编排协调工作,  最后输出项目成果交付甲方验收

加乙方沟通示例: 
    - 甲方:  我需要做一个B2B2C电商平台
    - 乙方:  好的,  我需要了解您的具体需求,  请提供详细的需求文档
    - 甲方:  好的,  我会提供详细的需求文档
    - 乙方:  B2B2C电商平台同常涵盖的模块有:  用户管理、商品管理、订单管理、支付管理、物流管理、营销管理、数据分析等,  是否有需要补充或调整的模块？
    - 甲方:  不需要补充分销模块
    - 乙方:  好的,  接下来我们需要依次确认每个模块的功能需求
    - 乙方:  用户管理模块,  需要实现哪些功能？
    - 甲方:  xxx
    - ....
    - 乙方:  好的,  我已经了解了您的全部业务需求
    - 乙方:  我将根据您的需求, 开始进行项目规划和开发,  但在开始之前, 您对技术栈有什么要求吗？
    - 甲方:  xxx
    - ....
    - 乙方:  好的,  我已经了解了您的技术要求
    - 乙方:  我将根据您的需求, 开始进行项目规划和开发
    - 乙方:  我方后续将按照敏捷开发的方式进行,  每个迭代都会向您汇报进度,  并且每个阶段都会给您展示成果确认
    - 乙方:  敏捷开发过程中, 您可以随时增删功能或提出修改意见,  我们会及时调整


乙方内部沟通示例: 
    - orchestrator: 我已经收集了甲方的所有需求
    - orchestrator: xxxx, xxx5个文件是目前我整理的需求文档, @PM @Arch 需要做一次需求评审和技术评审,  如果有问题提出来我会和甲方沟通
    - pm: 需求评审通过, 可以开始低保真原型设计和prd文档编写
    - orchestrator: 好的,  开始设计低保真原型和编写prd文档, 完成后输出 低保真原型设计文档 和 prd文档
    - arch: 技术评审通过, 推荐使用 springcloud 或 golang 作为服务端,  nextjs 作为前端,  flutter 做跨平台app,  需要与甲方确认是否同意或有其他要求
    - orchestrator: 好的,  我会与甲方确认技术栈
    - orchestrator: 技术栈确认, 开始进行详细设计和开发
    - ...
    - arch: 详细设计和开发完成, 需要评审 @orchestrator @pm @coder @qa @security
    - qa: 用户响应指标不达标, 需要优化,  建议 定为 200ms 内响应
    - coder1: xxx 是否需要考虑 redis集群的红锁机制对分布式锁带来的复杂度影响和稳定性影响？性能要求不高的场景要不要换成基于db的分布式锁？
    - coder2: 雪花算法ID 到前端可能会丢失精度,  是统一转成spring？还是前端自行处理？还是根据值范围动态判断比如 大于interger.MAX的 转string？ 建议统一转string,  动态类型容易埋雷,  出问题影响范围大 排查困难！
    - coder1: 同意coder2的建议
    - corder1: api的动态参数定义在复杂查询场景下有局限性, 是否引入RSQL的额外兼容方式, 让查询更灵活？
    - arch: 引入RSQL是个好主意, 可以增加查询的灵活性
    - arch: ...
    - arch: 没有其他问题那么方案确认评审完成,  等待 pm 原型图和prd
    - ....
    - pm: 详细设计和开发完成, 需要评审 @orchestrator @arch @coder @qa @security
    - coder1: 这个密码输入框是否需要支持密码强度检测和提示？需要明确支持的长度范围、字符类型等, 建议支持8-20位, 包含大小写字母、数字、特殊字符
    - coder2: 需要支持, 建议支持8-20位, 包含大小写字母、数字、特殊字符
    - pm: 同意, 需要支持密码强度检测和提示, 这是我疏忽了.
    - ui: 主题风格是只改颜色 还是 需要不同的样式？ 只改颜色比较简单但是体验一般,  多套样式开发复杂 但是体验更好
    - pm: 同意, 需要不同的样式, 体验更好,  可否主题风格多套, 颜色多套,  不同主题风格也可以切换不同颜色？
    - ui: 可以, 但是需要评估开发成本和维护成本
    - arch: 评估后发现开发成本和维护成本较高, 建议只做一套主题风格, 多套颜色
    - pm: 不行要做,  可以先把框架设计好支持多套主题风格和颜色, 但前期先实现2套主题风格和颜色, 后面再逐步完善多套
    - arch: 同意, 可以先实现2套主题风格和颜色, 后面再逐步完善多套
    - coder2: 原型图xxx的业务连续性中断了,  需要补充下流程图和对应页面
    - pm: 好的, 直接补充
    - ..
    - ...
    - pm: 如果没有其他问题, 本次评审就到这里, 我会马上修改, 完成后进行下一轮评审
    - ...
    - pm: 修改完成, 可以开始下一轮评审 @orchestrator @arch @coder @qa @security
    - ...
    - pm: 本次评审全部通过完成, 可以进入ui设计阶段
    - ui: 好的, 开始设计
    - ...
    - ui: 设计完成, 可以开始评审 @orchestrator @arch @coder @qa @security
    - coder1: 已经实现两套主题风格和颜色, 没有问题
    - coder2: 颜色饱和度不符合 WCAG 标准
    - ui: 好的, 我重新调整一下
    - ...
    - pm:  本次ui设计评审全部通过完成, 可以发给甲方确认
    - orchestrator: 好的, 发给甲方确认
    - ...
    - orchestrator 甲方确认通过, 可以进入开发阶段 @pm 先规划epics 和 sprints
    - pm: 好的, 开始规划
    - pm: epics 和 sprints 规划完成, @arch 需要评审
    - arch: 好的, 开始评审
    - ...
    - pm: 评审通过,  @arch 可以对 epic-xx/sprint-xx 进行任务拆分了
    - orchestrator: 好的, @arch 可以对 epic-xx/sprint-xx 进行任务拆分了
    - ...
    - arch: 任务拆分完成, @qa 需要生成测试用例 @coder1 设计SQL @coder2 设计API
    - coder1: 好的, 开始设计SQL
    - coder2: 好的, 开始设计API
    - qa: 好的, 开始生成测试用例
    - ...
    - qa: 测试用例生成完成, 
    - coder1: SQL设计完成
    - coder2: API设计完成
    - orchestrator: 检测到SQL和API设计完成, 测试用例生成完成, 可以开始开发了
    - orchestrator:  @coder1 task-xxid@dir/xxxx.md
    - orchestrator:  @coder2 task-xxid@dir/xxxx.md
    - coder1: 好的, 开始开发, 我创建了 worktree: feature/task-xxid
    - coder2: 好的, 开始开发, 我创建了 worktree: feature/task-xxid
    - ...
    - coder1: task1开发完成,  代码变更范围: ... 影响范围: ... 我已经测试通过, 已经合并到dev分支,  worktree: feature/task-xxid已经清理, 可以开始测试了
    - coder2: task2开发完成,  代码变更范围: ... 影响范围: ... 我已经测试通过, 已经合并到dev分支,  worktree: feature/task-xxid已经清理, 可以开始测试了
    - ...
    - qa: 测试不通过, 发现排版没有按照设计稿实现,  部分颜色不符合设计稿要求, 请修复 issues-xxid@dir/xxxx.md,  worktree: feature/issue-xxid 并未清理
    - orchestrator:  @coder1 @coder2 请修复 issues-xxid@dir/xxxx.md , 并清理 worktree: feature/issue-xxid
    - ...
    - coder1: 修复完成, 已合并到dev分支, worktree: fix/issue-xxid 已清理, 可以重新测试了
    - coder2: 修复完成, 已合并到dev分支, worktree: fix/issue-xxid 已清理, 可以重新测试了
    - ...
    - qa: 测试通过, 可以进入下一阶段了
    - ...
    - orchestrator: sprint-xx 完成, 需要通知甲方确认
    - orchestrator: 已通过 邮件/slack/企业微信 方式通知甲方确认
    - orchestrator: 甲方超时5分钟未回复
    - orchestrator: 甲方超时10分钟未回复  根据配置 甲方超过10分钟未回复, 当前时间是 夜间20:00～8:00, 配置了超时默认通过规则, 继续下一阶段
    - orchestrator: 开始下一阶段 @pm
    - pm: 好的 ...

    
其中, 这个工作流程是 orchestrator 固化的(当然也可以通过配置来调整类似n8n)非LLM驱动的.避免LLM驱动带来的不可控性.
每个节点的执行逻辑都是固定的 输入格式、执行器、执行内容范围、授权范围、禁止范围、输出产物、输出完成报告格式 等
- 每个执行者 对应 LLM Agent, 对输入检查、执行、输出产物检查 报告完成
- 每个执行者 都应该严格优先使用成熟的skill， 比如 ui-ux-pro-max, 可以通过配置来调整skill的使用
- orchestrator 每xx秒(可配置)检查一次流程状态, 自动推进流程
- 所有流程都有基本的文件结构和文件名定义,  便于cli 快速检查状态, 便于agent异常中断恢复等

- worktree 的使用最好做成脚本,  符合 git flow 分支命名规范以及合并流程
- main/master分支 只能通过 pull request 合并

## 文档规范

#### git flow 规范

> 用于规范git flow,  便于团队协作和代码管理
> 主要包括分支命名规范、合并流程、提交规范等

> git操作记录需要本地记录,  不提交到git

#### 项目文档
> 用于记录项目的 backlog, epics, sprints, tasks, issues 等数据
> 同时记录 原型、设计稿、架构图、流程图、SQL设计、API设计等每个节点交付物

> 需要提交到 git

#### 运行时文档

> 用于记录Agent在执行过程中的状态、日志、结果等信息,  辅助agent异常中断恢复等,  也用于查看agent工作状态等
> 不提交到 git


### agent 宪法

- 比如 claude.md 入口
- 比如 .claude/rules

尽可能让agent遵循宪法 以及各端开发规约, 减少LLM的不可控性

## TODO1

- runtime spec
- validator spec
- ...


## TODO2

- 尽可能拆分足够小的任务,  每个任务独立可执行,  便于并行执行和回滚
- 每个任务执行最好不会触发 上下文压缩, 避免压缩带来的信息丢失
- 可以增加 上下文压缩的勾子, 可以自行处理一些优化逻辑减少上下文压缩带来的影响

- 最好能打通 orchestrator CLI/TUI 与 IM 同时会话, 方便human远程协作,  而不会因为人离开了电脑导致无法及时处理

## TODO3 

- 最好能支持 多家 runtime 服务商 比如 claude code, opencode, kimi codex, gemini cli等
- 第一阶段先支持 claude code;


## 方案

- 方案1: nodejs 开发？然后可以通过 npx xxx@xxx install 快速安装？
- 方案2: py
- 方案3: golang 
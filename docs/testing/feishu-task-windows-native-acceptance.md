# 飞书任务 Windows 原生开发与验收记录

日期：2026-09-07 至 2026-09-08。状态：Windows 10 Administrator 原生自动化、计划任务受控生命周期已通过；Windows 11 普通用户与真实飞书业务闭环仍待验收。

用户先要求“先开发”，随后提供 Windows SSH 测试机，并明确确认上传三个消费包源码、测试与开发 tgz。以下新增原生证据；普通用户及真实业务闭环仍是发布门禁。

## 源码与环境

- 仓库：ILUO/aamp；分支：`feat/feishu-task-windows-native`。
- 固定基线：`7c4b7ff50b2fc766f9076dcbc7d87ce910ca8b76`，来自 `fix/feishu-auth-scope-negotiation`。
- 开发与当前测试主机：macOS 26.5.2 arm64、Node v22.22.2；Windows 11 build、PowerShell 和 Windows Codex 版本尚无实测记录。
- Windows 目标：Windows 11 x64 普通用户、PowerShell 5.1、Node 22/24。
- 未注册真实 Bot、未派发真实任务、未向远程推送或 npm 发布。

## 验证记录

下表区分当前已取得的证据与仍未执行的验收；文末保留首次本地交付历史。

| 验证层 | 当前状态 | 说明 |
|---|---|---|
| macOS 三包回归与类型检查 | 通过 | Task Agent 436 通过 / 4 原生跳过；ACP 176 通过；Feishu 106 通过；两 Bridge tsc 通过 |
| 实际 npm pack / 本地安装 | macOS 通过 | 三包实际 tgz 安装到全新临时 prefix，安装后帮助入口和必需运行文件检查通过 |
| Windows / macOS / Linux × Node 22/24 CI | 未执行 | 已新增工作流；尚未推送或触发 |
| Windows npm shim / argv / stdin / exit | Windows 10 通过 | 真实 npm shim，中文、空格、shell 特殊字符、CRLF stdin、退出码 7 |
| Windows ACL / CIM / 进程树隔离 | Windows 10 通过 | 原生 ACL 回读、CIM 身份、父子孙清理及旁观进程存活 |
| Windows Codex ACP session | 未执行 | 必须覆盖标准 npm 安装与特殊字符目录 |
| Feishu 注册、授权、配对及完整 Task 结果 | 未执行 | 需要专用测试 Bot 和 Windows 主机 |
| need_help / Owner 继续 / 提醒 / 重复 / 子任务 | 未执行 | 保持既有业务行为，记录各自 Task ID |
| 附件输入及 Windows 本地产物上传 | 未执行 | 中文路径、CRLF、现有大小限制 |
| 关闭终端、登录、stop/start/restart、故障重启 | 部分通过 | 实际 Task Scheduler 启动、幂等启动、重启、停止通过；注销、登录触发、故障重启与普通用户未验证 |
| 运行包更新、卸载与旁观进程存活 | 未执行 | 只管理本产品任务及已验证身份 |

## 原生验收录入模板

每个用例记录：OS build / 架构 / PowerShell / Node / Agent 版本、三个实际包的版本及 integrity、源码提交、操作、预期、实际、退出码、Task ID（适用时）、脱敏日志位置、通过或失败原因。不得放入 App Secret、OAuth token 或原始 profile。

## 发布与范围

源码 Bridge 的 package name 与默认发布 scope 不同。开发测试通过明确的本地 tgz 覆盖选择修改后的 Bridge，不能把 registry 中的旧包当成本分支。发布顺序仍为必要 Bridge patch → 核验真实 artifact 与精确引用 → Task Agent patch；目前没有分配或发布 Windows 版本。

仅涉及三个消费包与专用测试工作流。Task/AAMP 协议、scopes、Owner、结果与取消规则、SDK、服务端、旧 Task Bridge 不在本次改动范围。原有业务缺陷不因 Windows 适配声明已解决。

## 首次本地交付开发包（历史，未发布）

三个包均在本机通过 `npm pack --json` 构建。两 Bridge 的 prepack 执行 build/prepare-bin，随后三个确切 tgz 在全新临时 prefix 安装并运行安装后入口。这里只证明 macOS 上包内容与入口可加载，Windows `.cmd` 和业务闭环仍未执行。版本号沿用源码基线，不代表同名 registry 包包含这些修改；用 integrity 区分此次开发 artifact。

- `zengxingyuan-aamp-acp-bridge-0.1.29-dev.0.tgz`
  - 包：`@zengxingyuan/aamp-acp-bridge@0.1.29-dev.0`
  - Integrity：`sha512-VNleMRo7abRSCJHETbeF+W+2qNFgd1+/rn4QK4+GBDUolM8IFU9okjTfscXfaVUhxG7O3cmuqmDZDiVQU4sEwA==`
- `zengxingyuan-aamp-feishu-bridge-0.1.52-dev.5.tgz`
  - 包：`@zengxingyuan/aamp-feishu-bridge@0.1.52-dev.5`
  - Integrity：`sha512-L/mAr6CWLnWZ2ySbIjkJXPL4oBSp6m8gPzqih5S9Tiq45NbdBujI3uUfyoRcIT8EI2CNNHI4TXRinKERgdewcA==`
- `larktask-aamp-feishu-task-agent-0.1.1-dev.6.tgz`
  - 包：`@larktask/aamp-feishu-task-agent@0.1.1-dev.6`
  - Integrity：`sha512-Dr5Ey5zVlm4D4AWPJ2u2lg1QRKo/mWaWOnq3zeZnla31EYAC1gAOsJ06q/uqZcGozSCVNZMN7W4EDd7jK1p+Vg==`

安装验证：首次离线安装因 SDK 元数据未缓存失败；允许下载包已声明的依赖后，再将最终三包离线安装到全新 prefix 成功。安装过程未运行 lifecycle scripts；Bridge 构建已由 pack 的 prepack 完成。

## 实施决策

- 使用用户指定 checkout 与开发分支，没有另建工作树；代码留在该分支供后续审查。
- 按用户要求先开发，Windows 实机门禁延期；若原生 API 或上游 artifact 行为不同，仍需后续修正后才能发布。
- Windows 私有身份 journal 和操作锁用于落实既定进程生命周期约束，未扩展为跨平台可靠性协议；其 Windows 行为仍需桌面验收。
- Codex 是本次实现的 Windows Agent 入口。其他既有 Agent 的原生入口未验证，不显示为可用，也不映射为 Codex。

## 首次本地交付自动化结果（历史）

| 包 / 检查 | 实际命令 | 结果与日志文件 |
|---|---|---|
| Task Agent | `node scripts/run-platform-tests.mjs` | 437 项：434 通过、0 失败、3 跳过；`/tmp/aamp-task-agent-final-accepted.log` |
| ACP Bridge | `npm test` | 176/176；`/tmp/aamp-acp-final.log` |
| Feishu Bridge | `node --import tsx --test 'src/**/*.test.ts'` | 99/99；`/tmp/aamp-feishu-final-crossfix.log` |
| 两 Bridge 类型 | `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| 共享数据 | `node scripts/sync-bootstrap-defaults.mjs --check` | 通过 |
| 独立 Bash 入口 | `bash -n bootstrap/aamp-feishu-task-agent-bootstrap.sh` | 通过；原有 Bootstrap 契约纳入完整回归 |
| Diff | `git diff --check` / `git diff --cached --check` | 通过；真实 npm shim 的 CRLF 以单文件 Git 属性保留 |

3 项跳过是 Windows 原生 ACL/进程树和真实 npm Windows argv fixture，未计入通过数。完整测试包括纯逻辑分支、受控依赖和现有 macOS 行为，不代表 Windows 原生实机执行。

最终复审已确认 npm shim/Codex/lark-cli 入口、CLI 提示词、锁的恢复、后台事务、前台协作退出和持久进程身份修复；无剩余阻断级静态发现。

基线/中间失败：原有日志跟随测试固定等待150ms，在 tail 尚未监听时写入更新而超时；测试现采用两轮唯一 marker 握手后再写一次真实更新。AIME 投影测试需等待相应日志落盘后断言。两者仅修正测试同步，未改对应 POSIX 业务逻辑；日志用例连续3次14/14通过后，完整回归通过。共享 pin 抽取后，两处源码字面量断言改为验证唯一 JSON 来源。

提交时全局硬编码提示性 hook 曾超过其2秒上限，hook 自行放行，不能将该次扫描算作通过；本次未关闭或改写该 hook。

代码提交：ACP `29c3506`、Feishu Bridge `8e3f9d5`、Task Agent `a5e49fe`。均为本地开发提交。

## 2026-09-08 Windows 10 原生 SSH 实测

环境：Windows 10 企业版 22H2 / 10.0.19045 / x64，PowerShell 5.1.19041.6456；Administrator，存在 active console 会话，无 RDP。使用官方校验过的便携 Node 22.22.2 / npm 10.9.7。仅在独立测试目录操作；每次进程 PATH 仅含 Node 与 Windows 系统工具，无 Git Bash、MSYS、WSL。未修改系统 PATH，未注销或重启机器。

| 检查 | 结果 | 脱敏日志（远端测试根目录内） |
|---|---|---|
| Task Agent 正式平台测试 | 244 项：231 通过、13 平台跳过、0 失败/取消 | `task-agent-native-final.log` |
| ACP `npm test` | 176 项：172 通过、4 平台跳过、0 失败；tsc 通过 | `acp-canonical-fixed.log` |
| Feishu 全部 src 测试 | 106/106；tsc 通过 | `feishu-full-fixed2.log` |
| 原子替换最终重试窗口 | 7/7；最后对齐批准设计的 100/200/400/800/1600ms 间隔 | `rename-final.log` |
| 真实 npm cmd shim | argv 特殊字符、中文、stdin、exit code 通过 | `native-launcher-fixed1.log` |
| 真实 Task Scheduler | start、重复 start 保持 PID、restart 更换 PID、stop 返回 stopped | `scheduler-smoke-fixed.log` |
| 计划任务账号解析 | SID、完整账户名、短账户名；其他/不可解析账户拒绝，8/8 | `scheduler-principal-fixed.log` |
| 三个 tgz 新 prefix 安装 | ignore-scripts 安装成功；5 个 .cmd 帮助入口及空绑定 list 均通过 | `installed-native-final.log`、`installed-*-help.log`、`installed-list.log` |

Task Scheduler 读回 Interactive / Limited / IgnoreNew / RestartCount=3 / PT1M。受控 controller 仅模拟 readiness 和协作退出，不连接 AAMP/Feishu，不能算真实 Bot ready。确认 worker/controller 均退出后注销测试任务；不遗留后台任务。自动故障重启策略仅核对配置，未注入故障或实际注销登录。

macOS 增量回归：Task Agent 440 项、436 通过、4 原生跳过；ACP 176/176；Feishu 106/106。两 Bridge 类型检查与 pack build 通过。原生与 macOS 统计分开，不把跳过项算通过。

### 实机发现与最小修复

1. Windows npm exec 多行 eval 静默返回空描述符：固定 resolver 源码编码成单行 data URI，仅 Windows 使用；真实 npm 参数测试验证。
2. Path/PATH 重复导致 helper 覆盖无效：Windows 环境合并按大小写不敏感规则处理，POSIX 保持原规则。
3. Task Scheduler 把注册时的 SID 回读为 Administrator：归一化为 SID 后检查身份；仍拒绝其他身份或无法解析的账户。
4. 私密 JSON 的 chmod 在 Windows 不表达 ACL：秘密临时文件创建前设置并回读父目录私密 ACL，独立测试验证最终文件权限。
5. Windows rename 共享占用导致 EPERM：在文件替换边界对 EPERM/EACCES/EBUSY 最多重试 5 次、累计 3.1 秒；不先删除目标，不改变事件或结果语义。
6. 测试夹具修正：真实 Node 入口替代 shebang、USERPROFILE 隔离、Windows 路径及 PowerShell 断言、DNS mock 引用句柄及异步持久化完成条件。POSIX 专属测试明确跳过。

初次原生失败结果保留在 `*-full-initial.log`；一次扩大 ACP glob 意外包含额外 AIME packaged harness，其物料未在本次上传范围且含 POSIX 专属依赖，不作为正式 `npm test` 通过证据。随后按 package.json 的正式入口复跑并通过。

### 最终原生验证开发包（未发布）

版本号沿用开发基线，须按下列 integrity / SHA256 区分同名旧包。三个包安装到新的独立 prefix，远端 SHA256 与本地一致。

- `larktask-aamp-feishu-task-agent-0.1.1-dev.6.tgz`
  - Integrity：`sha512-dYmeNaFhyxEL1pDByLh+wcIqzwg4aZWF0DX5And1TwcRcOi0HGytsbmLs6dky0nAqzb9INiN4amayj1v/hoMMQ==`
  - SHA256：`8b6764f69d6bdaf6ce5150f2b770e0847ce1b36fd448efea8f80758e6c0362cb`

- `zengxingyuan-aamp-acp-bridge-0.1.29-dev.0.tgz`
  - Integrity：`sha512-zcijPRZRDGwUGc8TRYq1z0Y5Auo9TawxbQ/UocQbvQzwOAOw1nh7EneHJn8GeFAiCqQMgRHt5CnxggamuU4bnQ==`
  - SHA256：`1589b3bba191bf012357fce719a462ab82b34c1c99253e2d6bdc8192bdcb9119`

- `zengxingyuan-aamp-feishu-bridge-0.1.52-dev.5.tgz`
  - Integrity：`sha512-VGHSTH62u2DP9qlR0qjm8VrcdD5TAnLDF0Lv8j4Itjbc+dvBawbfHP5NOXHjoLSJVxjAQxgrRdkiqBfPyH5IXQ==`
  - SHA256：`b772040bbaa2a6dcb6127e8990e90e58897000fab5c1ab6c515a8711c2cfb0bf`

### 仍待验收

Windows 11 普通用户、Node 24、真正 Codex ACP session、飞书注册/OAuth/Owner 配对和完整 Task 业务矩阵、附件上传、注销登录恢复、故障重启、运行中更新卸载与 CI 矩阵。此次无真实测试 Bot/用户授权材料，未注册、发送或派发业务任务。Win10 Administrator 的原生测试不替代这些发布门禁。

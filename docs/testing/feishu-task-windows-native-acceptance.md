# 飞书任务 Windows 原生开发与验收记录

日期：2026-09-07 至 2026-09-08。状态：Windows 10 Administrator 已取得原生自动化、受控生命周期及真实飞书任务闭环证据，附件闭环在已登录用户的交互会话后台模式通过；Windows 11 普通用户等剩余矩阵仍待验收。

用户先要求“先开发”，随后提供 Windows SSH 测试机，并明确确认上传三个消费包源码、测试与开发 tgz，后续授权真实 Bot 与任务业务补测。下表汇总最新证据；未完成的验收项仍是发布门禁。

## 源码与环境

- 仓库：ILUO/aamp；分支：`feat/feishu-task-windows-native`。
- 固定基线：`7c4b7ff50b2fc766f9076dcbc7d87ce910ca8b76`，来自 `fix/feishu-auth-scope-negotiation`。
- 开发主机：macOS 26.5.2 arm64、Node v22.22.2。实测主机：Windows 10 企业版 22H2 / 10.0.19045 x64、Administrator、PowerShell 5.1.19041.6456、Node 22.22.2、Codex 0.153.4；存在活动 console 登录，无 RDP。Windows 11 尚无实测记录。
- Windows 目标：Windows 11 x64 普通用户、PowerShell 5.1、Node 22/24。
- 已注册专用新 Bot、完成用户 OAuth 与真实任务补测；未向远程推送或 npm 发布。

## 验证记录

下表为截至 2026-09-08 附件最终复验后的最新汇总。Windows 通过项均限定为上述 Windows 10 Administrator 环境，不代表 Windows 11、普通用户或 Node 24 已通过。下方按时间保留历史失败及当时的待验收状态，以本节和最新复验结论为准。

| 验证层 | 当前状态 | 说明 |
|---|---|---|
| macOS 三包回归与类型检查 | 部分通过 | 最新已记录 Task Agent 459 项：451 通过、6 跳过、2 AIME 失败；ACP 197 项：194 通过、3 跳过；Feishu 112 项：108 通过、4 跳过。两 Bridge 类型检查已有通过记录，不将三包整体报告为全绿 |
| Windows 原生包测试 | Windows 10 通过 | Task Agent 263 项：250 通过、13 跳过；ACP 197 项：193 通过、4 跳过；最新 Feishu 112/112。各包分轮执行，详见下方记录 |
| 实际 npm pack / 本地安装 | macOS / Windows 10 通过 | 三包实际 tgz 安装到全新临时 prefix，安装后帮助入口及运行文件检查通过；后续修复包本地与 Windows 哈希回读一致 |
| Windows / macOS / Linux × Node 22/24 CI | 未执行 | 已新增工作流；尚未推送或触发 |
| Windows npm shim / argv / stdin / exit | Windows 10 通过 | 真实 npm shim，中文、空格、shell 特殊字符、CRLF stdin、退出码 7 |
| Windows ACL / CIM / 进程树隔离 | Windows 10 通过 | 原生 ACL 回读、CIM 身份、父子孙清理及旁观进程存活；异步周期采样性能已补测 |
| Windows Codex ACP session | 部分通过 | 真实计算及交互会话后台读写文件通过；SSH Session0 runner pipe-in 超时仍可复现。标准 npm 安装与特殊字符目录完整矩阵未验收 |
| Feishu 注册、授权、配对及完整 Task 结果 | Windows 10 通过（修复后） | 新 Bot 注册、用户 OAuth、自动绑定成功；初次任务被 EPERM 中断，修复后 Owner 评论重试得到 527 并回读 done/4。不是原包干净安装全程无故障 |
| need_help / Owner 继续 | Windows 10 通过 | 跨重启补充参数后得到 493，服务端 done/4；Task ID 见“原Bot扩展场景恢复” |
| 单次提醒 / 重复任务 | 部分通过 | 单次 task_reminder_fire 实际触发并回写 133、done/4；重复任务未验证 |
| 父子任务 | Windows 10 通过 | 结果 48；父子均 done/4，日志 completed parent=1 children=1 |
| 附件输入及 Windows 本地产物上传 | 核心闭环 Windows 10 通过；边界待验 | 交互会话后台实际读 CSV、求和生成 result.csv、上传并从服务端下载核验 WIN10-ROUNDTRIP-9821 / 49，日志 succeeded、任务 done/4。中文路径、CRLF 附件及大小边界仍待验，不能用 shim 测试替代；详见“附件最终闭环通过（交互会话后台模式）” |
| 关闭终端、登录、stop/start/restart、故障重启 | 部分通过 | 受控 Task Scheduler 生命周期及真实业务 restart/stop 通过，停止后无本轮 Node 残留；关闭终端、注销、登录触发、故障重启与普通用户完整矩阵未验证 |
| 运行包更新、卸载与旁观进程存活 | 未执行完整验收 | 已做测试修复包替换及受控旁观进程存活检查；运行中更新、卸载完整流程未验证 |

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

Windows 11 普通用户、Node 24、真正 Codex ACP session、飞书注册/OAuth/Owner 配对和完整 Task 业务矩阵、附件上传、注销登录恢复、故障重启、运行中更新卸载与 CI 矩阵。截至该轮测试尚无真实测试 Bot/用户授权材料，未注册、发送或派发业务任务；后续真实授权与业务测试见下节。Win10 Administrator 的原生测试不替代这些发布门禁。


## 2026-09-08 真实授权与业务验证

- Bot 注册已完成，用户在 Mac 浏览器授权，Windows SDK 轮询成功取得结果；无需浏览器回调 Windows localhost。
- App ID：`cli_aa1511303dba5bc1`；隔离 profile：`aamp-feishu-task-cli_aa1511303dba5bc1`。
- 用户 OAuth 已完成；CLI 1.0.94 的服务端 verify 检查返回 user available=true、status=ready、tokenStatus=valid，已授予所需 Task scopes。
- 首次授权结束时发现 CIM GetOwnerSid 进程退出竞态，以及 Windows helper 不兼容新版 profile 对象列表。已进行限定修复：前者重查同 PID 与创建时间后才忽略退出/复用，存活进程权限错误不忽略；后者支持旧字符串及具名对象，并保留 token/scope 校验。
- 原生专项：CIM 28/28、profile 16/16；macOS 增量全套 451 项、445 通过、6 原生跳过。随后另加入仅含 PID 与字段名的身份诊断；一次 invalid tree identity 未再次复现，保留为待跟踪项，不按通过处理。
- 旧安装流程在返回注册结果前中止，尚未写 bindings。已按官方 CLI v1.0.94 Windows DPAPI 存储实现，仅在该 Windows 用户内恢复本 App 的单个密钥引用，并经产品既有 buildPendingBinding/upsertBindings 保存 pending 绑定；密钥未输出或传出机器，未重复创建应用。
- 真实 Agent Bridge 与 Feishu Bridge 1/1 启动及 AAMP 配对完成。
- 首个 Task：`9b796fdb-7212-428b-ad39-b7e1c7bd9a9d`，仅分配给上述测试 Bot；幂等键 `aamp-win-native-20260908-smoke-01`。内容为 17×23。
- 已观察完整事件接收、AAMP dispatch、ACK、result 回写链路，但 result 为 rejected/failure。飞书虽为 done，不算成功闭环。AAMP Task ID：`feishu-task-9b796fdb-7212-428b-ad39-b7e1c7bd9a9d-eacdab79709ac050f83f8b6171f96085`。
- 失败根因：真实 acpx 0.15.1 在 Windows 拒绝 raw --agent command string，要求配置 argv array；Windows 原生适配已在后续轮次修复，业务结果/完成规则保持原样。
- 独立原生 Codex 0.153.4 只读计算探针最终输出 391。过程中 WebSocket 多次超时，自动切换 HTTPS 后成功，说明模型可调用但该主机网络存在明显等待。
- 首次失败任务后已正常 stop，保留 Bot、OAuth、绑定及任务作为验收证据。

### 第二轮真实任务与 Windows 长提示词问题

- Windows argv 配置修复后，真实 `agent.session.ready` 成功。原生回归：Task Agent 256 项（243 通过、13 跳过）；ACP Bridge 184 项（180 通过、4 POSIX 跳过）。
- 第二个 Task：`35b8692f-4e2d-44d1-a88e-e7bd0c2bed5f`；幂等键 `aamp-win-native-20260908-smoke-02`。事件、ACK、进度、结果回写均已发生，但仍为失败，不算业务通过。
- 评论确认失败原因为缺少 `FEISHU_TASK_RESULT_JSON`，返回内容为系统错误乱码。Windows 无副作用复现：`node npx-cli.js -y acpx --help` 携带 20 字符参数成功；携带 12000 字符参数返回退出码 1、`The command line is too long.`。
- 根因定位到 npx 内部 Windows 命令调用长度限制。修复限定为 Windows 使用 acpx 原生 `--file -` 从 stdin 读取提示词，保留 POSIX 调用和飞书结果判定规则。修复后成功结果见第三轮记录。
- stdin 初版原生全套为 189 项（185 通过、4 POSIX 跳过、无失败）；后续审查补充输入管道失败仍存活子进程的清理场景，因此该数字仅作为中间证据，最终版须再次验证。
- 第二轮停止命令正常返回 0，确认该轮 controller/bridge/acpx 进程已退出。等待达到分钟级：清理逐个 PID 做 PowerShell/CIM 验证，不将循环的 sleep 总时长等同于整体超时。
- 下一轮启动遇到旧记录 PID 6288 已复用而拒绝 taskkill，未误杀。恢复逻辑已修复：只对证实已退出的旧身份跳过，不吞掉权限或身份查询错误。

### 第三轮：普通文本任务真实闭环通过

- Task GUID：`c32c432b-1907-4e44-949f-ee59abf90858`；幂等键 `aamp-win-native-20260908-smoke-03`；[飞书任务](https://applink.larkoffice.com/client/todo/detail?guid=c32c432b-1907-4e44-949f-ee59abf90858)。
- AAMP Task ID：`feishu-task-c32c432b-1907-4e44-949f-ee59abf90858-2c91cc116c79fd43aeb3e59e76095989`；run `1788854392120-14248`。
- 2026-09-08 08:02:24 UTC 真实 ACP session ready；08:03:55 接收任务；08:06:39 ACP completed；Feishu Bridge 随后记录 `answered` 与父任务完成。
- 服务端回读确认评论 `7683072876475419577`：`391. Multiplying 17 by 20 and by 3 gives 340 + 51 = 391.`；任务 status=done、agent_task_status=4。此轮由内容与协议成功日志共同判定通过，不只看 done。
- 验证范围：Mac 浏览器授权 → Windows 取得 Bot / 用户凭证 → AAMP 配对 → 原生 Codex ACP → 飞书任务事件/ACK/执行/评论结果/完成。未引入 Bash、WSL 或 Windows 远程桌面。
- 最终产品修复限定为 Windows：CIM 退出竞态、CLI profile 对象列表兼容、acpx argv 配置、长提示词 stdin 传输及失败子进程清理、旧 journal 的已退出 PID 代次恢复。飞书业务协议与 POSIX prompt 传递保持原样。
- Task Agent 最终原生全套：263 项，250 通过、13 平台跳过。ACP 清理测试曾因 Windows fd/pipe 差异及 PID 退出先于 close 事件产生夹具失败，已修正夹具并保留失败记录，最终重跑结果另记。
- 最终 tgz 版本号不变、未发布；以下 SHA256 已与远端核对一致：Task Agent `1ebaa938965e5b8a6925dd1418e5f3de994add84c72e37f380cfe1dead7d18f4`；ACP Bridge `8fcf12ba78b68f11c32b08566291a4a15c9249c94b853b3723b2e617792741c3`。ACP 实机文件名带 `windows-stdin-final` 后缀以避开 npm 旧缓存。
- 尚未验收：need_help + Owner 评论继续、提醒/重复/子任务、附件输入/上传、Windows 11 普通用户、Node 24、注销恢复/故障重启/更新卸载和远端 CI。普通任务成功不替代完整发布门禁。
- 最终 ACP 全套：Windows 190 项（186 通过、4 POSIX 跳过、0 失败）；macOS 相同测试集合串行执行 190 项（187 通过、3 Windows 跳过、0 失败）。并行运行曾出现已有超时夹具的慢启动失败；HEAD 对照可复现 TERM 夹具超时，记录保留，未删改或跳过该 POSIX 用例。
- 第三轮业务完成后 stop 返回 0，前台会话退出；保留已授权 Bot、用户 profile、绑定和三个测试任务供复核。
- 最终 Task Agent macOS 串行全套：459 项，451 通过、6 Windows 跳过、2 AIME 相关测试失败（远端 helper 进程组清理夹具 5 秒超时、噪声 npm 输出分类夹具 25 秒超时）。未报告全绿；两项不属于本次 Windows 改动文件，修改前 HEAD `2236a31` 隔离对照中，进程组清理同样约 5 秒超时，噪声输出分类约 8 秒通过；后者不能据此判定为已确认的既有失败。
- 最终 Windows 进程回查仅剩测试前已存在的 other Node PID 8548/7832/7672；本轮 controller、bridge、acpx 和 held-input 夹具均无残留。
- 噪声输出分类补充受控对照：HEAD 临时包仅覆盖本轮三个 Task Agent Windows 产品文件后，noisy 单项约 17.7 秒通过；当前 checkout 隔离仍达 25 秒超时。证据不足以将该失败归因于 Windows 改动，也不足以宣称当前 checkout 的 macOS 全套已通过，继续保留限制。

## 2026-09-08 Win10 业务与生命周期补测（进行中）

继续使用提交 `598acc0` 的已验证包、原隔离 Bot 和 Win10 Administrator，未引入新的业务代码。

| 场景 | Task GUID | 当前证据 |
|---|---|---|
| need_help / Owner 继续 | `1c859119-6e94-4499-bde2-a4200a13860c` | 日志 `help-needed` 和 blocked；Owner 已评论补充29，预期17×29=493，结果待回读 |
| 附件输入/CSV交付 | `4216434f-75ea-4fc2-ab68-5c98f888623f` | 85字节合成input.csv上传成功；附件GUID `c73bad00-f1c4-4e7a-8e07-44a403e98bab`；内容17/23/9、唯一标记，预期总和49 |
| 单次提醒 | `f8452498-b5ac-4b09-bee5-b98eeeaba10b` | due=1788856916000ms，截止时提醒，预期19×7=133；观察创建时延迟执行与提醒事件 |

附件任务先创建、上传、再分配Bot。实际 `task_assignees_update` 被既有allowlist忽略，已通过Owner评论触发；不将单独负责人变更视为已验证执行入口，未扩大修改事件语义。

补测中断记录：run `1788856157522-9888` 在 08:38:24 UTC 出现 `windows-process-journal: Windows process timed out after 30000ms`，Controller 按保护策略停止全部 Bridge。Owner 继续评论已经 ACK，附件任务 dispatch attachments=1，但尚未得到终态，不能判通过；提醒和父子任务需要恢复运行后重新触发。

原生诊断：同一主机 readIdentity 约0.9秒；空闲根进程树快照1.68秒，8个子进程2.72秒。ACP 每500ms同步执行快照时，两个空闲受管进程令100ms心跳最大间隔从125ms增至3551ms（10秒仅7次心跳）。这证明周期同步采样会显著阻塞事件循环；尚不能仅凭此把单次30秒CIM超时完全归因于它。修复限定为Windows异步、有界周期查询，保留身份验证及cleanup生命周期。

干净安装第一次尝试使用 `fresh-install-598acc0`：用户确认注册页面复用了旧Bot，故不算新注册通过；已正常stop，未撤销旧应用。按用户要求在新的空目录 `fresh-install-598acc0-r2` 重新发起注册，必须核对新App ID不同于旧 `cli_aa1511303dba5bc1`。


### 新 Bot 干净安装与新增 Windows 阻塞

- R2 空状态目录安装创建了新 App `cli_aa15713357f89bc4`（不同于旧 Bot），绑定 `0ed2b29e-a310-475f-b006-ce1b433d634a`。Bot 注册和用户 OAuth 分别完成，安装流程自行保存绑定并启动 1/1，无需手动恢复密钥。
- 新 Bot 冒烟任务 `5328fd0a-9ef7-4428-81d3-8e95c9420759`，17×31，预期527；服务端回读仅有 ACK `7683087206512069577`，不能认定业务通过。
- run `1788857506724-12068` 于09:04:34 UTC因 `writeJsonAtomic` 替换 IM state.json 返回 `EPERM`，Feishu Bridge退出1。ACP于09:04:58完成，但结果未回写。该轮仍使用 stdin-final ACP包；与异步采样修复的验证分开记录。仅凭错误码不能确定文件被哪个进程占用。

### Windows 异步进程采样验证

- ACP周期采样改为有界异步、single-flight，停止/取消等待在途采样结束后清理；保持PID代次和所有者校验。初始身份校验与最终清理仍包含有界同步操作，不宣称完全无阻塞。
- macOS ACP串行：197项，194通过、3Windows跳过、0失败。Windows ACP全套：197项，193通过、4POSIX跳过、0失败，约62秒。
- 同一Win10主机100ms心跳基线最大115ms；两个监控含启动身份校验最大1889ms、10秒93次；稳定阶段最大126ms、10秒93次。此前同步周期采样为最大3551ms、10秒7次。这支持周期阻塞已改善，不证明所有CIM超时已消失。
- 新ACP测试包文件名 `zengxingyuan-aamp-acp-bridge-0.1.29-dev.0-windows-async.tgz`；SHA256 `fc7817da4e5081d7a700dc0304ea47f17d0821bd70d9f5cc67da5e1a8459d068`，本地与Windows回读一致；尚待真实业务复验。

- IM持久化限定修复：将config.ts遗漏的直接rename接入包内既有renameAtomic，与Task路径共用。Windows临时EPERM/EACCES/EBUSY最多5次重试，总等待3.1秒；不unlink目标，失败保留原始错误，POSIX不重试。不能把重试等同于已证实占用来源或彻底解决所有EPERM。
- Feishu Bridge本地src测试108/108、build退出0；Windows原子替换专项9/9，含暂时/永久拒绝时旧JSON完整性。修复包 `zengxingyuan-aamp-feishu-bridge-0.1.52-dev.5-windows-im-rename.tgz` SHA256 `766652be1075a98a0cf16ded59c45683b5242eed4153b150ba9bf32d62953b2d`，本地与远端一致。

### 新Bot恢复后的真实闭环通过

- run `1788859026150-8992` 使用异步ACP与IM rename修复包，复用新Bot授权启动1/1。Owner继续评论 `7683091901909765058` 触发原任务；AAMP Task ID `feishu-task-5328fd0a-9ef7-4428-81d3-8e95c9420759-fbe716c1ebc30e8019905a01904613b2`。
- 最终评论 `7683092546850966490`：`17 × 31 = 527. Calculate 17 × 30 + 17 = 510 + 17 = 527.`。服务端回读 status=done、agent_task_status=4、completed_at=1788859383000，日志answered、completed parent=1 children=0，errors.jsonl为空。
- 结论：新Bot注册/用户OAuth/自动绑定成功；初次业务被EPERM中断，修复包恢复后由Owner评论触发的真实结果闭环通过。不将其改写为原598acc0包干净安装全程无故障，也不声称验证了结果自动重放。运行中仍有AAMP连接超时及流事件fetch失败，但本次最终回写成功。产品修复本地提交 `0a70b18`，未推送或发布。

- 新Bot本轮正常stop返回0，前台会话确认停止并退出；保留授权与绑定。

### 原Bot扩展场景恢复

- run `1788859546112-9380`，两个Windows修复包，1/1绑定恢复。Owner/附件/父子继续评论分别为 `7683093937623485414` / `7683093939989040080` / `7683093942392622032`，均ACK且ACP于09:28:34 UTC收到。
- 单次提醒重新设为due `1788860078000`，原截止时提醒保留。CLI +update的毫秒值入口返回1470400，改用文档支持的ISO日期成功；未改产品或CLI，尚待提醒触发验证。

- Owner继续通过：`1c859119-6e94-4499-bde2-a4200a13860c`，结果评论 `7683094672184478985` 为17×29=493，服务端done/agent_task_status=4；与此前need_help评论共同覆盖请求补充→Owner继续→完成（跨重启）。
- 父子通过：父 `ae73f174-a946-40b9-8098-c5b6630e6f4a`、子 `5ca6ce48-9d75-4d50-bb47-bc76b60af54e` 均done/agent_task_status=4，父评论 `7683094730036481246` 为6×8=48，日志answered及completed parent=1 children=1。
- 附件失败：结果评论 `7683095099516964040` 报告文件读取执行前连接runner pipe-in超时15000ms、替代Node runtime退出，未验证marker/total，未创建artifact。Feishu日志dispatch attachments=1、attachment_notes=0，终态result closed status=failure；虽然done不能算通过。错误来源目前为Agent结果报告，未独立定位Windows runner的系统根因，未绕过沙箱或改动权限策略。
- 新截止时间后已观察单次 `task_reminder_fire`、dispatch及ACK，事件 `a587731c241acac81022446764dba21f`；等待最终133回写。

- 单次提醒闭环通过：最终评论 `7683096245686029249` 为19×7=133，服务端done/agent_task_status=4；ACP于09:37:32 UTC completed，触发来源确认为task_reminder_fire，没有用Owner评论替代。
- 本轮明确未完成：附件输入到原生产物上传的完整闭环（runner执行失败）；重复任务、普通用户Win11、Node24、注销/故障恢复、运行中更新卸载和远端CI。当前成功场景不能替代这些门禁。

- 原Bot扩展补测结束正常stop返回0、前台SSH退出。停止完成后CIM回查仅有测试前既存Node PID8548/7832/7672，无本轮Node残留。保留两套Bot授权/绑定及任务证据。

## 2026-09-08 附件runner阻塞定位

- 原始Codex会话 `01a0802a-f612-72f0-ae3a-da3661e1cc30` 对应本附件任务。09:30:57 UTC首个Get-Content（读skill/CSV）在进程创建阶段报runner pipe-in连接15000ms超时；09:32:00仅读CSV且login=false仍复现。会话为workspace-write、network_access=false、on-request；未通过降低沙箱复测。SSH直接读取合成CSV正常。
- sandbox日志显示setup refresh errors=[]、command-runner复制/选择成功，错误出现在执行进程管道连接阶段。不能把setup成功等同于runner可用。
- 独立于AAMP的最小探针：同一Codex0.153.4执行 `codex sandbox -P :workspace --include-managed-config -C <test_root> -- powershell.exe -NoProfile -Command 'Write-Output AAMP_RUNNER_PROBE'`。SSH Session0失败（同样15000ms pipe-in超时）；一次性同用户Interactive/Limited计划任务位于Session1，输出标记并exit0。机器已有Administrator活动console登录；本对照未依赖RDP、未关闭沙箱、未修改用户Codex配置。
- 当前证据将阻塞定位为SSH Session0启动原生Codex runner的会话上下文问题；内核/runner更深层原因未定位。上游同类公开报告 https://github.com/openai/codex/issues/30839 截至检索仍Open，只作旁证，不代替本机对照。
- 产品已有后台模式使用Interactive/Limited Task Scheduler，可复用该执行路径；正在对同一附件任务重开并复测完整产物。独立诊断任务AAMP-Runner-Probe-20260908已移除，日志保留。

- 授权对照补充：相同隔离profile在SSH Session0返回bot not_configured/user missing；同用户Session1调用auth status --verify返回bot/user available=true、verified=true、tokenStatus=valid，Task scopes齐全。凭证未丢失，无需重新授权。lark-cli源码的Windows backend使用HKCU+DPAPI，读取失败对外返回missing；本机证据确认会话相关可用性差异，尚未独立输出具体DPAPI错误码。
- `start` 从SSH仍在前台预检授权，故在移交后台前被上述凭证读取阻断（0/1）；使用既有绑定的产品 `restart` 路径让worker在交互会话完成准备，无须手动导出凭证或改沙箱配置。完整业务结果待回读。

### 后台执行成功后暴露的Windows文件路径损坏

- run `1788861690737-14264`，后台worker PID14264经回查为Session1，ready=1/1；Owner重试评论 `7683103363885485282`，AAMP Task ID后缀 `c7872db28601ded0af0a200ea08f9a31`。新Codex会话 `01a0807a-daf4-7622-ba77-cb4b525d2c58` 于10:07:33 UTC实际Get-Content成功，10:08:31实际Import-Csv→求和→写result.csv→回读验证，exit0，内容marker,total及WIN10-ROUNDTRIP-9821,49。确认runner执行阻塞在交互会话消失。
- 随后交付仍失败，评论 `7683104669452471272`：路径被损坏后stat ENOENT。根因在task/runtime.ts的parseResultOutput使用展示文本getString读取file_delivery.path，二次把Windows路径中的反斜杠n/r转换成换行，导致node_modules/report/result.csv等路径段损坏。
- 限定修复：仅win32的file_delivery.path改用已有getRawString，保留JSON已解码路径；POSIX和展示文本换行处理不变。新增盘符/UNC各直接和外层AAMP JSON共4个原生回归，修改前4/4断言失败（路径换行），修改后4/4通过。Windows全套112/112；macOS108通过、4原生专项跳过；npm pack/build退出0。
- 修复包 `zengxingyuan-aamp-feishu-bridge-0.1.52-dev.5-windows-path.tgz` SHA256 `b85c5a932e3ee688bd0dd776e729886283a874fb2a42089ed63f34c6e6bddb80`，尚待最终实际上传复验。

### 附件最终闭环通过（交互会话后台模式）

- run `1788862696265-15364`，PID15364，修复包哈希与本地一致。原任务 `4216434f-75ea-4fc2-ab68-5c98f888623f` 重开，Owner评论 `7683107506259758063`；AAMP Task ID `feishu-task-4216434f-75ea-4fc2-ab68-5c98f888623f-38c28e12f936c77d99b9f1f9b569a47c`。
- 最终日志file_delivery=1、result closed status=succeeded、completed parent=1 children=0；服务端回读done/agent_task_status=4，交付附件 `e866b836-1172-4e05-a7d7-533d0a426840`，result.csv，37字节，resource.type=task_delivery。
- 通过服务端attachment.list/get取得临时URL，仅在Windows内下载回读，内容严格为 `marker,total\nWIN10-ROUNDTRIP-9821,49\n`。下载链接及凭证未输出；验证副本保留在隔离测试fixtures/verified-result.csv。
- 本次验证覆盖附件上传→AAMP派发→原生Codex实际读取/求和/生成→Bridge上传→服务端下载核验→任务完成。没有用预生成文件代替Agent产物，没有关闭沙箱；SSH Session0 foreground依然不作为可执行附件的已验收入口。
- 本地代码提交 `51950e5`，未推送/发布。两项一次性会话诊断任务已移除；完整Windows11/注销恢复等矩阵仍未完成。

- 本轮正常stop返回0；随后仅剩既存Node PID8548/7832/7672，产品计划任务Disabled，两项一次性诊断任务均不存在。授权、绑定与测试产物保留。

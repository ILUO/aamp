# 飞书任务 Windows 原生开发与验收记录

日期：2026-09-07 至 2026-09-08。状态：Windows 10 Administrator 已取得原生自动化、受控生命周期及真实飞书任务闭环证据，附件闭环在已登录用户的交互会话后台模式通过；Windows 11 普通用户等剩余矩阵仍待验收。

用户先要求“先开发”，随后提供 Windows SSH 测试机，并明确确认上传三个消费包源码、测试与开发 tgz，后续授权真实 Bot 与任务业务补测。下表汇总最新证据；未完成的验收项仍是发布门禁。

## 源码与环境

- 仓库：ILUO/aamp；分支：`feat/feishu-task-windows-native`。
- 固定基线：`7c4b7ff50b2fc766f9076dcbc7d87ce910ca8b76`，来自 `fix/feishu-auth-scope-negotiation`。
- 开发主机：macOS 26.5.2 arm64、Node v22.22.2。实测主机：Windows 10 企业版 22H2 / 10.0.19045 x64、Administrator、PowerShell 5.1.19041.6456、Node 22.22.2 / 24.20.0、Codex 0.153.4；存在活动 console 登录，无 RDP。Windows 11 尚无实测记录。
- Windows 目标：Windows 11 x64 普通用户、PowerShell 5.1、Node 22/24。
- 已注册专用新 Bot、完成用户 OAuth 与真实任务补测；已推送开发分支并创建 Draft PR https://github.com/ILUO/aamp/pull/1，未合并或 npm 发布。

## 验证记录

下表汇总 2026-09-08 最新补测。真实桌面证据来自 Windows 10 Enterprise 22H2 Administrator；CI 的 Windows runner 是 Windows Server 2025，不是 Windows 11。Node 24 已完成三包原生测试及更新后真实后台任务闭环。历史失败保留在下方，不将已被后续证据覆盖的旧状态作为当前结论。

| 验证层 | 当前状态 | 说明 |
|---|---|---|
| 三平台 × Node 22/24 CI | 最新产品代码六组通过 | 产品代码 `32af180` 的 run 34229593027 及文档提交 `0732a02` 的 run 34230292680 全部通过，含三包测试、类型检查、pack 与安装入口；此前 Windows 配置锁超时已有原生红绿复现并修复 |
| Win10 Node 22/24 原生包测试 | 通过 | Node 24.20.0：Task Agent 250 通过/13 跳过，ACP 193/4，Feishu 112/0；新增进程元数据完整文件 31/31、文件大小边界 3/3 等另轮验证，见下方 |
| 实际 npm pack / 全新 prefix 安装 | 通过 | 三包实际 tgz；新 Bot 注册、用户 OAuth、自动绑定与真实任务恢复均有证据；不把修复后恢复称为初版安装全程无故障 |
| npm shim / argv / stdin / exit | 通过 | 原生 npm shim，中文、空格、特殊字符、CRLF 与退出码；包含标准安装 Codex/acpx |
| ACL / CIM / 进程树隔离 | 通过（修复后） | 原生身份、ACL、父子孙清理、旁观者存活；CIM 缺路径增加有界复查及原生句柄/创建时间补查。最终包真实启动和任务已通过，仍拒绝未知身份 |
| Codex ACP 与特殊目录 | 核心闭环通过 | 交互 Session 1 实际计算、读写及上传通过；特殊目录标准安装及原生 Codex sandbox 命令通过。SSH Session 0 runner pipe-in 超时边界保留；不据此声称 headless 可用 |
| 注册 / 用户授权 / 普通任务 / need_help | 通过 | 新 Bot 普通计算 527、Owner 补充 493，服务端 done/4 与日志交叉核验 |
| 单次提醒 / 重复任务 / 父子任务 | 通过 | 单次 133，父子 48；真实每日重复任务连续两实例均得到 91，第二实例提前 due 加速验证，不是等待完整 24 小时 |
| 附件输入及 Windows 产物上传 | 核心与中文/CRLF 边界通过 | 中文输入、中文空格输出路径，上传后服务端下载校验 marker/49/CRLF。50 MiB 前一字节、等于上限、超一字节以真实 NTFS 文件＋受控上传接口验证，不冒充三次真实大文件云上传 |
| stop/start/restart / 崩溃恢复 | 已验部分通过 | 实际 controller 强退后同 worker 自动恢复，新 controller ready；测试覆盖三次重试耗尽及等待期间 stop。关闭终端后交互后台业务继续；锁屏、注销/重新登录仍待可恢复交互登录条件 |
| 运行中 update / 卸载 | 通过（修复后） | 非法包拒绝且旧服务/包不变；合法包安装保留绑定；后续修复包 Node 24 任务 361/done。正常 stop 与 npm uninstall 退出 0，计划任务/入口/隔离包移除，绑定字节不变，受管 Node 0，三个旁观进程存活 |
| 异常与安全边界 | 受控测试通过 | Windows profile/ACL/CLI 缺失、网络错误分类与重试、CIM 权限拒绝/PID 重用、多绑定隔离纳入已通过的原生/CI 测试；不表示真实租户 token 撤销、拔网或修改企业策略已实测 |
| Windows 11 普通用户 | 未验证 | 独立验收门禁，不能用 Win10 管理员或 Windows Server CI 替代 |

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

## 2026-09-08 非 Win11 补测与远端 CI

用户授权将除 Win11 外的验收继续推进并推送开发分支。接受新增协作者邀请后，HTTPS 推送成功，Draft PR 为 https://github.com/ILUO/aamp/pull/1；没有合并、发布 npm 或修改上游协议/scopes。

### 原生环境及 CI

Win10 新增官方 Node v24.20.0 x64，zip SHA256 `6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba`。Node 24 原生三包日志 `node24-task-agent.log`、`node24-acp.log`、`node24-feishu.log` 分别为 250 通过/13 跳过、193/4、112/0，均 fail=0。后续新增测试单独补测，不把早先计数标成最新全量。

CI https://github.com/ILUO/aamp/actions/runs/34223830533（`4f00ce2`）六组全部通过，每组 fail=0：

| 平台（各含 Node 22、24） | Task Agent 通过/跳过 | ACP 通过/跳过 | Feishu 通过/跳过 |
|---|---|---|---|
| Windows Server 2025 / PowerShell 5.1 | 253/13 | 194/4 | 115/0 |
| macOS | 455/7 | 194/4 | 108/7 |
| Ubuntu | 453/9 | 194/4 | 108/7 |

CI 发现并修正的测试环境问题：打包 Bash fixture 固定 LF；POSIX 假 AIME 消费 FD4 输入避免提前退出；Windows 使用 PowerShell 5.1，避免 PS7 父进程模块路径污染；Windows ACL 比较只忽略系统写回的 `DiscretionaryAclAutoInherited` bookkeeping 位，保留 owner/group/ACE/保护位完整比较与负例。没有改变 POSIX 业务语义。

最新 `902b856` 增加重试耗尽测试后，run 34224980298 的 Windows Node 22 有一项配置锁超时；新增测试本身通过。`0917e60` 修复实机发现的 CIM 元数据竞态，完整矩阵复跑中。

### 真实重复任务两轮

首实例 `7344ff4a-7b34-4a1b-9538-5ef0882027bb` 使用 `FREQ=DAILY;INTERVAL=1` 和到期提醒，真实提醒触发，ACK `7683122693738073017`，结果评论 `7683123385169103840` 为 91，服务端 done/4。

服务端生成次实例 `a0c25ff3-4b7b-497c-9fe4-6258a3ea9248`。将该实例 due 提前以加速验证，再由真实提醒触发，ACK `7683125069731630020`，结果 `7683125763029093623` 为 91，服务端 done/4。第三实例 `366808a5-2930-47f0-a26e-1c59afc706d0` 已执行清除 repeat_rule 并完成，清理命令退出 0，日志 `remaining-acceptance/recurring-cleanup.log`。没有声称跨完整 24 小时稳定性。

### 中文、空格、CRLF 与附件大小

任务 `02a9ae6a-da3e-4301-a48b-21f38243cdb7`：输入 `输入 数据 CRLF.csv`（98 字节，附件 `818bf073-6124-445f-9826-323896caff3b`），Owner 评论 `7683120648364838187`，ACK `7683120708850928590`。实际 Codex 生成 `验收 产物/结果 report.csv`，交付附件 `4152fd94-8159-44b4-9b23-1d1e82c3ae0e` 为 43 字节。服务端下载的精确文本为 `marker,amount\r\nWIN10-BOUNDARY-20260908,49\r\n`，任务 done/4。运行 `1788865689373-13240` 于 11:21:15.963 UTC 完成。

出站附件限制以真实 NTFS 文件测试 52,428,799、52,428,800、52,428,801 字节：前两者调用上传，超限者在上传前拒绝。Node 24 3/3，`delivery-size-boundary.log`。上传接口受控，不等同真实云 API 的 50 MiB 压测。

标准 npm 安装目录 `验收 & paths (24)` 中，原生 JS 入口解析后 Codex/acpx 版本与 Task Agent help 均退出 0；交互 Session 1 中标准 Codex sandbox 输出 `AAMP_SPECIAL_DIRECTORY_RUNNER_OK`，退出 0，未弱化 sandbox。直接从 PowerShell 调用该含 `&` prefix 的 npm `.cmd` 会被 cmd 解析失败；产品的 native JS 入口路径已通过，不能扩大为任意直接 batch 调用均通过。

### controller 故障清理与自动恢复

实测 Task Scheduler 的 RestartOnFailure 未在此环境为 controller 非零退出重新拉起。首次还发现记录过的 Feishu 子进程遗留，已增加 worker 退出前 journal 身份验证清理，再由 worker 内部执行最多三次、间隔 60 秒的 controller 恢复；等待可被 stop 或 generation 变化中止。

最终真实故障注入：2026-09-08T12:04:28.764Z 强退本轮 controller 16196；worker 13160 保持，新 controller 4896 于 12:06:18.4424193Z ready，同 generation `8d94e3ff-06db-47f1-9bd5-18cd14f803fa`，约 109.678 秒。原 controller 消失，旁观 Node 8548/7832/7672 均存活，无手动 restart。证据 `remaining-acceptance/supervised-recovery-result.json`。原生测试另覆盖 journal 留存身份的存活进程清理、等待中 stop 与重试三次后返回失败。

### 运行中更新及待收尾项

仅在 127.0.0.1 临时 registry 提供本地打包测试版本，结束即关闭，未向外发布。非法包缺少 Windows helper，product update 退出 1，原包字节不变、controller 4896 仍活且身份不变。合法包 product update 退出 0，安装版本 `0.1.1-dev.6.acceptance.1`，bindings 文件字节完全一致。证据 `remaining-acceptance/update-verification.log`。

更新后切换 Node 24 真实启动时，部分短生命周期 powershell/conhost 的初始 CIM 快照有空 ExecutablePath，故安全拒绝并耗尽恢复。`0917e60` 仅在确认同 PID、创建时间后刷新缺失元数据；退出/PID 重用返回不存在，读取拒绝或仍缺路径仍失败关闭。新增测试修复前 0/2、修复后完整 Windows 文件 31/31。真实启动与最终卸载正在复验，不提前标通过。

已测 artifact：Task Agent supervisor 包 SHA256 `f990a4bbd53625663815810c49a3a6b8b4d44c45fae386974199efcd2bb26dee`；ACP ACL 包 `fff6cf06b70db6507cf4b9678da88c0887be8e9ef4e78620f0b5d86ff59461d6`；Feishu path 包 `b85c5a932e3ee688bd0dd776e729886283a874fb2a42089ed63f34c6e6bddb80`。CIM 修复包为后续新 artifact，不能沿用 supervisor 哈希。

锁屏与注销/重新登录仍需要用户确认能通过云控制台恢复交互登录；SSH 不能替代该登录条件，未冒险注销。Win11 普通用户独立保留待验收。

### 最新产品提交 CI 与锁计时复验

`e989ec6` 的 https://github.com/ILUO/aamp/actions/runs/34227906679 六组全部成功，fail=0。每个 Node 22/24 Windows runner 的 Task Agent 257 通过/13 跳过，ACP 194/4，Feishu 115/0；macOS 分别 456/10、194/4、108/7；Ubuntu 分别 454/12、194/4、108/7。

Windows 目录 ACL 初始化原来占用了锁等待预算；实机约 3 秒初始化即使无竞争也误报占用。现仅 Windows 在 ACL 成功后开始锁等待计时。原生回归修复前失败，修复后完整绑定文件 20/20；macOS 19 通过/1 Windows 跳过。另对 CIM 缺字段最多复查五次、间隔 100ms，每次校验 PID/创建时间；原生进程测试 31/31。不过真实 Node 24 后台仍捕获持续缺路径，进一步诊断中，不能据 CI 全绿宣布实机通过。

最终待复验 Task Agent tgz SHA256 `a0eab2efab82714877666d7f3e414ef9c19e66ccc0c14bb9a291828c7e97c4a4`。Node 24 测试 PATH 补回了原 Node 22 prefix 中既有 Codex 的入口（Node 24 优先），修正的是隔离测试环境，不是新增产品兼容逻辑。专用后续任务 `6015d748-78f3-4613-a868-339aa4c5171a` 已创建分配，结果尚未验证。

### 原生句柄补查与最终复验进行中

仅 CIM 有界复查后仍缺路径时，`32af180` 打开原生进程句柄，校验其创建时间（原生 FILETIME 100ns，CIM 微秒，截去不足一微秒部分），读取句柄对应的 MainModule 路径，再复核 CIM 身份。已退出、PID 重用返回不存在；权限拒绝和存活但路径仍缺失继续报错。原生完整测试 31/31，临时回退旧模块时新补查用例 0/2，恢复修复模块。没有按进程名字放行或删除身份检查。

`e989ec6` 在纠正测试 PATH 后曾由 worker 重试恢复到 ready（PID 8500），但还没有任务结果，不能算 Node 24 业务完成。最终包 SHA256 `ad065a2240b7d423944df5720631ec009ac9532f6d6b19f768fe1bb0da94338b` 已安装，`32af180` CI run 34229593027 和真实闭环继续复验。SDK 已确认重复任务第三实例 `366808a5-2930-47f0-a26e-1c59afc706d0` 为 done、repeat_rule 为空，清理完成。

### Node 24 更新后真实闭环通过

最终包 `ad065a2240b7d423944df5720631ec009ac9532f6d6b19f768fe1bb0da94338b` 本地/Windows 哈希一致。CIM 回读 controller 13336 的 executablePath 为 `node-v24.20.0-win-x64/node.exe`；worker 16936，generation `d8647166-7c7e-48da-a820-e5674490d2a9`，绑定 1/1 ready。实际运行中未引入 Bash/WSL、降级 sandbox 或重新授权。

任务 `6015d748-78f3-4613-a868-339aa4c5171a` 在早先失败期间创建，无 ACK；最终服务启动后由 Owner 评论 `7683150085093346270` 触发。ACK `7683150127195769828`，结果评论 `7683150816017943743` 内容为 `361`。SDK 服务端回读 status=done、completed_at=1788872950000。ACP `task.received` 为 13:06:26.859 UTC，`task.completed` 为 13:09:08.516 UTC；AAMP task ID `feishu-task-6015d748-78f3-4613-a868-339aa4c5171a-d7bf1de62636c58847d9e67744ed300e`。证据 `remaining-acceptance/node24-final-result.json` 与 run 后缀 `-13336` 的 ACP 日志，errors.jsonl 为 0 字节。

这是合法更新后继续安装修复 artifact、经故障修复及 Owner 触发后取得的闭环，不是首个更新测试包一遍成功。`32af180` 的 CI https://github.com/ILUO/aamp/actions/runs/34229593027 六组全绿，执行计数与上轮 e989ec6 相同。

### Win10 卸载最终通过与剩余门禁

2026-09-08T13:14:53.9524179Z：正常 stop 退出 0，移除当前 SID 的产品计划任务，隔离 prefix 中 npm uninstall 退出 0；包目录、`.cmd` 入口、产品任务均不存在，bindings SHA256 前后完全相同，受管测试 Node 0，旁观 PID 8548/7832/7672 均存活。一次性 `AAMP-Remaining-Acceptance` 任务也已删除，测试日志/绑定/原始安装目录保留，未删除远端 Bot。证据 `remaining-acceptance/uninstall-result.json`。

首次卸载因任务 Principal 返回 `Administrator` 而非 SID 被示例安全拒绝，尚未删除任务或 npm 包。将账户名解析到 SID 后确认与当前用户完全一致，才完成卸载；README 同步这一正确校验方式。

可独立执行的非 Win11 业务、包、CI 与更新/卸载补测已完成；锁屏、注销后重新登录及登录触发仍未实测，需要能从云控制台恢复交互登录，SSH 不能替代。异常注入仅按相应受控测试层通过，不声称已撤销真实租户 token、断开测试机网络或更改企业策略。Win11 普通用户仍为独立门禁，不做完整 Windows 支持/发布结论。

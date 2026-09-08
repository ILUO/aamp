# 飞书任务 Windows 原生开发与验收记录

日期：2026-09-07 至 2026-09-08。状态：代码开发与本地回归已完成；Windows 原生验收未执行。

用户在明确获知没有 Windows 实机验证后要求“先开发”。因此继续完成本地开发，实机闭环仍是发布门禁，不以 macOS 上的分支模拟测试代替。

## 源码与环境

- 仓库：ILUO/aamp；分支：`feat/feishu-task-windows-native`。
- 固定基线：`7c4b7ff50b2fc766f9076dcbc7d87ce910ca8b76`，来自 `fix/feishu-auth-scope-negotiation`。
- 开发与当前测试主机：macOS 26.5.2 arm64、Node v22.22.2；Windows 11 build、PowerShell 和 Windows Codex 版本尚无实测记录。
- Windows 目标：Windows 11 x64 普通用户、PowerShell 5.1、Node 22/24。
- 未注册真实 Bot、未派发真实任务、未向远程推送或 npm 发布。

## 验证记录

以下为最终冻结代码的验证结果；中间失败与修复记录单列，不替代原生验收。

| 验证层 | 当前状态 | 说明 |
|---|---|---|
| macOS 三包回归与类型检查 | 通过 | Task Agent 434 通过 / 3 原生跳过；ACP 176 通过；Feishu 99 通过；两 Bridge tsc 通过 |
| 实际 npm pack / 本地安装 | macOS 通过 | 三包实际 tgz 安装到全新临时 prefix，安装后帮助入口和必需运行文件检查通过 |
| Windows / macOS / Linux × Node 22/24 CI | 未执行 | 已新增工作流；尚未推送或触发 |
| Windows npm shim / argv / stdin / exit | 未执行 | 原生 fixture 已加入；macOS 跳过原生测试 |
| Windows ACL / CIM / 进程树隔离 | 未执行 | 注入测试与实机测试分别统计 |
| Windows Codex ACP session | 未执行 | 必须覆盖标准 npm 安装与特殊字符目录 |
| Feishu 注册、授权、配对及完整 Task 结果 | 未执行 | 需要专用测试 Bot 和 Windows 主机 |
| need_help / Owner 继续 / 提醒 / 重复 / 子任务 | 未执行 | 保持既有业务行为，记录各自 Task ID |
| 附件输入及 Windows 本地产物上传 | 未执行 | 中文路径、CRLF、现有大小限制 |
| 关闭终端、登录、stop/start/restart、故障重启 | 未执行 | 普通用户桌面会话；CI 不替代 |
| 运行包更新、卸载与旁观进程存活 | 未执行 | 只管理本产品任务及已验证身份 |

## 原生验收录入模板

每个用例记录：OS build / 架构 / PowerShell / Node / Agent 版本、三个实际包的版本及 integrity、源码提交、操作、预期、实际、退出码、Task ID（适用时）、脱敏日志位置、通过或失败原因。不得放入 App Secret、OAuth token 或原始 profile。

## 发布与范围

源码 Bridge 的 package name 与默认发布 scope 不同。开发测试通过明确的本地 tgz 覆盖选择修改后的 Bridge，不能把 registry 中的旧包当成本分支。发布顺序仍为必要 Bridge patch → 核验真实 artifact 与精确引用 → Task Agent patch；目前没有分配或发布 Windows 版本。

仅涉及三个消费包与专用测试工作流。Task/AAMP 协议、scopes、Owner、结果与取消规则、SDK、服务端、旧 Task Bridge 不在本次改动范围。原有业务缺陷不因 Windows 适配声明已解决。

## 实际开发包（未发布）

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

## 最终本地自动化结果

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

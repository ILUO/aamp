# aamp-feishu-task-agent

One-click manager for binding local Codex/Cursor/Trae/WorkBuddy agents to
user-owned Feishu Bots and running the corresponding Task bridges.

## Native Windows development preview

The Windows implementation is under development on
`feat/feishu-task-windows-native`. It has **not passed Windows 11 desktop or
the full Feishu Task acceptance matrix**, and the existing registry `@dev` release is
not evidence of Windows support. See the
[acceptance record](../../docs/testing/feishu-task-windows-native-acceptance.md).

The target is Windows 11 x64, Windows PowerShell 5.1, and Node.js 22/24.
Use PowerShell's explicit `.cmd` commands. WSL, Git Bash, administrator
permissions, and a system Windows Service are not prerequisites.
Codex is the first Windows integration; other Agent types require their own
verified native entry before becoming selectable.

For development, build the **three modified packages** using `npm.cmd pack`
and retain each exact returned `.tgz` path. Install the Task Agent artifact
with `npm.cmd install --global <task-agent-tgz>`. In the same PowerShell
session, opt into the existing local-package override mechanism:

```powershell
$env:AAMP_TASK_ALLOW_PACKAGE_OVERRIDES = 'true'
$env:AAMP_TASK_ACP_BRIDGE_PKG = '<absolute-acp-bridge-tgz-path>'
$env:AAMP_TASK_FEISHU_BRIDGE_PKG = '<absolute-feishu-bridge-tgz-path>'
feishu-task-agent.cmd help
feishu-task-agent.cmd install
feishu-task-agent.cmd status
feishu-task-agent.cmd start --foreground
feishu-task-agent.cmd stop
feishu-task-agent.cmd start
feishu-task-agent.cmd restart
feishu-task-agent.cmd logs
aamp-logs.cmd tail -f
```

Replace all three artifact placeholders with actual local build paths;
otherwise the released Bridge pins still select older registry code. `install`
and `add` need an interactive console. `add` saves a pending binding; its next
`start` performs startup. `update` validates a downloaded release's Windows
entry before stopping the current runtime; it is not a way to publish this
checkout or update unpublished local Bridge artifacts.

Background operation uses the current user's
`AAMP-FeishuTask-<SID>` scheduled task, an interactive login trigger, and normal
permissions. Closing the terminal is supported by this design; running after
logout is outside its scope. A scheduler state alone does not count as ready:
the Controller also verifies the selected binding generation and live process
identities. `stop` disables login activation until the next explicit `start`.
On unexpected Controller exit, the Windows worker cleans its recorded process
identities and retries at most three times, with 60 seconds between attempts.
A stop request or changed generation interrupts the retry wait. After retries
are exhausted, inspect `logs` and explicitly restart after resolving the cause.
Enterprise policies can prevent PowerShell or task registration; use explicit
foreground mode after addressing the reported prerequisites.

Windows OpenSSH foreground sessions need separate validation. On the tested
Win10 host with Codex 0.153.4, Session 0 failed even a standalone sandbox
command with `timed out after 15000ms connecting runner pipe-in`; the same
sandbox in the user's active Session 1 succeeded. The CLI's DPAPI-backed
credentials were also readable in Session 1 while SSH reported them missing.
Do not treat a successful model-only calculation as proof of file execution,
or immediately reauthorize when only the SSH session cannot read credentials.

With an existing authorized binding and the same user already logged in,
`feishu-task-agent.cmd restart` starts the existing interactive background
worker, including its credential checks, in that user's session. Preserve the
same state/runtime directory and any development package overrides. `start`
can still run credential preparation in the calling SSH session before handing
off; `start --foreground` stays in that session. This does not provide execution
after logout or make a headless Session 0 equivalent to a desktop login. See the
acceptance record for the observed boundaries and business results.

Windows runtime state is under the existing product runtime directory in
`windows-service-v1`; its log is `service.log`. Private state uses Windows ACLs.
`aamp-logs` follows files with Node and uses Windows `tar.exe` for archives,
resolving the Desktop Known Folder (including redirected desktops).

To uninstall, stop successfully first, then remove only this user's product
task and npm package. These steps preserve bindings and remote applications:

```powershell
feishu-task-agent.cmd stop
if ($LASTEXITCODE -ne 0) { throw 'Stop failed; resolve it before uninstalling' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "AAMP-FeishuTask-$sid"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  if ($task.Principal.UserId -ne $sid) { throw 'Task owner mismatch' }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
npm.cmd uninstall --global @larktask/aamp-feishu-task-agent
```

## Install and bind (macOS / Linux)

Run the standalone one-click command. The launcher checks for Node.js and npm
before setup. When either is unavailable, it stops before authorization and
links to the official Node.js LTS download page; it does not install or modify
the user's package managers automatically:

```bash
npx -y --package @larktask/aamp-feishu-task-agent@dev \
  feishu-task-agent install
```

`install` first authorizes a Feishu Bot and its `lark-cli` user, then shows the
Agent choices available to that authenticated tenant. It repeats until the user
chooses not to continue. No persistent Bridge is started while choices are
being collected. The same Agent may be bound to multiple Bots, while a Bot can
only be selected once. After selection, one Agent Bridge group is prepared and
each pair is preflighted serially with a real one-time ACP pairing. A successful
macOS run is then handed to a user `launchd` service. Only pairs that passed the
foreground readiness check are handed off, and the command waits for a
generation- and PID-scoped readiness marker from the service worker before it
reports success. Setup then exits and the Bridges continue running after
Terminal closes. The successfully completed bindings atomically replace the
new-flow configuration.

The package installs the short command `feishu-task-agent`. Running that short
command without arguments shows help. Running the standalone Bootstrap without
arguments is equivalent to `install`.

The supported canonical agent names are `codex`, `cursor`, `coco`, `traex`,
`traecli`, `workbuddy`, `workbuddy_ai`, and `aime`.
`--agent codex|cursor|coco|traex|traecli|workbuddy|workbuddy_ai|aime` fixes the Agent
for every new binding in that command instead of prompting.
Selection menus, saved bindings, and startup output display these canonical
`agent_type` values verbatim. The removed `trae` value is not accepted as a
command-line alias or stored binding type; affected bindings must be created
again with `coco`.
The Task Agent flow only supports the Online environment. Environment-switch
arguments are not supported.

The Trae-family choice uses this order:

1. `traex` → Trae CLI Next（内部版）
2. `coco` → Trae CLI（内部版） and the existing Next upgrade prompt
3. only when `coco` is absent, `traecli` → TraeCode CLI

For the internal Trae CLI flow, accepting the upgrade prompt runs the Trae CLI
Next installer and continues with `traex`. A new pending `coco` binding is
normalized and saved as `traex`, so subsequent startup output uses `traex`.
Declining the upgrade cancels the current binding or startup without
invoking legacy `login`, `login status`, or ACP commands, and leaves saved
bindings unchanged. Native ACP startup is exactly `traex acp serve`; the
generated command intentionally omits `--yolo` and never adds a bypass or
approval flag.

TraeCode CLI is stored as `agent_type: traecli` and starts native ACP with
`traecli acp serve`. If that command is unavailable, the launcher asks before
running `traecli update`, then checks ACP again. It runs
`traecli doctor --json` without entering the TUI; model errors ask you to open
TraeCode CLI and use `/model`. The launcher never runs a TraeCode login/status
command and never falls back to CLI Bridge.

A saved `traecli` binding remains TraeCode CLI even after `traex` is installed.
Ready `coco` bindings keep their stored identity and mailbox, while runtime
startup output displays the resolved raw type `traex` or `traecli` that will
actually be used.

`workbuddy` is detected only from the standard macOS WorkBuddy.app installation:
`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`.
The launcher uses the app-bundled `codebuddy --acp` command.
It does not run a WorkBuddy login command. Open WorkBuddy and complete login
before starting a binding. Startup verifies login by creating and immediately
closing a temporary ACP session without sending a model prompt. Nonstandard
paths and non-macOS installations are not auto-detected.

`workbuddy_ai` is the international WorkBuddy AI application. It is detected
only at
`/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`.
Its persisted and displayed Agent type remains the literal `workbuddy_ai`.
When both WorkBuddy applications are installed, `workbuddy` and
`workbuddy_ai` are offered independently. The Task Agent does not run a login
command for either product; complete login in the selected desktop app.

`aime` is the ByteDance-internal remote AIME Agent. The launcher authorizes the
Bot, creates or reuses its `lark-cli` profile, completes user login, and reads
`tenant_key` before showing the Agent menu. It offers AIME only when that
authenticated tenant key is `736588c9260f175d`; explicit `--agent aime` uses
the same fail-closed tenant check. Network reachability and `ping` are not used
as tenant identity signals. The launcher installs the exact AIME version pinned by the bootstrap as
`@tengchengwei/aime-acp@<version>` from `https://bnpm.byted.org` into
the shared `$HOME/.aamp/npm-global` prefix, removes the obsolete unscoped
`aime-acp` package when present, then runs the scoped package's absolute
`dist/bin.js` entry with `--site cn`.
Readiness is authoritative only after `auth status`/`auth login` and
`doctor --site cn --json` succeed.
The generated bridge config rejects attachments and limits AIME task dispatch
to one task at a time because AIME is remote and does not use the local
workspace. All other Agents default to local execution; AIME is explicitly
configured as remote. It reads requested Feishu/Lark data with its own
remote-native capabilities and identity; the binding runtime does not consume
the local `lark-cli` profile used during tenant eligibility detection. The local
Feishu Bridge still uses Bot App credentials and is the only writer of the
current Task's comment, status, and delivery. Remote
attachments and local file delivery are unsupported; use text or HTTP(S) links.
`aamp-feishu-task-bridge` is deprecated and is not an AIME implementation
target. AIME `auth`/`doctor` success proves adapter readiness only, not access
to a particular Feishu group.

## Commands

```bash
feishu-task-agent install
feishu-task-agent start
feishu-task-agent start --foreground
feishu-task-agent status
feishu-task-agent stop
feishu-task-agent restart
feishu-task-agent logs
feishu-task-agent list
feishu-task-agent add
feishu-task-agent add --no-start
feishu-task-agent remove
feishu-task-agent update
feishu-task-agent help
```

- `install` preserves saved pairs and atomically saves each accepted pair as
  pending before it starts any Bridge. If the Bot App ID is already bound,
  replacement requires explicit confirmation. A startup failure leaves the
  pending pair available for a later `start` retry. On macOS, successful
  Bridges are transferred to a per-user background service before `install`
  exits.
- `start` multi-selects saved pairs. Selecting `全部` takes precedence over any
  other selection. If no pair is configured, the terminal prints the full
  install command. Its final summary retains the successful/planned count and
  lists the concrete successful, failed, and cancelled pairs. On macOS it
  starts the background service by default; `start --foreground` keeps the
  legacy terminal-attached mode for diagnosis.
- `status`, `stop`, and `restart` inspect and control the managed runtime
  without locating its original terminal. `stop` also recognizes and safely
  terminates verified Task Agent processes left by the older foreground flow.
- `logs` prints the latest 100 lines from the persistent background log.
- `list` prints saved Agent-Bot pairs and never prints App Secrets.
- `add` uses the same confirmed atomic add/replace behavior and initially saves
  each pair as pending. On macOS it then merges the new pairs into the managed
  background-service selection and restarts that service automatically. The
  first service start completes ACP pairing, creates runtime configuration,
  registers the Task Agent, and changes the pair to ready. Existing selected
  pairs remain selected. If a newly added pair cannot start, its pending
  configuration is kept for retry and the previous background selection is
  restored. If a replacement cannot start, the replaced ready binding is
  restored instead. A legacy foreground runtime is left untouched and the
  command prints the explicit `stop` then `start` migration steps.
  `add --no-start` keeps the save-only behavior; on platforms without the macOS
  background service, run `feishu-task-agent start` after `add`.
- `remove` multi-selects pairs, with a `全部` option. It only removes saved
  pairing records; Bridges that are already running are not stopped.
- `update` refreshes the installed short command and package.

Single-choice and confirmation menus use `↑`/`↓` to move and Enter to confirm.
For `start` and `remove`, use `↑`/`↓` to move, Space to select multiple items,
and Enter to confirm the selection.

Bridge startup is serial. A failure is printed and recorded, then the next pair
is attempted. The command exits as a startup failure only when every selected
pair fails. User-cancelled Coco selections are reported separately and
are not recorded as system failures. Within one command invocation, all Bots for the same Agent/AAMP
host reuse one ACP Bridge process. Independent invocations do not attach to an
existing process; an Agent lease prevents competing runtimes from being
started for the same Agent identity.

Bridge processes are launched by `install`, `start`, or the private service
worker. On macOS, `add` updates and restarts the managed service rather than
starting a competing Bridge in the interactive process. Before an interactive
foreground startup begins, it acquires one global runtime-session lease and
also checks for Agent leases left by an older Task Agent version. If another
live runtime exists, use `feishu-task-agent status` and
`feishu-task-agent stop`; the user never has to find the original terminal.
`list` and `remove` never acquire this runtime lease or start a Bridge.
Service selection changes made by `add`, `start`, `stop`, and `restart` are
serialized with a cross-process control lock so concurrent commands cannot
overwrite one another's background selection.

On macOS the service is registered as the current user, not as root:

```text
~/Library/LaunchAgents/com.larktask.aamp-feishu-task-agent.plist
~/.aamp/feishu-task-agent/service-v1/selection.json
~/.aamp/feishu-task-agent/service-v1/readiness.json
~/.aamp/logs/feishu-task-agent-service.log
```

The plist contains the installed launcher path and a deterministic `PATH`, but
no App Secret or OAuth token. `launchd` starts it at login and restarts it after
an unexpected exit. `feishu-task-agent stop` unloads it. On Linux, `install` and `start` remain foreground operations and `restart`
reports that the managed background service is unsupported. Windows development
behavior is described above.

## Configuration and compatibility

The new flow uses a dedicated configuration:

```text
~/.aamp/feishu-task-agent/bindings-v1.json
```

It does not read, migrate, overwrite, or delete the legacy Feishu task profile
configuration. Existing users enter the new binding flow again. Runtime files
are isolated under:

```text
~/.aamp/feishu-task-agent/runtime-v1/
```

On POSIX, the configuration directory is mode `0700` and `bindings-v1.json`
is mode `0600`. Windows uses verified current-user ACLs instead. The App Secret is intentionally stored as plaintext so a saved pair can
be started again without asking for credentials. Treat this file as a local
credential and do not share it. Bridge-specific derived configuration is kept
inside the same protected new-flow runtime directory.

Bindings saved by `add` first use the `pending` state and do not contain Agent
or Feishu Bridge runtime identities. After automatic activation, or after a
later manual `start` when `--no-start` was used, the same records are atomically
updated to `ready` with the generated runtime metadata. Existing ready records
without an explicit state remain compatible.

Saved bindings whose environment is not Online are incompatible with this
version. They remain visible to `list` and can be deleted with `remove`, but
`start` skips them with an explicit error and continues with the next binding.

If a saved `lark-cli` profile is missing, `start` recreates it from the stored
App ID/App Secret. User OAuth is optional by default and never blocks Task/IM
Bridge startup. The embedded version-2 scope manifest configures only the Task
and IM application capabilities used by this package; it does not expand
Base, Calendar, Mail, Minutes, VC, Wiki, or other user domains. Existing bot
profiles are rewritten with `domains: ["task"]` when they are saved again.

`FEISHU_USER_AUTH_MODE` controls the local user capability policy:

- `optional` (default) reuses an existing valid token, records unavailable
  optional capabilities, and continues without opening a browser.
- `required` requests the fixed Task user scope set once and fails only when
  those explicit scopes remain missing. The command never passes `--domain`.
- `disabled` skips user capability checks and runs Task-only.

Granted and missing user scopes are recorded without credentials under
`~/.aamp/feishu-bridge/auth-capabilities/<profile>.json`. Legacy
`FEISHU_USER_AUTH_EXCLUDES` values are intersected with the current explicit
request, so stale or tenant-invisible scope names cannot create a new failure.

If the persisted Agent or Feishu Bridge mailbox identity is missing or has
changed, startup rejects that pair and asks the user to bind it again instead
of reporting a false success. The same Online `LARKSUITE_CLI_CONFIG_DIR` is
passed to Feishu Bridge, Agent Bridge, and the local Codex/Cursor/Trae process
so task execution resolves the exact profile created during binding.

## Local logs and diagnostics

Each command creates a run under:

```text
~/.aamp/logs/runs/<timestamp>-<pid>/
```

The macOS service combines its stdout and stderr in:

```text
~/.aamp/logs/feishu-task-agent-service.log
```

Use `feishu-task-agent logs` to show its latest 100 lines.

Multi-Bot runs use flat, unique component log files so the existing `aamp-logs`
command can find them:

```text
one-click.log
feishu-register.<random>
acp-bridge-<host-hash>.jsonl
feishu-bridge-<binding-id>-install.jsonl
feishu-bridge-<binding-id>-add.jsonl
feishu-bridge-<binding-id>-start.jsonl
errors.jsonl
manifest.json
```

The manifest and terminal output never include App Secrets. Component output is
redacted before it is written by the Controller. Verbose Feishu registration
details (SDK metadata, scopes, events, and raw SDK output) are written to a
private per-run registration log instead of flooding the interactive terminal.

Useful diagnostics commands:

```bash
~/.aamp/bin/aamp-logs collect --run-dir <run log directory>
~/.aamp/bin/aamp-logs collect --latest
~/.aamp/bin/aamp-logs collect --task-id <Task ID>
~/.aamp/bin/aamp-logs collect --task-guid <Feishu task guid>
~/.aamp/bin/aamp-logs list-runs
~/.aamp/bin/aamp-logs tail -f
```

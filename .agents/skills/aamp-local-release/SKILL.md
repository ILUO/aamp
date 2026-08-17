---
name: aamp-local-release
description: >
  Build AAMP npm packages locally, optionally pack local tgz artifacts, and
  produce the Feishu Task Agent startup command for testing a local build
  WITHOUT publishing. Use when the agent needs to rebuild the local dist of
  aamp-feishu-bridge / aamp-acp-bridge / aamp-feishu-task-agent, prepare a
  local test artifact, or answer "how do I start the local build for testing".
  Never publishes and never touches the remote registry with our packages.
---

# AAMP local release

Use this skill as an agent-facing runbook for local-only testing. Do the build
and pack work yourself with the bundled helper script. Never publish.

The helper script is:

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs
```

## What this does

1. Builds the selected package(s) so their `dist` output is current
   (`npm run build`; skipped for `aamp-feishu-task-agent`, which is
   source/bootstrap based).
2. Optionally packs local `.tgz` artifacts (never published).
3. Prints the startup command for the local test run, with bridge package
   overrides, plus the notes needed to apply it correctly.

Bridge builds run the package's bin preparation hook, and the helper rejects a
bridge executable that exists without execute permission. The generated
startup command also uses a fresh npm cache so stale local file-package
materialization is not reused.

## How the local override works

The installed Task Agent shim (`$HOME/.aamp/bin/feishu-task-agent`) honors two
environment variables that flow into the controller:

- `ACP_BRIDGE_PKG` → controller `AAMP_TASK_ACP_BRIDGE_PKG` → the ACP bridge package
- `FEISHU_BRIDGE_PKG` → controller `AAMP_TASK_FEISHU_BRIDGE_PKG` → the Feishu bridge package

Two reference flavors are supported:

- `file:<repo>/packages/<dir>` (recommended): npm resolves the folder and on
  npm 11 symlinks the live package folder, so the bridge runs the current
  `dist` directly. After editing source, rebuild (`npm run build`) and restart;
  no repack is needed.
- Packed `.tgz` path: an immutable snapshot of the build. Use this when the
  user wants a fixed artifact (for example copying it to another machine).

When npm resolves the local package it still downloads the package's public
dependencies (pino, @larksuiteoapi/node-sdk, aamp-sdk, ...) from the registry.
That is dependency installation, not publishing our packages.

The task-agent shim has no override for the task-agent package itself. To test
a local `aamp-feishu-task-agent` build, install it into the global prefix
(`npm install -g --prefix "$HOME/.aamp/npm-global" --force <tgz>`) and set
`AAMP_TASK_AUTO_UPDATE=false`.

## Choose packages from the change set

- `packages/aamp-feishu-bridge/**` changed: pass `--package feishuBridge`.
- `packages/aamp-acp-bridge/**` changed: pass `--package acpBridge`.
- `packages/aamp-feishu-task-agent/**` changed: pass `--package taskAgent`.
- Multiple packages changed: pass one `--package` per package, or `--package all`.
- Only docs, skills, or unrelated files changed: do not run a release; nothing
  needs a local rebuild unless the user asks for a fresh build anyway.

## Agent workflow

1. Inspect repository state (`git status --short` / `git diff --name-only`) to
   determine which AAMP packages changed, then pass the matching `--package`
   flags. The helper defaults to all packages when none are given.
2. Run the helper with non-interactive flags. It builds, optionally packs, and
   prints the startup command. Do not make the user run `node ...` themselves
   as the normal path.
3. If the user only wants the command (no rebuild), run with `--plan-only`.
4. If the user wants an immutable artifact, add `--pack` (and optionally
   `--mode tgz` so the printed command references the tarball).
5. Report the printed startup command in the final reply, and call out the two
   required steps: stop the currently running Task Agent first (it holds the
   runtime/agent leases), then run the command. `feishu-task-agent start` is
   interactive; it opens the multi-select for saved bindings.
6. Suggest verification: send the agent a task that exercises the changed code
   path and confirm the Feishu comment shows the real text (for the
   help-text/timezone fix, "查询今天的日程" should show
   `请提供你所在的时区，例如 Asia/Shanghai…` and never
   `REMOTE_AGENT_FAILED：远程智能体执行失败…`).

## Helper commands for agents

Build the Feishu bridge locally and print the file:-folder startup command:

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package feishuBridge
```

Build both bridges plus the task agent:

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package all
```

Only print the plan and startup command (no build, no pack):

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package feishuBridge \
  --plan-only
```

Build and pack a local tgz, then print the tgz-based startup command:

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package feishuBridge \
  --pack \
  --mode tgz \
  --out-dir /tmp/aamp-local-release
```

Sanity-check that npm can actually resolve the local bridge executable
(slower: downloads public dependencies):

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package feishuBridge \
  --verify
```

Machine-readable output for agents:

```bash
node .agents/skills/aamp-local-release/scripts/aamp-local-release.mjs \
  --package feishuBridge \
  --plan-only \
  --json
```

## Safety rules

- This skill never publishes. There is no `--publish` flag; reject any request
  to publish with this skill and point to `aamp-npm-release` instead.
- The local build only affects a future Task Agent start: the running bridge
  does not hot-swap. Always tell the user to stop the current Task Agent
  before starting with the new overrides.
- `file:` mode requires `dist` to exist. If a build was skipped and `dist` is
  stale or missing, the helper fails on the missing binary target; rebuild
  first or run with `--build` (the default).
- Preserve existing local `.tgz` artifacts unless the user asks to remove
  them. The helper writes packs to `--out-dir` (default `.aamp-local-release`
  under the repo root) and never deletes anything.
- The helper isolates npm cache writes to a temp directory so `npm run build`
  / `npm pack` do not depend on the user's `~/.npm` permissions.

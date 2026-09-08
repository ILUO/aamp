import { ensureWindowsAgentConfig, parseWindowsAgentArgv, windowsAgentAlias } from './windows-agent-config.js'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'
import { resolveNativeCommand } from './native-command.js'

export interface WindowsProcessIdentity {
  pid: number
  creationDate: string
  executablePath: string
  ownerSid: string
}

const WINDOWS_SNAPSHOT_OWNER = String.raw`
function Test-SnapshotProcessStillCurrent($snapshot) {
  $current = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + [int]$snapshot.ProcessId)
  if ($null -eq $current) { return $false }
  if ($null -eq $snapshot.CreationDate -or $null -eq $current.CreationDate) {
    throw 'unable to verify process creation identity'
  }
  return ([int]$current.ProcessId -eq [int]$snapshot.ProcessId -and
    $current.CreationDate.ToUniversalTime().Ticks -eq $snapshot.CreationDate.ToUniversalTime().Ticks)
}
function Read-VerifiedSnapshotOwner($snapshot) {
  try {
    $owner = Invoke-CimMethod -InputObject $snapshot -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($owner.Sid)) {
      throw ('unable to read process owner SID; return value ' + $owner.ReturnValue)
    }
  } catch {
    $ownerFailure = $_
    if (-not (Test-SnapshotProcessStillCurrent $snapshot)) { return $null }
    throw $ownerFailure
  }
  if (-not (Test-SnapshotProcessStillCurrent $snapshot)) { return $null }
  return $owner
}
`

export const WINDOWS_PROCESS_IDENTITY_SCRIPT = WINDOWS_SNAPSHOT_OWNER + String.raw`
$ErrorActionPreference = 'Stop'
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAMP_ACP_WINDOWS_INPUT_BASE64)) | ConvertFrom-Json
$processId = [uint32]$config.pid
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
if ($null -eq $process) { exit 3 }
$owner = Read-VerifiedSnapshotOwner $process
if ($null -eq $owner) { exit 3 }
[pscustomobject]@{
  pid = [uint32]$process.ProcessId
  creationDate = $process.CreationDate.ToString('o')
  executablePath = [string]$process.ExecutablePath
  ownerSid = [string]$owner.Sid
} | ConvertTo-Json -Compress
`

export const WINDOWS_PROCESS_TREE_SCRIPT = WINDOWS_SNAPSHOT_OWNER + String.raw`
$ErrorActionPreference = 'Stop'
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAMP_ACP_WINDOWS_INPUT_BASE64)) | ConvertFrom-Json
$rootPid = [uint32]$config.pid
$all = @(Get-CimInstance Win32_Process)
$byPid = @{}
foreach ($process in $all) { $byPid[[uint32]$process.ProcessId] = $process }
$selected = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$selected.Add($rootPid)
do {
  $changed = $false
  foreach ($process in $all) {
    $parentPid = [uint32]$process.ParentProcessId
    $parent = $byPid[$parentPid]
    if ($selected.Contains($parentPid) -and $null -ne $parent -and $process.CreationDate -ge $parent.CreationDate -and $selected.Add([uint32]$process.ProcessId)) {
      $changed = $true
    }
  }
} while ($changed)
$identities = @()
foreach ($process in $all) {
  if (-not $selected.Contains([uint32]$process.ProcessId)) { continue }
  $owner = Read-VerifiedSnapshotOwner $process
  if ($null -eq $owner) { continue }
  $identities += [pscustomobject]@{
    pid = [uint32]$process.ProcessId
    parentPid = [uint32]$process.ParentProcessId
    creationDate = $process.CreationDate.ToString('o')
    executablePath = [string]$process.ExecutablePath
    ownerSid = [string]$owner.Sid
  }
}
[pscustomobject]@{ processes = $identities } | ConvertTo-Json -Compress -Depth 3
`

const WINDOWS_PROCESS_INPUT_KEY = 'AAMP_ACP_WINDOWS_INPUT_BASE64'

function windowsProcessEnvironment(pid: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [WINDOWS_PROCESS_INPUT_KEY]: Buffer.from(JSON.stringify({ pid }), 'utf8').toString('base64'),
  }
}

type WindowsIdentityRead =
  | { status: 'found'; identity: WindowsProcessIdentity }
  | { status: 'gone' }
  | { status: 'unknown' }

function inspectWindowsProcessIdentity(pid: number): WindowsIdentityRead {
  try {
    const value = JSON.parse(execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_IDENTITY_SCRIPT,
    ], { encoding: 'utf8', windowsHide: true, env: windowsProcessEnvironment(pid) })) as Partial<WindowsProcessIdentity>
    if (value.pid !== pid || !value.creationDate || !value.executablePath || !value.ownerSid) return { status: 'unknown' }
    return { status: 'found', identity: value as WindowsProcessIdentity }
  } catch (error) {
    return (error as { status?: number }).status === 3 ? { status: 'gone' } : { status: 'unknown' }
  }
}

export function readWindowsProcessIdentity(pid: number): WindowsProcessIdentity | undefined {
  const result = inspectWindowsProcessIdentity(pid)
  return result.status === 'found' ? result.identity : undefined
}

export function snapshotOwnedWindowsTree(root: WindowsProcessIdentity): WindowsProcessIdentity[] {
  try {
    const value = JSON.parse(execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_TREE_SCRIPT,
    ], { encoding: 'utf8', windowsHide: true, env: windowsProcessEnvironment(root.pid) })) as { processes?: unknown }
    if (!Array.isArray(value.processes)) return []
    const identities = value.processes.filter((candidate): candidate is WindowsProcessIdentity => {
      if (!candidate || typeof candidate !== 'object') return false
      const identity = candidate as Partial<WindowsProcessIdentity>
      return Number.isSafeInteger(identity.pid) && (identity.pid ?? 0) > 0
        && Number.isSafeInteger((candidate as Partial<WindowsProcessRecord>).parentPid)
        && typeof identity.creationDate === 'string' && Boolean(identity.creationDate)
        && typeof identity.executablePath === 'string' && Boolean(identity.executablePath)
        && typeof identity.ownerSid === 'string' && Boolean(identity.ownerSid)
    })
    return selectOwnedWindowsTree(root, identities as WindowsProcessRecord[])
  } catch {
    return []
  }
}

export interface WindowsProcessRecord extends WindowsProcessIdentity { parentPid: number }

export function selectOwnedWindowsTree(
  root: WindowsProcessIdentity,
  records: readonly WindowsProcessRecord[],
): WindowsProcessIdentity[] {
  const rootRecord = records.find((record) => record.pid === root.pid)
  if (!rootRecord || !sameWindowsProcessIdentity(root, rootRecord)) return []
  const selected = new Map<number, WindowsProcessRecord>([[root.pid, rootRecord]])
  let changed = true
  while (changed && selected.size < 256) {
    changed = false
    for (const record of records) {
      if (selected.has(record.pid) || record.ownerSid !== root.ownerSid) continue
      const parent = selected.get(record.parentPid)
      if (!parent) continue
      if (Date.parse(record.creationDate) < Date.parse(parent.creationDate)) continue
      selected.set(record.pid, record)
      changed = true
      if (selected.size >= 256) break
    }
  }
  return [...selected.values()]
}

function sameWindowsProcessIdentity(a: WindowsProcessIdentity, b: WindowsProcessIdentity): boolean {
  return a.pid === b.pid
    && a.creationDate === b.creationDate
    && a.executablePath.toLowerCase() === b.executablePath.toLowerCase()
    && a.ownerSid === b.ownerSid
}

interface WindowsOwnedProcessTreeOptions {
  snapshot?: (root: WindowsProcessIdentity) => WindowsProcessIdentity[]
  terminate?: (identity: WindowsProcessIdentity) => WindowsTerminationOutcome
  setIntervalFn?: (callback: () => void, intervalMs: number) => NodeJS.Timeout
  clearIntervalFn?: (timer: NodeJS.Timeout) => void
  intervalMs?: number
}

export class WindowsOwnedProcessTree {
  private retained = new Map<number, WindowsProcessIdentity>()
  private timer: NodeJS.Timeout | undefined
  private readonly snapshot: (root: WindowsProcessIdentity) => WindowsProcessIdentity[]
  private readonly terminate: (identity: WindowsProcessIdentity) => WindowsTerminationOutcome
  private readonly setIntervalFn: (callback: () => void, intervalMs: number) => NodeJS.Timeout
  private readonly clearIntervalFn: (timer: NodeJS.Timeout) => void
  private readonly intervalMs: number

  constructor(
    private readonly root: WindowsProcessIdentity,
    options: WindowsOwnedProcessTreeOptions = {},
  ) {
    this.snapshot = options.snapshot ?? snapshotOwnedWindowsTree
    this.terminate = options.terminate ?? ((identity) => terminateWindowsProcessTree(identity))
    this.setIntervalFn = options.setIntervalFn ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
    this.clearIntervalFn = options.clearIntervalFn ?? ((timer) => clearInterval(timer))
    this.intervalMs = options.intervalMs ?? 500
  }

  start(): void {
    if (this.timer) return
    this.refresh()
    this.timer = this.setIntervalFn(() => this.refresh(), this.intervalMs)
    this.timer.unref?.()
  }

  refresh(): void {
    let identities: WindowsProcessIdentity[]
    try { identities = this.snapshot(this.root) } catch { return }
    const observedRoot = identities.find((identity) => identity.pid === this.root.pid)
    if (!observedRoot || !sameWindowsProcessIdentity(this.root, observedRoot)) return
    for (const identity of identities.slice(0, 256)) {
      if (identity.ownerSid === this.root.ownerSid) this.retained.set(identity.pid, identity)
    }
  }

  stopPolling(): void {
    if (!this.timer) return
    this.clearIntervalFn(this.timer)
    this.timer = undefined
  }

  terminateRetained(): void {
    this.stopPolling()
    const identities = [...this.retained.values()].sort((a, b) => b.pid - a.pid)
    for (const identity of identities) {
      const outcome = this.terminate(identity)
      if (outcome === 'gone' || outcome === 'identity-changed') this.retained.delete(identity.pid)
    }
  }
}

export type WindowsTerminationOutcome = 'termination-requested' | 'gone' | 'identity-changed' | 'unconfirmed'

export function terminateWindowsProcessTree(
  expected: WindowsProcessIdentity,
  inspectIdentity: (pid: number) => WindowsIdentityRead = inspectWindowsProcessIdentity,
  taskkill: typeof execFileSync = execFileSync,
): WindowsTerminationOutcome {
  const before = inspectIdentity(expected.pid)
  if (before.status === 'gone') return 'gone'
  if (before.status !== 'found') return 'unconfirmed'
  if (!sameWindowsProcessIdentity(expected, before.identity)) return 'identity-changed'
  try {
    taskkill('taskkill.exe', ['/pid', String(expected.pid), '/t', '/f'], {
      stdio: 'ignore', windowsHide: true,
    })
  } catch {
    return 'unconfirmed'
  }
  const after = inspectIdentity(expected.pid)
  if (after.status === 'gone') return 'gone'
  if (after.status === 'found' && !sameWindowsProcessIdentity(expected, after.identity)) return 'identity-changed'
  return after.status === 'unknown' ? 'unconfirmed' : 'termination-requested'
}

export function buildAcpxEnvironment(
  cwd: string,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...source }
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? (platform === 'win32' ? 'Path' : 'PATH')
  const existingPath = pathKeys.map((key) => env[key]).find((value) => value !== undefined) ?? ''
  for (const key of pathKeys) delete env[key]
  const pathJoin = platform === 'win32' ? win32.join : join
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  env[pathKey] = [pathJoin(cwd, 'node_modules', '.bin'), existingPath]
    .filter(Boolean).join(pathDelimiter)
  return env
}

export interface AcpEvent {
  eventVersion?: number
  sessionId?: string
  requestId?: string
  seq?: number
  type?: string
  messageId?: string
  content?: unknown
  [key: string]: unknown
}

export interface AcpxClientRuntime {
  platform?: NodeJS.Platform
  resolveCommand?: typeof resolveNativeCommand
}

export type AcpTextChunkChannel = 'assistant' | 'thought'

export interface AcpTextChunk {
  channel: AcpTextChunkChannel
  text: string
  messageId?: string
}

export interface AcpToolUpdate {
  toolCallId?: string
  title?: string
  status?: string
  kind?: string
  text?: string
  locations?: Array<{ path: string; line?: number }>
}

export interface AcpPlanEntry {
  content: string
  status?: string
  priority?: string
}

export interface AcpPromptHandlers {
  onEvent?: (event: AcpEvent) => void
  onTextChunk?: (chunk: AcpTextChunk) => void
  onToolUpdate?: (update: AcpToolUpdate) => void
  onPlanUpdate?: (entries: AcpPlanEntry[]) => void
}

export interface AcpResult {
  output: string
  events: AcpEvent[]
  stopReason?: string
  streamedAssistantText: boolean
}

export function selectFinalAssistantOutput(
  assistantMessages: ReadonlyMap<string, string>,
  messageOrder: readonly string[],
  excludedMessageKeys: ReadonlySet<string> = new Set(),
): string {
  return [...messageOrder]
    .reverse()
    .filter((messageKey) => !excludedMessageKeys.has(messageKey))
    .map((messageKey) => assistantMessages.get(messageKey)?.trim() ?? '')
    .find((message) => message.length > 0) ?? ''
}

export interface AcpAgentProbeOptions {
  sessionName?: string
  timeoutMs?: number
}

interface AcpxProcessControl {
  cancel: () => Promise<void>
}

interface AcpxExecution<T> extends AcpxProcessControl {
  promise: Promise<T>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => extractContentText(item)).join('')
  }

  const record = asRecord(content)
  if (!record) return ''

  if (typeof record.text === 'string') return record.text
  if (typeof record.thinking === 'string') return record.thinking

  const resource = asRecord(record.resource)
  if (resource && typeof resource.text === 'string') return resource.text

  return ''
}

function isAimeSourcesEvent(event: AcpEvent): boolean {
  if (event.messageId !== 'aime-sources') return false
  const meta = asRecord(event._meta)
  return meta?.['aime.acp.message_kind'] === 'sources'
}

function extractToolLocations(value: unknown): Array<{ path: string; line?: number }> | undefined {
  if (!Array.isArray(value)) return undefined

  const locations = value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const path = asString(record.path)
    if (!path) return []

    const line = typeof record.line === 'number' && Number.isFinite(record.line)
      ? record.line
      : undefined

    return [{ path, ...(line != null ? { line } : {}) }]
  })

  return locations.length > 0 ? locations : undefined
}

function extractPlanEntries(value: unknown): AcpPlanEntry[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const record = asRecord(item)
    const content = asString(record?.content)
    if (!content) return []

    return [{
      content,
      ...(asString(record?.status) ? { status: asString(record?.status) } : {}),
      ...(asString(record?.priority) ? { priority: asString(record?.priority) } : {}),
    }]
  })
}

function normalizeLegacyEvent(record: Record<string, unknown>): AcpEvent | null {
  const rawType = asString(record.type)
  if (!rawType) return null

  const mappedType = rawType === 'thinking' ? 'agent_thought_chunk' : rawType
  return {
    ...record,
    type: mappedType,
    ...(asString(record.sessionId) ? { sessionId: asString(record.sessionId) } : {}),
    ...(asString(record.requestId) ? { requestId: asString(record.requestId) } : {}),
    ...(typeof record.seq === 'number' ? { seq: record.seq } : {}),
  }
}

function normalizeJsonRpcEvent(record: Record<string, unknown>): AcpEvent | null {
  if (record.method === 'session/update') {
    const params = asRecord(record.params)
    if (!params) return null

    const explicitUpdate = asRecord(params.update)
    const fallbackUpdate = asString(params.sessionUpdate)
      ? {
        ...params,
        sessionUpdate: params.sessionUpdate,
      }
      : null
    const update = explicitUpdate ?? fallbackUpdate
    if (!update) return null

    const type = asString(update.sessionUpdate)
    if (!type) return null

    const normalized: AcpEvent = {
      type,
      ...(asString(params.sessionId) ? { sessionId: asString(params.sessionId) } : {}),
    }

    for (const [key, value] of Object.entries(update)) {
      if (key === 'sessionUpdate') continue
      normalized[key] = value
    }

    return normalized
  }

  if (record.result) {
    const result = asRecord(record.result)
    if (!result) return null
    return {
      type: 'result',
      ...(asString(record.id) ? { requestId: asString(record.id) } : {}),
      ...result,
    }
  }

  if (record.error) {
    return {
      type: 'error',
      ...(asString(record.id) ? { requestId: asString(record.id) } : {}),
      error: record.error,
    }
  }

  return null
}

function parseAcpLine(line: string): { event: AcpEvent | null; isJson: boolean } {
  const trimmed = line.trim()
  if (!trimmed) return { event: null, isJson: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { event: null, isJson: false }
  }

  const record = asRecord(parsed)
  if (!record) return { event: null, isJson: true }

  if (record.jsonrpc === '2.0') {
    return { event: normalizeJsonRpcEvent(record), isJson: true }
  }

  return { event: normalizeLegacyEvent(record), isJson: true }
}

function supportsJsonStreamingFallback(stderr: string): boolean {
  return /unknown option|unknown argument|unexpected argument|invalid value|--format|--json-strict/i.test(stderr)
}

function isCliTranscriptHeader(line: string): boolean {
  return /^\[(acpx|client|tool|done|error|warning)\](?:\s|$)/i.test(line)
}

function extractFinalReplyFromTranscript(output: string): string {
  const trimmed = output.trim()
  if (!trimmed) return ''

  const lines = trimmed.replace(/\r\n/g, '\n').split('\n')
  const textBlocks: string[] = []
  let currentBlock: string[] = []
  let skippingTranscriptDetails = false

  const flushBlock = () => {
    const block = currentBlock.join('\n').trim()
    if (block) textBlocks.push(block)
    currentBlock = []
  }

  for (const line of lines) {
    if (isCliTranscriptHeader(line)) {
      flushBlock()
      skippingTranscriptDetails = true
      continue
    }

    if (skippingTranscriptDetails) {
      if (!line || /^[ \t]+/.test(line)) {
        continue
      }
      skippingTranscriptDetails = false
    }

    currentBlock.push(line)
  }

  flushBlock()
  return textBlocks.at(-1) ?? ''
}

function sanitizePromptOutput(output: string): string {
  const trimmed = output.trim()
  if (!trimmed) return ''
  if (!trimmed.split(/\r?\n/).some((line) => isCliTranscriptHeader(line))) {
    return trimmed
  }
  return extractFinalReplyFromTranscript(trimmed)
}

const AUTHENTICATION_FAILURE_LINE = /^Authentication (?:required|failed)(?:\. Please use \/login command to sign in to your account\.?)?$/i

const AIME_AUTH_REQUIRED_CODE = 'AUTH_REQUIRED'
const AIME_LOGIN_COMMAND_PATTERN = /\baime-acp auth login --site (cn|i18n-tt)\b/

function findAimeAuthRequiredFailure(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findAimeAuthRequiredFailure(item)
      if (match) return match
    }
    return undefined
  }

  const record = asRecord(value)
  if (!record) return undefined
  const data = asRecord(record.data)
  const code = typeof record.code === 'string'
    ? record.code
    : typeof data?.code === 'string'
      ? data.code
      : undefined
  if (code === AIME_AUTH_REQUIRED_CODE) {
    const sourceMessage = [record.message, data?.message]
      .find((item): item is string => typeof item === 'string')
    const site = sourceMessage ? AIME_LOGIN_COMMAND_PATTERN.exec(sourceMessage)?.[1] : undefined
    return 'AUTH_REQUIRED: Managed user authentication is required.'
      + (site ? ' Run `aime-acp auth login --site ' + site + '`.' : '')
  }

  for (const item of Object.values(record)) {
    const match = findAimeAuthRequiredFailure(item)
    if (match) return match
  }
  return undefined
}

function findAuthenticationFailureLine(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line
        .replace(/\u001b\[[0-9;]*m/g, '')
        .trim()
        .replace(/^(?:(?:\[(?:error|warning|acpx|client)\]|error:|stderr:)\s*)+/i, '')
        .trim())
      .find((line) => AUTHENTICATION_FAILURE_LINE.test(line))
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findAuthenticationFailureLine(item)
      if (match) return match
    }
    return undefined
  }

  const record = asRecord(value)
  if (!record) return undefined
  for (const item of Object.values(record)) {
    const match = findAuthenticationFailureLine(item)
    if (match) return match
  }
  return undefined
}

function throwIfAuthenticationFailure(...values: unknown[]): void {
  const aimeFailure = values
    .map((value) => findAimeAuthRequiredFailure(value))
    .find((value): value is string => value !== undefined)
  if (aimeFailure) throw new Error(aimeFailure)

  const failure = findAuthenticationFailureLine(values)
  if (failure) throw new Error(failure)
}

/**
 * Wrapper around acpx CLI.
 * Invokes acpx as a subprocess and parses NDJSON output.
 */
function windowsPromptInput(text: string): string {
  // acpx --file accepts ACP blocks. Wrap text so a prompt beginning with '['
  // cannot become structured input; match its existing argv whitespace trim.
  // ASCII JSON also survives upstream Buffer-to-string chunk decoding intact.
  return JSON.stringify([{ type: 'text', text: text.trim() }])
    .replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export class AcpxClient {
  private cwd: string
  private activeProcesses = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  private stopInFlight: Promise<void> | undefined
  private windowsProcessIdentities = new WeakMap<ChildProcessWithoutNullStreams, WindowsProcessIdentity>()
  private exitedProcesses = new WeakSet<ChildProcessWithoutNullStreams>()
  private windowsProcessTrees = new WeakMap<ChildProcessWithoutNullStreams, WindowsOwnedProcessTree>()
  private platform: NodeJS.Platform
  private resolveCommand: typeof resolveNativeCommand

  constructor(cwd?: string, runtime: AcpxClientRuntime = {}) {
    this.cwd = cwd ?? process.cwd()
    this.platform = runtime.platform ?? process.platform
    this.resolveCommand = runtime.resolveCommand ?? resolveNativeCommand
  }

  private isRawAgentCommand(agent: string): boolean {
    return /\s/.test(agent.trim())
  }

  private buildAcpxArgs(agent: string, args: string[], globalArgs: string[] = [], prepare = true): string[] {
    if (this.isRawAgentCommand(agent)) {
      if (this.platform === 'win32') {
        const argv = parseWindowsAgentArgv(agent)
        const alias = prepare ? ensureWindowsAgentConfig(this.cwd, argv) : windowsAgentAlias(argv)
        return ['--approve-all', '--cwd', this.cwd, ...globalArgs, alias, ...args]
      }
      return ['--approve-all', '--cwd', this.cwd, ...globalArgs, '--agent', agent, ...args]
    }
    return ['--approve-all', '--cwd', this.cwd, ...globalArgs, agent, ...args]
  }

  private formatArgForLog(arg: string): string {
    const normalized = arg.replace(/\s+/g, ' ').trim()
    if (normalized.length <= 160) return normalized
    return `${normalized.slice(0, 157)}...`
  }

  private formatFailedCommand(agent: string, args: string[], globalArgs: string[] = []): string {
    return ['acpx', ...this.buildAcpxArgs(agent, args, globalArgs, false)]
      .map((arg) => this.formatArgForLog(arg))
      .join(' ')
  }

  private acpxEnv(): NodeJS.ProcessEnv {
    const env = buildAcpxEnvironment(this.cwd)
    const registry = env.npm_config_registry || env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/'
    const cache = env.npm_config_cache || env.NPM_CONFIG_CACHE || `${tmpdir()}/aamp-acpx-npm-cache`

    for (const key of Object.keys(env)) {
      const lower = key.toLowerCase()
      if (
        lower.startsWith('npm_config_')
        || lower.startsWith('npm_package_')
        || lower.startsWith('npm_lifecycle_')
        || lower === 'npm_command'
        || lower === 'npm_execpath'
        || lower === 'npm_node_execpath'
        || lower === 'init_cwd'
      ) {
        delete env[key]
      }
    }

    mkdirSync(cache, { recursive: true })
    env.npm_config_registry = registry
    env.NPM_CONFIG_REGISTRY = registry
    env.npm_config_cache = cache
    env.NPM_CONFIG_CACHE = cache
    return env
  }

  private spawnAcpx(args: string[]): ChildProcessWithoutNullStreams {
    const env = this.acpxEnv()
    const executable = this.resolveCommand('acpx', { env })
    return this.trackWindowsProcess(spawn(executable.command, [...executable.argsPrefix, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.cwd,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    }))
  }

  private spawnNpxAcpx(args: string[]): ChildProcessWithoutNullStreams {
    const env = this.acpxEnv()
    const executable = this.resolveCommand('npx', { env })
    return this.trackWindowsProcess(spawn(executable.command, [...executable.argsPrefix, '-y', 'acpx', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.cwd,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    }))
  }

  private trackWindowsProcess(proc: ChildProcessWithoutNullStreams): ChildProcessWithoutNullStreams {
    if (process.platform === 'win32' && proc.pid) {
      const identity = readWindowsProcessIdentity(proc.pid)
      if (identity) {
        this.windowsProcessIdentities.set(proc, identity)
        const tree = new WindowsOwnedProcessTree(identity)
        this.windowsProcessTrees.set(proc, tree)
        tree.start()
      }
      proc.once('exit', () => {
        this.exitedProcesses.add(proc)
        this.windowsProcessTrees.get(proc)?.stopPolling()
      })
    }
    return proc
  }

  private isSpawnNotFoundError(err: unknown): boolean {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }

  private runAcpx(
    args: string[],
    handlers: {
      onStdout?: (chunk: Buffer) => void
      onStderr?: (chunk: Buffer) => void
      onClose: (code: number | null) => void
      onError: (err: Error) => void
    },
    input?: string,
  ): AcpxProcessControl {
    let startedFallback = false
    let settled = false
    let cancelled = false
    const ownedProcesses = new Set<ChildProcessWithoutNullStreams>()
    const forcedKillTimers = new Map<ChildProcessWithoutNullStreams, NodeJS.Timeout>()
    let resolveExited: (() => void) | undefined
    const exited = new Promise<void>((resolve) => { resolveExited = resolve })
    const resolveExitedIfComplete = () => {
      if (settled && ownedProcesses.size === 0) resolveExited?.()
    }

    const attach = (proc: ChildProcessWithoutNullStreams) => {
      let resolveClosed!: () => void
      const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
      let closeObserved = false
      let processErrored = false
      ownedProcesses.add(proc)
      this.activeProcesses.set(proc, closed)
      const forgetProcess = () => {
        if (closeObserved) return
        closeObserved = true
        const forcedKillTimer = forcedKillTimers.get(proc)
        if (forcedKillTimer) clearTimeout(forcedKillTimer)
        forcedKillTimers.delete(proc)
        ownedProcesses.delete(proc)
        this.activeProcesses.delete(proc)
        this.windowsProcessTrees.get(proc)?.terminateRetained()
        resolveClosed()
      }
      if (input !== undefined) {
        // Wait for a real spawn so ENOENT can select npx before any stdin write.
        // The same payload is supplied afresh to each fallback child.
        proc.stdin.on('error', (error: NodeJS.ErrnoException) => {
          if (settled) return
          settled = true
          // Failed delivery must not leave this exact owned child running.
          this.terminateProcessTree(proc, 'SIGTERM')
          const forcedKillTimer = setTimeout(() => {
            if (ownedProcesses.has(proc)) this.terminateProcessTree(proc, 'SIGKILL')
          }, 1_000)
          forcedKillTimer.unref()
          forcedKillTimers.set(proc, forcedKillTimer)
          handlers.onError(error)
        })
        proc.once('spawn', () => { proc.stdin.end(input, 'utf8') })
      }
      proc.stdout.on('data', (chunk: Buffer) => handlers.onStdout?.(chunk))
      proc.stderr.on('data', (chunk: Buffer) => handlers.onStderr?.(chunk))
      proc.on('close', (code) => {
        forgetProcess()
        if (processErrored) {
          resolveExitedIfComplete()
          return
        }
        if (settled) {
          resolveExitedIfComplete()
          return
        }
        settled = true
        handlers.onClose(code)
        resolveExitedIfComplete()
      })
      proc.on('error', (err) => {
        processErrored = true
        if (!proc.pid) forgetProcess()
        if (!cancelled && !startedFallback && this.isSpawnNotFoundError(err)) {
          startedFallback = true
          try {
            attach(this.spawnNpxAcpx(args))
          } catch (fallbackError) {
            settled = true
            handlers.onError(fallbackError as Error)
            resolveExitedIfComplete()
          }
          return
        }
        if (settled) {
          resolveExitedIfComplete()
          return
        }
        settled = true
        handlers.onError(err)
        resolveExitedIfComplete()
      })
    }

    try {
      attach(this.spawnAcpx(args))
    } catch (error) {
      startedFallback = true
      try {
        attach(this.spawnNpxAcpx(args))
      } catch (fallbackError) {
        settled = true
        handlers.onError(fallbackError instanceof Error ? fallbackError : error as Error)
        resolveExitedIfComplete()
      }
    }
    return {
      cancel: async () => {
        if (!cancelled) {
          cancelled = true
          for (const proc of [...ownedProcesses]) {
            this.terminateProcessTree(proc, 'SIGTERM')
            const forcedKillTimer = setTimeout(() => {
              if (ownedProcesses.has(proc)) this.terminateProcessTree(proc, 'SIGKILL')
            }, 1_000)
            forcedKillTimer.unref()
            forcedKillTimers.set(proc, forcedKillTimer)
          }
        }

        resolveExitedIfComplete()
        await Promise.race([
          exited,
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ])
      },
    }
  }

  stop(): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight
    let retained!: Promise<void>
    retained = this.stopActiveProcesses().finally(() => {
      if (this.stopInFlight === retained) this.stopInFlight = undefined
    })
    this.stopInFlight = retained
    return retained
  }

  private async stopActiveProcesses(): Promise<void> {
    for (const proc of this.activeProcesses.keys()) {
      this.terminateProcessTree(proc, 'SIGTERM')
    }
    if (await this.waitForActiveProcessesToClose(1_000)) return

    for (const proc of this.activeProcesses.keys()) {
      this.terminateProcessTree(proc, 'SIGKILL')
    }
    if (!(await this.waitForActiveProcessesToClose(1_000))) {
      throw new Error('acpx child process did not close after SIGKILL')
    }
  }

  private async waitForActiveProcessesToClose(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.activeProcesses.size > 0) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const closed = await Promise.race([
          Promise.all([...this.activeProcesses.values()]).then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), remaining)
          }),
        ])
        if (!closed) return false
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
    return true
  }

  private terminateProcessTree(
    proc: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals = 'SIGTERM',
  ): void {
    const pid = proc.pid
    if (!pid) return

    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, signal)
        return
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') return
      }
    }

    if (process.platform === 'win32') {
      const tree = this.windowsProcessTrees.get(proc)
      if (tree) {
        tree.terminateRetained()
        return
      }
      if (this.exitedProcesses.has(proc)) return
      const identity = this.windowsProcessIdentities.get(proc)
      if (identity) terminateWindowsProcessTree(identity)
      return
    }

    try { proc.kill(signal) } catch { /* best-effort cleanup */ }
  }

  private formatProcessFailure(
    agent: string,
    args: string[],
    code: number | null,
    stdout: string,
    stderr: string,
    globalArgs: string[] = [],
  ): string {
    const details = [
      stderr.trim() ? `stderr: ${stderr.trim()}` : '',
      stdout.trim() ? `stdout: ${stdout.trim()}` : '',
    ].filter(Boolean)

    return `${this.formatFailedCommand(agent, args, globalArgs)} failed (${code ?? 'unknown'}): ${
      details.join('\n') || 'no output from acpx'
    }`
  }

  /**
   * Ensure a named ACP session exists for the given agent.
   */
  async ensureSession(agent: string, sessionName: string): Promise<string> {
    const result = await this.exec(agent, ['sessions', 'ensure', '--name', sessionName])
    // Try to extract sessionId from the JSON output
    try {
      const data = JSON.parse(result.trim().split('\n').pop() ?? '{}')
      return data.sessionId ?? sessionName
    } catch {
      return sessionName
    }
  }

  /**
   * Start and immediately close a fresh ACP session to verify that the agent
   * can initialize now. Unlike `sessions ensure`, this cannot be satisfied by
   * a stale local acpx session record.
   */
  async probeAgent(agent: string, options: AcpAgentProbeOptions = {}): Promise<void> {
    const sessionName = options.sessionName
      ?? `aamp-readiness-${Date.now()}-${randomUUID().slice(0, 8)}`
    const timeoutMs = options.timeoutMs ?? 15_000

    try {
      await this.execWithTimeout(
        agent,
        ['sessions', 'new', '--name', sessionName],
        timeoutMs,
        `ACP readiness probe timed out after ${timeoutMs}ms`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/^ACP readiness probe timed out after \d+ms$/.test(message)) {
        try {
          await this.execWithTimeout(
            agent,
            ['sessions', 'close', sessionName],
            Math.min(timeoutMs, 5_000),
            'ACP readiness probe timeout cleanup also timed out',
          )
        } catch { /* preserve the original readiness timeout */ }
      }
      throw err
    }

    let cleanupError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.execWithTimeout(
          agent,
          ['sessions', 'close', sessionName],
          timeoutMs,
          `ACP readiness probe cleanup timed out after ${timeoutMs}ms`,
        )
        cleanupError = undefined
        break
      } catch (err) {
        cleanupError = err
      }
    }

    if (cleanupError) {
      throw new Error('ACP readiness probe could not close its temporary session', {
        cause: cleanupError,
      })
    }
  }

  /**
   * Send a prompt to an ACP agent and wait for completion.
   * Collects all stdout + stderr output and extracts the agent's response.
   */
  async prompt(
    agent: string,
    sessionName: string,
    text: string,
    handlers?: AcpPromptHandlers,
  ): Promise<AcpResult> {
    try {
      return await this.promptJsonMode(agent, sessionName, text, handlers)
    } catch (err) {
      if (supportsJsonStreamingFallback((err as Error).message)) {
        return await this.promptTextMode(agent, sessionName, text)
      }
      throw err
    }
  }

  private async promptJsonMode(
    agent: string,
    sessionName: string,
    text: string,
    handlers?: AcpPromptHandlers,
  ): Promise<AcpResult> {
    const events: AcpEvent[] = []
    let stopReason: string | undefined
    let streamedAssistantText = false
    const assistantMessages = new Map<string, string>()
    const assistantMessageOrder: string[] = []
    const excludedAssistantMessageKeys = new Set<string>()
    let lastAssistantMessageKey: string | undefined
    let lastThoughtMessageKey: string | undefined
    let thoughtMessageCount = 0
    let previousEventType: string | undefined

    return new Promise<AcpResult>((resolve, reject) => {
      const acpxArgs = this.buildAcpxArgs(agent, [
        'prompt',
        '-s', sessionName,
        ...(this.platform === 'win32' ? ['--file', '-'] : [text]),
      ], ['--format', 'json', '--json-strict'])

      let stdoutBuffer = ''
      let rawStdout = ''
      let stderr = ''

      const processLine = (line: string) => {
        const parsed = parseAcpLine(line)
        const event = parsed.event
        if (!event) {
          if (!parsed.isJson) {
            rawStdout += `${line}\n`
          }
          return
        }

        events.push(event)
        handlers?.onEvent?.(event)

        if (event.type === 'agent_message_chunk') {
          const textChunk = extractContentText(event.content)
          if (textChunk) {
            const explicitMessageId = asString(event.messageId)
            const aimeSourcesEvent = isAimeSourcesEvent(event)
            const messageKey = aimeSourcesEvent
              ? 'metadata:aime-sources'
              : explicitMessageId
              ?? (previousEventType === 'agent_message_chunk' && lastAssistantMessageKey
                ? lastAssistantMessageKey
                : `anonymous:${assistantMessageOrder.length}`)

            if (!assistantMessages.has(messageKey)) {
              assistantMessages.set(messageKey, '')
              assistantMessageOrder.push(messageKey)
            }

            if (aimeSourcesEvent) {
              excludedAssistantMessageKeys.add(messageKey)
            }

            assistantMessages.set(messageKey, `${assistantMessages.get(messageKey) ?? ''}${textChunk}`)
            lastAssistantMessageKey = messageKey
            streamedAssistantText = true
            handlers?.onTextChunk?.({
              channel: 'assistant',
              text: textChunk,
              messageId: explicitMessageId ?? messageKey,
            })
          }
          previousEventType = event.type
          return
        }

        if (event.type === 'agent_thought_chunk') {
          const textChunk = extractContentText(event.content)
          if (textChunk) {
            const messageId = asString(event.messageId)
              ?? (previousEventType === 'agent_thought_chunk' && lastThoughtMessageKey
                ? lastThoughtMessageKey
                : `anonymous-thought:${thoughtMessageCount++}`)
            lastThoughtMessageKey = messageId
            handlers?.onTextChunk?.({
              channel: 'thought',
              text: textChunk,
              messageId,
            })
          }
          previousEventType = event.type
          return
        }

        if (event.type === 'tool_call' || event.type === 'tool_call_update') {
          handlers?.onToolUpdate?.({
            toolCallId: asString(event.toolCallId),
            title: asString(event.title),
            status: asString(event.status),
            kind: asString(event.kind),
            text: extractContentText(event.content),
            locations: extractToolLocations(event.locations),
          })
          previousEventType = event.type
          return
        }

        if (event.type === 'plan') {
          const entries = extractPlanEntries(event.entries)
          if (entries.length > 0) {
            handlers?.onPlanUpdate?.(entries)
          }
          previousEventType = event.type
          return
        }

        if (event.type === 'result') {
          stopReason = asString(event.stopReason)
        }

        previousEventType = event.type
      }

      const processStdoutChunk = (chunk: Buffer) => {
        stdoutBuffer += chunk.toString()

        let newlineIndex = stdoutBuffer.indexOf('\n')
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
          processLine(line)
          newlineIndex = stdoutBuffer.indexOf('\n')
        }
      }

      this.runAcpx(acpxArgs, {
        onStdout: processStdoutChunk,
        onStderr: (chunk: Buffer) => { stderr += chunk.toString() },
        onClose: (code) => {
          if (stdoutBuffer.trim()) {
            processLine(stdoutBuffer.replace(/\r$/, ''))
          }

          const finalAssistantOutput = selectFinalAssistantOutput(
            assistantMessages,
            assistantMessageOrder,
            excludedAssistantMessageKeys,
          )
          const output = finalAssistantOutput
            || sanitizePromptOutput(rawStdout)
            || sanitizePromptOutput(stderr)

          try {
            throwIfAuthenticationFailure(
              finalAssistantOutput,
              rawStdout,
              stderr,
              events.filter((event) => event.type === 'error').map((event) => event.error),
            )
          } catch (err) {
            reject(err)
            return
          }

          if (code !== 0 && !output) {
            reject(new Error(this.formatProcessFailure(
              agent,
              ['prompt', '-s', sessionName, text],
              code,
              rawStdout,
              stderr,
              ['--format', 'json', '--json-strict'],
            )))
          } else {
            resolve({
              output,
              events,
              ...(stopReason ? { stopReason } : {}),
              streamedAssistantText,
            })
          }
        },
        onError: (err) => {
          reject(new Error(`Failed to spawn acpx or npx acpx: ${err.message}. Is Node/npm available?`))
        },
      }, this.platform === 'win32' ? windowsPromptInput(text) : undefined)
    })
  }

  private async promptTextMode(agent: string, sessionName: string, text: string): Promise<AcpResult> {
    const events: AcpEvent[] = []

    return await new Promise<AcpResult>((resolve, reject) => {
      // Old acpx builds may not support JSON output yet.
      const acpxArgs = this.buildAcpxArgs(agent, ['prompt', '-s', sessionName, ...(this.platform === 'win32' ? ['--file', '-'] : [text])])

      let stdout = ''
      let stderr = ''

      this.runAcpx(acpxArgs, {
        onStdout: (chunk: Buffer) => { stdout += chunk.toString() },
        onStderr: (chunk: Buffer) => { stderr += chunk.toString() },
        onClose: (code) => {
          const output = sanitizePromptOutput(stdout) || sanitizePromptOutput(stderr)

          try {
            throwIfAuthenticationFailure(stdout, stderr)
          } catch (err) {
            reject(err)
            return
          }

          if (code !== 0 && !output) {
            reject(new Error(this.formatProcessFailure(
              agent,
              ['prompt', '-s', sessionName, text],
              code,
              stdout,
              stderr,
            )))
          } else {
            resolve({
              output,
              events,
              streamedAssistantText: false,
            })
          }
        },
        onError: (err) => {
          reject(new Error(`Failed to spawn acpx or npx acpx: ${err.message}. Is Node/npm available?`))
        },
      }, this.platform === 'win32' ? windowsPromptInput(text) : undefined)
    })
  }

  /**
   * Cancel the current operation in a session.
   */
  async cancel(agent: string, sessionName: string): Promise<void> {
    await this.exec(agent, ['cancel', '-s', sessionName])
  }

  /**
   * Close a session.
   */
  async close(agent: string, sessionName: string): Promise<void> {
    await this.exec(agent, ['sessions', 'close', sessionName])
  }

  /**
   * Execute an acpx command and return stdout.
   */
  private exec(agent: string, args: string[]): Promise<string> {
    return this.startExec(agent, args).promise
  }

  private startExec(agent: string, args: string[]): AcpxExecution<string> {
    let processControl: AcpxProcessControl | undefined
    const promise = new Promise<string>((resolve, reject) => {
      const acpxArgs = this.buildAcpxArgs(agent, args)

      let stdout = ''
      let stderr = ''

      processControl = this.runAcpx(acpxArgs, {
        onStdout: (chunk: Buffer) => { stdout += chunk.toString() },
        onStderr: (chunk: Buffer) => { stderr += chunk.toString() },
        onClose: (code) => {
          if (code !== 0) reject(new Error(this.formatProcessFailure(agent, args, code, stdout, stderr)))
          else resolve(stdout)
        },
        onError: (err) => {
          reject(new Error(`Failed to spawn acpx or npx acpx: ${err.message}`))
        },
      })
    })

    return {
      promise,
      cancel: async () => { await processControl?.cancel() },
    }
  }

  private async execWithTimeout(
    agent: string,
    args: string[],
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<string> {
    const execution = this.startExec(agent, args)
    return await new Promise<string>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        void execution.cancel().finally(() => reject(new Error(timeoutMessage)))
      }, timeoutMs)

      execution.promise.then(
        (value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(value)
        },
        (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(err)
        },
      )
    })
  }
}

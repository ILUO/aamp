import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'

const CODEX_APP_CLI = '/Applications/Codex.app/Contents/Resources/codex'
const CODEX_APP_ACP_COMMAND = `env CODEX_PATH=${CODEX_APP_CLI} npx -y @agentclientprotocol/codex-acp`
const TRAE_COMMANDS = ['traecli', 'traex'] as const

export const KNOWN_AGENTS = [
  'claude', 'codex', 'gemini', 'goose', 'openclaw',
  'opencode', 'cursor', 'copilot', 'kimi', 'kiro',
  'hermes', 'trae',
] as const

export interface AgentResolution {
  command: string
  acpCommand: string
  version: string
}

function commandCandidates(name: string): readonly string[] {
  return name === 'trae' ? TRAE_COMMANDS : [name]
}

export function defaultAgentCommand(name: string): string {
  return commandCandidates(name)[0]
}

function baseAcpCommand(name: string, command = defaultAgentCommand(name)): string {
  if (name === 'hermes') return 'hermes acp'
  if (name === 'trae') return `${command} acp serve`
  return name
}

function detectVersion(command: string): string {
  try {
    return execFileSync(command, ['--version'], { stdio: 'pipe', timeout: 5_000 })
      .toString()
      .trim()
      .split('\n')[0] || 'installed'
  } catch {
    return 'installed'
  }
}

export interface ExecutableLookupOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = env[name]
  if (exact !== undefined) return exact
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findExecutableOnPath(
  command: string,
  options: ExecutableLookupOptions = {},
): string | undefined {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = environmentValue(env, 'PATH')
  if (!pathValue) return undefined

  let candidates = [command]
  if (platform === 'win32') {
    const pathExt = environmentValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
    const extensions = pathExt
      .split(';')
      .map((extension) => extension.trim())
      .filter(Boolean)
      .map((extension) => extension.startsWith('.') ? extension : `.${extension}`)
    const commandExtension = extname(command)
    candidates = commandExtension
      ? extensions.some((extension) => extension.toLowerCase() === commandExtension.toLowerCase())
        ? [command]
        : []
      : extensions.map((extension) => `${command}${extension}`)
  }

  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  for (const rawDirectory of pathValue.split(pathDelimiter)) {
    const directory = rawDirectory.replace(/^"|"$/g, '')
    if (!directory) continue
    for (const candidate of candidates) {
      const resolved = join(directory, candidate)
      if (isExecutableFile(resolved, platform)) return resolved
    }
  }

  return undefined
}

export function detectKnownAgent(name: string): AgentResolution | undefined {
  for (const command of commandCandidates(name)) {
    if (findExecutableOnPath(command)) {
      return {
        command,
        acpCommand: baseAcpCommand(name, command),
        version: detectVersion(command),
      }
    }
  }

  if (name === 'codex' && process.platform === 'darwin' && existsSync(CODEX_APP_CLI)) {
    return {
      command: CODEX_APP_CLI,
      acpCommand: CODEX_APP_ACP_COMMAND,
      version: detectVersion(CODEX_APP_CLI),
    }
  }

  return undefined
}

export function defaultAcpCommand(name: string, previousCommand?: string): string {
  const baseCommand = baseAcpCommand(name)
  const nonblankPreviousCommand = typeof previousCommand === 'string'
    && previousCommand.trim().length > 0
    ? previousCommand
    : undefined
  if (name === 'trae' && nonblankPreviousCommand) return nonblankPreviousCommand
  if (nonblankPreviousCommand && nonblankPreviousCommand !== baseCommand) {
    if (name !== 'codex' || nonblankPreviousCommand !== CODEX_APP_CLI) {
      return nonblankPreviousCommand
    }
  }
  return detectKnownAgent(name)?.acpCommand ?? baseCommand
}

export function missingAgentWarning(name: string): string {
  if (name === 'trae') {
    return 'traecli or traex was not found on PATH.'
  }
  if (name === 'codex' && process.platform === 'darwin') {
    return `codex was not found on PATH or at ${CODEX_APP_CLI}.`
  }
  return `${name} was not found on PATH.`
}

import { stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'

import { discoverClineTasks, createClineParser, getVSCodeGlobalStoragePaths } from './vscode-cline-parser.js'
import {
  createClineCliParser,
  discoverClineCliSessions,
  getClineCliSessionsDir,
  isClineCliSource,
  mapClineCliToolName,
} from './cline-cli-parser.js'
import { getShortModelName } from '../models.js'
import type { ProbeRoot, Provider, SessionSource, SessionParser } from './types.js'

const EXTENSION_ID = 'saoudrizwan.claude-dev'

export function getClineDataPath(): string {
  return join(homedir(), '.cline', 'data')
}

function normalizeOverrideDirs(overrideDirs?: string | string[]): string[] | undefined {
  if (overrideDirs === undefined) return undefined
  // Cline has several default roots, so tests and future callers can override one or all.
  return Array.isArray(overrideDirs) ? overrideDirs : [overrideDirs]
}

async function dedupeTaskSources(sources: SessionSource[]): Promise<SessionSource[]> {
  const candidates = await Promise.all(sources.map(async source => ({
    source,
    mtimeMs: (await stat(join(source.path, 'ui_messages.json')).catch(() => null))?.mtimeMs ?? 0,
  })))

  const seenTaskIds = new Set<string>()
  const deduped: SessionSource[] = []

  for (const { source } of candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const taskId = basename(source.path)
    if (seenTaskIds.has(taskId)) continue
    seenTaskIds.add(taskId)
    deduped.push(source)
  }

  return deduped
}

export function createClineProvider(
  overrideDirs?: string | string[],
  cliSessionsDir?: string,
): Provider {
  const configuredDirs = normalizeOverrideDirs(overrideDirs)
  const sessionsDir = (): string => cliSessionsDir ?? getClineCliSessionsDir()

  return {
    name: 'cline',
    displayName: 'Cline',

    modelDisplayName(model: string): string {
      // The CLI records routed ids like `cline-pass/glm-5.2`, which are
      // unreadable raw; getShortModelName resolves those (and the extension's
      // `anthropic/claude-sonnet-4-5`) to the model's real name.
      return getShortModelName(model)
    },

    toolDisplayName(rawTool: string): string {
      // Only the CLI's tool vocabulary is mapped; the extension's names are not
      // in that table and pass through untouched.
      return mapClineCliToolName(rawTool)
    },

    async probeRoots(): Promise<ProbeRoot[]> {
      const taskRoots = configuredDirs ?? [
        ...getVSCodeGlobalStoragePaths(EXTENSION_ID),
        getClineDataPath(),
      ]
      return [
        ...taskRoots.map(path => ({ path, label: 'Cline tasks' })),
        { path: sessionsDir(), label: 'Cline CLI sessions' },
      ]
    },

    async discoverSessions(): Promise<SessionSource[]> {
      // Cline may be installed in any VS Code variant (stable, Insiders,
      // VSCodium), so every globalStorage root is scanned - same as the Roo Code
      // and KiloCode siblings - plus Cline's own home-data root.
      const baseDirs = configuredDirs ?? [
        ...getVSCodeGlobalStoragePaths(EXTENSION_ID),
        getClineDataPath(),
      ]

      // Task sources dedup among themselves by task id; the CLI's session dirs
      // live under a different subtree and carry no task id, so they are
      // discovered separately and appended rather than run through that pass.
      const [tasks, cliSessions] = await Promise.all([
        discoverClineTasks(EXTENSION_ID, 'cline', 'Cline', baseDirs).then(dedupeTaskSources),
        discoverClineCliSessions(cliSessionsDir),
      ])

      return [...tasks, ...cliSessions]
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return isClineCliSource(source)
        ? createClineCliParser(source, seenKeys)
        : createClineParser(source, seenKeys, 'cline')
    },
  }
}

export const cline = createClineProvider()

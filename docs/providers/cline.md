# Cline

Covers both the VS Code extension's task tree and the **Cline CLI**'s own session layout. They share nothing but the provider name and the `~/.cline/data` root, so CLI parsing lives in `src/providers/cline-cli-parser.ts` and `vscode-cline-parser.ts` (shared with Roo Code, KiloCode and IBM Bob) is untouched.

- **Source:** `src/providers/cline.ts`, `src/providers/cline-cli-parser.ts`
- **Loading:** eager (`src/providers/index.ts`)
- **Test:** `tests/providers/cline.test.ts`, `tests/providers/cline-cli.test.ts`

## Where it reads from

These roots are scanned:

1. VS Code extension globalStorage for `saoudrizwan.claude-dev`, in every supported VS Code variant: stable (`Code`), Insiders (`Code - Insiders`), and VSCodium. The per-platform paths come from `getVSCodeGlobalStoragePaths` in `src/providers/vscode-cline-parser.ts`, the same helper Roo Code and KiloCode use.
2. Cline's home-data root at `~/.cline/data`.
3. The Cline CLI's sessions root, resolved exactly as the CLI resolves it: `CLINE_SESSION_DATA_DIR` -> `<data>/sessions`, `CLINE_DATA_DIR` -> `<root>/data`, `CLINE_DIR` -> `~/.cline`.

Roots 1-2 hold `tasks/<taskId>/` directories and dedupe among themselves by task id. Root 3 holds `sessions/<sessionId>/` directories and is discovered separately, so a task and a CLI session that happen to share an id both survive. `probeRoots()` reports every root, so `codeburn doctor` can tell "not installed" from "override pointing elsewhere".

Every root is expected to contain a `tasks/` child directory. Discovery is delegated to `discoverClineTasks` in `src/providers/vscode-cline-parser.ts`, so a task is only included when it has a `ui_messages.json` file.

## Storage format

Per-task directories with:

```
tasks/<taskId>/
  ui_messages.json
  api_conversation_history.json
  task_metadata.json
```

`ui_messages.json` provides the `api_req_started` usage entries. `api_conversation_history.json` is used for model extraction. See [`vscode-cline-parser`](vscode-cline-parser.md) for the full schema description.
`task_metadata.json` is part of Cline's task layout but is not read by CodeBurn today.

## Caching

None at the provider level; delegates to the shared helper and normal parser/cache layers.

## Deduplication

Discovery deduplicates by task id across all Cline roots so a task that exists in more than one root (a migration, or the same extension storage seen by two VS Code variants) is not scanned twice. If the same task id exists in multiple roots, the one with the newest `ui_messages.json` wins. Parsing still uses the shared per-call key: `<providerName>:<taskId>:<index>`.

## Quirks

- This provider is intentionally a thin wrapper over the shared Cline-family parser.
- Cline can keep data in both VS Code globalStorage and `~/.cline/data`, depending on version and workflow.
- A user can run Cline in VS Code stable, Insiders, and VSCodium at the same time; each variant has its own globalStorage tree, so all of them must be scanned.
- If Cline changes the JSON shape, fix `vscode-cline-parser.ts` only if Roo Code and KiloCode still pass. Branch provider-specific parsing rather than duplicating the whole parser.

## When fixing a bug here

1. Reproduce with a minimal task directory containing `ui_messages.json` and `api_conversation_history.json`.
2. Run `tests/providers/cline.test.ts`, plus `tests/providers/roo-code.test.ts` and `tests/providers/kilo-code.test.ts` if the shared parser changes.
3. Keep the provider name `cline`; downstream filters and dedup keys depend on it.

## Cline CLI storage format

```
sessions/<sessionId>/
  <sessionId>.json           metadata + rolled-up usage
  <sessionId>.messages.json  per-message metrics
```

Assistant messages carry Anthropic-style content blocks plus `modelInfo` and a `metrics` block (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost`); one `metrics` block becomes one call. Dedup keys are namespaced `cline-cli:<sessionId>:<messageId>` so they can never collide with the extension's `cline:<taskId>:<index>`.

### Quirks

- **The session file's `provider` field is the upstream LLM route** (e.g. `cline-pass`), not the tool. Routed model ids arrive as `cline-pass/<slug>` and resolve through `getShortModelName`'s path fallback.
- **Cost is metered per message**, so those calls carry `costIsEstimated: false` and keep their reported cost instead of being re-priced from tokens. A metered `$0` stays reported; a missing or negative cost falls back to token pricing.
- **Rollup fallback.** A session whose messages carry no metrics emits a single call from `metadata.usage` — deliberately not `aggregateUsage`, which folds in spawned subagents that are themselves separate session directories and would double count.
- **`messages_path` is absolute** and goes stale when a session directory moves between machines, so the co-located `<sessionId>.messages.json` is preferred and `messages_path` is only a fallback.
- **Timestamps are epoch milliseconds**; a seconds-resolution value is promoted rather than landing in 1970, matching the guard `kiro.ts` uses.

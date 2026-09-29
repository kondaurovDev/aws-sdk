import * as path from "node:path"
import { Effect } from "effect"

import { renderFiles } from "../codegen/render.ts"
import { writeFiles } from "../codegen/write.ts"
import { loadConfig } from "../config/config.ts"
import { scanClient } from "../scan/scan.ts"

/** Generates Effect wrappers for the configured clients; returns their names. */
export const generate = Effect.gen(function* () {
  const config = yield* loadConfig

  if (config.clients.length === 0) {
    yield* Effect.logWarning(
      "No clients to generate: add @aws-sdk/client-* dependencies to package.json or list clients in aws-sdk.json"
    )
    return []
  }

  // Scanning is synchronous and CPU-bound, running clients concurrently gains nothing.
  const models = yield* Effect.forEach(config.clients, (client) =>
    scanClient(client, config.root).pipe(
      Effect.tap((model) => Effect.logInfo(`Scanned ${model.packageName}: ${model.commands.length} commands`))
    )
  )

  const result = yield* writeFiles(config.generateTo, renderFiles(models, { region: config.region }))

  const outDir = path.relative(config.root, config.generateTo) || "."
  yield* Effect.logInfo(
    `${outDir}: ${result.written.length} written, ${result.unchanged.length} unchanged, ${result.removed.length} removed`
  )
  for (const file of result.removed) {
    yield* Effect.logInfo(`Removed stale ${path.join(outDir, file)}`)
  }

  return models.map((model) => model.client)
}).pipe(Effect.withSpan("generate"))

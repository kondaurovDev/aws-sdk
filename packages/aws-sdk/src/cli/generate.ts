import * as path from "node:path"
import { Data, Effect, Result } from "effect"

import { renderFiles } from "../codegen/render.ts"
import { writeFiles } from "../codegen/write.ts"
import { loadConfig } from "../config/config.ts"
import {
  DYNAMODB_DOCUMENT_CLIENT,
  DYNAMODB_DOCUMENT_PACKAGE,
  S3_PRESIGNER_PACKAGE,
  type SdkModel
} from "../scan/model.ts"
import { scanClient, scanDocumentClient } from "../scan/scan.ts"

export class GenerateError extends Data.TaggedError("GenerateError")<{
  readonly message: string
}> {}

const logScanned = (model: SdkModel) =>
  Effect.logInfo(`Scanned ${model.packageName}: ${model.commands.length} commands`)

/** Generates Effect wrappers for the configured clients; returns their names. */
export const generate = Effect.gen(function* () {
  const config = yield* loadConfig

  if (config.clients.length === 0) {
    yield* Effect.logWarning(
      "No clients to generate: add @aws-sdk/client-* dependencies to package.json or list clients in aws-sdk.json"
    )
    return []
  }

  const has = (packageName: string) => config.dependencies.includes(packageName)

  // Scanning is synchronous and CPU-bound, running clients concurrently gains
  // nothing. Every client is scanned even after a failure, so one run reports
  // every problem.
  const results = yield* Effect.forEach(config.clients, (client) =>
    scanClient(client, config.root, {
      presigner: client === "s3" && has(S3_PRESIGNER_PACKAGE) ? S3_PRESIGNER_PACKAGE : undefined
    }).pipe(Effect.tap(logScanned), Effect.tapError((error) => Effect.logError(error.message)), Effect.result)
  )
  const models = results.filter(Result.isSuccess).map((result) => result.success)

  // Library clients are generated next to the client they are built on
  const dynamodb = models.find((model) => model.client === "dynamodb")
  if (has(DYNAMODB_DOCUMENT_PACKAGE) && dynamodb) {
    const document = yield* scanDocumentClient(
      { client: DYNAMODB_DOCUMENT_CLIENT, packageName: DYNAMODB_DOCUMENT_PACKAGE },
      dynamodb,
      config.root
    ).pipe(Effect.tap(logScanned), Effect.tapError((error) => Effect.logError(error.message)), Effect.result)
    results.push(document)
    if (Result.isSuccess(document)) models.push(document.success)
  } else if (has(DYNAMODB_DOCUMENT_PACKAGE)) {
    yield* Effect.logWarning(
      `${DYNAMODB_DOCUMENT_PACKAGE} is installed but the dynamodb client is not generated; add "dynamodb" to clients in aws-sdk.json`
    )
  }

  const failed = results.filter(Result.isFailure).length
  if (failed > 0) {
    return yield* new GenerateError({
      message: `${failed} of ${results.length} clients could not be scanned, nothing was generated`
    })
  }

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

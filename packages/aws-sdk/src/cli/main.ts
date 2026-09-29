#!/usr/bin/env node
import { Cause, Effect, Exit, Logger, References } from "effect"

import { generate } from "./generate.ts"

const USAGE = `Usage: gen-aws-sdk [--verbose]

Generates Effect wrappers for the @aws-sdk/client-* packages of the project in
the current directory. Configuration is read from aws-sdk.json (optional).`

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE)
} else {
  const program = generate.pipe(
    Effect.tap((clients) =>
      clients.length > 0 ? Effect.logInfo(`Generated Effect wrappers for: ${clients.join(", ")}`) : Effect.void
    ),
    // Expected failures (bad config, missing package, ...) need a message, not a stack trace
    Effect.catch((error) =>
      Effect.logError(error.message).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 1))))
    ),
    Effect.provideService(References.MinimumLogLevel, args.includes("--verbose") ? "Debug" : "Info"),
    Effect.provide(Logger.layer([Logger.consolePretty()]))
  )

  const exit = await Effect.runPromiseExit(program)
  if (Exit.isFailure(exit)) {
    console.error(Cause.pretty(exit.cause))
    process.exitCode = 1
  }
}

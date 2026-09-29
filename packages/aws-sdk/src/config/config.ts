import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { Context, Data, Effect, Option, Schema } from "effect"

import { type ConfigFile, ConfigFileSchema, DEFAULT_GENERATE_TO, PackageJsonSchema } from "./schema.ts"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Root directory of the user's project. The CLI runs against the current directory. */
export const ProjectRoot = Context.Reference<string>("@effect-ak/aws-sdk/ProjectRoot", {
  defaultValue: () => process.cwd()
})

export interface Config {
  readonly root: string
  /** Absolute path of the output directory */
  readonly generateTo: string
  /** Package suffixes: `s3` for `@aws-sdk/client-s3` */
  readonly clients: ReadonlyArray<string>
  readonly region: string | undefined
  /** Names of every dependency and devDependency in package.json, sorted */
  readonly dependencies: ReadonlyArray<string>
}

const CLIENT_PACKAGE_PREFIX = "@aws-sdk/client-"

const toClientName = (nameOrPackage: string) =>
  nameOrPackage.startsWith(CLIENT_PACKAGE_PREFIX)
    ? nameOrPackage.slice(CLIENT_PACKAGE_PREFIX.length)
    : nameOrPackage

const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

const readTextFile = (file: string) =>
  Effect.tryPromise({
    try: () => readFile(file, "utf-8"),
    catch: (cause) => cause
  }).pipe(
    Effect.map(Option.some),
    Effect.catchIf(isNotFound, () => Effect.succeed(Option.none<string>())),
    Effect.mapError((cause) => new ConfigError({ message: `Cannot read ${file}`, cause }))
  )

const invalidFile = (file: string) => (cause: Schema.SchemaError) =>
  new ConfigError({ message: `Invalid ${file}: ${cause.message}`, cause })

// Unknown keys are most likely typos (`generateTo`), so they are rejected
const decodeConfigFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ConfigFileSchema), {
  onExcessProperty: "error"
})
const decodePackageJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PackageJsonSchema))

/** Reads `aws-sdk.json` (optional) and `package.json` from the project root. */
export const loadConfig: Effect.Effect<Config, ConfigError> = Effect.gen(function* () {
  const root = yield* ProjectRoot

  const configFilePath = path.join(root, "aws-sdk.json")
  const configFile = yield* readTextFile(configFilePath).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeed<ConfigFile>({}),
      onSome: (text) => decodeConfigFile(text).pipe(Effect.mapError(invalidFile(configFilePath)))
    }))
  )

  const packageJsonPath = path.join(root, "package.json")
  const packageJson = yield* readTextFile(packageJsonPath).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.fail(new ConfigError({ message: `${packageJsonPath} not found` })),
      onSome: (text) => decodePackageJson(text).pipe(Effect.mapError(invalidFile(packageJsonPath)))
    }))
  )

  const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies }

  const effectVersion = dependencies["effect"]
  if (typeof effectVersion === "string" && /^\D*3\./.test(effectVersion)) {
    yield* Effect.logWarning(
      `The project depends on effect@${effectVersion}, but the generated code requires Effect 4. ` +
        "Use @effect-ak/aws-sdk@1 with Effect 3."
    )
  }

  const dependencyNames = Object.keys(dependencies).sort()
  const installedClients = dependencyNames
    .filter((name) => name.startsWith(CLIENT_PACKAGE_PREFIX))
    .map(toClientName)

  const config: Config = {
    root,
    generateTo: path.resolve(root, configFile.generate_to ?? DEFAULT_GENERATE_TO),
    clients: configFile.clients ? [...new Set(configFile.clients.map(toClientName))] : installedClients,
    region: configFile.global?.region,
    dependencies: dependencyNames
  }

  yield* Effect.logDebug("Resolved configuration", config)

  return config
}).pipe(Effect.withSpan("loadConfig"))

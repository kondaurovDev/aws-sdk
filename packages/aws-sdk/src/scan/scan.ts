import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { Data, Effect } from "effect"
import * as Morph from "ts-morph"

import { clientPackageName, type SdkCommand, type SdkModel } from "./model.ts"
import { makeMethodName } from "./naming.ts"

export class ScanError extends Data.TaggedError("ScanError")<{
  readonly client: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Finds an installed package the way Node resolves bare specifiers: looks into
 * `node_modules` of `root` and of every parent directory, so hoisted and
 * workspace installs are found as well.
 */
export const findPackageDir = (root: string, packageName: string): string | undefined => {
  let dir = path.resolve(root)
  while (true) {
    const candidate = path.join(dir, "node_modules", packageName)
    if (existsSync(path.join(candidate, "package.json"))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Scans the type declarations of `@aws-sdk/client-<client>` installed for `root`. */
export const scanClient = Effect.fn("scanClient")(function* (client: string, root: string) {
  const packageName = clientPackageName(client)
  const packageDir = findPackageDir(root, packageName)
  if (!packageDir) {
    return yield* new ScanError({
      client,
      message: `${packageName} is not installed (looked in node_modules from ${root} upwards)`
    })
  }
  const sourceFiles = yield* Effect.try({
    try: () => loadDeclarations(packageDir),
    catch: (cause) =>
      new ScanError({ client, message: `Cannot read type declarations of ${packageName}`, cause })
  })
  return yield* extractModel(client, sourceFiles)
})

const loadDeclarations = (packageDir: string): Array<Morph.SourceFile> => {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8"))
  const types = manifest.types ?? manifest.typings
  const typesDir = typeof types === "string" ? path.dirname(path.join(packageDir, types)) : packageDir
  const glob = typesDir.split(path.sep).join("/")
  const project = new Morph.Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  })
  return project.addSourceFilesAtPaths([
    `${glob}/**/*.d.ts`,
    // Downleveled copies of the same declarations for TypeScript < 4.5
    `!${glob}/**/ts3.4/**`,
    `!${glob}/**/node_modules/**`
  ])
}

const throwsRegex = /@throws\s+\{@link\s+([^}\s]+)\s*\}/g

export const extractModel = (
  client: string,
  sourceFiles: ReadonlyArray<Morph.SourceFile>
): Effect.Effect<SdkModel, ScanError> =>
  Effect.gen(function* () {
    const packageName = clientPackageName(client)
    const fail = (message: string) => new ScanError({ client, message: `${packageName}: ${message}` })

    const classes = sourceFiles.flatMap((file) => file.getClasses())
    const interfaces = sourceFiles.flatMap((file) => file.getInterfaces())

    const clientClass = classes.find((cls) => {
      const name = cls.getName()
      return name?.endsWith("Client") && cls.getSourceFile().getBaseName() === `${name}.d.ts`
    })
    const clientClassName = clientClass?.getName()
    if (!clientClassName) return yield* fail("client class not found")

    const configInterfaceName = `${clientClassName}Config`
    if (!interfaces.some((iface) => iface.getName() === configInterfaceName)) {
      return yield* fail(`${configInterfaceName} interface not found`)
    }

    const serviceExceptionName = classes
      .map((cls) => cls.getName())
      .find((name) => name?.endsWith("ServiceException"))
    if (!serviceExceptionName) return yield* fail("service exception class not found")

    const exceptions = new Set<string>()
    for (const cls of classes) {
      const name = cls.getName()
      const base = cls.getExtends()?.getExpression().getText()
      if (name && name !== serviceExceptionName && base?.endsWith("Exception")) {
        exceptions.add(name)
      }
    }

    const commands = new Map<string, SdkCommand>()
    for (const cls of classes) {
      const className = cls.getName()
      if (!className?.endsWith("Command") || className === "Command") continue
      if (!cls.getSourceFile().getFilePath().includes("/commands/")) continue

      const name = className.slice(0, -"Command".length)
      const method = makeMethodName(name)
      if (commands.has(method)) continue

      const docs = cls.getLeadingCommentRanges().map((range) => range.getText()).join("\n")
      const errors = [...docs.matchAll(throwsRegex)]
        .map((match) => match[1]!)
        .filter((error) => exceptions.has(error))

      commands.set(method, { name, method, errors: [...new Set(errors)].sort() })
    }
    if (commands.size === 0) return yield* fail("no commands found")

    return {
      client,
      packageName,
      clientClassName,
      configInterfaceName,
      serviceExceptionName,
      exceptions: [...exceptions].sort(),
      commands: [...commands.values()].sort((a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : 0))
    }
  })

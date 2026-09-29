import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { Data, Effect } from "effect"
import * as Morph from "ts-morph"

import { summarizeDocs } from "./docs.ts"
import {
  clientPackageName,
  type SdkBase,
  type SdkCommand,
  type SdkModel,
  type SdkPaginator,
  type SdkWaiter
} from "./model.ts"
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

export interface ScanOptions {
  /** Package providing `getSignedUrl` for the client; the generated `presign` imports it */
  readonly presigner?: string | undefined
}

/** Scans the type declarations of `@aws-sdk/client-<client>` installed for `root`. */
export const scanClient = Effect.fn("scanClient")(function* (client: string, root: string, options?: ScanOptions) {
  const sourceFiles = yield* loadPackage(client, clientPackageName(client), root)
  return yield* extractModel(client, sourceFiles, options)
})

export interface DocumentClientSpec {
  /** Module name: `dynamodb-document` */
  readonly client: string
  /** `@aws-sdk/lib-dynamodb` */
  readonly packageName: string
}

/**
 * Scans a library client built on top of `base`, like `@aws-sdk/lib-dynamodb`
 * on `@aws-sdk/client-dynamodb`: its commands delegate to base commands and
 * raise the base exceptions.
 */
export const scanDocumentClient = Effect.fn("scanDocumentClient")(function* (
  spec: DocumentClientSpec,
  base: SdkModel,
  root: string
) {
  const sourceFiles = yield* loadPackage(spec.client, spec.packageName, root)
  return yield* extractDocumentModel(spec, base, sourceFiles)
})

const loadPackage = (client: string, packageName: string, root: string) =>
  Effect.gen(function* () {
    const packageDir = findPackageDir(root, packageName)
    if (!packageDir) {
      return yield* new ScanError({
        client,
        message: `${packageName} is not installed (looked in node_modules from ${root} upwards)`
      })
    }
    return yield* Effect.try({
      try: () => loadDeclarations(packageDir),
      catch: (cause) =>
        new ScanError({ client, message: `Cannot read type declarations of ${packageName}`, cause })
    })
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

const baseClassOf = (cls: Morph.ClassDeclaration) => cls.getExtends()?.getExpression().getText()

const isIn = (dir: string) => (node: Morph.Node) => node.getSourceFile().getFilePath().includes(`/${dir}/`)

const byMethod = <T extends { readonly method: string }>(a: T, b: T) =>
  a.method < b.method ? -1 : a.method > b.method ? 1 : 0

/** The bare client extends smithy's `Client`, imported as `__Client`. */
const findClientClass = (classes: ReadonlyArray<Morph.ClassDeclaration>) =>
  classes.find((cls) => baseClassOf(cls) === "__Client" || baseClassOf(cls) === "Client")

const docsOf = (cls: Morph.ClassDeclaration) => summarizeDocs(cls.getJsDocs().at(-1)?.getDescription())

/** Exported `paginate<Command>` functions whose command is a known method. */
const extractPaginators = (
  sourceFiles: ReadonlyArray<Morph.SourceFile>,
  methods: ReadonlySet<string>
): Array<SdkPaginator> => {
  const paginators = new Map<string, SdkPaginator>()
  for (const file of sourceFiles.filter(isIn("pagination"))) {
    for (const declaration of file.getVariableDeclarations()) {
      const functionName = declaration.getName()
      if (!functionName.startsWith("paginate")) continue
      const method = makeMethodName(functionName.slice("paginate".length))
      if (methods.has(method)) paginators.set(method, { method, functionName })
    }
  }
  return [...paginators.values()].sort(byMethod)
}

/** Exported `waitUntil<Condition>` functions. */
const extractWaiters = (sourceFiles: ReadonlyArray<Morph.SourceFile>): Array<SdkWaiter> => {
  const waiters = new Map<string, SdkWaiter>()
  for (const file of sourceFiles.filter(isIn("waiters"))) {
    for (const declaration of file.getVariableDeclarations()) {
      const functionName = declaration.getName()
      if (!functionName.startsWith("waitUntil")) continue
      const method = makeMethodName(functionName.slice("waitUntil".length))
      waiters.set(method, { method, functionName })
    }
  }
  return [...waiters.values()].sort(byMethod)
}

export const extractModel = (
  client: string,
  sourceFiles: ReadonlyArray<Morph.SourceFile>,
  options?: ScanOptions
): Effect.Effect<SdkModel, ScanError> =>
  Effect.gen(function* () {
    const packageName = clientPackageName(client)
    const fail = (message: string) => new ScanError({ client, message: `${packageName}: ${message}` })

    const classes = sourceFiles.flatMap((file) => file.getClasses())
    const interfaces = sourceFiles.flatMap((file) => file.getInterfaces())

    // Names are not reliable: the aggregated `WorkSpacesThinClient` also ends
    // with "Client" and lives in a file of its own.
    const clientClassName = findClientClass(classes)?.getName()
    if (!clientClassName) return yield* fail("client class not found")

    const configInterfaceName = `${clientClassName}Config`
    if (!interfaces.some((iface) => iface.getName() === configInterfaceName)) {
      return yield* fail(`${configInterfaceName} interface not found`)
    }

    // The base of every modeled error extends smithy's `ServiceException`.
    // Modeled errors like Connect's `InternalServiceException` share the suffix.
    const serviceExceptionName = classes
      .find((cls) => baseClassOf(cls) === "__ServiceException" || baseClassOf(cls) === "ServiceException")
      ?.getName()
    if (!serviceExceptionName) return yield* fail("service exception class not found")

    const exceptions = new Set<string>()
    for (const cls of classes) {
      const name = cls.getName()
      if (name && name !== serviceExceptionName && baseClassOf(cls)?.endsWith("Exception")) {
        exceptions.add(name)
      }
    }

    const commands = new Map<string, SdkCommand>()
    for (const cls of classes.filter(isIn("commands"))) {
      const className = cls.getName()
      if (!className?.endsWith("Command") || className === "Command") continue

      const name = className.slice(0, -"Command".length)
      const method = makeMethodName(name)
      if (commands.has(method)) continue

      const comments = cls.getLeadingCommentRanges().map((range) => range.getText()).join("\n")
      const errors = [...comments.matchAll(throwsRegex)]
        .map((match) => match[1]!)
        .filter((error) => exceptions.has(error))

      commands.set(method, { name, method, errors: [...new Set(errors)].sort(), docs: docsOf(cls) })
    }
    if (commands.size === 0) return yield* fail("no commands found")

    return {
      client,
      packageName,
      clientClassName,
      configInterfaceName,
      serviceExceptionName,
      exceptions: [...exceptions].sort(),
      commands: [...commands.values()].sort(byMethod),
      paginators: extractPaginators(sourceFiles, new Set(commands.keys())),
      waiters: extractWaiters(sourceFiles),
      presigner: options?.presigner,
      base: undefined
    }
  })

export const extractDocumentModel = (
  spec: DocumentClientSpec,
  base: SdkModel,
  sourceFiles: ReadonlyArray<Morph.SourceFile>
): Effect.Effect<SdkModel, ScanError> =>
  Effect.gen(function* () {
    const fail = (message: string) =>
      new ScanError({ client: spec.client, message: `${spec.packageName}: ${message}` })

    const classes = sourceFiles.flatMap((file) => file.getClasses())

    const clientClass = findClientClass(classes)
    const clientClassName = clientClass?.getName()
    if (!clientClass || !clientClassName) return yield* fail("client class not found")

    // `static from(client: DynamoDBClient, translateConfig?: TranslateConfig)`
    const configInterfaceName = clientClass.getStaticMethod("from")?.getParameters()[1]?.getTypeNode()?.getText()
    if (!configInterfaceName) return yield* fail(`${clientClassName}.from(client, config) not found`)

    const baseCommands = new Map(base.commands.map((command) => [command.name, command]))
    const commands = new Map<string, SdkCommand>()
    for (const cls of classes.filter(isIn("commands"))) {
      const className = cls.getName()
      if (!className?.endsWith("Command") || className === "Command") continue

      // `protected readonly clientCommand: __GetItemCommand` names the base command
      const delegate = cls.getProperty("clientCommand")?.getTypeNode()?.getText()
      if (!delegate) continue
      const baseCommand = baseCommands.get(delegate.replace(/^__/, "").replace(/Command$/, ""))

      const name = className.slice(0, -"Command".length)
      const method = makeMethodName(name)
      if (commands.has(method)) continue

      commands.set(method, {
        name,
        method,
        errors: baseCommand?.errors ?? [],
        docs: baseCommand?.docs ?? docsOf(cls)
      })
    }
    if (commands.size === 0) return yield* fail("no commands found")

    const baseRef: SdkBase = {
      client: base.client,
      packageName: base.packageName,
      clientClassName: base.clientClassName
    }

    return {
      client: spec.client,
      packageName: spec.packageName,
      clientClassName,
      configInterfaceName,
      serviceExceptionName: base.serviceExceptionName,
      exceptions: base.exceptions,
      commands: [...commands.values()].sort(byMethod),
      paginators: extractPaginators(sourceFiles, new Set(commands.keys())),
      waiters: [],
      presigner: undefined,
      base: baseRef
    }
  })

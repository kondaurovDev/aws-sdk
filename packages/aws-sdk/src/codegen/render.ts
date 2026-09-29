import { renderJsDoc } from "../scan/docs.ts"
import type { SdkCommand, SdkModel } from "../scan/model.ts"
import { makeNamespaceName } from "../scan/naming.ts"

/** First line of every generated file; stale files are recognized by it. */
export const GENERATED_MARKER = "// *****  GENERATED CODE *****"

export interface GeneratedFile {
  /** Path relative to the output directory */
  readonly path: string
  readonly content: string
}

export interface RenderOptions {
  /** Default region of every client layer */
  readonly region: string | undefined
}

export const renderFiles = (
  models: ReadonlyArray<SdkModel>,
  options: RenderOptions
): Array<GeneratedFile> => [
  ...models.map((model) => ({ path: `${model.client}.ts`, content: renderClient(model, options) })),
  { path: "index.ts", content: renderIndex(models) }
]

const header = (source: string) =>
  `${GENERATED_MARKER}\n// Source: ${source}. Do not edit, run \`gen-aws-sdk\` to regenerate.\n`

const lines = (items: ReadonlyArray<string>, indent: string) =>
  items.map((item) => `${indent}${item}`).join("\n")

/** `S3Client` -> `S3` */
const serviceName = (model: SdkModel) => model.clientClassName.slice(0, -"Client".length)

const literalUnion = (values: ReadonlyArray<string>) =>
  values.length === 0 ? "never" : values.map((value) => JSON.stringify(value)).join(" | ")

const apiEntry = (command: SdkCommand) => {
  const entry = `${command.method}: [Sdk.${command.name}CommandInput, Sdk.${command.name}CommandOutput, ${literalUnion(command.errors)}]`
  return command.docs ? `${renderJsDoc(command.docs, "  ")}\n  ${entry}` : `  ${entry}`
}

export const renderClient = (model: SdkModel, options: RenderOptions): string => {
  const name = serviceName(model)
  const ns = makeNamespaceName(model.client)
  // A document client raises the exceptions of the client it is built on
  const Errors = model.base ? "Base" : "Sdk"
  const firstMethod = model.commands[0]?.method ?? "command"

  const imports = [
    `import * as Sdk from "${model.packageName}"`,
    ...(model.base ? [`import * as Base from "${model.base.packageName}"`] : []),
    ...(model.presigner ? [`import { getSignedUrl } from "${model.presigner}"`] : []),
    `import * as Context from "effect/Context"`,
    `import * as Data from "effect/Data"`,
    ...(model.waiters.length > 0 ? [`import * as Duration from "effect/Duration"`] : []),
    `import * as Effect from "effect/Effect"`,
    `import * as Layer from "effect/Layer"`,
    ...(model.paginators.length > 0 ? [`import * as Stream from "effect/Stream"`] : []),
    ...(model.base ? [``, `import { ${model.base.clientClassName} } from "./${model.base.client}.js"`] : [])
  ]

  const clientConfig = options.region
    ? `{ region: ${JSON.stringify(options.region)}, ...config }`
    : "config ?? {}"

  const service = model.base
    ? `/** The \`${model.packageName}\` client, provided by {@link ${name}Client.layer}. */
export class ${name}Client extends Context.Service<${name}Client, Sdk.${model.clientClassName}>()(
  "@effect-ak/aws-sdk/${name}Client"
) {
  /**
   * Wraps the ${model.base.clientClassName} from the context. Its lifecycle stays
   * with that client's layer.
   */
  static readonly layer = (
    config?: Sdk.${model.configInterfaceName}
  ): Layer.Layer<${name}Client, never, ${model.base.clientClassName}> =>
    Layer.effect(
      ${name}Client,
      Effect.map(${model.base.clientClassName}, (client) => Sdk.${model.clientClassName}.from(client, config))
    )
}`
    : `/** The \`${model.packageName}\` client, provided by {@link ${name}Client.layer}. */
export class ${name}Client extends Context.Service<${name}Client, Sdk.${model.clientClassName}>()(
  "@effect-ak/aws-sdk/${name}Client"
) {
  /**
   * Creates the SDK client when the layer is built and destroys it when the
   * layer is released.
   */
  static readonly layer = (config?: Sdk.${model.configInterfaceName}): Layer.Layer<${name}Client> =>
    Layer.effect(
      ${name}Client,
      Effect.acquireRelease(
        Effect.sync(() => new Sdk.${model.clientClassName}(${clientConfig})),
        (client) => Effect.sync(() => client.destroy())
      )
    )
}`

  const core = `
/** Every modeled ${name} service exception, by name. */
export type ${name}Errors = {
${lines(model.exceptions.map((error) => `${error}: ${Errors}.${error}`), "  ")}
}

/** [input, output, documented exception names] of every ${name} command. */
type ${name}Api = {
${model.commands.map(apiEntry).join("\n")}
}

export type ${name}Method = keyof ${name}Api
export type ${name}MethodInput<M extends ${name}Method> = ${name}Api[M][0]
export type ${name}MethodOutput<M extends ${name}Method> = ${name}Api[M][1]
/** Names of the exceptions documented for method \`M\`. */
export type ${name}MethodError<M extends ${name}Method> = ${name}Api[M][2]
/** The input may be omitted when none of its fields is required. */
export type ${name}MethodArgs<M extends ${name}Method, Options = never> = {} extends ${name}MethodInput<M>
  ? [input?: ${name}MethodInput<M>, ...options: [Options] extends [never] ? [] : [options?: Options]]
  : [input: ${name}MethodInput<M>, ...options: [Options] extends [never] ? [] : [options?: Options]]

/**
 * A modeled ${name} service exception raised by {@link make}. Failures outside
 * of the service model (network, credentials, ...) are defects.
 */
export class ${name}Error<M extends ${name}Method = ${name}Method> extends Data.TaggedError("${name}Error")<{
  readonly message: string
  readonly cause: ${Errors}.${model.serviceExceptionName}
  readonly command: ${name}Method
}> {
  declare readonly command: M

  /** Narrows to one of the exceptions documented for the failed command. */
  $is<N extends ${name}MethodError<M>>(
    name: N
  ): this is ${name}Error<M> & { readonly cause: ${name}Errors[N & keyof ${name}Errors] } {
    return this.cause.name === name
  }

  /** Narrows to any modeled ${name} exception. */
  is<N extends keyof ${name}Errors>(name: N): this is ${name}Error<M> & { readonly cause: ${name}Errors[N] } {
    return this.cause.name === name
  }

  /** The SDK marks the exception as retryable: throttling or a transient server error. */
  get isRetryable(): boolean {
    return this.cause.$retryable !== undefined
  }

  /** The request was throttled; retry with backoff. */
  get isThrottling(): boolean {
    return this.cause.$retryable?.throttling === true
  }

  /** Whether the client (4xx) or the service (5xx) is at fault, per the SDK. */
  get fault(): "client" | "server" {
    return this.cause.$fault
  }

  get statusCode(): number | undefined {
    return this.cause.$metadata.httpStatusCode
  }

  get requestId(): string | undefined {
    return this.cause.$metadata.requestId
  }
}

const to${name}Error = <M extends ${name}Method>(command: M, cause: unknown): ${name}Error<M> => {
  if (cause instanceof ${Errors}.${model.serviceExceptionName}) {
    return new ${name}Error<M>({ message: \`\${command}: \${cause.name}: \${cause.message}\`, cause, command })
  }
  // Rethrowing turns anything outside the service model into a defect
  throw cause
}

const ${name}Commands: { readonly [M in ${name}Method]: new (input: ${name}MethodInput<M>) => unknown } = {
${lines(model.commands.map((command) => `${command.method}: Sdk.${command.name}Command,`), "  ")}
}

/**
 * Runs the given ${name} command. Interrupting the effect aborts the HTTP request.
 *
 * @example
 * \`\`\`ts
 * import { ${ns} } from "./generated/index.js"
 *
 * const program = ${ns}.make("${firstMethod}", { ... }).pipe(
 *   Effect.provide(${ns}.${name}Client.layer())
 * )
 * \`\`\`
 */
export const make = <M extends ${name}Method>(
  command: M,
  ...[input]: ${name}MethodArgs<M>
): Effect.Effect<${name}MethodOutput<M>, ${name}Error<M>, ${name}Client> =>
  Effect.gen(function* () {
    const client = yield* ${name}Client
    const sdkCommand = new ${name}Commands[command]((input ?? {}) as ${name}MethodInput<M>)
    return yield* Effect.tryPromise({
      try: (signal) =>
        client.send(sdkCommand as Parameters<typeof client.send>[0], {
          abortSignal: signal
        }) as Promise<${name}MethodOutput<M>>,
      catch: (cause) => to${name}Error(command, cause)
    })
  }).pipe(
    Effect.withSpan(\`${name}.\${command}\`, {
      attributes: { "rpc.system": "aws-api", "rpc.service": "${name}", "rpc.method": command }
    })
  )
`

  const paginate = model.paginators.length === 0 ? "" : `
export type ${name}Paginated = ${literalUnion(model.paginators.map((paginator) => paginator.method))}

/** Configuration shared by the SDK paginators of this client */
type ${name}PaginatorConfig = Parameters<typeof Sdk.${model.paginators[0]!.functionName}>[0]

const ${name}Paginators: {
  readonly [M in ${name}Paginated]: (
    config: ${name}PaginatorConfig,
    input: ${name}MethodInput<M>,
    ...rest: Array<any>
  ) => AsyncIterable<${name}MethodOutput<M>>
} = {
${lines(model.paginators.map((paginator) => `${paginator.method}: Sdk.${paginator.functionName},`), "  ")}
}

export interface ${name}PaginateOptions {
  /** Items per page, when the command supports a page size */
  readonly pageSize?: number
  /** Token of the page to start from */
  readonly startingToken?: unknown
  /** Stop when the service keeps returning the same token instead of omitting it */
  readonly stopOnSameToken?: boolean
}

/**
 * Streams the pages of a paginated ${name} command, one output per page.
 * Interrupting the stream aborts the request in flight.
 *
 * @example
 * \`\`\`ts
 * const items = ${ns}.paginate("${model.paginators[0]!.method}", { ... }).pipe(
 *   Stream.flatMap((page) => Stream.fromIterable(page.Items ?? [])),
 *   Stream.runCollect
 * )
 * \`\`\`
 */
export const paginate = <M extends ${name}Paginated>(
  command: M,
  ...[input, options]: ${name}MethodArgs<M, ${name}PaginateOptions>
): Stream.Stream<${name}MethodOutput<M>, ${name}Error<M>, ${name}Client> =>
  Stream.unwrap(
    Effect.map(${name}Client, (client) => {
      const controller = new AbortController()
      const pages = ${name}Paginators[command](
        { client, ...options },
        (input ?? {}) as ${name}MethodInput<M>,
        { abortSignal: controller.signal }
      )
      return Stream.fromAsyncIterable(abortable(pages, controller), (cause) => cause).pipe(
        Stream.catch((cause) =>
          cause instanceof ${Errors}.${model.serviceExceptionName}
            ? Stream.fail(to${name}Error(command, cause))
            : Stream.die(cause)
        )
      )
    })
  )

/** Aborts the request in flight when the consumer stops iterating. */
const abortable = <A>(pages: AsyncIterable<A>, controller: AbortController): AsyncIterable<A> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = pages[Symbol.asyncIterator]()
    return {
      next: () => iterator.next(),
      return: () => {
        controller.abort()
        // Not awaited: the SDK generator's \`return\` waits for the aborted request to settle
        void iterator.return?.().catch(() => {})
        return Promise.resolve({ done: true, value: undefined })
      }
    }
  }
})
`

  const waitUntil = model.waiters.length === 0 ? "" : `
export type ${name}Waiter = ${literalUnion(model.waiters.map((waiter) => waiter.method))}

type ${name}WaiterInputs = {
${lines(model.waiters.map((waiter) => `${waiter.method}: Parameters<typeof Sdk.${waiter.functionName}>[1]`), "  ")}
}

export type ${name}WaiterInput<W extends ${name}Waiter> = ${name}WaiterInputs[W]

interface ${name}WaiterParams {
  readonly client: Sdk.${model.clientClassName}
  readonly maxWaitTime: number
  readonly minDelay?: number
  readonly maxDelay?: number
  readonly abortSignal?: AbortSignal
}

const ${name}Waiters: {
  readonly [W in ${name}Waiter]: (params: ${name}WaiterParams, input: ${name}WaiterInput<W>) => Promise<unknown>
} = {
${lines(model.waiters.map((waiter) => `${waiter.method}: Sdk.${waiter.functionName},`), "  ")}
}

export interface ${name}WaitOptions {
  /** Give up after this long. The SDK polls with backoff in between. */
  readonly maxWaitTime: Duration.Input
  readonly minDelay?: Duration.Input
  readonly maxDelay?: Duration.Input
}

/** The awaited state was not reached. */
export class ${name}WaiterError<W extends ${name}Waiter = ${name}Waiter> extends Data.TaggedError("${name}WaiterError")<{
  readonly message: string
  readonly waiter: ${name}Waiter
  /** \`TIMEOUT\` after \`maxWaitTime\`; \`FAILURE\` when a state the waiter cannot recover from was observed */
  readonly state: "TIMEOUT" | "FAILURE"
  /** The last response or exception the SDK observed, when it reported one */
  readonly reason: unknown
  readonly cause: Error
}> {
  declare readonly waiter: W
}

const to${name}WaiterError = <W extends ${name}Waiter>(waiter: W, cause: unknown): ${name}WaiterError<W> => {
  // The waiter only aborts when the effect is interrupted; an invalid
  // configuration (maxWaitTime below minDelay, ...) is a defect
  if (!(cause instanceof Error) || cause.name === "AbortError" || cause.message.startsWith("WaiterConfiguration.")) {
    throw cause
  }
  // The SDK serializes the final waiter result into the message
  let details: { readonly state?: unknown; readonly reason?: unknown } = {}
  try {
    details = JSON.parse(cause.message)
  } catch {}
  const state = cause.name === "TimeoutError" || details.state === "TIMEOUT" ? "TIMEOUT" : "FAILURE"
  return new ${name}WaiterError<W>({
    message: state === "TIMEOUT" ? \`\${waiter}: not reached within maxWaitTime\` : \`\${waiter}: cannot be reached\`,
    waiter,
    state,
    reason: details.reason,
    cause
  })
}

const ${name}WaiterDelays = (options: ${name}WaitOptions) => ({
  maxWaitTime: Duration.toSeconds(options.maxWaitTime),
  ...(options.minDelay !== undefined && { minDelay: Duration.toSeconds(options.minDelay) }),
  ...(options.maxDelay !== undefined && { maxDelay: Duration.toSeconds(options.maxDelay) })
})

/**
 * Polls with the SDK waiter until the awaited state is reached. Interrupting
 * the effect stops polling and aborts the request in flight.
 *
 * @example
 * \`\`\`ts
 * yield* ${ns}.waitUntil("${model.waiters[0]!.method}", { ... }, { maxWaitTime: "2 minutes" })
 * \`\`\`
 */
export const waitUntil = <W extends ${name}Waiter>(
  waiter: W,
  input: ${name}WaiterInput<W>,
  options: ${name}WaitOptions
): Effect.Effect<void, ${name}WaiterError<W>, ${name}Client> =>
  Effect.gen(function* () {
    const client = yield* ${name}Client
    yield* Effect.tryPromise({
      try: (signal) => ${name}Waiters[waiter]({ client, abortSignal: signal, ...${name}WaiterDelays(options) }, input),
      catch: (cause) => to${name}WaiterError(waiter, cause)
    })
  }).pipe(Effect.withSpan(\`${name}.waitUntil.\${waiter}\`))
`

  const presign = !model.presigner ? "" : `
export type ${name}PresignOptions = NonNullable<Parameters<typeof getSignedUrl>[2]>

type ${name}PresignCommand = Parameters<
  typeof getSignedUrl<Sdk.ServiceInputTypes, Sdk.ServiceInputTypes, Sdk.ServiceOutputTypes>
>[1]

/**
 * Creates a presigned URL for a ${name} command without calling AWS. The URL
 * expires after \`expiresIn\` seconds, 15 minutes by default. Failures, such
 * as missing credentials, are defects.
 */
export const presign = <M extends ${name}Method>(
  command: M,
  ...[input, options]: ${name}MethodArgs<M, ${name}PresignOptions>
): Effect.Effect<string, never, ${name}Client> =>
  Effect.gen(function* () {
    const client = yield* ${name}Client
    const sdkCommand = new ${name}Commands[command]((input ?? {}) as ${name}MethodInput<M>)
    return yield* Effect.promise(() => getSignedUrl(client, sdkCommand as ${name}PresignCommand, options))
  })
`

  return `${header(model.packageName)}
${imports.join("\n")}

${service}
${core}${paginate}${waitUntil}${presign}`
}

export const renderIndex = (models: ReadonlyArray<SdkModel>): string => {
  const clients = models.map((model) => ({
    ns: makeNamespaceName(model.client),
    service: `${serviceName(model)}Client`,
    model
  }))
  const base = clients.filter(({ model }) => !model.base)
  const derived = clients.filter(({ model }) => model.base)

  const layers = (items: typeof clients, indent: string) =>
    lines(items.map(({ ns, service }) => `${ns}.${service}.layer(config?.${ns}),`), indent)

  const makeClients = derived.length === 0
    ? `export const makeClients = (config?: ClientsConfig) =>
  Layer.mergeAll(
${layers(base, "    ")}
  )`
    : `export const makeClients = (config?: ClientsConfig) =>
  Layer.provideMerge(
    Layer.mergeAll(
${layers(derived, "      ")}
    ),
    Layer.mergeAll(
${layers(base, "      ")}
    )
  )`

  return `${header("aws-sdk.json")}
${lines(clients.map(({ model }) => `import type { ${model.configInterfaceName} } from "${model.packageName}"`), "")}
import * as Layer from "effect/Layer"

${lines(clients.map(({ ns, model }) => `import * as ${ns} from "./${model.client}.js"`), "")}

export { ${clients.map(({ ns }) => ns).join(", ")} }

export interface ClientsConfig {
${lines(clients.map(({ ns, model }) => `readonly ${ns}?: ${model.configInterfaceName}`), "  ")}
}

/** A single layer providing every generated client. */
${makeClients}
`
}

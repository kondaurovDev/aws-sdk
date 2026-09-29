import type { SdkModel } from "../scan/model.ts"
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

export const renderClient = (model: SdkModel, options: RenderOptions): string => {
  const name = serviceName(model)
  const ns = makeNamespaceName(model.client)
  const clientConfig = options.region
    ? `{ region: ${JSON.stringify(options.region)}, ...config }`
    : "config ?? {}"
  const errorUnion = (errors: ReadonlyArray<string>) =>
    errors.length === 0 ? "never" : errors.map((error) => JSON.stringify(error)).join(" | ")

  return `${header(model.packageName)}
import * as Sdk from "${model.packageName}"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/** The \`${model.packageName}\` client, provided by {@link ${name}Client.layer}. */
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
}

/** Every modeled ${name} service exception, by name. */
export type ${name}Errors = {
${lines(model.exceptions.map((error) => `${error}: Sdk.${error}`), "  ")}
}

/** [input, output, documented exception names] of every ${name} command. */
type ${name}Api = {
${lines(
  model.commands.map((command) =>
    `${command.method}: [Sdk.${command.name}CommandInput, Sdk.${command.name}CommandOutput, ${errorUnion(command.errors)}]`
  ),
  "  "
)}
}

export type ${name}Method = keyof ${name}Api
export type ${name}MethodInput<M extends ${name}Method> = ${name}Api[M][0]
export type ${name}MethodOutput<M extends ${name}Method> = ${name}Api[M][1]
/** The input may be omitted when none of its fields is required. */
export type ${name}MethodArgs<M extends ${name}Method> = {} extends ${name}MethodInput<M>
  ? [input?: ${name}MethodInput<M>]
  : [input: ${name}MethodInput<M>]
/** Names of the exceptions documented for method \`M\`. */
export type ${name}MethodError<M extends ${name}Method> = ${name}Api[M][2]

/**
 * A modeled ${name} service exception raised by {@link make}. Failures outside
 * of the service model (network, credentials, ...) are defects.
 */
export class ${name}Error<M extends ${name}Method = ${name}Method> extends Data.TaggedError("${name}Error")<{
  readonly message: string
  readonly cause: Sdk.${model.serviceExceptionName}
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
 * const program = ${ns}.make("${model.commands[0]?.method ?? "command"}", { ... }).pipe(
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
      catch: (cause) => {
        if (cause instanceof Sdk.${model.serviceExceptionName}) {
          return new ${name}Error<M>({ message: \`\${command}: \${cause.name}: \${cause.message}\`, cause, command })
        }
        // Rethrowing from \`catch\` turns the failure into a defect
        throw cause
      }
    })
  }).pipe(
    Effect.withSpan(\`${name}.\${command}\`, {
      attributes: { "rpc.system": "aws-api", "rpc.service": "${name}", "rpc.method": command }
    })
  )
`
}

export const renderIndex = (models: ReadonlyArray<SdkModel>): string => {
  const clients = models.map((model) => ({
    ns: makeNamespaceName(model.client),
    service: `${serviceName(model)}Client`,
    model
  }))

  return `${header("aws-sdk.json")}
${lines(clients.map(({ model }) => `import type { ${model.configInterfaceName} } from "${model.packageName}"`), "")}
import * as Layer from "effect/Layer"

${lines(clients.map(({ ns, model }) => `import * as ${ns} from "./${model.client}.js"`), "")}

export { ${clients.map(({ ns }) => ns).join(", ")} }

export interface ClientsConfig {
${lines(clients.map(({ ns, model }) => `readonly ${ns}?: ${model.configInterfaceName}`), "  ")}
}

/** A single layer providing every generated client. */
export const makeClients = (config?: ClientsConfig) =>
  Layer.mergeAll(
${lines(clients.map(({ ns, service }) => `${ns}.${service}.layer(config?.${ns}),`), "    ")}
  )
`
}

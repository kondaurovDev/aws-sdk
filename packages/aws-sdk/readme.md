# @effect-ak/aws-sdk

Generates [Effect](https://effect.website/) wrappers for the AWS SDK v3 clients installed in your project.

[![npm](https://img.shields.io/npm/v/%40effect-ak%2Faws-sdk)](https://www.npmjs.com/package/@effect-ak/aws-sdk)
[![Build](https://github.com/kondaurovDev/aws-sdk/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/kondaurovDev/aws-sdk/actions/workflows/build.yml)
[![Probe: every AWS client](https://github.com/kondaurovDev/aws-sdk/actions/workflows/probe.yml/badge.svg)](https://github.com/kondaurovDev/aws-sdk/actions/workflows/probe.yml)

```typescript
const program = Effect.gen(function* () {
  yield* s3.send("create_bucket", { Bucket: "reports" }).pipe(
    Effect.catchTag("BucketAlreadyOwnedByYou", () => Effect.void)
  )
  yield* dynamodb.waitUntil("table_exists", { TableName: "users" }, { maxWaitTime: "2 minutes" })
  const user = yield* dynamodb_document.send("get", { TableName: "users", Key: { id: "42" } })
  const keys = yield* s3.paginate("list_objects_v2", { Bucket: "reports" }).pipe(
    Stream.flatMap((page) => Stream.fromIterable(page.Contents ?? [])),
    Stream.runCollect
  )
  const link = yield* s3.presign("get_object", { Bucket: "reports", Key: "q3.pdf" }, { expiresIn: 3600 })
  return { user: user.Item, keys, link }
}).pipe(Effect.provide(layer()))
```

Every command name, input, output and documented exception above is typed, straight from the SDK you have installed.

> Version 2 generates code for **Effect 4**. With Effect 3, use `@effect-ak/aws-sdk@1`.

## Why a generator

- **The official SDK does the work.** Signing, protocols, endpoints, retries and every S3 corner case stay with `@aws-sdk/client-*`. The generated code only adds the Effect layer.
- **The code is yours.** It lands in your repository, readable and editable, and imports nothing but `effect` and the SDK. There is no runtime dependency on this package.
- **Any client, the day it ships.** The generator reads the declaration files of whatever `@aws-sdk/client-*` version you install, so new commands and services need no release on this side. It is verified weekly against every published client package (435 at the time of writing): all of them generate and typecheck.
- **The SDK ecosystem keeps working.** A generated layer holds a real SDK client, so [aws-sdk-client-mock](https://github.com/m-radzikowski/aws-sdk-client-mock), custom middleware, credential providers and OpenTelemetry instrumentation apply unchanged.

## What you get

| | |
| --- | --- |
| `send(command, input?)` | One function per client, every command as a string literal with its AWS documentation in the completion popup |
| Tagged errors | One error class per SDK exception, so `Effect.catchTag("NoSuchKey", ...)` and `catchTags` work as everywhere else in Effect; the error channel of each command lists exactly the exceptions AWS documents for it |
| SDK metadata on errors | `isRetryable`, `isThrottling`, `fault`, `statusCode`, `requestId`, and the SDK exception itself in `cause` |
| `paginate(command, input?)` | A `Stream` of pages for every command the SDK has a paginator for; leaving early aborts the request in flight |
| `waitUntil(waiter, input, options)` | SDK waiters as effects, with `Duration` inputs and a typed `TIMEOUT` / `FAILURE` error |
| `presign(command, input?)` | Presigned S3 URLs, when `@aws-sdk/s3-request-presigner` is installed |
| `dynamodb_document` | The DynamoDB document client with the same API, when `@aws-sdk/lib-dynamodb` is installed |
| Layers | `XClient.layer(config)` creates and destroys the SDK client, `XClient.make(config)` is the scoped constructor behind it, `layer()` provides all clients |
| Cancellation and tracing | Interruption aborts the HTTP request; every call runs in a span |

## Getting started

```sh
pnpm add effect @aws-sdk/client-s3
pnpm add -D @effect-ak/aws-sdk
pnpm exec gen-aws-sdk
```

`gen-aws-sdk` finds every `@aws-sdk/client-*` dependency in `package.json` and writes a module per client to `src/generated`. Re-run it after adding or upgrading a client, e.g. from a `prepare` script. Files it generated before for clients that are gone are deleted.

```typescript
import { Effect } from "effect"
import { s3 } from "./generated/index.js"

const buckets = s3.send("list_buckets").pipe(
  Effect.map(({ Buckets = [] }) => Buckets),
  Effect.provide(s3.S3Client.layer({ region: "eu-central-1" }))
)
```

## Configuration

Optional `aws-sdk.json` in the project root:

```json
{
  "$schema": "node_modules/@effect-ak/aws-sdk/schema.json",
  "generate_to": "src/generated",
  "clients": ["s3", "dynamodb"],
  "global": { "region": "us-east-1" }
}
```

| Key | Default | |
| --- | --- | --- |
| `generate_to` | `src/generated` | Output directory, relative to the project root |
| `clients` | every `@aws-sdk/client-*` dependency | Clients to generate: `s3` or `@aws-sdk/client-s3` |
| `global.region` | — | Default region of every client layer |

Two more packages are picked up when they are dependencies: `@aws-sdk/s3-request-presigner` adds `s3.presign`, and `@aws-sdk/lib-dynamodb` adds the `dynamodb_document` module.

Run `gen-aws-sdk --verbose` to see debug output.

## Generated API

For each client (here `s3`, from `@aws-sdk/client-s3`):

| Export | |
| --- | --- |
| `send(command, input?)` | Sends a command: `Effect<Output, S3MethodError<command>, S3Client>`. The input may be omitted when no field is required |
| `paginate(command, input?, options?)` | Streams the pages of a command the SDK has a paginator for: `Stream<Output, S3MethodError<command>, S3Client>` |
| `waitUntil(waiter, input, { maxWaitTime })` | Polls an SDK waiter: `Effect<void, S3WaiterError, S3Client>` |
| `presign(command, input?, options?)` | S3 only: a presigned URL, `Effect<string, never, S3Client>` |
| `S3Client` | The service holding the SDK client |
| `S3Client.layer(config?)` | Creates the SDK client and destroys it when the layer is released |
| `S3Client.make(config?)` | The scoped constructor behind `layer`, for custom layers |
| `NoSuchKey`, `NoSuchBucket`, ... | One tagged error class per modeled S3 exception; `cause` is the SDK exception |
| `S3Error` | Any other S3 service exception; `code` names it |
| `S3WaiterError` | The awaited state was not reached: `state` is `TIMEOUT` or `FAILURE` |
| `S3Errors`, `S3MethodError<M>`, `S3Method`, `S3MethodInput<M>`, `S3MethodOutput<M>`, `S3Paginated`, `S3Waiter`, `S3WaiterInput<W>` | Helper types |

`index.ts` re-exports every client as a namespace and adds `layer(config?)`, one layer with all clients:

```typescript
import { layer } from "./generated/index.js"

program.pipe(Effect.provide(layer({ s3: { region: "eu-central-1" } })))
```

To use an SDK client you created yourself, provide it directly: `Layer.succeed(s3.S3Client, client)`.

### Errors

Each command fails with the exceptions AWS documents for it, as tagged error classes, plus `S3Error` for anything else:

```typescript
s3.send("get_object", { Bucket, Key }).pipe(
  //     ^ Effect<GetObjectCommandOutput, NoSuchKey | InvalidObjectState | S3Error, S3Client>
  Effect.catchTags({
    NoSuchKey: () => Effect.succeed(undefined),
    InvalidObjectState: (error) => Effect.fail(new Archived({ storageClass: error.cause.StorageClass }))
  })
)
```

- `error.cause` is the SDK exception, narrowed to its class by `catchTag`; `error.command` names the command.
- `S3Error` is raised for an exception the SDK does not document for that command, or one unknown to the SDK model; `error.code` is the exception name and `error.cause` the SDK's base exception. Types and runtime always agree: an undocumented `NoSuchBucket` arrives as `S3Error`, never as a class missing from the error channel.
- Every class exposes the SDK's metadata: `isRetryable`, `isThrottling`, `fault`, `statusCode`, `requestId`, e.g. for `Effect.retry({ while: (error) => error.isRetryable })`.

Anything outside the service model (network failures, missing credentials, ...) is a defect. Interrupting the effect, e.g. with `Effect.timeout`, aborts the HTTP request.

### Pagination

```typescript
import { Stream } from "effect"

const keys = s3.paginate("list_objects_v2", { Bucket: "my-bucket" }, { pageSize: 1000 }).pipe(
  Stream.flatMap((page) => Stream.fromIterable(page.Contents ?? [])),
  Stream.map((object) => object.Key),
  Stream.runCollect
)
```

The SDK paginator follows the continuation tokens; leaving the stream early aborts the request in flight.

### Waiters

```typescript
yield* dynamodb.send("create_table", { TableName: "users", ... })
yield* dynamodb.waitUntil("table_exists", { TableName: "users" }, { maxWaitTime: "2 minutes" })
```

`minDelay` and `maxDelay` tune the SDK's backoff. `DynamoDBWaiterError.reason` carries the last response the SDK observed.

### Presigned URLs

With `@aws-sdk/s3-request-presigner` installed:

```typescript
const url = yield* s3.presign("get_object", { Bucket: "my-bucket", Key: "report.pdf" }, { expiresIn: 3600 })
```

### DynamoDB document client

With `@aws-sdk/lib-dynamodb` installed next to `@aws-sdk/client-dynamodb`, the `dynamodb_document` module offers the same API over plain JavaScript values, and its errors are the DynamoDB exceptions typed per command:

```typescript
import { dynamodb_document, layer } from "./generated/index.js"

const user = dynamodb_document.send("get", { TableName: "users", Key: { id: "1" } }).pipe(
  Effect.map(({ Item }) => Item),
  Effect.provide(layer({ dynamodb_document: { marshallOptions: { removeUndefinedValues: true } } }))
)
```

`dynamodb_document.DynamoDBDocumentClient.layer(translateConfig?)` wraps the `DynamoDBClient` from the context; `layer()` wires both.

### Testing

The generated code runs the real SDK client, so the SDK's own testing tools apply: pass a fake `requestHandler` in the layer config, or provide a client prepared with [aws-sdk-client-mock](https://github.com/m-radzikowski/aws-sdk-client-mock) through `Layer.succeed(s3.S3Client, client)`.

## How it works

`gen-aws-sdk` parses the declaration files of each installed client package. Command classes become the methods, the exception classes become tagged errors, the `@throws` annotations in each command's JSDoc decide its error channel, and the SDK's own paginators and waiters are wrapped rather than reimplemented. The output is plain TypeScript; nothing from this package runs in your application.

Every week, the [probe workflow](https://github.com/kondaurovDev/aws-sdk/actions/workflows/probe.yml) installs the latest release of every `@aws-sdk/client-*` package, generates all of them and typechecks the result, so a change in the SDK's declaration files shows up here before it reaches you.

## How it compares

| | `@effect-ak/aws-sdk` | [`@effect-aws/*`](https://github.com/floydspace/effect-aws) | [`@distilled.cloud/aws`](https://github.com/alchemy-run/distilled) |
| --- | --- | --- | --- |
| Underneath | The official SDK client you install | The official SDK client | Its own runtime, generated from Smithy models |
| Where the code lives | Generated into your repository | One published package per client | One published package for 200+ services |
| Coverage | Any `@aws-sdk/client-*` package, at the version you install | The clients the maintainers publish | The services in the package |
| Fits best | Projects already on the AWS SDK that want typed Effect wrappers with no new runtime | The same, without a generation step | Runtimes where the AWS SDK is too heavy, such as edge workers |

## Migrating from 1.x

- Upgrade to Effect 4 and re-run `gen-aws-sdk`
- `make(command, input)` → `send(command, input)`
- `error.$is("NoSuchKey")` → `Effect.catchTag("NoSuchKey", ...)`; `S3Error<M>` is now the union `S3MethodError<M>` of tagged classes
- `S3Client.Default(config)` → `S3Client.layer(config)`
- `AllClientsDefault` → `layer()`
- The `postinstall` hook is gone: run `gen-aws-sdk` yourself

## License

MIT

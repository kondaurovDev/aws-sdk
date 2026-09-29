# Effect AWS SDK

TypeScript-first AWS development with [Effect](https://effect.website/).

[![NPM Version](https://img.shields.io/npm/v/%40effect-ak%2Faws-sdk)](https://www.npmjs.com/package/@effect-ak/aws-sdk)
![NPM Downloads](https://img.shields.io/npm/dw/%40effect-ak%2Faws-sdk)

A code generator that wraps the AWS SDK v3 clients installed in your project into Effect services. The official SDK keeps doing the work (signing, protocols, endpoints, retries); the generated code adds the Effect layer on top:

- One typed `make(command, input)` per client, with input and output inferred per command and the command's AWS documentation in completion popups
- Typed errors for the exceptions each command documents, narrowed with `$is`, plus the SDK's retry metadata
- `paginate` as a `Stream`, `waitUntil` for SDK waiters, `presign` for S3, and the DynamoDB document client
- Scoped client layers, request cancellation on interruption, a tracing span per call

The generator is verified daily against every published `@aws-sdk/client-*` package (435 at the time of writing): all of them generate, and the generated code typechecks.

> Version 2 generates code for **Effect 4**. With Effect 3, use `@effect-ak/aws-sdk@1`.

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

const program = Effect.gen(function* () {
  yield* s3.make("create_bucket", { Bucket: "my-bucket" }).pipe(
    Effect.catchIf(
      (error) => error.$is("BucketAlreadyOwnedByYou"),
      () => Effect.log("The bucket exists already")
    )
  )
  const { Buckets = [] } = yield* s3.make("list_buckets")
  return Buckets
}).pipe(Effect.provide(s3.S3Client.layer({ region: "eu-central-1" })))
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
| `make(command, input?)` | Runs a command: `Effect<Output, S3Error<command>, S3Client>`. The input may be omitted when no field is required |
| `paginate(command, input?, options?)` | Streams the pages of a command the SDK has a paginator for: `Stream<Output, S3Error<command>, S3Client>` |
| `waitUntil(waiter, input, { maxWaitTime })` | Polls an SDK waiter: `Effect<void, S3WaiterError<waiter>, S3Client>` |
| `presign(command, input?, options?)` | S3 only: a presigned URL, `Effect<string, never, S3Client>` |
| `S3Client` | The service holding the SDK client |
| `S3Client.layer(config?)` | Creates the SDK client and destroys it when the layer is released |
| `S3Error<M>` | A modeled service exception: `cause` is the SDK exception, `command` the failed command |
| `S3WaiterError<W>` | The awaited state was not reached: `state` is `TIMEOUT` or `FAILURE` |
| `S3Method`, `S3MethodInput<M>`, `S3MethodOutput<M>`, `S3MethodError<M>`, `S3Errors`, `S3Paginated`, `S3Waiter`, `S3WaiterInput<W>` | Helper types |

`index.ts` re-exports every client as a namespace and adds `makeClients(config?)`, one layer with all clients:

```typescript
import { makeClients } from "./generated/index.js"

program.pipe(Effect.provide(makeClients({ s3: { region: "eu-central-1" } })))
```

To use an SDK client you created yourself, provide it directly: `Layer.succeed(s3.S3Client, client)`.

### Errors

`make` fails with `S3Error` when the SDK throws a modeled `S3ServiceException`:

- `error.$is(name)` accepts only the exceptions documented for that command and narrows `error.cause` to the SDK exception class
- `error.is(name)` accepts any S3 exception
- `error.isRetryable`, `error.isThrottling`, `error.fault`, `error.statusCode` and `error.requestId` expose the SDK's metadata, e.g. for `Effect.retry({ while: (error) => error.isRetryable })`

Anything else (network failures, missing credentials, ...) is a defect. Interrupting the effect, e.g. with `Effect.timeout`, aborts the HTTP request.

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
yield* dynamodb.make("create_table", { TableName: "users", ... })
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
import { dynamodb_document, makeClients } from "./generated/index.js"

const user = dynamodb_document.make("get", { TableName: "users", Key: { id: "1" } }).pipe(
  Effect.map(({ Item }) => Item),
  Effect.provide(makeClients({ dynamodb_document: { marshallOptions: { removeUndefinedValues: true } } }))
)
```

`dynamodb_document.DynamoDBDocumentClient.layer(translateConfig?)` wraps the `DynamoDBClient` from the context; `makeClients` wires both.

### Testing

The generated code runs the real SDK client, so the SDK's own testing tools apply: pass a fake `requestHandler` in the layer config, or provide a client prepared with [aws-sdk-client-mock](https://github.com/m-radzikowski/aws-sdk-client-mock) through `Layer.succeed(s3.S3Client, client)`.

## Migrating from 1.x

- Upgrade to Effect 4 and re-run `gen-aws-sdk`
- `S3Client.Default(config)` → `S3Client.layer(config)`
- `AllClientsDefault` → `makeClients()`
- The `postinstall` hook is gone: run `gen-aws-sdk` yourself

## License

MIT

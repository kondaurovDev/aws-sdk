# Effect AWS SDK

TypeScript-first AWS development with [Effect](https://effect.website/).

[![NPM Version](https://img.shields.io/npm/v/%40effect-ak%2Faws-sdk)](https://www.npmjs.com/package/@effect-ak/aws-sdk)
![NPM Downloads](https://img.shields.io/npm/dw/%40effect-ak%2Faws-sdk)

A code generator that wraps the AWS SDK v3 clients installed in your project into Effect services.

- One typed `make(command, input)` per client, with input and output inferred per command
- Typed errors for the exceptions each command documents, narrowed with `$is`
- Scoped client layers, request cancellation on interruption, a tracing span per call

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

Run `gen-aws-sdk --verbose` to see debug output.

## Generated API

For each client (here `s3`, from `@aws-sdk/client-s3`):

| Export | |
| --- | --- |
| `make(command, input?)` | Runs a command: `Effect<Output, S3Error<command>, S3Client>`. The input may be omitted when no field is required |
| `S3Client` | The service holding the SDK client |
| `S3Client.layer(config?)` | Creates the SDK client and destroys it when the layer is released |
| `S3Error<M>` | A modeled service exception: `cause` is the SDK exception, `command` the failed command |
| `S3Method`, `S3MethodInput<M>`, `S3MethodOutput<M>`, `S3MethodError<M>`, `S3Errors` | Helper types |

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

Anything else (network failures, missing credentials, ...) is a defect. Interrupting the effect, e.g. with `Effect.timeout`, aborts the HTTP request.

## Migrating from 1.x

- Upgrade to Effect 4 and re-run `gen-aws-sdk`
- `S3Client.Default(config)` → `S3Client.layer(config)`
- `AllClientsDefault` → `makeClients()`
- The `postinstall` hook is gone: run `gen-aws-sdk` yourself

## License

MIT

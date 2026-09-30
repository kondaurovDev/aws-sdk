---
"@effect-ak/aws-sdk": major
---

Generate code for Effect 4. Projects on Effect 3 should stay on 1.x.

Breaking changes in the generated code:

- `make(command, input)` is renamed to `send(command, input)`, after the SDK's `client.send(command)`.
- Errors are tagged classes, one per modeled SDK exception (`s3.NoSuchKey`, `s3.NoSuchBucket`, ...), plus `S3Error` for any other service exception. The error channel of each command is the union of the exceptions AWS documents for it and `S3Error`, so `Effect.catchTag`, `catchTags` and `Match` work as everywhere else in Effect. `$is` and `is` are gone; `S3Error<M>` is replaced by the union type `S3MethodError<M>`. Every class exposes the SDK exception in `cause`, the failed `command`, and the SDK's metadata: `isRetryable`, `isThrottling`, `fault`, `statusCode`, `requestId`.
- `XClient` is a `Context.Service`; `XClient.Default(config)` is renamed to `XClient.layer(config)`. The layer destroys the SDK client when it is released; `XClient.make(config)` is the scoped constructor behind it.
- `AllClientsDefault` is removed, use `layer()` from the generated index. `internal/utils.ts` is no longer generated and is deleted on the next run.
- Inputs and outputs are no longer logged at debug level (they may contain secrets); every call runs in a span named `<Service>.<method>` instead.

New in the generated code:

- `paginate(command, input?, options?)` streams the pages of every command the SDK has a paginator for, with the errors of that command. Leaving the stream early aborts the request in flight.
- `waitUntil(waiter, input, { maxWaitTime })` wraps the SDK waiters; `XWaiterError` reports `TIMEOUT` or `FAILURE`.
- `presign(command, input?, options?)` for S3 when `@aws-sdk/s3-request-presigner` is installed.
- `dynamodb_document`: a module for `@aws-sdk/lib-dynamodb` when it is installed, with the same `send`/`paginate` API, native JavaScript values, and the DynamoDB exceptions typed per command. Its layer wraps the `DynamoDBClient` from the context; `layer()` wires both.
- Each command carries the first paragraph of its AWS documentation, shown by editors in completion and hover.

Improvements:

- Interrupting `send` aborts the HTTP request.
- The input of commands without required fields may be omitted: `s3.send("list_buckets")`.
- New helper types: `XMethod`, `XMethodOutput<M>`, `XMethodError<M>`, `XErrors`.
- The generator is verified against every published `@aws-sdk/client-*` package (435 at the time of writing): all of them scan and the generated code typechecks.
- Every client is scanned before the run fails, so one run reports every problem.
- Client packages are found in parent `node_modules` too (hoisted and workspace installs). Only their declaration files are parsed, without type checking.
- Previously generated files of removed clients are deleted; unchanged files are not rewritten.
- `aws-sdk.json` rejects unknown keys, `clients` accepts full package names, and invalid configuration fails with a clear message and exit code 1.
- The CLI bundles its own Effect, so it no longer depends on the Effect version installed in the project.
- The `postinstall` hook is removed: it never ran in consumer projects. Run `gen-aws-sdk` explicitly, e.g. from a `prepare` script.

---
"@effect-ak/aws-sdk": major
---

Generate code for Effect 4. Projects on Effect 3 should stay on 1.x.

Breaking changes in the generated code:

- `XClient` is a `Context.Service`; `XClient.Default(config)` is renamed to `XClient.layer(config)`. The layer now destroys the SDK client when it is released.
- `XError` is a `Data.TaggedError`: it is yieldable, has a stack trace and a readable `message`. `$is(name)` and `is(name)` also narrow `error.cause` to the matching SDK exception class.
- `AllClientsDefault` is removed, use `makeClients()`. `internal/utils.ts` is no longer generated and is deleted on the next run.
- Inputs and outputs are no longer logged at debug level (they may contain secrets); every call runs in a span named `<Service>.<method>` instead.

Improvements:

- Interrupting `make` aborts the HTTP request.
- The input of commands without required fields may be omitted: `s3.make("list_buckets")`.
- New helper types: `XMethod`, `XMethodOutput<M>`, `XMethodError<M>`, `XErrors`.
- Client packages are found in parent `node_modules` too (hoisted and workspace installs). Only their declaration files are parsed, without type checking.
- Previously generated files of removed clients are deleted; unchanged files are not rewritten.
- `aws-sdk.json` rejects unknown keys, `clients` accepts full package names, and invalid configuration fails with a clear message and exit code 1.
- The CLI bundles its own Effect, so it no longer depends on the Effect version installed in the project.
- The `postinstall` hook is removed: it never ran in consumer projects. Run `gen-aws-sdk` explicitly, e.g. from a `prepare` script.

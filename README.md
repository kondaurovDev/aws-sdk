# Effect AWS SDK

Generates [Effect](https://effect.website/) wrappers for AWS SDK v3 clients.
Usage docs: [packages/aws-sdk](packages/aws-sdk/readme.md).

| Path | |
| --- | --- |
| [packages/aws-sdk](packages/aws-sdk) | `@effect-ak/aws-sdk`, the published generator (`gen-aws-sdk` CLI) |
| [examples/demo](examples/demo) | A consumer project: generates real clients (S3, DynamoDB, SQS) and verifies the output with type-level and runtime tests |

## Development

Requires Node 24 and pnpm 12.

```sh
pnpm install
pnpm run ci        # build → generate the demo clients → typecheck → test
```

Or step by step:

```sh
pnpm run build     # bundle the CLI into packages/aws-sdk/dist
pnpm run generate  # run it in examples/demo
pnpm run check     # tsc in every package
pnpm run test      # vitest in every package
```

The generator source is organized by slice: `config/` (aws-sdk.json), `scan/`
(reading the SDK declarations), `codegen/` (rendering and writing files) and
`cli/`. Unit tests sit next to the code; changes to the generated code are
reviewed through `src/codegen/__snapshots__` and must pass the demo.

After changing `src/config/schema.ts`, run `pnpm -F @effect-ak/aws-sdk generate:schema`.

## Releasing

Releases go through [changesets](https://github.com/changesets/changesets): add
one with `pnpm changeset`, merge, then merge the release PR it opens. The repo
is in pre-release mode (`next` tag) while Effect 4 is a release candidate; run
`pnpm changeset pre exit` once Effect 4 is stable.

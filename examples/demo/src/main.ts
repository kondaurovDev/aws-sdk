import { Effect } from "effect"

import { dynamodb, makeClients, s3 } from "./generated/index.js"

/** Creates a bucket unless it exists already, then lists all buckets. */
export const ensureBucket = (bucket: string) =>
  Effect.gen(function* () {
    yield* s3.make("create_bucket", { Bucket: bucket }).pipe(
      Effect.catchIf(
        (error) => error.$is("BucketAlreadyOwnedByYou"),
        () => Effect.log(`Bucket ${bucket} exists already`)
      )
    )
    const { Buckets = [] } = yield* s3.make("list_buckets")
    return Buckets.map((b) => b.Name)
  })

/** Reads an item; a missing table is reported as `undefined`. */
export const getItem = (table: string, id: string) =>
  dynamodb.make("get_item", { TableName: table, Key: { id: { S: id } } }).pipe(
    Effect.map(({ Item }) => Item),
    Effect.catchIf(
      (error) => error.$is("ResourceNotFoundException"),
      () => Effect.succeed(undefined)
    )
  )

// One layer for every generated client; per-client config overrides the
// region from aws-sdk.json.
export const program = ensureBucket("my-bucket").pipe(
  Effect.provide(makeClients({ s3: { region: "eu-central-1" } }))
)

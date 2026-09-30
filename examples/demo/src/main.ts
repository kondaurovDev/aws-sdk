import { Effect, Stream } from "effect"

import { dynamodb, dynamodb_document, layer, s3 } from "./generated/index.js"

/** Creates a bucket unless it exists already, then lists all buckets. */
export const ensureBucket = (bucket: string) =>
  Effect.gen(function* () {
    yield* s3.send("create_bucket", { Bucket: bucket }).pipe(
      Effect.catchTag("BucketAlreadyOwnedByYou", () => Effect.log(`Bucket ${bucket} exists already`))
    )
    const { Buckets = [] } = yield* s3.send("list_buckets")
    return Buckets.map((b) => b.Name)
  })

/** Every key in a bucket, across all pages. */
export const listKeys = (bucket: string) =>
  s3.paginate("list_objects_v2", { Bucket: bucket }).pipe(
    Stream.flatMap((page) => Stream.fromIterable(page.Contents ?? [])),
    Stream.map((object) => object.Key ?? ""),
    Stream.runCollect
  )

/** A link to download an object, valid for one hour. */
export const downloadUrl = (bucket: string, key: string) =>
  s3.presign("get_object", { Bucket: bucket, Key: key }, { expiresIn: 3600 })

/** Reads an item; a missing table is reported as `undefined`. */
export const getItem = (table: string, id: string) =>
  dynamodb.send("get_item", { TableName: table, Key: { id: { S: id } } }).pipe(
    Effect.map(({ Item }) => Item),
    Effect.catchTag("ResourceNotFoundException", () => Effect.succeed(undefined))
  )

/** The same read through the document client: plain JavaScript values in and out. */
export const getUser = (id: string) =>
  dynamodb_document.send("get", { TableName: "users", Key: { id } }).pipe(Effect.map(({ Item }) => Item))

/** Creates a table and waits until it can be used. */
export const createTable = (table: string) =>
  Effect.gen(function* () {
    yield* dynamodb.send("create_table", {
      TableName: table,
      AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST"
    })
    yield* dynamodb.waitUntil("table_exists", { TableName: table }, { maxWaitTime: "2 minutes" })
  })

// One layer for every generated client; per-client config overrides the
// region from aws-sdk.json.
export const program = ensureBucket("my-bucket").pipe(
  Effect.provide(layer({ s3: { region: "eu-central-1" } }))
)

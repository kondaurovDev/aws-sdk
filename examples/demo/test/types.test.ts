// Compile-time contract of the generated API, enforced by `pnpm check`.
// Every @ts-expect-error below must stay an error.
import type * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import type * as S3Sdk from "@aws-sdk/client-s3"
import { describe, expectTypeOf, it } from "vitest"
import { Effect, Layer } from "effect"

import { dynamodb, makeClients, s3, sqs } from "../src/generated/index.js"

describe("generated types", () => {
  it("infers input, output, error and requirement per command", () => {
    expectTypeOf(s3.make("create_bucket", { Bucket: "b" })).toEqualTypeOf<
      Effect.Effect<S3Sdk.CreateBucketCommandOutput, s3.S3Error<"create_bucket">, s3.S3Client>
    >()
    expectTypeOf(dynamodb.make("list_tables")).toEqualTypeOf<
      Effect.Effect<DynamoDBSdk.ListTablesCommandOutput, dynamodb.DynamoDBError<"list_tables">, dynamodb.DynamoDBClient>
    >()
  })

  it("lets optional input be omitted but not required input", () => {
    s3.make("list_buckets")
    s3.make("list_buckets", {})
    // @ts-expect-error Bucket is required
    s3.make("create_bucket")
    // @ts-expect-error Bucket is required
    s3.make("create_bucket", {})
  })

  it("rejects unknown commands and input fields", () => {
    // @ts-expect-error no such command
    s3.make("create_bukket", { Bucket: "b" })
    // @ts-expect-error unknown input field
    s3.make("create_bucket", { Bucket: "b", Buckett: "b" })
  })

  it("narrows the cause to the documented exception", () => {
    s3.make("create_bucket", { Bucket: "b" }).pipe(
      Effect.catchIf(
        (error) => error.$is("BucketAlreadyExists"),
        (error) => {
          expectTypeOf(error.cause).toExtend<S3Sdk.BucketAlreadyExists>()
          expectTypeOf(error.cause.name).toEqualTypeOf<"BucketAlreadyExists">()
          expectTypeOf(error.command).toEqualTypeOf<"create_bucket">()
          return Effect.void
        }
      )
    )
  })

  it("only accepts exceptions documented for the command in $is", () => {
    s3.make("create_bucket", { Bucket: "b" }).pipe(
      // @ts-expect-error NoSuchKey is not documented for create_bucket
      Effect.catchIf((error) => error.$is("NoSuchKey"), () => Effect.void)
    )
    // list_buckets documents no exceptions
    // @ts-expect-error nothing to narrow to
    s3.make("list_buckets").pipe(Effect.catchIf((error) => error.$is("NoSuchKey"), () => Effect.void))
  })

  it("accepts any exception of the client in is", () => {
    s3.make("list_buckets").pipe(
      Effect.catchIf(
        (error) => error.is("NoSuchKey"),
        (error) => {
          expectTypeOf(error.cause).toExtend<S3Sdk.NoSuchKey>()
          expectTypeOf(error.cause.name).toEqualTypeOf<"NoSuchKey">()
          return Effect.void
        }
      )
    )
    // @ts-expect-error not an S3 exception
    s3.make("list_buckets").pipe(Effect.catchIf((error) => error.is("ConditionalCheckFailedException"), () => Effect.void))
  })

  it("provides every client from makeClients", () => {
    expectTypeOf(makeClients()).toEqualTypeOf<
      Layer.Layer<dynamodb.DynamoDBClient | s3.S3Client | sqs.SQSClient>
    >()
  })
})

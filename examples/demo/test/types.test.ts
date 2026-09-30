// Compile-time contract of the generated API, enforced by `pnpm check`.
// Every @ts-expect-error below must stay an error.
import type * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import type * as S3Sdk from "@aws-sdk/client-s3"
import type * as DocumentSdk from "@aws-sdk/lib-dynamodb"
import { describe, expectTypeOf, it } from "vitest"
import { Effect, Layer, Stream } from "effect"

import { dynamodb, dynamodb_document, layer, s3, sqs } from "../src/generated/index.js"

describe("send", () => {
  it("infers input, output, errors and requirement per command", () => {
    expectTypeOf(s3.send("create_bucket", { Bucket: "b" })).toEqualTypeOf<
      Effect.Effect<
        S3Sdk.CreateBucketCommandOutput,
        s3.BucketAlreadyExists | s3.BucketAlreadyOwnedByYou | s3.S3Error,
        s3.S3Client
      >
    >()
    // Commands without documented exceptions still fail with the catch-all
    expectTypeOf(s3.send("list_buckets")).toEqualTypeOf<
      Effect.Effect<S3Sdk.ListBucketsCommandOutput, s3.S3Error, s3.S3Client>
    >()
    expectTypeOf(dynamodb.send("list_tables")).toEqualTypeOf<
      Effect.Effect<DynamoDBSdk.ListTablesCommandOutput, dynamodb.DynamoDBMethodError<"list_tables">, dynamodb.DynamoDBClient>
    >()
  })

  it("lets optional input be omitted but not required input", () => {
    s3.send("list_buckets")
    s3.send("list_buckets", {})
    // @ts-expect-error Bucket is required
    s3.send("create_bucket")
    // @ts-expect-error Bucket is required
    s3.send("create_bucket", {})
  })

  it("rejects unknown commands and input fields", () => {
    // @ts-expect-error no such command
    s3.send("create_bukket", { Bucket: "b" })
    // @ts-expect-error unknown input field
    s3.send("create_bucket", { Bucket: "b", Buckett: "b" })
  })
})

describe("errors", () => {
  it("are tagged per exception, with the SDK exception as cause", () => {
    s3.send("create_bucket", { Bucket: "b" }).pipe(
      Effect.catchTag("BucketAlreadyExists", (error) => {
        expectTypeOf(error).toEqualTypeOf<s3.BucketAlreadyExists>()
        expectTypeOf(error.cause).toEqualTypeOf<S3Sdk.BucketAlreadyExists>()
        expectTypeOf(error.command).toEqualTypeOf<s3.S3Method>()
        return Effect.void
      }),
      Effect.catchTag("S3Error", (error) => {
        expectTypeOf(error.code).toEqualTypeOf<string>()
        expectTypeOf(error.cause).toEqualTypeOf<S3Sdk.S3ServiceException>()
        return Effect.void
      })
    )
  })

  it("only offers the exceptions documented for the command", () => {
    // @ts-expect-error NoSuchKey is not documented for create_bucket
    s3.send("create_bucket", { Bucket: "b" }).pipe(Effect.catchTag("NoSuchKey", () => Effect.void))
    // @ts-expect-error list_buckets documents no exceptions
    s3.send("list_buckets").pipe(Effect.catchTag("NoSuchKey", () => Effect.void))
  })

  it("share the SDK metadata across every class", () => {
    expectTypeOf<s3.S3Errors["fault"]>().toEqualTypeOf<"client" | "server">()
    expectTypeOf<s3.S3Errors["isRetryable"]>().toEqualTypeOf<boolean>()
    expectTypeOf<s3.S3Errors["statusCode"]>().toEqualTypeOf<number | undefined>()
    expectTypeOf<s3.S3MethodError<"get_object">>().toEqualTypeOf<s3.InvalidObjectState | s3.NoSuchKey | s3.S3Error>()
  })
})

describe("paginate", () => {
  it("streams the output of paginated commands", () => {
    expectTypeOf(s3.paginate("list_objects_v2", { Bucket: "b" })).toEqualTypeOf<
      Stream.Stream<S3Sdk.ListObjectsV2CommandOutput, s3.NoSuchBucket | s3.S3Error, s3.S3Client>
    >()
    s3.paginate("list_buckets")
    s3.paginate("list_buckets", {}, { pageSize: 10 })
  })

  it("rejects commands without a paginator and bad options", () => {
    // @ts-expect-error get_object has no paginator
    s3.paginate("get_object", { Bucket: "b", Key: "k" })
    // @ts-expect-error pageSize is a number
    s3.paginate("list_buckets", {}, { pageSize: "10" })
    // @ts-expect-error Bucket is required
    s3.paginate("list_objects_v2")
  })
})

describe("waitUntil", () => {
  it("types the input of the waiter", () => {
    expectTypeOf(dynamodb.waitUntil("table_exists", { TableName: "t" }, { maxWaitTime: "1 minute" })).toEqualTypeOf<
      Effect.Effect<void, dynamodb.DynamoDBWaiterError, dynamodb.DynamoDBClient>
    >()
    expectTypeOf<s3.S3Waiter>().toEqualTypeOf<"bucket_exists" | "bucket_not_exists" | "object_exists" | "object_not_exists">()
  })

  it("rejects unknown waiters, wrong input and missing maxWaitTime", () => {
    // @ts-expect-error no such waiter
    dynamodb.waitUntil("bucket_exists", { TableName: "t" }, { maxWaitTime: "1 minute" })
    // @ts-expect-error TableName is required
    dynamodb.waitUntil("table_exists", { Bucket: "b" }, { maxWaitTime: "1 minute" })
    // @ts-expect-error maxWaitTime is required
    dynamodb.waitUntil("table_exists", { TableName: "t" }, {})
    // @ts-expect-error SQS has no waiters
    sqs.waitUntil
  })
})

describe("presign", () => {
  it("is generated for S3 only", () => {
    expectTypeOf(s3.presign("get_object", { Bucket: "b", Key: "k" }, { expiresIn: 60 })).toEqualTypeOf<
      Effect.Effect<string, never, s3.S3Client>
    >()
    s3.presign("list_buckets")
    // @ts-expect-error no presigner for DynamoDB
    dynamodb.presign
  })
})

describe("dynamodb_document", () => {
  it("accepts native types and raises DynamoDB exceptions as its own classes", () => {
    expectTypeOf(dynamodb_document.send("get", { TableName: "t", Key: { id: "1" } })).toEqualTypeOf<
      Effect.Effect<
        DocumentSdk.GetCommandOutput,
        dynamodb_document.DynamoDBDocumentMethodError<"get">,
        dynamodb_document.DynamoDBDocumentClient
      >
    >()
    expectTypeOf<dynamodb_document.ResourceNotFoundException>().toExtend<
      dynamodb_document.DynamoDBDocumentMethodError<"get">
    >()
    // @ts-expect-error Key is required
    dynamodb_document.send("get", { TableName: "t" })

    dynamodb_document.send("get", { TableName: "t", Key: { id: "1" } }).pipe(
      Effect.catchTag("ResourceNotFoundException", (error) => {
        expectTypeOf(error.cause).toEqualTypeOf<DynamoDBSdk.ResourceNotFoundException>()
        return Effect.void
      })
    )
  })

  it("requires the base client", () => {
    expectTypeOf(dynamodb_document.DynamoDBDocumentClient.layer()).toEqualTypeOf<
      Layer.Layer<dynamodb_document.DynamoDBDocumentClient, never, dynamodb.DynamoDBClient>
    >()
  })
})

describe("layer", () => {
  it("provides every client", () => {
    expectTypeOf(layer()).toEqualTypeOf<
      Layer.Layer<dynamodb.DynamoDBClient | dynamodb_document.DynamoDBDocumentClient | s3.S3Client | sqs.SQSClient>
    >()
    layer({ dynamodb_document: { marshallOptions: { removeUndefinedValues: true } } })
  })
})

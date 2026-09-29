// Compile-time contract of the generated API, enforced by `pnpm check`.
// Every @ts-expect-error below must stay an error.
import type * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import type * as S3Sdk from "@aws-sdk/client-s3"
import type * as DocumentSdk from "@aws-sdk/lib-dynamodb"
import { describe, expectTypeOf, it } from "vitest"
import { Effect, Layer, Stream } from "effect"

import { dynamodb, dynamodb_document, makeClients, s3, sqs } from "../src/generated/index.js"

describe("make", () => {
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
})

describe("errors", () => {
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

  it("exposes SDK metadata", () => {
    expectTypeOf<s3.S3Error["fault"]>().toEqualTypeOf<"client" | "server">()
    expectTypeOf<s3.S3Error["isRetryable"]>().toEqualTypeOf<boolean>()
    expectTypeOf<s3.S3Error["statusCode"]>().toEqualTypeOf<number | undefined>()
  })
})

describe("paginate", () => {
  it("streams the output of paginated commands", () => {
    expectTypeOf(s3.paginate("list_objects_v2", { Bucket: "b" })).toEqualTypeOf<
      Stream.Stream<S3Sdk.ListObjectsV2CommandOutput, s3.S3Error<"list_objects_v2">, s3.S3Client>
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
      Effect.Effect<void, dynamodb.DynamoDBWaiterError<"table_exists">, dynamodb.DynamoDBClient>
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
  it("accepts native types and raises DynamoDB exceptions", () => {
    expectTypeOf(dynamodb_document.make("get", { TableName: "t", Key: { id: "1" } })).toEqualTypeOf<
      Effect.Effect<
        DocumentSdk.GetCommandOutput,
        dynamodb_document.DynamoDBDocumentError<"get">,
        dynamodb_document.DynamoDBDocumentClient
      >
    >()
    // @ts-expect-error Key is required
    dynamodb_document.make("get", { TableName: "t" })

    dynamodb_document.make("get", { TableName: "t", Key: { id: "1" } }).pipe(
      Effect.catchIf(
        (error) => error.$is("ResourceNotFoundException"),
        (error) => {
          expectTypeOf(error.cause).toExtend<DynamoDBSdk.ResourceNotFoundException>()
          return Effect.void
        }
      )
    )
  })

  it("requires the base client", () => {
    expectTypeOf(dynamodb_document.DynamoDBDocumentClient.layer()).toEqualTypeOf<
      Layer.Layer<dynamodb_document.DynamoDBDocumentClient, never, dynamodb.DynamoDBClient>
    >()
  })
})

describe("makeClients", () => {
  it("provides every client", () => {
    expectTypeOf(makeClients()).toEqualTypeOf<
      Layer.Layer<dynamodb.DynamoDBClient | dynamodb_document.DynamoDBDocumentClient | s3.S3Client | sqs.SQSClient>
    >()
    makeClients({ dynamodb_document: { marshallOptions: { removeUndefinedValues: true } } })
  })
})

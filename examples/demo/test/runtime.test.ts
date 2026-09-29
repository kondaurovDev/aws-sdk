// Runs the generated wrappers against real SDK clients whose HTTP layer is
// replaced by canned responses, so no AWS account or network is involved.
import * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import * as S3Sdk from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"

import { dynamodb, makeClients, s3 } from "../src/generated/index.js"
import { ensureBucket, getItem } from "../src/main.js"
import { dynamodbJson, fakeAws, s3Error, type Handle } from "./fake-aws.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("s3", () => {
  it("returns the command output", async () => {
    const layer = s3.S3Client.layer(fakeAws(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/xml" },
      body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>` +
        `<Bucket><Name>first</Name></Bucket><Bucket><Name>second</Name></Bucket>` +
        `</Buckets></ListAllMyBucketsResult>`
    })))

    const output = await Effect.runPromise(s3.make("list_buckets").pipe(Effect.provide(layer)))

    expect(output.Buckets?.map((bucket) => bucket.Name)).toEqual(["first", "second"])
  })

  it("fails with a typed error for modeled exceptions", async () => {
    const layer = s3.S3Client.layer(fakeAws(async () => s3Error(409, "BucketAlreadyExists")))

    const error = await Effect.runPromise(
      s3.make("create_bucket", { Bucket: "taken" }).pipe(Effect.flip, Effect.provide(layer))
    )

    expect(error).toBeInstanceOf(s3.S3Error)
    expect(error._tag).toBe("S3Error")
    expect(error.command).toBe("create_bucket")
    expect(error.cause).toBeInstanceOf(S3Sdk.BucketAlreadyExists)
    expect(error.message).toBe("create_bucket: BucketAlreadyExists: BucketAlreadyExists message")
    expect(error.$is("BucketAlreadyExists")).toBe(true)
    expect(error.$is("BucketAlreadyOwnedByYou")).toBe(false)
    expect(error.is("BucketAlreadyExists")).toBe(true)
  })

  it("recovers from a documented exception (examples/demo/src/main.ts)", async () => {
    const handle = vi.fn<Handle>(async (request) =>
      request.method === "PUT"
        ? s3Error(409, "BucketAlreadyOwnedByYou")
        : {
            statusCode: 200,
            body: `<ListAllMyBucketsResult><Buckets><Bucket><Name>mine</Name></Bucket></Buckets></ListAllMyBucketsResult>`
          }
    )

    const buckets = await Effect.runPromise(
      ensureBucket("mine").pipe(Effect.provide(s3.S3Client.layer(fakeAws(handle))))
    )

    expect(buckets).toEqual(["mine"])
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it("turns failures outside the service model into defects", async () => {
    const layer = s3.S3Client.layer(fakeAws(async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
    }))

    const exit = await Effect.runPromiseExit(s3.make("list_buckets").pipe(Effect.provide(layer)))

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("socket hang up")
  })

  it("aborts the HTTP request when interrupted", async () => {
    let signal: AbortSignal | undefined
    const layer = s3.S3Client.layer(fakeAws((_, abortSignal) => {
      signal = abortSignal
      return new Promise(() => {})
    }))

    const result = await Effect.runPromise(
      s3.make("list_buckets").pipe(Effect.timeoutOption("50 millis"), Effect.provide(layer))
    )

    expect(result._tag).toBe("None")
    expect(signal?.aborted).toBe(true)
  })

  it("destroys the SDK client when the layer is released", async () => {
    const destroy = vi.spyOn(S3Sdk.S3Client.prototype, "destroy")
    const layer = s3.S3Client.layer(fakeAws(async () => s3Error(404, "NoSuchBucket")))

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* s3.S3Client
        expect(client).toBeInstanceOf(S3Sdk.S3Client)
        expect(destroy).not.toHaveBeenCalled()
      }).pipe(Effect.provide(layer))
    )

    expect(destroy).toHaveBeenCalledOnce()
  })

  it("accepts an SDK client created elsewhere", async () => {
    const client = new S3Sdk.S3Client(fakeAws(async () => s3Error(404, "NoSuchBucket")))

    const error = await Effect.runPromise(
      s3.make("list_objects_v2", { Bucket: "missing" }).pipe(
        Effect.flip,
        Effect.provide(Layer.succeed(s3.S3Client, client))
      )
    )

    expect(error.$is("NoSuchBucket")).toBe(true)
  })

  it("applies the default region from aws-sdk.json", async () => {
    const region = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* s3.S3Client
        return yield* Effect.promise(() => client.config.region())
      }).pipe(Effect.provide(s3.S3Client.layer()))
    )

    expect(region).toBe("us-east-1")
  })
})

describe("dynamodb", () => {
  const layer = (handle: Handle) => dynamodb.DynamoDBClient.layer(fakeAws(handle))

  it("returns the command output", async () => {
    const item = await Effect.runPromise(
      getItem("users", "1").pipe(
        Effect.provide(layer(async () => dynamodbJson(200, { Item: { id: { S: "1" } } })))
      )
    )

    expect(item).toEqual({ id: { S: "1" } })
  })

  it("recovers from a documented exception (examples/demo/src/main.ts)", async () => {
    const item = await Effect.runPromise(
      getItem("missing", "1").pipe(
        Effect.provide(layer(async () =>
          dynamodbJson(400, {
            __type: "com.amazonaws.dynamodb.v20120810#ResourceNotFoundException",
            message: "Requested resource not found"
          })
        ))
      )
    )

    expect(item).toBeUndefined()
  })

  it("fails with a typed error carrying the SDK exception", async () => {
    const error = await Effect.runPromise(
      dynamodb.make("put_item", { TableName: "users", Item: { id: { S: "1" } } }).pipe(
        Effect.flip,
        Effect.provide(layer(async () =>
          dynamodbJson(400, {
            __type: "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException",
            message: "The conditional request failed"
          })
        ))
      )
    )

    expect(error.$is("ConditionalCheckFailedException")).toBe(true)
    expect(error.cause).toBeInstanceOf(DynamoDBSdk.ConditionalCheckFailedException)
  })
})

describe("makeClients", () => {
  it("builds every client in one layer", async () => {
    const regions = await Effect.runPromise(
      Effect.gen(function* () {
        const s3Client = yield* s3.S3Client
        const dynamodbClient = yield* dynamodb.DynamoDBClient
        return [yield* Effect.promise(() => s3Client.config.region()), yield* Effect.promise(() => dynamodbClient.config.region())]
      }).pipe(Effect.provide(makeClients({ s3: { region: "eu-central-1" } })))
    )

    expect(regions).toEqual(["eu-central-1", "us-east-1"])
  })

  it("is a plain Layer", () => {
    expect(Layer.isLayer(makeClients())).toBe(true)
  })
})

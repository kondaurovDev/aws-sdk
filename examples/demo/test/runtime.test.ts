// Runs the generated wrappers against real SDK clients whose HTTP layer is
// replaced by canned responses, so no AWS account or network is involved.
import * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import * as S3Sdk from "@aws-sdk/client-s3"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"

import { dynamodb, layer, s3 } from "../src/generated/index.js"
import { ensureBucket, getItem } from "../src/main.js"
import { dynamodbError, dynamodbJson, fakeAws, s3Error, s3Xml, type Handle } from "./fake-aws.js"

afterEach(() => {
  vi.restoreAllMocks()
})

const buckets = (...names: Array<string>) =>
  s3Xml(
    `<ListAllMyBucketsResult><Buckets>${names.map((name) => `<Bucket><Name>${name}</Name></Bucket>`).join("")}</Buckets></ListAllMyBucketsResult>`
  )

describe("s3", () => {
  it("returns the command output", async () => {
    const output = await Effect.runPromise(
      s3.send("list_buckets").pipe(Effect.provide(s3.S3Client.layer(fakeAws(async () => buckets("first", "second")))))
    )

    expect(output.Buckets?.map((bucket) => bucket.Name)).toEqual(["first", "second"])
  })

  it("fails with the tagged error of a documented exception", async () => {
    const error = await Effect.runPromise(
      s3.send("create_bucket", { Bucket: "taken" }).pipe(
        Effect.flip,
        Effect.provide(s3.S3Client.layer(fakeAws(async () => s3Error(409, "BucketAlreadyExists"))))
      )
    )

    expect(error).toBeInstanceOf(s3.BucketAlreadyExists)
    expect(error._tag).toBe("BucketAlreadyExists")
    expect(error.command).toBe("create_bucket")
    expect(error.cause).toBeInstanceOf(S3Sdk.BucketAlreadyExists)
    expect(error.message).toBe("create_bucket: BucketAlreadyExists: BucketAlreadyExists message")
  })

  it("recovers from a documented exception (examples/demo/src/main.ts)", async () => {
    const handle = vi.fn<Handle>(async (request) =>
      request.method === "PUT" ? s3Error(409, "BucketAlreadyOwnedByYou") : buckets("mine")
    )

    const names = await Effect.runPromise(ensureBucket("mine").pipe(Effect.provide(s3.S3Client.layer(fakeAws(handle)))))

    expect(names).toEqual(["mine"])
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it("handles several documented exceptions with catchTags", async () => {
    const outcome = await Effect.runPromise(
      s3.send("get_object", { Bucket: "b", Key: "k" }).pipe(
        Effect.map(() => "found"),
        Effect.catchTags({
          NoSuchKey: () => Effect.succeed("no key"),
          InvalidObjectState: () => Effect.succeed("archived")
        }),
        Effect.provide(s3.S3Client.layer(fakeAws(async () => s3Error(404, "NoSuchKey"))))
      )
    )

    expect(outcome).toBe("no key")
  })

  it("raises exceptions not documented for the command as the catch-all with their code", async () => {
    // list_buckets documents no exceptions; AccessDenied is modeled for S3
    const error = await Effect.runPromise(
      s3.send("list_buckets").pipe(
        Effect.flip,
        Effect.provide(s3.S3Client.layer(fakeAws(async () => s3Error(403, "AccessDenied"))))
      )
    )

    expect(error).toBeInstanceOf(s3.S3Error)
    expect(error._tag).toBe("S3Error")
    expect(error.code).toBe("AccessDenied")
    expect(error.cause).toBeInstanceOf(S3Sdk.AccessDenied)
  })

  it("raises exceptions unknown to the SDK model as the catch-all", async () => {
    const error = await Effect.runPromise(
      s3.send("get_object", { Bucket: "b", Key: "k" }).pipe(
        Effect.flip,
        Effect.provide(s3.S3Client.layer(fakeAws(async () => s3Error(400, "BrandNewErrorCode"))))
      )
    )

    expect(error._tag === "S3Error" && error.code).toBe("BrandNewErrorCode")
    expect(error.cause).toBeInstanceOf(S3Sdk.S3ServiceException)
  })

  it("turns failures outside the service model into defects", async () => {
    const layer = s3.S3Client.layer(fakeAws(async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
    }))

    const exit = await Effect.runPromiseExit(s3.send("list_buckets").pipe(Effect.provide(layer)))

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
      s3.send("list_buckets").pipe(Effect.timeoutOption("50 millis"), Effect.provide(layer))
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

  it("exposes the scoped constructor for custom layers", async () => {
    const destroy = vi.spyOn(S3Sdk.S3Client.prototype, "destroy")

    const region = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* s3.S3Client.make({ region: "ap-south-1" })
          return yield* Effect.promise(() => client.config.region())
        })
      )
    )

    expect(region).toBe("ap-south-1")
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("accepts an SDK client created elsewhere", async () => {
    const client = new S3Sdk.S3Client(fakeAws(async () => s3Error(404, "NoSuchBucket")))

    const error = await Effect.runPromise(
      s3.send("list_objects_v2", { Bucket: "missing" }).pipe(
        Effect.flip,
        Effect.provide(Layer.succeed(s3.S3Client, client))
      )
    )

    expect(error._tag).toBe("NoSuchBucket")
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
  const withTable = (handle: Handle) => dynamodb.DynamoDBClient.layer(fakeAws(handle))

  it("returns the command output", async () => {
    const item = await Effect.runPromise(
      getItem("users", "1").pipe(
        Effect.provide(withTable(async () => dynamodbJson(200, { Item: { id: { S: "1" } } })))
      )
    )

    expect(item).toEqual({ id: { S: "1" } })
  })

  it("recovers from a documented exception (examples/demo/src/main.ts)", async () => {
    const item = await Effect.runPromise(
      getItem("missing", "1").pipe(
        Effect.provide(withTable(async () => dynamodbError("ResourceNotFoundException", "Requested resource not found")))
      )
    )

    expect(item).toBeUndefined()
  })

  it("fails with a tagged error carrying the SDK exception", async () => {
    const error = await Effect.runPromise(
      dynamodb.send("put_item", { TableName: "users", Item: { id: { S: "1" } } }).pipe(
        Effect.flip,
        Effect.provide(withTable(async () => dynamodbError("ConditionalCheckFailedException", "The conditional request failed")))
      )
    )

    expect(error._tag).toBe("ConditionalCheckFailedException")
    expect(error.cause).toBeInstanceOf(DynamoDBSdk.ConditionalCheckFailedException)
  })
})

describe("layer", () => {
  it("builds every client in one layer", async () => {
    const regions = await Effect.runPromise(
      Effect.gen(function* () {
        const s3Client = yield* s3.S3Client
        const dynamodbClient = yield* dynamodb.DynamoDBClient
        return [yield* Effect.promise(() => s3Client.config.region()), yield* Effect.promise(() => dynamodbClient.config.region())]
      }).pipe(Effect.provide(layer({ s3: { region: "eu-central-1" } })))
    )

    expect(regions).toEqual(["eu-central-1", "us-east-1"])
  })

  it("is a plain Layer", () => {
    expect(Layer.isLayer(layer())).toBe(true)
  })
})

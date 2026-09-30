import { readFileSync } from "node:fs"
import * as DynamoDBSdk from "@aws-sdk/client-dynamodb"
import { describe, expect, it, vi } from "vitest"
import { Cause, Effect, Exit, Layer, Stream } from "effect"

import { dynamodb, dynamodb_document, layer, s3 } from "../src/generated/index.js"
import { listKeys } from "../src/main.js"
import { dynamodbError, dynamodbJson, fakeAws, requestJson, s3Error, s3Xml, type Handle } from "./fake-aws.js"

const listing = (keys: ReadonlyArray<string>, nextToken?: string) =>
  s3Xml(
    `<ListBucketResult><Name>b</Name><IsTruncated>${nextToken ? "true" : "false"}</IsTruncated>` +
      (nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : "") +
      keys.map((key) => `<Contents><Key>${key}</Key></Contents>`).join("") +
      `</ListBucketResult>`
  )

const collect = <A, E, R>(stream: Stream.Stream<A, E, R>) => Stream.runCollect(stream)

describe("paginate", () => {
  it("streams every page, following the continuation token", async () => {
    const handle = vi.fn<Handle>(async (request) =>
      request.query["continuation-token"] === "t1" ? listing(["c"]) : listing(["a", "b"], "t1")
    )

    const keys = await Effect.runPromise(listKeys("b").pipe(Effect.provide(s3.S3Client.layer(fakeAws(handle)))))

    expect(keys).toEqual(["a", "b", "c"])
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it("passes the page size to the command", async () => {
    const handle = vi.fn<Handle>(async () => listing([]))

    await Effect.runPromise(
      collect(s3.paginate("list_objects_v2", { Bucket: "b" }, { pageSize: 5 })).pipe(
        Effect.provide(s3.S3Client.layer(fakeAws(handle)))
      )
    )

    expect(handle.mock.calls[0]![0].query["max-keys"]).toBe("5")
  })

  it("fails with the tagged error of the paginated command", async () => {
    const error = await Effect.runPromise(
      collect(s3.paginate("list_objects_v2", { Bucket: "missing" })).pipe(
        Effect.flip,
        Effect.provide(s3.S3Client.layer(fakeAws(async () => s3Error(404, "NoSuchBucket"))))
      )
    )

    expect(error._tag).toBe("NoSuchBucket")
    expect(error.command).toBe("list_objects_v2")
  })

  it("aborts the request in flight when the consumer leaves", async () => {
    let signal: AbortSignal | undefined
    const handle: Handle = (request, abortSignal) => {
      if (request.query["continuation-token"] === undefined) return Promise.resolve(listing(["a"], "t1"))
      signal = abortSignal
      // Like a real HTTP handler: pending until aborted
      return new Promise((_, reject) =>
        abortSignal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
      )
    }

    const result = await Effect.runPromise(
      collect(s3.paginate("list_objects_v2", { Bucket: "b" })).pipe(
        Effect.timeoutOption("100 millis"),
        Effect.provide(s3.S3Client.layer(fakeAws(handle)))
      )
    )

    expect(result._tag).toBe("None")
    expect(signal?.aborted).toBe(true)
  })

  it("unmarshalls document client pages", async () => {
    const handle = vi.fn<Handle>(async (request) =>
      requestJson(request).ExclusiveStartKey
        ? dynamodbJson(200, { Items: [{ id: { S: "2" } }] })
        : dynamodbJson(200, { Items: [{ id: { S: "1" } }], LastEvaluatedKey: { id: { S: "1" } } })
    )

    const pages = await Effect.runPromise(
      collect(dynamodb_document.paginate("scan", { TableName: "t" })).pipe(
        Effect.provide(layer({ dynamodb: fakeAws(handle) }))
      )
    )

    expect(pages.map((page) => page.Items)).toEqual([[{ id: "1" }], [{ id: "2" }]])
  })
})

describe("waitUntil", () => {
  const fast = { maxWaitTime: "5 seconds", minDelay: "10 millis", maxDelay: "20 millis" } as const
  const table = (TableStatus: string) => dynamodbJson(200, { Table: { TableName: "t", TableStatus } })
  const withTable = (handle: Handle) => dynamodb.DynamoDBClient.layer(fakeAws(handle))

  it("polls until the awaited state is reached", async () => {
    const handle = vi.fn<Handle>().mockResolvedValueOnce(table("CREATING")).mockResolvedValue(table("ACTIVE"))

    await Effect.runPromise(
      dynamodb.waitUntil("table_exists", { TableName: "t" }, fast).pipe(Effect.provide(withTable(handle)))
    )

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it("fails with TIMEOUT when maxWaitTime elapses", async () => {
    const error = await Effect.runPromise(
      dynamodb
        .waitUntil("table_exists", { TableName: "t" }, { ...fast, maxWaitTime: "300 millis" })
        .pipe(Effect.flip, Effect.provide(withTable(async () => table("CREATING"))))
    )

    expect(error).toBeInstanceOf(dynamodb.DynamoDBWaiterError)
    expect(error.waiter).toBe("table_exists")
    expect(error.state).toBe("TIMEOUT")
    expect(error.message).toBe("table_exists: not reached within maxWaitTime")
  })

  it("fails with FAILURE when a terminal state is observed", async () => {
    const error = await Effect.runPromise(
      dynamodb.waitUntil("export_completed", { ExportArn: "arn" }, fast).pipe(
        Effect.flip,
        Effect.provide(withTable(async () => dynamodbJson(200, { ExportDescription: { ExportStatus: "FAILED" } })))
      )
    )

    expect(error.state).toBe("FAILURE")
    expect(error.reason).toMatchObject({ ExportDescription: { ExportStatus: "FAILED" } })
  })

  it("stops polling when interrupted", async () => {
    const result = await Effect.runPromise(
      dynamodb.waitUntil("table_exists", { TableName: "t" }, fast).pipe(
        Effect.timeoutOption("50 millis"),
        Effect.provide(withTable(() => new Promise(() => {})))
      )
    )

    expect(result._tag).toBe("None")
  })

  it("treats an invalid configuration as a defect", async () => {
    const exit = await Effect.runPromiseExit(
      dynamodb
        .waitUntil("table_exists", { TableName: "t" }, { maxWaitTime: "10 millis", minDelay: "1 second" })
        .pipe(Effect.provide(withTable(async () => table("ACTIVE"))))
    )

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("WaiterConfiguration.maxWaitTime")
  })
})

describe("presign", () => {
  it("signs a URL without calling AWS", async () => {
    const handle = vi.fn<Handle>()

    const url = new URL(
      await Effect.runPromise(
        s3.presign("get_object", { Bucket: "my-bucket", Key: "k" }, { expiresIn: 60 }).pipe(
          Effect.provide(s3.S3Client.layer(fakeAws(handle)))
        )
      )
    )

    expect(url.hostname).toBe("my-bucket.s3.us-east-1.amazonaws.com")
    expect(url.pathname).toBe("/k")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60")
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/)
    expect(handle).not.toHaveBeenCalled()
  })

  it("accepts commands without input", async () => {
    const url = await Effect.runPromise(
      s3.presign("list_buckets").pipe(Effect.provide(s3.S3Client.layer(fakeAws(vi.fn<Handle>()))))
    )

    expect(url).toContain("X-Amz-Signature=")
  })
})

describe("dynamodb_document", () => {
  it("marshalls the input and unmarshalls the output", async () => {
    const handle = vi.fn<Handle>(async () => dynamodbJson(200, { Item: { id: { S: "1" }, name: { S: "Alice" } } }))

    const output = await Effect.runPromise(
      dynamodb_document.send("get", { TableName: "users", Key: { id: "1" } }).pipe(
        Effect.provide(layer({ dynamodb: fakeAws(handle) }))
      )
    )

    expect(output.Item).toEqual({ id: "1", name: "Alice" })
    expect(requestJson(handle.mock.calls[0]![0])).toEqual({ TableName: "users", Key: { id: { S: "1" } } })
  })

  it("raises the exceptions of the base client as its own tagged errors", async () => {
    const error = await Effect.runPromise(
      dynamodb_document.send("get", { TableName: "missing", Key: { id: "1" } }).pipe(
        Effect.flip,
        Effect.provide(layer({ dynamodb: fakeAws(async () => dynamodbError("ResourceNotFoundException", "no")) }))
      )
    )

    expect(error).toBeInstanceOf(dynamodb_document.ResourceNotFoundException)
    expect(error._tag).toBe("ResourceNotFoundException")
    expect(error.cause).toBeInstanceOf(DynamoDBSdk.ResourceNotFoundException)
  })

  it("applies the translate config to the base client from the context", async () => {
    const handle = vi.fn<Handle>(async () => dynamodbJson(200, {}))
    const document = dynamodb_document.DynamoDBDocumentClient.layer({ marshallOptions: { removeUndefinedValues: true } }).pipe(
      Layer.provide(dynamodb.DynamoDBClient.layer(fakeAws(handle)))
    )

    await Effect.runPromise(
      dynamodb_document.send("put", { TableName: "users", Item: { id: "1", note: undefined } }).pipe(Effect.provide(document))
    )

    expect(requestJson(handle.mock.calls[0]![0]).Item).toEqual({ id: { S: "1" } })
  })
})

describe("error metadata", () => {
  const putItem = (response: Handle) =>
    Effect.runPromise(
      dynamodb.send("put_item", { TableName: "t", Item: { id: { S: "1" } } }).pipe(
        Effect.flip,
        Effect.provide(dynamodb.DynamoDBClient.layer(fakeAws(response)))
      )
    )

  it("exposes the retryable trait, fault, status and request id", async () => {
    const error = await putItem(async () => ({
      ...dynamodbError("ReplicatedWriteConflictException", "conflict"),
      headers: { "content-type": "application/x-amz-json-1.0", "x-amzn-requestid": "req-1" }
    }))

    expect(error._tag).toBe("ReplicatedWriteConflictException")
    expect(error.isRetryable).toBe(true)
    expect(error.isThrottling).toBe(false)
    expect(error.fault).toBe("client")
    expect(error.statusCode).toBe(400)
    expect(error.requestId).toBe("req-1")
  })

  it("is not retryable for plain client errors", async () => {
    const error = await putItem(async () => dynamodbError("ConditionalCheckFailedException", "failed"))

    expect(error.isRetryable).toBe(false)
  })

  it("drives Effect.retry through the metadata", async () => {
    const handle = vi
      .fn<Handle>()
      .mockResolvedValueOnce(dynamodbError("ReplicatedWriteConflictException", "conflict"))
      .mockResolvedValue(dynamodbJson(200, {}))

    await Effect.runPromise(
      dynamodb.send("put_item", { TableName: "t", Item: { id: { S: "1" } } }).pipe(
        Effect.retry({ while: (error) => error.isRetryable, times: 3 }),
        Effect.provide(dynamodb.DynamoDBClient.layer(fakeAws(handle)))
      )
    )

    expect(handle).toHaveBeenCalledTimes(2)
  })
})

describe("generated docs", () => {
  it("documents each command where the SDK does", () => {
    const source = readFileSync(new URL("../src/generated/s3.ts", import.meta.url), "utf-8")
    expect(source).toMatch(/\n  \/\*\*\n(?:   \* .*\n)+   \*\/\n  list_buckets: \[/)
    expect(source).toMatch(/\* Returns a list of all buckets owned by the authenticated sender/)
  })
})

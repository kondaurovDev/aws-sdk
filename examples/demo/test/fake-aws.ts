// Real SDK clients whose HTTP layer is replaced by canned responses, so no AWS
// account or network is involved.
import { Readable } from "node:stream"

export interface CannedResponse {
  readonly statusCode: number
  readonly headers?: Record<string, string>
  readonly body?: string
}

export interface FakeRequest {
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string>
  readonly query: Record<string, string | Array<string> | null>
  readonly body?: unknown
}

export type Handle = (request: FakeRequest, signal?: AbortSignal) => Promise<CannedResponse>

/** SDK client config whose requests are answered by `handle`. */
export const fakeAws = (handle: Handle) => ({
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  maxAttempts: 1,
  requestHandler: {
    handle: async (request: FakeRequest, options?: { abortSignal?: AbortSignal }) => {
      const { statusCode, headers = {}, body = "" } = await handle(request, options?.abortSignal)
      return { response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) } }
    }
  }
})

export const s3Xml = (body: string, headers: Record<string, string> = {}): CannedResponse => ({
  statusCode: 200,
  headers: { "content-type": "application/xml", ...headers },
  body: `<?xml version="1.0" encoding="UTF-8"?>${body}`
})

export const s3Error = (statusCode: number, code: string): CannedResponse => ({
  statusCode,
  headers: { "content-type": "application/xml" },
  body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code} message</Message></Error>`
})

export const dynamodbJson = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): CannedResponse => ({
  statusCode,
  headers: { "content-type": "application/x-amz-json-1.0", ...headers },
  body: JSON.stringify(body)
})

export const dynamodbError = (name: string, message: string): CannedResponse =>
  dynamodbJson(400, { __type: `com.amazonaws.dynamodb.v20120810#${name}`, message })

/** Parses the JSON body of a DynamoDB request. */
export const requestJson = (request: FakeRequest): any => JSON.parse(String(request.body))

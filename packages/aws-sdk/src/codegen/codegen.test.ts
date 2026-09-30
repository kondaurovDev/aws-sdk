import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import type { SdkModel } from "../scan/model.ts"
import { makeTempDir, writeTree } from "../testing/fixtures.ts"
import { GENERATED_MARKER, renderClient, renderFiles, renderIndex } from "./render.ts"
import { writeFiles } from "./write.ts"

const acme: SdkModel = {
  client: "acme",
  packageName: "@aws-sdk/client-acme",
  clientClassName: "AcmeClient",
  configInterfaceName: "AcmeClientConfig",
  serviceExceptionName: "AcmeServiceException",
  exceptions: ["AccessDeniedException", "ThingNotFound"],
  commands: [
    { name: "GetThing", method: "get_thing", errors: ["AccessDeniedException", "ThingNotFound"], docs: "Gets a thing." },
    { name: "ListThings", method: "list_things", errors: [], docs: undefined }
  ],
  paginators: [{ method: "list_things", functionName: "paginateListThings" }],
  waiters: [{ method: "thing_exists", functionName: "waitUntilThingExists" }],
  presigner: "@aws-sdk/acme-request-presigner",
  base: undefined
}

const plain: SdkModel = { ...acme, paginators: [], waiters: [], presigner: undefined }

const cloudwatchLogs: SdkModel = {
  ...plain,
  client: "cloudwatch-logs",
  packageName: "@aws-sdk/client-cloudwatch-logs",
  clientClassName: "CloudWatchLogsClient",
  configInterfaceName: "CloudWatchLogsClientConfig",
  serviceExceptionName: "CloudWatchLogsServiceException"
}

const acmeDocument: SdkModel = {
  client: "acme-document",
  packageName: "@aws-sdk/lib-acme",
  clientClassName: "AcmeDocumentClient",
  configInterfaceName: "TranslateConfig",
  serviceExceptionName: "AcmeServiceException",
  exceptions: acme.exceptions,
  commands: [
    { name: "Get", method: "get", errors: ["AccessDeniedException", "ThingNotFound"], docs: "Gets a thing." },
    { name: "List", method: "list", errors: [], docs: undefined }
  ],
  paginators: [{ method: "list", functionName: "paginateList" }],
  waiters: [],
  presigner: undefined,
  base: { client: "acme", packageName: "@aws-sdk/client-acme", clientClassName: "AcmeClient" }
}

describe("renderClient", () => {
  it("renders a client with paginators, waiters and a presigner", () => {
    // The generated code is type-checked and exercised in examples/demo
    expect(renderClient(acme, { region: "eu-west-1" })).toMatchSnapshot()
  })

  it("renders a document client on top of its base client", () => {
    expect(renderClient(acmeDocument, { region: undefined })).toMatchSnapshot()
  })

  it("starts with the generated marker", () => {
    expect(renderClient(plain, { region: undefined }).startsWith(`${GENERATED_MARKER}\n`)).toBe(true)
  })

  it("applies the default region only when configured", () => {
    expect(renderClient(plain, { region: "eu-west-1" })).toContain(
      `new Sdk.AcmeClient({ region: "eu-west-1", ...config })`
    )
    expect(renderClient(plain, { region: undefined })).toContain("new Sdk.AcmeClient(config ?? {})")
  })

  it("documents commands and types undocumented errors as never", () => {
    const code = renderClient(plain, { region: undefined })
    expect(code).toContain(
      `  /** Gets a thing. */\n  get_thing: [Sdk.GetThingCommandInput, Sdk.GetThingCommandOutput, AccessDeniedException | ThingNotFound]`
    )
    expect(code).toContain(`\n  list_things: [Sdk.ListThingsCommandInput, Sdk.ListThingsCommandOutput, never]`)
  })

  it("generates a tagged error class per modeled exception and a catch-all", () => {
    const code = renderClient(plain, { region: undefined })
    expect(code).toContain(`export class ThingNotFound extends acmeException("ThingNotFound") {\n  declare readonly cause: Sdk.ThingNotFound\n}`)
    expect(code).toContain(`export class AcmeError extends acmeException("AcmeError")`)
    expect(code).toContain(`export type AcmeErrors = AccessDeniedException | ThingNotFound | AcmeError`)
    expect(code).toContain(`get_thing: ["AccessDeniedException","ThingNotFound"],`)
  })

  it("takes the exceptions of a document client from the base package", () => {
    const code = renderClient(acmeDocument, { region: undefined })
    expect(code).toContain(`declare readonly cause: Base.ThingNotFound`)
    expect(code).toContain(`cause instanceof Base.AcmeServiceException`)
  })

  it("omits paginate, waitUntil and presign when the SDK offers none", () => {
    const code = renderClient(plain, { region: undefined })
    for (const absent of ["paginate", "waitUntil", "presign", "effect/Stream", "effect/Duration", "getSignedUrl"]) {
      expect(code).not.toContain(absent)
    }
  })
})

describe("renderIndex", () => {
  it("re-exports every client and merges their layers", () => {
    expect(renderIndex([acme, cloudwatchLogs])).toMatchSnapshot()
  })

  it("provides base clients to document clients", () => {
    const code = renderIndex([acme, acmeDocument])
    expect(code).toContain(`import type { TranslateConfig } from "@aws-sdk/lib-acme"`)
    expect(code).toContain("readonly acme_document?: TranslateConfig")
    expect(code).toContain(
      `export const layer = (config?: ClientsConfig) =>\n  Layer.provideMerge(\n    Layer.mergeAll(\n      acme_document.AcmeDocumentClient.layer(config?.acme_document),\n    ),\n    Layer.mergeAll(\n      acme.AcmeClient.layer(config?.acme),\n    )\n  )`
    )
  })
})

describe("writeFiles", () => {
  const files = renderFiles([plain], { region: undefined })
  const list = (dir: string) => readdir(dir, { recursive: true }).then((entries) => entries.sort())

  it("writes files and skips unchanged ones on the next run", async () => {
    const dir = path.join(await makeTempDir(), "generated")

    const first = await Effect.runPromise(writeFiles(dir, files))
    const second = await Effect.runPromise(writeFiles(dir, files))

    expect(first).toEqual({ written: ["acme.ts", "index.ts"], unchanged: [], removed: [] })
    expect(second).toEqual({ written: [], unchanged: ["acme.ts", "index.ts"], removed: [] })
    expect(await readFile(path.join(dir, "acme.ts"), "utf-8")).toBe(files[0]!.content)
  })

  it("removes stale generated files but keeps everything else", async () => {
    const dir = await makeTempDir()
    await writeTree(dir, {
      "removed-client.ts": `${GENERATED_MARKER}\nexport {}`,
      // Left over by 1.x
      "internal/utils.ts": `${GENERATED_MARKER}\nexport {}`,
      "handwritten.ts": "export const keep = true",
      "notes/readme.md": GENERATED_MARKER
    })

    const result = await Effect.runPromise(writeFiles(dir, files))

    expect([...result.removed].sort()).toEqual([path.join("internal", "utils.ts"), "removed-client.ts"])
    expect(await list(dir)).toEqual(["acme.ts", "handwritten.ts", "index.ts", "notes", path.join("notes", "readme.md")])
  })

  it("fails with WriteError when the directory cannot be created", async () => {
    const root = await makeTempDir()
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "occupied"), "a file, not a directory")

    const error = await Effect.runPromise(Effect.flip(writeFiles(path.join(root, "occupied"), files)))

    expect(error._tag).toBe("WriteError")
  })
})

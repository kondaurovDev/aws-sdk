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
    { name: "GetThing", method: "get_thing", errors: ["AccessDeniedException", "ThingNotFound"] },
    { name: "ListThings", method: "list_things", errors: [] }
  ]
}

const cloudwatchLogs: SdkModel = {
  ...acme,
  client: "cloudwatch-logs",
  packageName: "@aws-sdk/client-cloudwatch-logs",
  clientClassName: "CloudWatchLogsClient",
  configInterfaceName: "CloudWatchLogsClientConfig",
  serviceExceptionName: "CloudWatchLogsServiceException"
}

describe("renderClient", () => {
  it("renders the client module", () => {
    // The generated code is type-checked and exercised in examples/demo
    expect(renderClient(acme, { region: "eu-west-1" })).toMatchSnapshot()
  })

  it("starts with the generated marker", () => {
    expect(renderClient(acme, { region: undefined }).startsWith(`${GENERATED_MARKER}\n`)).toBe(true)
  })

  it("applies the default region only when configured", () => {
    expect(renderClient(acme, { region: "eu-west-1" })).toContain(
      `new Sdk.AcmeClient({ region: "eu-west-1", ...config })`
    )
    expect(renderClient(acme, { region: undefined })).toContain("new Sdk.AcmeClient(config ?? {})")
  })

  it("types commands without documented errors as never", () => {
    const code = renderClient(acme, { region: undefined })
    expect(code).toContain(
      `get_thing: [Sdk.GetThingCommandInput, Sdk.GetThingCommandOutput, "AccessDeniedException" | "ThingNotFound"]`
    )
    expect(code).toContain(`list_things: [Sdk.ListThingsCommandInput, Sdk.ListThingsCommandOutput, never]`)
  })
})

describe("renderIndex", () => {
  it("re-exports every client and merges their layers", () => {
    expect(renderIndex([acme, cloudwatchLogs])).toMatchSnapshot()
  })
})

describe("writeFiles", () => {
  const files = renderFiles([acme], { region: undefined })
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

import { readdir, readFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"

import { ProjectRoot } from "../config/config.ts"
import {
  acmeDocumentSdkFiles,
  acmeSdkFiles,
  collectLogs,
  installAcmeSdk,
  installPackage,
  makeTempDir,
  writeJson
} from "../testing/fixtures.ts"
import { generate } from "./generate.ts"

const run = (root: string) => collectLogs(generate.pipe(Effect.provideService(ProjectRoot, root)))

describe("generate", () => {
  it("generates wrappers for the installed clients", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)
    await writeJson(root, "package.json", { dependencies: { "@aws-sdk/client-acme": "1.0.0" } })
    await writeJson(root, "aws-sdk.json", { generate_to: "src/aws", global: { region: "eu-west-1" } })

    const { exit, logs } = await run(root)

    expect(exit).toEqual(Exit.succeed(["acme"]))
    const outDir = path.join(root, "src/aws")
    expect((await readdir(outDir)).sort()).toEqual(["acme.ts", "index.ts"])
    expect(await readFile(path.join(outDir, "acme.ts"), "utf-8")).toContain(`region: "eu-west-1"`)
    expect(logs.map((log) => log.message)).toEqual([
      "Scanned @aws-sdk/client-acme: 3 commands",
      "src/aws: 2 written, 0 unchanged, 0 removed"
    ])
  })

  it("generates the document client next to its base client", async () => {
    const root = await makeTempDir()
    // The acme fixtures stand in for client-dynamodb and lib-dynamodb
    await installPackage(root, "@aws-sdk/client-dynamodb", acmeSdkFiles)
    await installPackage(root, "@aws-sdk/lib-dynamodb", acmeDocumentSdkFiles)
    await writeJson(root, "package.json", {
      dependencies: { "@aws-sdk/client-dynamodb": "1.0.0", "@aws-sdk/lib-dynamodb": "1.0.0" }
    })

    const { exit, logs } = await run(root)

    expect(exit).toEqual(Exit.succeed(["dynamodb", "dynamodb-document"]))
    const outDir = path.join(root, "src/generated")
    expect((await readdir(outDir)).sort()).toEqual(["dynamodb-document.ts", "dynamodb.ts", "index.ts"])
    expect(await readFile(path.join(outDir, "dynamodb-document.ts"), "utf-8")).toContain(
      `import { AcmeClient } from "./dynamodb.js"`
    )
    expect(await readFile(path.join(outDir, "index.ts"), "utf-8")).toContain("Layer.provideMerge(")
    expect(logs.map((log) => log.message)).toContain("Scanned @aws-sdk/lib-dynamodb: 2 commands")
  })

  it("warns when the document library is installed without its base client", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)
    await writeJson(root, "package.json", { dependencies: { "@aws-sdk/lib-dynamodb": "1.0.0" } })
    await writeJson(root, "aws-sdk.json", { clients: ["acme"] })

    const { exit, logs } = await run(root)

    expect(exit).toEqual(Exit.succeed(["acme"]))
    expect(logs).toContainEqual({
      level: "Warn",
      message: expect.stringContaining("@aws-sdk/lib-dynamodb is installed but the dynamodb client is not generated")
    })
  })

  it("warns and generates nothing without clients", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", { dependencies: {} })

    const { exit, logs } = await run(root)

    expect(exit).toEqual(Exit.succeed([]))
    expect(logs).toEqual([{ level: "Warn", message: expect.stringContaining("No clients to generate") }])
    await expect(readdir(path.join(root, "src/generated"))).rejects.toThrow()
  })

  it("reports every client that cannot be scanned, then fails", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)
    await writeJson(root, "package.json", {})
    await writeJson(root, "aws-sdk.json", { clients: ["s3", "acme", "sqs"] })

    const { exit, logs } = await run(root)

    expect(logs.filter((log) => log.level === "Error").map((log) => log.message)).toEqual([
      expect.stringContaining("@aws-sdk/client-s3 is not installed"),
      expect.stringContaining("@aws-sdk/client-sqs is not installed")
    ])
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("2 of 3 clients could not be scanned")
    await expect(readdir(path.join(root, "src/generated"))).rejects.toThrow()
  })
})

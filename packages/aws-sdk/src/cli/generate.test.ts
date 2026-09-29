import { readdir, readFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"

import { ProjectRoot } from "../config/config.ts"
import { collectLogs, installAcmeSdk, makeTempDir, writeJson } from "../testing/fixtures.ts"
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

  it("warns and generates nothing without clients", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", { dependencies: {} })

    const { exit, logs } = await run(root)

    expect(exit).toEqual(Exit.succeed([]))
    expect(logs).toEqual([{ level: "Warn", message: expect.stringContaining("No clients to generate") }])
    await expect(readdir(path.join(root, "src/generated"))).rejects.toThrow()
  })

  it("fails when a configured client is not installed", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", {})
    await writeJson(root, "aws-sdk.json", { clients: ["s3"] })

    const { exit } = await run(root)

    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("@aws-sdk/client-s3 is not installed")
  })
})

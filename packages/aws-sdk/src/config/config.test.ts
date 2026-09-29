import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"

import { collectLogs, makeTempDir, writeJson, writeTree } from "../testing/fixtures.ts"
import { ConfigError, loadConfig, ProjectRoot } from "./config.ts"
import { makeJsonSchema } from "./json-schema.ts"

const load = (root: string) => loadConfig.pipe(Effect.provideService(ProjectRoot, root))

const loadError = (root: string) => Effect.runPromise(Effect.flip(load(root)))

describe("loadConfig", () => {
  it("takes clients from dependencies and devDependencies when aws-sdk.json is absent", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", {
      dependencies: { "@aws-sdk/client-sqs": "^3", "@aws-sdk/client-s3": "^3", effect: "^4" },
      devDependencies: { "@aws-sdk/client-s3": "^3", "@aws-sdk/client-dynamodb": "^3", "@aws-sdk/types": "^3" }
    })

    const config = await Effect.runPromise(load(root))

    expect(config).toEqual({
      root,
      generateTo: path.join(root, "src/generated"),
      clients: ["dynamodb", "s3", "sqs"],
      region: undefined,
      dependencies: ["@aws-sdk/client-dynamodb", "@aws-sdk/client-s3", "@aws-sdk/client-sqs", "@aws-sdk/types", "effect"]
    })
  })

  it("applies aws-sdk.json", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", { dependencies: { "@aws-sdk/client-sqs": "^3" } })
    await writeJson(root, "aws-sdk.json", {
      $schema: "node_modules/@effect-ak/aws-sdk/schema.json",
      generate_to: "lib/aws",
      clients: ["s3", "@aws-sdk/client-dynamodb", "s3"],
      global: { region: "eu-west-1" }
    })

    const config = await Effect.runPromise(load(root))

    expect(config).toEqual({
      root,
      generateTo: path.join(root, "lib/aws"),
      clients: ["s3", "dynamodb"],
      region: "eu-west-1",
      dependencies: ["@aws-sdk/client-sqs"]
    })
  })

  it("fails without package.json", async () => {
    const root = await makeTempDir()

    const error = await loadError(root)

    expect(error).toBeInstanceOf(ConfigError)
    expect(error.message).toBe(`${path.join(root, "package.json")} not found`)
  })

  it.each([
    ["malformed JSON", "{ clients: "],
    ["an empty client list", JSON.stringify({ clients: [] })],
    ["a wrong type", JSON.stringify({ generate_to: 42 })],
    ["a misspelled key", JSON.stringify({ generateTo: "lib" })]
  ])("rejects aws-sdk.json with %s", async (_, content) => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", {})
    await writeTree(root, { "aws-sdk.json": content })

    const error = await loadError(root)

    expect(error.message).toMatch(new RegExp(`^Invalid ${path.join(root, "aws-sdk.json")}: `))
  })

  it("warns when the project still depends on Effect 3", async () => {
    const root = await makeTempDir()
    await writeJson(root, "package.json", { dependencies: { effect: "^3.12.0" } })

    const { exit, logs } = await collectLogs(load(root))

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(logs).toContainEqual({
      level: "Warn",
      message: expect.stringContaining("effect@^3.12.0, but the generated code requires Effect 4")
    })
  })
})

describe("schema.json", () => {
  it("is up to date with the config schema (run `pnpm generate:schema`)", async () => {
    const committed = JSON.parse(await readFile(new URL("../../schema.json", import.meta.url), "utf-8"))
    expect(committed).toEqual(makeJsonSchema())
  })
})

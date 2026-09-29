// Generates and typechecks Effect wrappers for every published
// @aws-sdk/client-* package, in a throwaway project outside the repo.
//
//   node scripts/probe-all-clients.ts [--version <aws-sdk version>] [--keep]
//
// Requires a built CLI (`pnpm run build`). Exits with 1 when any client fails
// to scan or the generated code does not typecheck.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    version: { type: "string", default: "latest" },
    keep: { type: "boolean", default: false }
  }
})

const repoRoot = path.resolve(import.meta.dirname, "..")
const cli = path.join(repoRoot, "packages/aws-sdk/dist/cli.mjs")
const tsc = path.join(repoRoot, "node_modules/.bin/tsc")
const effectVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/aws-sdk/node_modules/effect/package.json"), "utf-8")
).version as string

const listClients = async (): Promise<Array<string>> => {
  const headers: Record<string, string> = { "user-agent": "effect-ak/aws-sdk probe" }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch("https://api.github.com/repos/aws/aws-sdk-js-v3/contents/clients?per_page=1000", {
    headers
  })
  if (!response.ok) throw new Error(`GitHub API: ${response.status} ${await response.text()}`)
  const entries = (await response.json()) as Array<{ name: string; type: string }>
  return entries
    .filter((entry) => entry.type === "dir" && entry.name.startsWith("client-"))
    .map((entry) => entry.name.slice("client-".length))
    .sort()
}

const run = (command: string, commandArgs: Array<string>, cwd: string) => {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`)
  execFileSync(command, commandArgs, { cwd, stdio: "inherit" })
}

const clients = await listClients()
console.log(`${clients.length} clients, @aws-sdk version ${args.version}, effect ${effectVersion}`)

const dir = mkdtempSync(path.join(tmpdir(), "aws-sdk-probe-"))
console.log(`Project: ${dir}`)

const write = (file: string, value: unknown) =>
  writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + "\n")

write("package.json", {
  name: "aws-sdk-probe",
  private: true,
  type: "module",
  dependencies: {
    ...Object.fromEntries(clients.map((client) => [`@aws-sdk/client-${client}`, args.version])),
    effect: effectVersion
  }
})
write("aws-sdk.json", { generate_to: "src/generated", global: { region: "us-east-1" } })
write("tsconfig.json", {
  compilerOptions: {
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    types: []
  },
  include: ["src"]
})

let failed = false
try {
  // Brand-new clients may be younger than pnpm's minimum release age
  run("pnpm", ["install", "--config.minimum-release-age=0"], dir)
  try {
    run("node", [cli], dir)
    run(tsc, ["-p", "tsconfig.json"], dir)
    console.log(`\nOK: ${clients.length} clients generated and typechecked`)
  } catch {
    failed = true
  }
} finally {
  if (args.keep || failed) console.log(`\nProject kept at ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}

process.exitCode = failed ? 1 : 0

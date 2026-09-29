import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { Data, Effect } from "effect"

import { GENERATED_MARKER, type GeneratedFile } from "./render.ts"

export class WriteError extends Data.TaggedError("WriteError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface WriteResult {
  readonly written: ReadonlyArray<string>
  readonly unchanged: ReadonlyArray<string>
  /** Generated files left over from a previous run, e.g. of a removed client */
  readonly removed: ReadonlyArray<string>
}

const readIfExists = (file: string) =>
  readFile(file, "utf-8").catch((error) => {
    if (error?.code === "ENOENT") return undefined
    throw error
  })

const isGenerated = async (file: string) =>
  (await readIfExists(file))?.startsWith(GENERATED_MARKER) ?? false

/**
 * Writes `files` into `dir`. Files whose content did not change are left
 * untouched, so file watchers do not fire needlessly. Previously generated
 * files that are no longer produced are deleted; any other file in `dir` is
 * never touched.
 */
export const writeFiles = (dir: string, files: ReadonlyArray<GeneratedFile>) =>
  Effect.tryPromise({
    try: async (): Promise<WriteResult> => {
      const written: Array<string> = []
      const unchanged: Array<string> = []
      const removed: Array<string> = []

      await mkdir(dir, { recursive: true })

      for (const file of files) {
        const target = path.join(dir, file.path)
        if ((await readIfExists(target)) === file.content) {
          unchanged.push(file.path)
          continue
        }
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, file.content, "utf-8")
        written.push(file.path)
      }

      const expected = new Set(files.map((file) => path.normalize(file.path)))
      const existing = await readdir(dir, { recursive: true, withFileTypes: true })
      for (const entry of existing) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue
        const absolute = path.join(entry.parentPath, entry.name)
        const relative = path.relative(dir, absolute)
        if (expected.has(relative) || !(await isGenerated(absolute))) continue
        await rm(absolute)
        removed.push(relative)
        // Drop directories emptied by the removal (e.g. `internal/` of 1.x)
        let parent = path.dirname(absolute)
        while (parent !== dir && (await readdir(parent)).length === 0) {
          await rmdir(parent)
          parent = path.dirname(parent)
        }
      }

      return { written, unchanged, removed }
    },
    catch: (cause) => new WriteError({ message: `Cannot write generated files to ${dir}`, cause })
  }).pipe(Effect.withSpan("writeFiles"))

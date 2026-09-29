import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { afterEach } from "vitest"
import { Effect, Logger } from "effect"

const tempDirs: Array<string> = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Creates a temporary directory removed after the current test. */
export const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "effect-aws-sdk-"))
  tempDirs.push(dir)
  return dir
}

export const writeTree = async (root: string, files: Record<string, string>) => {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, "utf-8")
  }
}

export const writeJson = (root: string, file: string, value: unknown) =>
  writeTree(root, { [file]: JSON.stringify(value, null, 2) })

/**
 * Declarations of a fake `@aws-sdk/client-acme`, laid out like a real AWS SDK
 * v3 client, including the pitfalls the scanner has to ignore.
 */
export const acmeSdkFiles: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@aws-sdk/client-acme", types: "./dist-types/index.d.ts" }),
  "dist-types/index.d.ts": `export * from "./AcmeClient";\nexport * from "./Acme";`,
  "dist-types/AcmeClient.d.ts": `
    import { Client as __Client } from "@smithy/smithy-client";
    export interface AcmeClientConfig { region?: string }
    export declare class AcmeClient extends __Client<any, any, any, any> {}
  `,
  // The aggregated client extends the bare one and must not be picked up
  "dist-types/Acme.d.ts": `
    import { AcmeClient } from "./AcmeClient";
    export declare class Acme extends AcmeClient {}
  `,
  "dist-types/models/AcmeServiceException.d.ts": `
    import { ServiceException as __ServiceException } from "@smithy/smithy-client";
    export declare class AcmeServiceException extends __ServiceException {}
  `,
  "dist-types/models/errors.d.ts": `
    import { AcmeServiceException as __BaseException } from "./AcmeServiceException";
    export declare class ThingNotFound extends __BaseException {}
    export declare class AccessDeniedException extends __BaseException {}
    export declare class NotAnError {}
  `,
  "dist-types/models/models_0.d.ts": `
    // Named like a command, but not in commands/
    export declare class ReportCommand {}
  `,
  "dist-types/commands/GetThingCommand.d.ts": `
    declare const GetThingCommand_base: any;
    /**
     * Gets a thing.
     * @throws {@link ThingNotFound} (client fault)
     * @throws {@link AccessDeniedException} (client fault)
     * @throws {@link ThingNotFound} (client fault)
     * @throws {@link UnknownToTheModel} (client fault)
     * @throws {@link AcmeServiceException}
     * <p>Base exception class for all service exceptions from Acme service.</p>
     */
    export declare class GetThingCommand extends GetThingCommand_base {}
  `,
  "dist-types/commands/ListThingsCommand.d.ts": `
    declare const ListThingsCommand_base: any;
    /** Lists things. */
    export declare class ListThingsCommand extends ListThingsCommand_base {}
  `,
  "dist-types/commands/GetSAMLConfigCommand.d.ts": `
    declare const GetSAMLConfigCommand_base: any;
    export declare class GetSAMLConfigCommand extends GetSAMLConfigCommand_base {}
  `,
  // Downleveled duplicates for old TypeScript must be ignored
  "dist-types/ts3.4/commands/LegacyOnlyCommand.d.ts": `
    export declare class LegacyOnlyCommand {}
  `
}

/** Installs the fake `@aws-sdk/client-acme` into `root/node_modules`. */
export const installAcmeSdk = (root: string) =>
  writeTree(
    root,
    Object.fromEntries(
      Object.entries(acmeSdkFiles).map(([file, content]) => [
        path.join("node_modules/@aws-sdk/client-acme", file),
        content
      ])
    )
  )

/** Runs `effect` and returns the messages it logged. */
export const collectLogs = async <A, E>(effect: Effect.Effect<A, E>) => {
  const logs: Array<{ level: string; message: string }> = []
  const logger = Logger.make(({ logLevel, message }) => {
    const parts = Array.isArray(message) ? message : [message]
    logs.push({ level: logLevel, message: parts.map(String).join(" ") })
  })
  const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(Logger.layer([logger]))))
  return { exit, logs }
}

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
  // Like WorkSpacesThinClient: an aggregated client whose name ends with
  // "Client" in a file of its own, sorted before the bare client
  "dist-types/AaaClient.d.ts": `
    import { AcmeClient } from "./AcmeClient";
    export declare class AaaClient extends AcmeClient {}
  `,
  "dist-types/models/AcmeServiceException.d.ts": `
    import { ServiceException as __ServiceException } from "@smithy/smithy-client";
    export declare class AcmeServiceException extends __ServiceException {}
  `,
  // Like Connect's InternalServiceException: a modeled error named like the
  // base one, sorted before it
  "dist-types/models/AbandonedServiceException.d.ts": `
    import { AcmeServiceException as __BaseException } from "./AcmeServiceException";
    export declare class AbandonedServiceException extends __BaseException {}
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
     * @example
     * Use a bare-bones client and the command you need to make an API call.
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
    /**
     * <note>
     *    <p>This operation is not supported for directory things.</p>
     * </note>
     * <p>Lists the things owned by the caller. Set <code>MaxResults</code> to page,
     *    see <a href="https://example.com/paging">Paging</a>.</p>
     * <p>Second paragraph.</p>
     * @public
     */
    export declare class ListThingsCommand extends ListThingsCommand_base {}
  `,
  "dist-types/commands/GetSAMLConfigCommand.d.ts": `
    declare const GetSAMLConfigCommand_base: any;
    export declare class GetSAMLConfigCommand extends GetSAMLConfigCommand_base {}
  `,
  "dist-types/pagination/Interfaces.d.ts": `
    import type { PaginationConfiguration } from "@smithy/types";
    import { AcmeClient } from "../AcmeClient";
    export interface AcmePaginationConfiguration extends PaginationConfiguration { client: AcmeClient }
  `,
  "dist-types/pagination/ListThingsPaginator.d.ts": `
    import type { Paginator } from "@smithy/types";
    import { ListThingsCommandInput, ListThingsCommandOutput } from "../commands/ListThingsCommand";
    import type { AcmePaginationConfiguration } from "./Interfaces";
    export declare const paginateListThings: (config: AcmePaginationConfiguration, input: ListThingsCommandInput, ...rest: any[]) => Paginator<ListThingsCommandOutput>;
  `,
  // A paginator without a command must be ignored
  "dist-types/pagination/OrphanPaginator.d.ts": `
    export declare const paginateOrphan: (config: any, input: any, ...rest: any[]) => any;
  `,
  "dist-types/waiters/waitForThingExists.d.ts": `
    import { type WaiterConfiguration, type WaiterResult } from "@smithy/core/client";
    import { type GetThingCommandInput, type GetThingCommandOutput } from "../commands/GetThingCommand";
    import type { AcmeClient } from "../AcmeClient";
    export declare const waitForThingExists: (params: WaiterConfiguration<AcmeClient>, input: GetThingCommandInput) => Promise<WaiterResult<GetThingCommandOutput>>;
    export declare const waitUntilThingExists: (params: WaiterConfiguration<AcmeClient>, input: GetThingCommandInput) => Promise<WaiterResult<GetThingCommandOutput>>;
  `,
  // Downleveled duplicates for old TypeScript must be ignored
  "dist-types/ts3.4/commands/LegacyOnlyCommand.d.ts": `
    export declare class LegacyOnlyCommand {}
  `
}

/**
 * Declarations of a fake `@aws-sdk/lib-acme`, laid out like
 * `@aws-sdk/lib-dynamodb`: a document client over `@aws-sdk/client-acme`.
 */
export const acmeDocumentSdkFiles: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@aws-sdk/lib-acme", types: "./dist-types/index.d.ts" }),
  "dist-types/index.d.ts": `export * from "./AcmeDocumentClient";`,
  "dist-types/AcmeDocumentClient.d.ts": `
    import { Client as __Client } from "@smithy/core/client";
    import { AcmeClient } from "@aws-sdk/client-acme";
    export type TranslateConfig = { marshallOptions?: { removeUndefinedValues?: boolean } };
    export declare class AcmeDocumentClient extends __Client<any, any, any, any> {
      protected constructor(client: AcmeClient, translateConfig?: TranslateConfig);
      static from(client: AcmeClient, translateConfig?: TranslateConfig): AcmeDocumentClient;
      destroy(): void;
    }
  `,
  "dist-types/baseCommand/AcmeDocumentClientCommand.d.ts": `
    import { Command as $Command } from "@smithy/core/client";
    export declare abstract class AcmeDocumentClientCommand<I, O> extends $Command<I, O, any> {}
  `,
  "dist-types/commands/GetCommand.d.ts": `
    import { AcmeDocumentClientCommand } from "../baseCommand/AcmeDocumentClientCommand";
    import { GetThingCommand as __GetThingCommand } from "@aws-sdk/client-acme";
    export type GetCommandInput = { Key: Record<string, unknown> };
    export type GetCommandOutput = { Item?: Record<string, unknown> };
    /** Accepts native JavaScript types and calls GetThingCommand. */
    export declare class GetCommand extends AcmeDocumentClientCommand<GetCommandInput, GetCommandOutput> {
      protected readonly clientCommand: __GetThingCommand;
      constructor(input: GetCommandInput);
    }
  `,
  "dist-types/commands/ListCommand.d.ts": `
    import { AcmeDocumentClientCommand } from "../baseCommand/AcmeDocumentClientCommand";
    import { ListThingsCommand as __ListThingsCommand } from "@aws-sdk/client-acme";
    export type ListCommandInput = {};
    export type ListCommandOutput = { Items?: Array<Record<string, unknown>> };
    export declare class ListCommand extends AcmeDocumentClientCommand<ListCommandInput, ListCommandOutput> {
      protected readonly clientCommand: __ListThingsCommand;
      constructor(input: ListCommandInput);
    }
  `,
  "dist-types/pagination/ListPaginator.d.ts": `
    export declare const paginateList: (config: any, input: any, ...additionalArguments: any) => any;
  `
}

/** Installs a fake package into `root/node_modules/<packageName>`. */
export const installPackage = (root: string, packageName: string, files: Record<string, string>) =>
  writeTree(
    root,
    Object.fromEntries(
      Object.entries(files).map(([file, content]) => [path.join("node_modules", packageName, file), content])
    )
  )

/** Installs the fake `@aws-sdk/lib-acme` into `root/node_modules`. */
export const installAcmeDocumentSdk = (root: string) => installPackage(root, "@aws-sdk/lib-acme", acmeDocumentSdkFiles)

/** Installs the fake `@aws-sdk/client-acme` into `root/node_modules`. */
export const installAcmeSdk = (root: string) => installPackage(root, "@aws-sdk/client-acme", acmeSdkFiles)

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

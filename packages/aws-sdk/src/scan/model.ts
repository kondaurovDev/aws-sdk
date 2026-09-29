/** Everything the code generator needs to know about one AWS SDK client. */
export interface SdkModel {
  /** Module name: `s3` for `@aws-sdk/client-s3`, `dynamodb-document` for `@aws-sdk/lib-dynamodb` */
  readonly client: string
  readonly packageName: string
  /** `S3Client` */
  readonly clientClassName: string
  /** `S3ClientConfig`, or `TranslateConfig` for a document client */
  readonly configInterfaceName: string
  /** `S3ServiceException`, the base class of every modeled service error */
  readonly serviceExceptionName: string
  /** Modeled service exceptions (without the base one), sorted */
  readonly exceptions: ReadonlyArray<string>
  /** Sorted by method name */
  readonly commands: ReadonlyArray<SdkCommand>
  /** Commands with an SDK paginator, sorted by method name */
  readonly paginators: ReadonlyArray<SdkPaginator>
  /** Sorted by method name */
  readonly waiters: ReadonlyArray<SdkWaiter>
  /** Package providing `getSignedUrl` for this client, when installed */
  readonly presigner: string | undefined
  /**
   * The client this one is built on: `@aws-sdk/lib-dynamodb` wraps
   * `@aws-sdk/client-dynamodb` and reuses its exceptions.
   */
  readonly base: SdkBase | undefined
}

export interface SdkBase {
  readonly client: string
  readonly packageName: string
  readonly clientClassName: string
}

export interface SdkCommand {
  /** SDK command name without the `Command` suffix: `ListObjectsV2` */
  readonly name: string
  /** Generated method name: `list_objects_v2` */
  readonly method: string
  /** Modeled exceptions documented with `@throws` on the command, sorted */
  readonly errors: ReadonlyArray<string>
  /** First paragraph of the command's documentation, as Markdown */
  readonly docs: string | undefined
}

export interface SdkPaginator {
  /** Method name of the paginated command: `list_objects_v2` */
  readonly method: string
  /** `paginateListObjectsV2` */
  readonly functionName: string
}

export interface SdkWaiter {
  /** `table_exists` */
  readonly method: string
  /** `waitUntilTableExists` */
  readonly functionName: string
}

export const clientPackageName = (client: string): string =>
  `@aws-sdk/client-${client}`

export const S3_PRESIGNER_PACKAGE = "@aws-sdk/s3-request-presigner"
export const DYNAMODB_DOCUMENT_PACKAGE = "@aws-sdk/lib-dynamodb"
export const DYNAMODB_DOCUMENT_CLIENT = "dynamodb-document"

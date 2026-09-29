/** Everything the code generator needs to know about one AWS SDK client. */
export interface SdkModel {
  /** Package suffix: `s3` for `@aws-sdk/client-s3` */
  readonly client: string
  readonly packageName: string
  /** `S3Client` */
  readonly clientClassName: string
  /** `S3ClientConfig` */
  readonly configInterfaceName: string
  /** `S3ServiceException`, the base class of every modeled service error */
  readonly serviceExceptionName: string
  /** Modeled service exceptions (without the base one), sorted */
  readonly exceptions: ReadonlyArray<string>
  /** Sorted by method name */
  readonly commands: ReadonlyArray<SdkCommand>
}

export interface SdkCommand {
  /** SDK command name without the `Command` suffix: `ListObjectsV2` */
  readonly name: string
  /** Generated method name: `list_objects_v2` */
  readonly method: string
  /** Modeled exceptions documented with `@throws` on the command, sorted */
  readonly errors: ReadonlyArray<string>
}

export const clientPackageName = (client: string): string =>
  `@aws-sdk/client-${client}`

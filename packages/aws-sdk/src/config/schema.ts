import { Schema } from "effect"

export const DEFAULT_GENERATE_TO = "src/generated"

/** Shape of `aws-sdk.json` in the root of the user's project. */
export const ConfigFileSchema = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  generate_to: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      title: "Generate to",
      description: "Directory for the generated files, relative to the project root",
      default: DEFAULT_GENERATE_TO
    })
  ),
  clients: Schema.optionalKey(
    Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
      title: "Clients",
      description:
        "Generate only these clients, e.g. \"s3\" for @aws-sdk/client-s3. " +
        "Defaults to every @aws-sdk/client-* dependency in package.json"
    })
  ),
  global: Schema.optionalKey(
    Schema.Struct({
      region: Schema.optionalKey(
        Schema.NonEmptyString.annotate({
          description: "Default region for every generated client layer"
        })
      )
    })
  )
})

export type ConfigFile = typeof ConfigFileSchema.Type

export const PackageJsonSchema = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
})

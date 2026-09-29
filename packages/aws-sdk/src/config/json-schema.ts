// Writes schema.json (the JSON Schema of aws-sdk.json) next to package.json.
// Run with `pnpm generate:schema` after changing ./schema.ts.
import { writeFile } from "node:fs/promises"
import { Schema } from "effect"

import { ConfigFileSchema } from "./schema.ts"

export const makeJsonSchema = () => {
  const { schema, definitions } = Schema.toJsonSchemaDocument(ConfigFileSchema, {
    onExcessProperty: "error"
  })
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "@effect-ak/aws-sdk configuration",
    ...schema,
    ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {})
  }
}

if (import.meta.main) {
  const target = new URL("../../schema.json", import.meta.url)
  await writeFile(target, JSON.stringify(makeJsonSchema(), null, 2) + "\n", "utf-8")
  console.log(`${target.pathname} generated`)
}

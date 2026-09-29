import { describe, expect, it } from "vitest"

import { makeMethodName, makeNamespaceName, makeProperPascalCase } from "./naming.ts"

describe("makeProperPascalCase", () => {
  it.each([
    ["GetSAMLProviderCommandInput", "GetSamlProviderCommandInput"],
    ["GetSAML", "GetSaml"],
    ["ListObjectsV2", "ListObjectsV2"],
    ["CreateDBInstance", "CreateDbInstance"],
    ["S3", "S3"],
    ["", ""]
  ])("%s -> %s", (input, expected) => {
    expect(makeProperPascalCase(input)).toBe(expected)
  })
})

describe("makeMethodName", () => {
  // Generated method names are public API: changing any of these is breaking.
  it.each([
    ["ListBuckets", "list_buckets"],
    ["ListObjectsV2", "list_objects_v2"],
    ["listObjectsV2", "list_objects_v2"],
    ["GetSAMLProvider", "get_saml_provider"],
    ["CreateDBInstance", "create_db_instance"],
    ["DescribeEC2InstanceLimits", "describe_ec2_instance_limits"],
    ["PutBucketACL", "put_bucket_acl"],
    ["GetObject", "get_object"]
  ])("%s -> %s", (input, expected) => {
    expect(makeMethodName(input)).toBe(expected)
  })
})

describe("makeNamespaceName", () => {
  it.each([
    ["s3", "s3"],
    ["cloudwatch-logs", "cloudwatch_logs"],
    ["api-gateway-v2", "api_gateway_v2"]
  ])("%s -> %s", (input, expected) => {
    expect(makeNamespaceName(input)).toBe(expected)
  })
})

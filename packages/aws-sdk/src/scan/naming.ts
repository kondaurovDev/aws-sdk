import { String } from "effect"

// Digits count as upper case on purpose: `EC2Instance` must become
// `Ec2Instance`, and changing this would rename generated methods.
const isUpperCase = (char: string) => char.toUpperCase() === char

/**
 * Lowercases the inner letters of acronyms so that snake-casing treats them
 * as a single word: `GetSAMLProvider` -> `GetSamlProvider`.
 */
export const makeProperPascalCase = (input: string): string => {
  let result = ""
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    const isInnerAcronymLetter =
      i > 0 &&
      isUpperCase(char) &&
      isUpperCase(input[i - 1]!) &&
      (i === input.length - 1 || isUpperCase(input[i + 1]!))
    result += isInnerAcronymLetter ? char.toLowerCase() : char
  }
  return result
}

/** `ListObjectsV2` -> `list_objects_v2` */
export const makeMethodName = (commandName: string): string =>
  String.pascalToSnake(makeProperPascalCase(commandName))

/** `client-cloudwatch-logs` package suffix -> `cloudwatch_logs` namespace */
export const makeNamespaceName = (client: string): string =>
  client.replaceAll("-", "_")

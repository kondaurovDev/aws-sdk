// AWS documents commands in HTML inside JSDoc. The generated code keeps only
// the first paragraph, converted to the Markdown that editors render in hover
// and completion popups.

const ASIDE_TAGS = ["note", "important", "warning"]

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&amp;": "&"
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim()

const decodeEntities = (text: string) =>
  text.replace(/&(?:lt|gt|quot|#39|apos|nbsp|amp);/g, (entity) => ENTITIES[entity] ?? entity)

/** The first paragraph of a command's description, as one line of Markdown. */
export const summarizeDocs = (description: string | undefined): string | undefined => {
  if (!description) return undefined

  let text = description
  // Asides often come first ("This operation is not supported for directory
  // buckets") and would hide the actual description.
  for (const tag of ASIDE_TAGS) {
    text = text.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), " ")
  }

  const paragraph = /<p>([\s\S]*?)<\/p>/.exec(text)?.[1] ?? text.trim().split(/\n\s*\n/)[0] ?? ""

  const markdown = collapse(
    decodeEntities(
      paragraph
        .replace(/<code>([\s\S]*?)<\/code>/g, (_, code: string) => `\`${collapse(code)}\``)
        .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) =>
          `[${collapse(label)}](${href})`
        )
        .replace(/<[^>]+>/g, " ")
    )
  )

  return markdown === "" ? undefined : markdown
}

/** Renders a summary as a JSDoc block, wrapped at `width` columns. */
export const renderJsDoc = (text: string, indent: string, width = 100): string => {
  const safe = text.replaceAll("*/", "*\\/")
  const lines: Array<string> = []
  let line = ""
  for (const word of safe.split(" ")) {
    if (line !== "" && indent.length + 3 + line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line === "" ? word : `${line} ${word}`
    }
  }
  lines.push(line)
  return lines.length === 1
    ? `${indent}/** ${lines[0]} */`
    : [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`].join("\n")
}

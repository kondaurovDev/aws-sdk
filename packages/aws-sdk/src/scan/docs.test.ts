import { describe, expect, it } from "vitest"

import { renderJsDoc, summarizeDocs } from "./docs.ts"

describe("summarizeDocs", () => {
  it.each([
    [
      "takes the first paragraph and converts inline HTML",
      `<p>Returns a list of all buckets owned by the sender. To grant IAM
       permission, add the <code>s3:ListAllMyBuckets</code> action. </p>
       <p>For information about buckets, see <a href="https://docs.aws.amazon.com/x.html">Creating
       buckets</a>.</p>`,
      "Returns a list of all buckets owned by the sender. To grant IAM permission, add the `s3:ListAllMyBuckets` action."
    ],
    [
      "skips asides that precede the description",
      `<note>
         <p>This operation is not supported for directory buckets.</p>
       </note>
       <p>Returns the Region the bucket resides in.</p>
       <important><p>Use paginated requests.</p></important>`,
      "Returns the Region the bucket resides in."
    ],
    [
      "keeps links as Markdown",
      `<p>See the <a href="http://www.w3.org/TR/REC-xml/#charsets">W3C
       specification for characters</a>.</p>`,
      "See the [W3C specification for characters](http://www.w3.org/TR/REC-xml/#charsets)."
    ],
    [
      "decodes entities after stripping tags",
      `<p>Set <code>Prefix</code> to <code>&lt;name&gt;/</code> &amp; retry.</p>`,
      "Set `Prefix` to `<name>/` & retry."
    ],
    [
      "accepts plain text",
      `Creates a campaign for the specified account. This API is idempotent.

       Second paragraph.`,
      "Creates a campaign for the specified account. This API is idempotent."
    ],
    ["drops other tags", `<p>A <b>bold</b> claim<br/>continued.</p>`, "A bold claim continued."]
  ])("%s", (_, input, expected) => {
    expect(summarizeDocs(input)).toBe(expected)
  })

  it("returns undefined for empty input", () => {
    expect(summarizeDocs(undefined)).toBeUndefined()
    expect(summarizeDocs("   ")).toBeUndefined()
    expect(summarizeDocs("<note><p>Only an aside.</p></note>")).toBeUndefined()
  })
})

describe("renderJsDoc", () => {
  it("renders short text on one line", () => {
    expect(renderJsDoc("Gets a thing.", "  ")).toBe("  /** Gets a thing. */")
  })

  it("wraps long text and escapes comment terminators", () => {
    const text = "Word ".repeat(30).trim() + " end */ of comment"
    const rendered = renderJsDoc(text, "  ", 60)
    expect(rendered.split("\n")[0]).toBe("  /**")
    expect(rendered.split("\n").every((line) => line.length <= 60)).toBe(true)
    expect(rendered).toContain("*\\/")
    expect(rendered.endsWith("\n   */")).toBe(true)
  })
})

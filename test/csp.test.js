import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Both pages set style-src 'self' without 'unsafe-inline', so browsers drop
// any style="" attribute in markup, including markup that scripts build with
// innerHTML. Styling has to come from the stylesheets, SVG presentation
// attributes, or element.style, which the policy allows.
for (const [page, script] of [["index.html", "app.js"], ["schedule.html", "schedule.js"]]) {
  test(`${page} and ${script} use no inline style attributes the page's CSP would block`, () => {
    const html = read(page);
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    assert.match(policy, /style-src 'self'/);
    assert.ok(!policy.includes("'unsafe-inline'"));
    for (const [name, source] of [[page, html], [script, read(script)]]) {
      assert.doesNotMatch(source, /\sstyle=["'`$]/, name);
    }
  });
}

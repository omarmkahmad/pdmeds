import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const modules = readdirSync(new URL("../src/", import.meta.url)).filter(name => name.endsWith(".js")).map(name => `src/${name}`);

// Both pages set style-src 'self' without 'unsafe-inline', so browsers drop
// any style="" attribute in markup, including markup that scripts build with
// innerHTML, and any setAttribute("style", ...). Styling has to come from the
// stylesheets, SVG presentation attributes, or element.style (CSSOM), which
// the policy allows.
for (const [page, scripts] of [["index.html", ["app.js", ...modules]], ["schedule.html", ["schedule.js", ...modules]]]) {
  test(`${page} and its scripts use no inline styles the page's CSP would block`, () => {
    const html = read(page);
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    assert.match(policy, /style-src 'self'/);
    assert.ok(!policy.includes("'unsafe-inline'"));
    assert.doesNotMatch(html, /\sstyle=["'`$]/, page);
    assert.doesNotMatch(html, /<style[\s>]/, page);
    for (const script of scripts) {
      const source = read(script);
      assert.doesNotMatch(source, /\sstyle=["'`$\\]/, script);
      assert.doesNotMatch(source, /setAttribute\(\s*["'`]style["'`]/, script);
    }
  });
}

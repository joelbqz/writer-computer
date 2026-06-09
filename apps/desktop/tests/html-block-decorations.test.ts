import { describe, expect, test } from "vite-plus/test";
import { estimateHtmlBlockHeight } from "../src/components/editor-area/html-block-decorations";

describe("estimateHtmlBlockHeight", () => {
  test("bare inline content clamps to one line plus widget padding", () => {
    // line 25.6 + padding 8 = 33.6 → ceil
    expect(estimateHtmlBlockHeight("<br>")).toBe(34);
    expect(estimateHtmlBlockHeight("<span>hi</span>")).toBe(34);
  });

  test("grows with paragraph count", () => {
    const one = estimateHtmlBlockHeight("<p>a</p>");
    const two = estimateHtmlBlockHeight("<p>a</p><p>b</p>");
    expect(two).toBeGreaterThan(one);
    expect(estimateHtmlBlockHeight("<p>a</p>")).toBeGreaterThan(estimateHtmlBlockHeight("<br>"));
  });

  test("h1 estimates taller than a paragraph", () => {
    expect(estimateHtmlBlockHeight("<h1>title</h1>")).toBeGreaterThan(
      estimateHtmlBlockHeight("<p>text</p>"),
    );
  });

  test("images reserve fixed space", () => {
    const without = estimateHtmlBlockHeight("<p>a</p>");
    const withImg = estimateHtmlBlockHeight('<p>a</p><img src="x.png">');
    expect(withImg - without).toBeGreaterThanOrEqual(150);
  });

  test("pre blocks grow with line count", () => {
    const short = estimateHtmlBlockHeight("<pre>one</pre>");
    const tall = estimateHtmlBlockHeight("<pre>one\ntwo\nthree</pre>");
    expect(tall).toBeGreaterThan(short);
  });

  test("table rows count toward height", () => {
    const one = estimateHtmlBlockHeight("<table><tr><td>a</td></tr></table>");
    const three = estimateHtmlBlockHeight(
      "<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>",
    );
    expect(three).toBeGreaterThan(one);
  });
});

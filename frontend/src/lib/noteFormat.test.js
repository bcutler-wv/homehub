import { parseInline, parseBlocks, applyMarker, noteSummary, safeHref } from "./noteFormat";

const types = (tokens) => tokens.map(t => t.type);
const values = (tokens) => tokens.map(t => t.value);

describe("parseInline", () => {
  test("plain text is a single token", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", value: "just words" }]);
  });

  test("recognises bold, italic, strike and code", () => {
    expect(types(parseInline("**b**"))).toEqual(["bold"]);
    expect(types(parseInline("*i*"))).toEqual(["italic"]);
    expect(types(parseInline("~~s~~"))).toEqual(["strike"]);
    expect(types(parseInline("`c`"))).toEqual(["code"]);
  });

  test("keeps the surrounding text around a marker", () => {
    const tokens = parseInline("call **Alison** today");
    expect(types(tokens)).toEqual(["text", "bold", "text"]);
    expect(values(tokens)).toEqual(["call ", "Alison", " today"]);
  });

  test("bold wins over italic so ** is not read as two emphases", () => {
    expect(types(parseInline("**bold**"))).toEqual(["bold"]);
  });

  test("markers inside code stay literal", () => {
    const tokens = parseInline("`**not bold**`");
    expect(types(tokens)).toEqual(["code"]);
    expect(values(tokens)).toEqual(["**not bold**"]);
  });

  test("a url containing parentheses is captured whole", () => {
    const [link] = parseInline("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(link).toEqual({
      type: "link", value: "wiki", href: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
  });

  test("renders a labelled link and a bare url", () => {
    const [link] = parseInline("[recipe](https://example.com/x)");
    expect(link).toEqual({ type: "link", value: "recipe", href: "https://example.com/x" });

    const [auto] = parseInline("https://example.com/thing");
    expect(auto).toEqual({ type: "link", value: "https://example.com/thing", href: "https://example.com/thing" });
  });

  test("a trailing sentence period is not swallowed into a bare url", () => {
    const tokens = parseInline("see https://example.com/x.");
    expect(tokens[1]).toMatchObject({ type: "link", href: "https://example.com/x" });
    expect(tokens[2]).toEqual({ type: "text", value: "." });
  });
});

describe("link safety", () => {
  test("only http, https and mailto are accepted", () => {
    expect(safeHref("https://a.test")).toBe("https://a.test");
    expect(safeHref("http://a.test")).toBe("http://a.test");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  test("a dangerous link degrades to its label instead of becoming a link", () => {
    const tokens = parseInline("[click me](javascript:alert(1))");
    expect(tokens).toEqual([{ type: "text", value: "click me" }]);
  });

  test("markup in note text stays literal text, never a tag", () => {
    // Nothing here may produce an element type other than text — the renderer
    // builds React nodes, so a text token can only ever be escaped content.
    const tokens = parseInline('<script>alert("x")</script>');
    expect(tokens).toEqual([{ type: "text", value: '<script>alert("x")</script>' }]);

    const withImg = parseInline('<img src=x onerror=alert(1)>');
    expect(types(withImg)).toEqual(["text"]);
  });
});

describe("parseBlocks", () => {
  test("groups consecutive lines into a paragraph", () => {
    const blocks = parseBlocks("one\ntwo");
    expect(blocks).toEqual([{ type: "p", lines: ["one", "two"] }]);
  });

  test("a blank line starts a new paragraph", () => {
    const blocks = parseBlocks("one\n\ntwo");
    expect(blocks.filter(b => b.type === "p")).toHaveLength(2);
  });

  test("collapses consecutive bullets into one list", () => {
    const blocks = parseBlocks("- milk\n- eggs\n- bread");
    expect(blocks).toEqual([{ type: "ul", items: ["milk", "eggs", "bread"] }]);
  });

  test("numbered lines make an ordered list", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks).toEqual([{ type: "ol", items: ["first", "second"] }]);
  });

  test("a paragraph then a list stays two blocks", () => {
    const blocks = parseBlocks("shopping:\n- milk");
    expect(blocks.map(b => b.type)).toEqual(["p", "ul"]);
  });

  test("empty input yields no blocks", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
  });
});

describe("applyMarker", () => {
  test("wraps the selection and keeps it selected", () => {
    const out = applyMarker("call Alison today", 5, 11, "**");
    expect(out.text).toBe("call **Alison** today");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("Alison");
  });

  test("with no selection it inserts a placeholder and selects it", () => {
    const out = applyMarker("", 0, 0, "**");
    expect(out.text).toBe("**text**");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("text");
  });

  test("bulleting prefixes each selected line once", () => {
    const out = applyMarker("milk\neggs", 0, 9, "- ");
    expect(out.text).toBe("- milk\n- eggs");
  });

  test("bulleting an already-bulleted line does not double the marker", () => {
    const out = applyMarker("- milk", 0, 6, "- ");
    expect(out.text).toBe("- milk");
  });
});

describe("noteSummary", () => {
  test("uses the first non-empty line with markers stripped", () => {
    expect(noteSummary("\n\n**Call** the *vet*")).toBe("Call the vet");
  });

  test("keeps link labels and drops their targets", () => {
    expect(noteSummary("see [the recipe](https://example.com)")).toBe("see the recipe");
  });

  test("truncates long lines", () => {
    expect(noteSummary("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });

  test("empty note summarises to an empty string", () => {
    expect(noteSummary("")).toBe("");
    expect(noteSummary(null)).toBe("");
  });
});

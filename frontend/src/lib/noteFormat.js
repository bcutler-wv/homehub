// Note formatting: a small markdown subset, rendered to React elements.
//
// Notes are stored as plain text and never converted to an HTML string, so
// dangerouslySetInnerHTML is never involved. React escapes text nodes, which
// makes injection structurally impossible rather than a matter of getting an
// escaping pass right. The only value that needs checking is a link href.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/** Only absolute http(s) and mailto links are rendered as links. */
export const safeHref = (url) => {
  const trimmed = String(url || "").trim();
  return SAFE_HREF.test(trimmed) ? trimmed : null;
};

// Ordered by precedence. `code` comes first so markers inside it stay literal.
const INLINE = [
  { type: "code", re: /`([^`\n]+)`/ },
  { type: "bold", re: /\*\*([^*\n]+)\*\*/ },
  { type: "italic", re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/ },
  { type: "strike", re: /~~([^~\n]+)~~/ },
  // One level of balanced parens, so a Wikipedia-style URL survives.
  { type: "link", re: /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/ },
  { type: "autolink", re: /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/ },
];

/**
 * Parse one line into inline tokens. Returns plain objects so this is testable
 * without rendering.
 */
export const parseInline = (line) => {
  const text = String(line ?? "");
  if (!text) return [];

  let earliest = null;
  for (const { type, re } of INLINE) {
    const m = re.exec(text);
    if (m && (earliest === null || m.index < earliest.match.index)) {
      earliest = { type, match: m };
    }
  }
  if (!earliest) return [{ type: "text", value: text }];

  const { type, match } = earliest;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  let token;
  if (type === "link") {
    const href = safeHref(match[2]);
    // An unsafe target degrades to its label rather than vanishing.
    token = href ? { type: "link", value: match[1], href } : { type: "text", value: match[1] };
  } else if (type === "autolink") {
    const href = safeHref(match[1]);
    token = href ? { type: "link", value: match[1], href } : { type: "text", value: match[1] };
  } else {
    token = { type, value: match[1] };
  }

  return [
    ...(before ? parseInline(before) : []),
    token,
    ...(after ? parseInline(after) : []),
  ];
};

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Split note text into blocks: paragraphs and lists. Consecutive list lines of
 * the same kind collapse into one list.
 */
export const parseBlocks = (text) => {
  const lines = String(text ?? "").split("\n");
  const blocks = [];

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const numbered = !bullet && NUMBERED.exec(line);
    const last = blocks[blocks.length - 1];

    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet || numbered)[1];
      if (last && last.type === kind) last.items.push(item);
      else blocks.push({ type: kind, items: [item] });
      continue;
    }

    if (!line.trim()) {
      // A blank line ends a list and separates paragraphs.
      if (last && last.type === "p" && last.lines.length) blocks.push({ type: "spacer" });
      else if (last && (last.type === "ul" || last.type === "ol")) blocks.push({ type: "spacer" });
      continue;
    }

    if (last && last.type === "p") last.lines.push(line);
    else blocks.push({ type: "p", lines: [line] });
  }

  return blocks.filter(b => b.type !== "spacer" || blocks.indexOf(b) !== blocks.length - 1);
};

/** Wrap a selection in markers, for the editor toolbar. */
export const applyMarker = (text, start, end, marker) => {
  const value = String(text ?? "");
  const selected = value.slice(start, end);
  if (!selected) {
    const placeholder = marker === "- " ? "" : "text";
    const inserted = marker === "- " ? `${marker}` : `${marker}${placeholder}${marker}`;
    return {
      text: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + placeholder.length,
    };
  }
  if (marker === "- ") {
    const listed = selected.split("\n").map(l => (l.trim() ? `- ${l.replace(/^\s*[-*]\s+/, "")}` : l)).join("\n");
    return {
      text: value.slice(0, start) + listed + value.slice(end),
      selectionStart: start,
      selectionEnd: start + listed.length,
    };
  }
  return {
    text: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
};

/** First non-empty line, for collapsed previews. */
export const noteSummary = (text, max = 120) => {
  const line = String(text ?? "").split("\n").map(l => l.trim()).find(Boolean) || "";
  const plain = line
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/[*~`]/g, "")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "bulletList",
  "orderedList",
  "blockquote",
]);

export function docToPlain(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return "";
  }

  const walk = (node) => {
    if (!node || typeof node !== "object") {
      return "";
    }

    if (node.type === "text") {
      return typeof node.text === "string" ? node.text : "";
    }

    if (node.type === "hardBreak") {
      return "\n";
    }

    const children = Array.isArray(node.content) ? node.content.map(walk).join("") : "";
    if (BLOCK_TYPES.has(node.type)) {
      return `${children}\n`;
    }

    return children;
  };

  return walk(doc).replace(/\n{3,}/g, "\n\n").trim();
}

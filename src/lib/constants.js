export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "EMAIL",
  "PHONE",
  "RADIO",
  "CHECKBOX",
  "SELECT",
  "YES_NO",
  "RATING",
  "LINEAR_SCALE",
  "DATE",
  "FILE",
  "HEADING",
  "INSTRUCTION",
];

export const CONTENT_TYPES = new Set(["HEADING", "INSTRUCTION"]);
export const CHOICE_TYPES = new Set(["RADIO", "CHECKBOX", "SELECT"]);

export function isContentType(type) {
  return CONTENT_TYPES.has(type);
}

export function isChoiceType(type) {
  return CHOICE_TYPES.has(type);
}

const WORD_TYPES = ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export const DEFAULT_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", ...WORD_TYPES];

const EXTENSION_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".doc": WORD_TYPES[0],
  ".docx": WORD_TYPES[1],
  ".txt": "text/plain",
};

function extensionType(fileName) {
  const extension = String(fileName ?? "").toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension ? EXTENSION_TYPES[extension] ?? null : null;
}

// Browsers without Office installed often send .docx as "" or application/octet-stream,
// so fall back to the file extension. Returns the type to store, or null if not allowed.
export function resolveAllowedType(mimeType, fileName, allowed) {
  const byExtension = extensionType(fileName);
  if (allowed.length === 0) {
    return mimeType || byExtension || "application/octet-stream";
  }

  if (allowed.includes(mimeType)) {
    return mimeType;
  }

  return byExtension && allowed.includes(byExtension) ? byExtension : null;
}

import { normalizeOptions } from "./forms.js";

function optionLabel(optionId, field, snapshotField) {
  const options = [...normalizeOptions(field?.options), ...normalizeOptions(snapshotField?.options)];
  return options.find((option) => option.id === optionId)?.label ?? String(optionId);
}

export function formatAnswer(field, value, snapshotField) {
  const type = field?.type ?? snapshotField?.type;
  if (value == null || value === "") {
    return "";
  }

  if (type === "CHECKBOX") {
    const ids = Array.isArray(value) ? value : [value];
    return ids.map((optionId) => optionLabel(optionId, field, snapshotField)).join("; ");
  }

  if (type === "RADIO" || type === "SELECT") {
    return optionLabel(value, field, snapshotField);
  }

  if (type === "YES_NO") {
    return value === true ? "Yes" : "No";
  }

  if (type === "FILE") {
    return value && typeof value === "object" ? value.fileName ?? "" : "";
  }

  return String(value);
}

function snapshotFields(submission) {
  const fields = submission.snapshot?.fields;
  return Array.isArray(fields) ? fields : [];
}

export function buildResponseTable(form, submissions) {
  const currentFields = [...form.sections]
    .sort((left, right) => left.order - right.order)
    .flatMap((section) => [...section.fields].sort((left, right) => left.order - right.order))
    .filter((field) => field.type !== "HEADING" && field.type !== "INSTRUCTION");
  const currentIds = new Set(currentFields.map((field) => field.id));
  const newestFirst = [...submissions].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const deleted = [];
  const seen = new Set();

  for (const submission of newestFirst) {
    for (const field of snapshotFields(submission)) {
      if (!field?.id || currentIds.has(field.id) || seen.has(field.id)) {
        continue;
      }

      seen.add(field.id);
      deleted.push(field);
    }
  }

  const columns = [
    ...currentFields.map((field) => ({
      id: field.id,
      label: field.label,
      deleted: false,
      type: field.type,
    })),
    ...deleted.map((field) => ({
      id: field.id,
      label: field.label || "Deleted question",
      deleted: true,
      type: field.type,
    })),
  ];

  const liveById = new Map(currentFields.map((field) => [field.id, field]));
  const rows = newestFirst.map((submission) => {
    const snapshotById = new Map(snapshotFields(submission).map((field) => [field.id, field]));
    const answers = {};
    const files = {};

    for (const column of columns) {
      const live = liveById.get(column.id) ?? null;
      const snapshotField = snapshotById.get(column.id) ?? null;
      const value = submission.data?.[column.id];
      answers[column.id] = formatAnswer(live ?? snapshotField, value, snapshotField);

      if ((live?.type ?? snapshotField?.type) === "FILE" && value && typeof value === "object" && value.path) {
        files[column.id] = {
          path: value.path,
          fileName: value.fileName ?? "download",
        };
      }
    }

    return {
      id: submission.id,
      createdAt: submission.createdAt,
      submittedBy: submission.user ? { name: submission.user.name, email: submission.user.email } : null,
      answers,
      files,
    };
  });

  return { columns, rows };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function toCsv(table) {
  const headers = [
    "Submitted at",
    "Submitted by",
    ...table.columns.map((column) => (column.deleted ? `${column.label} (deleted)` : column.label)),
  ];
  const lines = [headers.map(csvEscape).join(",")];

  for (const row of table.rows) {
    const cells = [
      new Date(row.createdAt).toISOString(),
      row.submittedBy ? `${row.submittedBy.name} <${row.submittedBy.email}>` : "Anonymous",
      ...table.columns.map((column) => row.answers[column.id] ?? ""),
    ];
    lines.push(cells.map(csvEscape).join(","));
  }

  return lines.join("\r\n");
}

export function collectFileRecords(submissions) {
  const records = new Map();

  for (const submission of submissions) {
    const data = submission.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      continue;
    }

    for (const value of Object.values(data)) {
      if (value && typeof value === "object" && typeof value.path === "string" && !value.path.includes("..")) {
        records.set(value.path, {
          path: value.path,
          fileName: typeof value.fileName === "string" ? value.fileName : "download",
          mimeType: typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream",
        });
      }
    }
  }

  return records;
}

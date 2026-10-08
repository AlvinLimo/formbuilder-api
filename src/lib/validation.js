import { z } from "zod";
import { CHOICE_TYPES, DEFAULT_FILE_TYPES, FIELD_TYPES, isChoiceType, isContentType } from "./constants.js";
import { HttpError } from "./http.js";
import { docToPlain } from "./rich-text.js";

const fieldTypeSchema = z.enum(FIELD_TYPES);

const optionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1, "Option text is required.").max(500),
});

const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(20000).nullable().optional(),
    maxLength: z.number().int().min(0).max(20000).nullable().optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    minLabel: z.string().max(200).nullable().optional(),
    maxLabel: z.string().max(200).nullable().optional(),
    allowedMimeTypes: z.array(z.string().trim().min(1).max(200)).max(20).nullable().optional(),
    maxFileSizeMb: z.number().positive().max(25).nullable().optional(),
  })
  .partial();

const fieldSchema = z.object({
  id: z.uuid(),
  label: z.string().max(2000).optional().default(""),
  titleDoc: z.unknown().nullable().optional(),
  descriptionDoc: z.unknown().nullable().optional(),
  type: fieldTypeSchema,
  required: z.boolean().optional().default(false),
  options: z.array(optionSchema).max(100).optional().default([]),
  validation: validationSchema.nullable().optional(),
});

const sectionSchema = z.object({
  id: z.uuid(),
  title: z.string().max(500).optional().default(""),
  titleDoc: z.unknown().nullable().optional(),
  descriptionDoc: z.unknown().nullable().optional(),
  fields: z.array(fieldSchema).max(200),
});

const formWriteSchema = z.object({
  title: z.string().trim().min(1, "Add a form title.").max(200),
  description: z.string().max(10000).nullable().optional(),
  titleDoc: z.unknown().nullable().optional(),
  descriptionDoc: z.unknown().nullable().optional(),
  limitOneResponse: z.boolean().optional(),
  sections: z.array(sectionSchema).min(1, "Add at least one section.").max(50),
});

function assertDocSize(doc, label) {
  if (doc == null) {
    return;
  }

  if (JSON.stringify(doc).length > 100000) {
    throw new HttpError(400, `${label} is too large.`);
  }
}

function storedValidation(type, validation) {
  if (type === "RATING") {
    return { max: validation?.max ?? 5 };
  }

  if (type === "LINEAR_SCALE") {
    return {
      min: validation?.min ?? 1,
      max: validation?.max ?? 5,
      minLabel: validation?.minLabel?.trim() || "",
      maxLabel: validation?.maxLabel?.trim() || "",
    };
  }

  if (type === "TEXT" || type === "TEXTAREA") {
    return {
      minLength: validation?.minLength ?? null,
      maxLength: validation?.maxLength ?? null,
    };
  }

  if (type === "NUMBER") {
    return {
      min: validation?.min ?? null,
      max: validation?.max ?? null,
    };
  }

  if (type === "FILE") {
    const allowed = Array.isArray(validation?.allowedMimeTypes)
      ? validation.allowedMimeTypes.map((mime) => mime.trim()).filter(Boolean)
      : [];

    return {
      allowedMimeTypes: allowed.length > 0 ? allowed : DEFAULT_FILE_TYPES,
      maxFileSizeMb: validation?.maxFileSizeMb ?? 10,
    };
  }

  return null;
}

function prepareField(field, order, sectionId) {
  assertDocSize(field.titleDoc, "Formatted text");
  assertDocSize(field.descriptionDoc, "Formatted text");

  const labelFromDoc = docToPlain(field.titleDoc);
  let label = (labelFromDoc || field.label || "").trim();
  const description = docToPlain(field.descriptionDoc);

  if (field.type === "INSTRUCTION") {
    if (!description) {
      throw new HttpError(400, "Instructions need some text.");
    }

    if (!label) {
      label = description.slice(0, 120);
    }
  } else if (field.type === "HEADING") {
    if (!label) {
      throw new HttpError(400, "Headings need some text.");
    }
  } else if (!label) {
    throw new HttpError(400, "Every question needs a title.");
  }

  const options = isChoiceType(field.type) ? field.options : [];
  if (isChoiceType(field.type) && options.length === 0) {
    throw new HttpError(400, `Add at least one option to "${label}".`);
  }

  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new HttpError(400, `Options on "${label}" must be unique.`);
  }

  const validation = storedValidation(field.type, field.validation ?? undefined);

  if ((field.type === "TEXT" || field.type === "TEXTAREA") && validation?.minLength != null && validation?.maxLength != null) {
    if (validation.minLength > validation.maxLength) {
      throw new HttpError(400, `Minimum length cannot exceed maximum length on "${label}".`);
    }
  }

  if (field.type === "NUMBER" && validation?.min != null && validation?.max != null && validation.min > validation.max) {
    throw new HttpError(400, `Minimum cannot exceed maximum on "${label}".`);
  }

  if (field.type === "RATING") {
    const max = validation.max;
    if (!Number.isInteger(max) || max < 2 || max > 10) {
      throw new HttpError(400, `Rating on "${label}" must be from 2 to 10.`);
    }
  }

  if (field.type === "LINEAR_SCALE") {
    const { min, max } = validation;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max || max - min > 10) {
      throw new HttpError(400, `Linear scale on "${label}" must be a whole-number range of at most 10 steps.`);
    }
  }

  return {
    id: field.id,
    sectionId,
    label: label.slice(0, 2000),
    titleDoc: field.titleDoc ?? null,
    descriptionDoc: field.descriptionDoc ?? null,
    type: field.type,
    required: isContentType(field.type) ? false : Boolean(field.required),
    options,
    validation,
    order,
  };
}

export function parseFormWrite(body) {
  const parsed = formWriteSchema.parse(body);
  assertDocSize(parsed.titleDoc, "The form title");
  assertDocSize(parsed.descriptionDoc, "The form description");

  const title = (docToPlain(parsed.titleDoc) || parsed.title).trim();
  if (!title) {
    throw new HttpError(400, "Add a form title.");
  }

  const description = (docToPlain(parsed.descriptionDoc) || parsed.description || "").trim() || null;
  const sectionIds = new Set();

  const sections = parsed.sections.map((section, sectionIndex) => {
    if (sectionIds.has(section.id)) {
      throw new HttpError(400, "Each section must have its own id.");
    }

    sectionIds.add(section.id);
    assertDocSize(section.titleDoc, "A section title");
    assertDocSize(section.descriptionDoc, "A section description");

    const fieldIds = new Set();
    const fields = section.fields.map((field, fieldIndex) => {
      if (fieldIds.has(field.id)) {
        throw new HttpError(400, "Each question must have its own id.");
      }

      fieldIds.add(field.id);
      return prepareField(field, fieldIndex, section.id);
    });

    return {
      id: section.id,
      title: (docToPlain(section.titleDoc) || section.title || "").trim().slice(0, 500),
      titleDoc: section.titleDoc ?? null,
      descriptionDoc: section.descriptionDoc ?? null,
      order: sectionIndex,
      fields,
    };
  });

  const allFieldIds = sections.flatMap((section) => section.fields.map((field) => field.id));
  if (new Set(allFieldIds).size !== allFieldIds.length) {
    throw new HttpError(400, "Each question must have its own id.");
  }

  return {
    title: title.slice(0, 200),
    description,
    titleDoc: parsed.titleDoc ?? null,
    descriptionDoc: parsed.descriptionDoc ?? null,
    limitOneResponse: parsed.limitOneResponse,
    sections,
  };
}

export function isUuid(value) {
  return z.uuid().safeParse(value).success;
}

export { CHOICE_TYPES };

import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";
import { isContentType } from "./constants.js";
import { parseFormWrite } from "./validation.js";

export const formInclude = {
  owner: { select: { id: true, name: true, email: true } },
  sections: {
    orderBy: { order: "asc" },
    include: {
      fields: { orderBy: { order: "asc" } },
    },
  },
};

function jsonValue(value) {
  return value == null ? Prisma.DbNull : value;
}

export function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (typeof option === "string") {
        return { id: option, label: option };
      }

      if (!option || typeof option !== "object") {
        return null;
      }

      return {
        id: String(option.id),
        label: String(option.label ?? ""),
      };
    })
    .filter(Boolean);
}

export function orderedSections(form) {
  return [...(form.sections ?? [])]
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      ...section,
      fields: [...(section.fields ?? [])].sort((left, right) => left.order - right.order),
    }));
}

export function orderedFields(form) {
  return orderedSections(form).flatMap((section) => section.fields);
}

export function answerableFields(form) {
  return orderedFields(form).filter((field) => !isContentType(field.type));
}

function serializeField(field) {
  return {
    id: field.id,
    label: field.label,
    titleDoc: field.titleDoc ?? null,
    descriptionDoc: field.descriptionDoc ?? null,
    type: field.type,
    required: field.required,
    options: normalizeOptions(field.options),
    validation: field.validation ?? null,
    order: field.order,
  };
}

// Pass viewerId only for signed-in builders; owner details are never sent to public respondents.
export function serializeForm(form, viewerId) {
  return {
    ...(viewerId
      ? {
          role: form.ownerId === viewerId ? "OWNER" : "EDITOR",
          owner: form.owner ? { id: form.owner.id, name: form.owner.name, email: form.owner.email } : null,
        }
      : {}),
    id: form.id,
    title: form.title,
    description: form.description ?? null,
    titleDoc: form.titleDoc ?? null,
    descriptionDoc: form.descriptionDoc ?? null,
    status: form.status,
    publicId: form.publicId ?? null,
    limitOneResponse: form.limitOneResponse,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    sections: orderedSections(form).map((section) => ({
      id: section.id,
      title: section.title,
      titleDoc: section.titleDoc ?? null,
      descriptionDoc: section.descriptionDoc ?? null,
      order: section.order,
      fields: section.fields.map(serializeField),
    })),
  };
}

// Prisma drops `undefined` filters, which would match every user's forms.
function assertOwner(ownerId) {
  if (typeof ownerId !== "string" || !ownerId) {
    throw new Error("ownerId is required");
  }
}

function accessibleBy(userId) {
  return { OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }] };
}

export async function requireForm(id, userId, { ownerOnly = false } = {}) {
  assertOwner(userId);
  const form = await prisma.form.findFirst({
    where: ownerOnly ? { id, ownerId: userId } : { id, ...accessibleBy(userId) },
    include: formInclude,
  });
  if (!form) {
    throw new HttpError(404, "Form not found");
  }

  return form;
}

function fieldData(formId, field) {
  return {
    formId,
    sectionId: field.sectionId,
    label: field.label,
    titleDoc: jsonValue(field.titleDoc),
    descriptionDoc: jsonValue(field.descriptionDoc),
    type: field.type,
    required: field.required,
    options: field.options,
    validation: jsonValue(field.validation),
    order: field.order,
  };
}

async function writeContent(tx, formId, prepared) {
  await tx.form.update({
    where: { id: formId },
    data: {
      title: prepared.title,
      description: prepared.description,
      titleDoc: jsonValue(prepared.titleDoc),
      descriptionDoc: jsonValue(prepared.descriptionDoc),
      ...(prepared.limitOneResponse === undefined ? {} : { limitOneResponse: prepared.limitOneResponse }),
    },
  });

  for (const section of prepared.sections) {
    const data = {
      title: section.title,
      titleDoc: jsonValue(section.titleDoc),
      descriptionDoc: jsonValue(section.descriptionDoc),
      order: section.order,
    };

    await tx.section.upsert({
      where: { id: section.id },
      create: { id: section.id, formId, ...data },
      update: data,
    });
  }

  for (const section of prepared.sections) {
    for (const field of section.fields) {
      await tx.field.upsert({
        where: { id: field.id },
        create: { id: field.id, ...fieldData(formId, field) },
        update: fieldData(formId, field),
      });
    }
  }

  const fieldIds = prepared.sections.flatMap((section) => section.fields.map((field) => field.id));
  const sectionIds = prepared.sections.map((section) => section.id);

  if (fieldIds.length === 0) {
    await tx.field.deleteMany({ where: { formId } });
  } else {
    await tx.field.deleteMany({ where: { formId, id: { notIn: fieldIds } } });
  }

  await tx.section.deleteMany({ where: { formId, id: { notIn: sectionIds } } });
}

async function assertOwnedIds(formId, prepared) {
  const sectionIds = prepared.sections.map((section) => section.id);
  const fieldIds = prepared.sections.flatMap((section) => section.fields.map((field) => field.id));

  if (sectionIds.length > 0) {
    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, formId: true },
    });

    if (sections.some((section) => section.formId !== formId)) {
      throw new HttpError(400, "Section does not belong to this form.");
    }
  }

  if (fieldIds.length > 0) {
    const fields = await prisma.field.findMany({
      where: { id: { in: fieldIds } },
      select: { id: true, formId: true },
    });

    if (fields.some((field) => field.formId !== formId)) {
      throw new HttpError(400, "Question does not belong to this form.");
    }
  }
}

export async function listForms(userId) {
  assertOwner(userId);
  const forms = await prisma.form.findMany({
    where: accessibleBy(userId),
    include: formInclude,
    orderBy: { updatedAt: "desc" },
  });

  return forms.map((form) => serializeForm(form, userId));
}

export async function createForm(ownerId, body = {}) {
  assertOwner(ownerId);
  const hasSections = Array.isArray(body.sections) && body.sections.length > 0;

  if (hasSections) {
    const prepared = parseFormWrite(body);
    const created = await prisma.$transaction(async (tx) => {
      const form = await tx.form.create({
        data: {
          ownerId,
          title: prepared.title,
          description: prepared.description,
          titleDoc: jsonValue(prepared.titleDoc),
          descriptionDoc: jsonValue(prepared.descriptionDoc),
          status: "DRAFT",
        },
      });

      await writeContent(tx, form.id, prepared);
      return tx.form.findUniqueOrThrow({ where: { id: form.id }, include: formInclude });
    });

    return serializeForm(created, ownerId);
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : "Untitled form";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const form = await prisma.form.create({
    data: {
      ownerId,
      title,
      description,
      status: "DRAFT",
      sections: {
        create: [{ title: "Section 1", order: 0 }],
      },
    },
    include: formInclude,
  });

  return serializeForm(form, ownerId);
}

export async function updateForm(id, userId, body) {
  await requireForm(id, userId);
  const prepared = parseFormWrite(body);
  await assertOwnedIds(id, prepared);

  const updated = await prisma.$transaction(async (tx) => {
    await writeContent(tx, id, prepared);
    return tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
  });

  return serializeForm(updated, userId);
}

function cloneOptions(options) {
  return normalizeOptions(options).map((option) => ({
    id: randomUUID(),
    label: option.label,
  }));
}

export async function duplicateForm(id, userId) {
  const form = await requireForm(id, userId);
  const serialized = serializeForm(form);

  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.form.create({
      data: {
        ownerId: userId,
        limitOneResponse: serialized.limitOneResponse,
        title: `Copy of ${serialized.title}`.slice(0, 200),
        description: serialized.description,
        titleDoc: jsonValue(serialized.titleDoc),
        descriptionDoc: jsonValue(serialized.descriptionDoc),
        status: "DRAFT",
      },
    });

    for (const [sectionIndex, section] of serialized.sections.entries()) {
      await tx.section.create({
        data: {
          formId: copy.id,
          title: section.title,
          titleDoc: jsonValue(section.titleDoc),
          descriptionDoc: jsonValue(section.descriptionDoc),
          order: sectionIndex,
          ...(section.fields.length > 0
            ? {
                fields: {
                  create: section.fields.map((field, fieldIndex) => ({
                    formId: copy.id,
                    label: field.label,
                    titleDoc: jsonValue(field.titleDoc),
                    descriptionDoc: jsonValue(field.descriptionDoc),
                    type: field.type,
                    required: field.required,
                    options: cloneOptions(field.options),
                    validation: jsonValue(field.validation),
                    order: fieldIndex,
                  })),
                },
              }
            : {}),
        },
      });
    }

    return tx.form.findUniqueOrThrow({ where: { id: copy.id }, include: formInclude });
  });

  return serializeForm(created, userId);
}

export function createPublicId() {
  return randomBytes(9).toString("base64url");
}

export async function publishForm(id, userId) {
  const form = await requireForm(id, userId);
  const updated = await prisma.form.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publicId: form.publicId ?? createPublicId(),
    },
    include: formInclude,
  });

  return serializeForm(updated, userId);
}

export async function closeForm(id, userId) {
  const form = await requireForm(id, userId);
  if (form.status === "DRAFT") {
    throw new HttpError(400, "Publish the form before closing it.");
  }

  const updated = await prisma.form.update({
    where: { id },
    data: { status: "CLOSED" },
    include: formInclude,
  });

  return serializeForm(updated, userId);
}

export async function getFormByPublicId(publicId) {
  return prisma.form.findFirst({
    where: {
      publicId,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    include: formInclude,
  });
}

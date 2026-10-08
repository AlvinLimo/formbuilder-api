import { Router } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../lib/http.js";
import { isEmptyAnswer, normalizeStoredAnswer, validateAnswer } from "../lib/answers.js";
import { answerableFields, getFormByPublicId, normalizeOptions, serializeForm } from "../lib/forms.js";
import { fileExists, uploadFormFile } from "../lib/storage.js";
import { isUuid } from "../lib/validation.js";
import { resolveAllowedType } from "../lib/constants.js";
import { optionalAuth } from "../lib/auth.js";

const router = Router();
const ALREADY_RESPONDED = "You have already responded to this form.";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function requirePublicId(publicId) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(publicId ?? "")) {
    throw new HttpError(404, "Form not found");
  }

  return publicId;
}

async function requirePublicForm(publicId) {
  const form = await getFormByPublicId(requirePublicId(publicId));
  if (!form) {
    throw new HttpError(404, "Form not found");
  }

  return form;
}

function answerable(form) {
  return answerableFields(form).map((field) => ({
    ...field,
    options: normalizeOptions(field.options),
    validation: field.validation && typeof field.validation === "object" ? field.validation : null,
  }));
}

function respondentKey(value) {
  return isUuid(value) ? value : null;
}

async function respondentStatus(form, key, user) {
  const assignment = user
    ? await prisma.formAssignment.findUnique({
        where: { formId_userId: { formId: form.id, userId: user.id } },
        select: { submittedAt: true },
      })
    : null;

  if (assignment?.submittedAt) {
    return { assigned: true, hasResponded: true };
  }

  if (!form.limitOneResponse || !key) {
    return { assigned: Boolean(assignment), hasResponded: false };
  }

  const existing = await prisma.submission.findUnique({
    where: { formId_respondentKey: { formId: form.id, respondentKey: key } },
    select: { id: true },
  });
  return { assigned: Boolean(assignment), hasResponded: Boolean(existing) };
}

router.get(
  "/:publicId",
  optionalAuth,
  asyncRoute(async (req, res) => {
    const form = await requirePublicForm(req.params.publicId);
    res.json({
      ...serializeForm(form),
      ...(await respondentStatus(form, respondentKey(req.query.respondent), req.user)),
    });
  })
);

router.post(
  "/:publicId/files",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      next(error);
    });
  },
  asyncRoute(async (req, res) => {
    const form = await requirePublicForm(req.params.publicId);
    if (form.status !== "PUBLISHED") {
      throw new HttpError(409, "This form is closed.");
    }

    const field = answerable(form).find((item) => item.id === req.body?.fieldId);
    if (!field || field.type !== "FILE") {
      throw new HttpError(400, "That question does not accept a file.");
    }

    if (!req.file) {
      throw new HttpError(400, "Choose a file.");
    }

    const allowed = Array.isArray(field.validation?.allowedMimeTypes) ? field.validation.allowedMimeTypes : [];
    const mimeType = resolveAllowedType(req.file.mimetype, req.file.originalname, allowed);
    if (!mimeType) {
      throw new HttpError(400, `"${field.label}" file type is not allowed.`, field.id);
    }
    req.file.mimetype = mimeType;

    const maxMb = field.validation?.maxFileSizeMb ?? 10;
    if (req.file.size > maxMb * 1024 * 1024) {
      throw new HttpError(400, `"${field.label}" must be ${maxMb} MB or smaller.`, field.id);
    }

    const stored = await uploadFormFile({
      formId: form.id,
      fieldId: field.id,
      file: req.file,
    });

    res.status(201).json(stored);
  })
);

router.post(
  "/:publicId/submissions",
  optionalAuth,
  asyncRoute(async (req, res) => {
    const form = await requirePublicForm(req.params.publicId);
    if (form.status !== "PUBLISHED") {
      throw new HttpError(409, "This form is closed.");
    }

    const key = respondentKey(req.body?.respondentKey);
    if (form.limitOneResponse && !key) {
      throw new HttpError(400, "Refresh the page and try again.");
    }

    if ((await respondentStatus(form, key, req.user)).hasResponded) {
      throw new HttpError(409, ALREADY_RESPONDED);
    }

    const incoming = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
    const data = {};
    const fields = answerable(form);

    for (const field of fields) {
      const value = incoming[field.id];
      const problem = validateAnswer(field, value);
      if (problem) {
        throw new HttpError(400, problem.error, problem.fieldId);
      }

      if (isEmptyAnswer(field.type, value)) {
        continue;
      }

      const stored = normalizeStoredAnswer(field, value);
      if (field.type === "FILE") {
        if (!stored.path.startsWith(`${form.id}/`) || stored.path.includes("..")) {
          throw new HttpError(400, `"${field.label}" file does not belong to this form.`, field.id);
        }

        const exists = await fileExists(stored.path);
        if (!exists) {
          throw new HttpError(400, `Upload "${field.label}" again.`, field.id);
        }
      }

      data[field.id] = stored;
    }

    const userId = req.user?.id ?? null;
    let submission;
    try {
      submission = await prisma.$transaction(async (tx) => {
        if (userId) {
          const assignment = await tx.formAssignment.findUnique({
            where: { formId_userId: { formId: form.id, userId } },
            select: { id: true },
          });

          if (assignment) {
            const claimed = await tx.formAssignment.updateMany({
              where: { id: assignment.id, submittedAt: null },
              data: { submittedAt: new Date() },
            });
            if (claimed.count === 0) {
              throw new HttpError(409, ALREADY_RESPONDED);
            }
          }
        }

        return tx.submission.create({
          data: {
            formId: form.id,
            data,
            userId,
            respondentKey: form.limitOneResponse ? key : null,
            snapshot: {
              fields: fields.map((field) => ({
                id: field.id,
                label: field.label,
                type: field.type,
                options: field.options,
              })),
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, ALREADY_RESPONDED);
      }

      throw error;
    }

    res.status(201).json({ id: submission.id, createdAt: submission.createdAt });
  })
);

export default router;

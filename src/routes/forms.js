import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../lib/http.js";
import { isUuid } from "../lib/validation.js";
import {
  closeForm,
  createForm,
  duplicateForm,
  listForms,
  publishForm,
  requireForm,
  serializeForm,
  updateForm,
} from "../lib/forms.js";
import { buildResponseTable, collectFileRecords, toCsv } from "../lib/responses.js";
import {
  addAssignments,
  addCollaborators,
  listAssignments,
  listCollaborators,
  removeAssignment,
  removeCollaborator,
} from "../lib/sharing.js";
import { downloadFormFile, removeFormFiles } from "../lib/storage.js";

const router = Router();
const submissionInclude = { user: { select: { name: true, email: true } } };

function requireId(id) {
  if (!isUuid(id)) {
    throw new HttpError(404, "Form not found");
  }

  return id;
}

router.get(
  "/",
  asyncRoute(async (req, res) => {
    res.json(await listForms(req.user.id));
  })
);

router.post(
  "/",
  asyncRoute(async (req, res) => {
    res.status(201).json(await createForm(req.user.id, req.body ?? {}));
  })
);

router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const form = await requireForm(requireId(req.params.id), req.user.id);
    res.json(serializeForm(form, req.user.id));
  })
);

router.put(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await updateForm(requireId(req.params.id), req.user.id, req.body ?? {}));
  })
);

router.post(
  "/:id/duplicate",
  asyncRoute(async (req, res) => {
    res.status(201).json(await duplicateForm(requireId(req.params.id), req.user.id));
  })
);

router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = requireId(req.params.id);
    await requireForm(id, req.user.id, { ownerOnly: true });
    const submissions = await prisma.submission.findMany({ where: { formId: id } });
    const paths = [...collectFileRecords(submissions).keys()];
    await prisma.form.delete({ where: { id } });
    await removeFormFiles(paths);
    res.status(204).send();
  })
);

router.post(
  "/:id/publish",
  asyncRoute(async (req, res) => {
    res.json(await publishForm(requireId(req.params.id), req.user.id));
  })
);

router.post(
  "/:id/close",
  asyncRoute(async (req, res) => {
    res.json(await closeForm(requireId(req.params.id), req.user.id));
  })
);

router.get(
  "/:id/collaborators",
  asyncRoute(async (req, res) => {
    res.json(await listCollaborators(requireId(req.params.id), req.user.id));
  })
);

router.post(
  "/:id/collaborators",
  asyncRoute(async (req, res) => {
    res.json(await addCollaborators(requireId(req.params.id), req.user.id, req.body));
  })
);

router.delete(
  "/:id/collaborators/:userId",
  asyncRoute(async (req, res) => {
    await removeCollaborator(requireId(req.params.id), req.user.id, req.params.userId);
    res.status(204).send();
  })
);

router.get(
  "/:id/assignments",
  asyncRoute(async (req, res) => {
    res.json(await listAssignments(requireId(req.params.id), req.user.id));
  })
);

router.post(
  "/:id/assignments",
  asyncRoute(async (req, res) => {
    res.json(await addAssignments(requireId(req.params.id), req.user.id, req.body));
  })
);

router.delete(
  "/:id/assignments/:userId",
  asyncRoute(async (req, res) => {
    await removeAssignment(requireId(req.params.id), req.user.id, req.params.userId);
    res.status(204).send();
  })
);

router.get(
  "/:id/submissions",
  asyncRoute(async (req, res) => {
    const form = serializeForm(await requireForm(requireId(req.params.id), req.user.id));
    const submissions = await prisma.submission.findMany({ where: { formId: form.id }, include: submissionInclude });
    res.json({
      form: {
        id: form.id,
        title: form.title,
        status: form.status,
        publicId: form.publicId,
      },
      ...buildResponseTable(form, submissions),
    });
  })
);

router.get(
  "/:id/submissions.csv",
  asyncRoute(async (req, res) => {
    const form = serializeForm(await requireForm(requireId(req.params.id), req.user.id));
    const submissions = await prisma.submission.findMany({ where: { formId: form.id }, include: submissionInclude });
    const csv = toCsv(buildResponseTable(form, submissions));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="responses.csv"');
    res.send(`\uFEFF${csv}`);
  })
);

router.get(
  "/:id/files/download",
  asyncRoute(async (req, res) => {
    const id = requireId(req.params.id);
    await requireForm(id, req.user.id);
    const path = typeof req.query.path === "string" ? req.query.path : "";
    if (!path || path.includes("..") || path.startsWith("/")) {
      throw new HttpError(404, "File not found.");
    }

    const submissions = await prisma.submission.findMany({ where: { formId: id } });
    const record = collectFileRecords(submissions).get(path);
    if (!record) {
      throw new HttpError(404, "File not found.");
    }

    const buffer = await downloadFormFile(path);
    const filename = record.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "") || "download";
    res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

export default router;

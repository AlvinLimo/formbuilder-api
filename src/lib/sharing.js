import { z } from "zod";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";
import { requireForm } from "./forms.js";

const userIdsSchema = z.object({
  userIds: z.array(z.uuid()).min(1, "Choose at least one person.").max(100),
});

const publicUser = { select: { id: true, name: true, email: true } };

async function existingUserIds(userIds, excludeId) {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true },
  });

  return users.map((user) => user.id).filter((id) => id !== excludeId);
}

export async function searchUsers(query, currentUserId) {
  const term = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (term.length < 2) {
    return [];
  }

  return prisma.user.findMany({
    where: {
      id: { not: currentUserId },
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ],
    },
    ...publicUser,
    orderBy: { name: "asc" },
    take: 10,
  });
}

export async function listCollaborators(formId, userId) {
  await requireForm(formId, userId);
  const rows = await prisma.formCollaborator.findMany({
    where: { formId },
    include: { user: publicUser },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({ ...row.user, addedAt: row.createdAt }));
}

export async function addCollaborators(formId, userId, body) {
  const form = await requireForm(formId, userId, { ownerOnly: true });
  const { userIds } = userIdsSchema.parse(body ?? {});
  const ids = await existingUserIds(userIds, form.ownerId);

  if (ids.length > 0) {
    await prisma.formCollaborator.createMany({
      data: ids.map((id) => ({ formId, userId: id })),
      skipDuplicates: true,
    });
  }

  return listCollaborators(formId, userId);
}

export async function removeCollaborator(formId, userId, collaboratorId) {
  await requireForm(formId, userId, { ownerOnly: true });
  await prisma.formCollaborator.deleteMany({ where: { formId, userId: collaboratorId } });
}

function serializeAssignment(row) {
  return {
    ...row.user,
    assignedAt: row.createdAt,
    submittedAt: row.submittedAt,
    status: row.submittedAt ? "SUBMITTED" : "PENDING",
  };
}

export async function listAssignments(formId, userId) {
  await requireForm(formId, userId);
  const rows = await prisma.formAssignment.findMany({
    where: { formId },
    include: { user: publicUser },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(serializeAssignment);
}

export async function addAssignments(formId, userId, body) {
  const form = await requireForm(formId, userId);
  if (form.status !== "PUBLISHED") {
    throw new HttpError(400, "Publish the form before sending it.");
  }

  const { userIds } = userIdsSchema.parse(body ?? {});
  const ids = await existingUserIds(userIds);

  if (ids.length > 0) {
    const earlier = await prisma.submission.groupBy({
      by: ["userId"],
      where: { formId, userId: { in: ids } },
      _min: { createdAt: true },
    });
    const submittedAt = new Map(earlier.map((row) => [row.userId, row._min.createdAt]));

    await prisma.formAssignment.createMany({
      data: ids.map((id) => ({
        formId,
        userId: id,
        assignedById: userId,
        submittedAt: submittedAt.get(id) ?? null,
      })),
      skipDuplicates: true,
    });
  }

  return listAssignments(formId, userId);
}

export async function removeAssignment(formId, userId, assigneeId) {
  await requireForm(formId, userId);
  await prisma.formAssignment.deleteMany({ where: { formId, userId: assigneeId } });
}

export async function listMyAssignments(userId) {
  const rows = await prisma.formAssignment.findMany({
    where: { userId, form: { status: { in: ["PUBLISHED", "CLOSED"] } } },
    include: {
      form: { select: { id: true, title: true, status: true, publicId: true } },
      assignedBy: publicUser,
    },
    orderBy: { createdAt: "desc" },
  });

  const assignments = rows.map((row) => ({
    id: row.id,
    form: row.form,
    assignedBy: row.assignedBy,
    assignedAt: row.createdAt,
    submittedAt: row.submittedAt,
    status: row.submittedAt ? "SUBMITTED" : row.form.status === "CLOSED" ? "CLOSED" : "PENDING",
  }));

  return {
    pendingCount: assignments.filter((item) => item.status === "PENDING").length,
    assignments,
  };
}

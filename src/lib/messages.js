import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";

const PAGE_SIZE = 30;

const publicUser = { select: { id: true, name: true, email: true } };

const idSchema = z.uuid("Conversation not found.");

const openSchema = z.object({
  userId: z.uuid("Choose someone to message."),
});

const sendSchema = z.object({
  body: z.string().trim().min(1, "Write a message.").max(4000, "Messages must be 4000 characters or fewer."),
});

const messageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
};

const conversationInclude = {
  participants: { include: { user: publicUser } },
  messages: { select: messageSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
};

function parseId(value) {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(404, "Conversation not found.");
  }

  return result.data;
}

function directKey(userA, userB) {
  return [userA, userB].sort().join(":");
}

async function unreadCounts(userId, conversationId) {
  const memberships = await prisma.conversationParticipant.findMany({
    where: { userId, ...(conversationId ? { conversationId } : {}) },
    select: { conversationId: true, lastReadAt: true },
  });

  if (memberships.length === 0) {
    return new Map();
  }

  const rows = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      AND: [
        { OR: [{ senderId: null }, { senderId: { not: userId } }] },
        {
          OR: memberships.map((membership) => ({
            conversationId: membership.conversationId,
            ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
          })),
        },
      ],
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.conversationId, row._count._all]));
}

function serializeConversation(conversation, userId, unread) {
  const other = conversation.participants.find((participant) => participant.userId !== userId);
  return {
    id: conversation.id,
    otherUser: other?.user ?? null,
    lastMessage: conversation.messages[0] ?? null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: unread.get(conversation.id) ?? 0,
  };
}

async function requireParticipant(conversationId, userId) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });

  if (!participant) {
    throw new HttpError(404, "Conversation not found.");
  }

  return participant;
}

export async function listConversations(userId) {
  const conversations = await prisma.conversation.findMany({
    where: {
      participants: { some: { userId } },
      messages: { some: {} },
    },
    include: conversationInclude,
    orderBy: { lastMessageAt: "desc" },
  });

  const unread = await unreadCounts(userId);
  return conversations.map((conversation) => serializeConversation(conversation, userId, unread));
}

export async function unreadMessageCount(userId) {
  const unread = await unreadCounts(userId);
  let count = 0;
  for (const value of unread.values()) {
    count += value;
  }

  return { count };
}

export async function getConversation(rawId, userId) {
  const conversationId = parseId(rawId);
  await requireParticipant(conversationId, userId);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });

  return serializeConversation(conversation, userId, await unreadCounts(userId, conversationId));
}

export async function openConversation(userId, body) {
  const { userId: otherId } = openSchema.parse(body ?? {});
  if (otherId === userId) {
    throw new HttpError(400, "You cannot message yourself.");
  }

  const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
  if (!other) {
    throw new HttpError(404, "That person no longer has an account.");
  }

  const key = directKey(userId, otherId);
  let conversation;
  try {
    conversation = await prisma.conversation.upsert({
      where: { directKey: key },
      update: {},
      create: {
        directKey: key,
        participants: { create: [{ userId }, { userId: otherId }] },
      },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }

    conversation = await prisma.conversation.findUnique({ where: { directKey: key }, select: { id: true } });
  }

  return getConversation(conversation.id, userId);
}

export async function listMessages(rawId, userId, before) {
  const conversationId = parseId(rawId);
  await requireParticipant(conversationId, userId);

  const cursor = typeof before === "string" && idSchema.safeParse(before).success ? before : null;
  const rows = await prisma.message.findMany({
    where: { conversationId },
    select: messageSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const messages = rows.slice(0, PAGE_SIZE).reverse();
  return { messages, nextCursor: hasMore ? messages[0].id : null };
}

export async function sendMessage(rawId, userId, body) {
  const conversationId = parseId(rawId);
  await requireParticipant(conversationId, userId);
  const { body: text } = sendSchema.parse(body ?? {});

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { conversationId, senderId: userId, body: text },
      select: messageSelect,
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    await tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: message.createdAt },
    });

    return message;
  });
}

export async function markConversationRead(rawId, userId) {
  const conversationId = parseId(rawId);
  await requireParticipant(conversationId, userId);

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
}

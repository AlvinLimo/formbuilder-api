import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute } from "../lib/http.js";
import {
  getConversation,
  listConversations,
  listMessages,
  markConversationRead,
  openConversation,
  sendMessage,
  unreadMessageCount,
} from "../lib/messages.js";

const router = Router();

router.get(
  "/me/conversations",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await listConversations(req.user.id));
  })
);

router.get(
  "/me/messages/unread-count",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await unreadMessageCount(req.user.id));
  })
);

router.post(
  "/conversations",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await openConversation(req.user.id, req.body));
  })
);

router.get(
  "/conversations/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await getConversation(req.params.id, req.user.id));
  })
);

router.get(
  "/conversations/:id/messages",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await listMessages(req.params.id, req.user.id, req.query.before));
  })
);

router.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.status(201).json(await sendMessage(req.params.id, req.user.id, req.body));
  })
);

router.post(
  "/conversations/:id/read",
  requireAuth,
  asyncRoute(async (req, res) => {
    await markConversationRead(req.params.id, req.user.id);
    res.status(204).end();
  })
);

export default router;

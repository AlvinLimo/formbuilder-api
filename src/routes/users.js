import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute } from "../lib/http.js";
import { listMyAssignments, searchUsers } from "../lib/sharing.js";

const router = Router();

router.get(
  "/users/search",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await searchUsers(req.query.q, req.user.id));
  })
);

router.get(
  "/me/assignments",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await listMyAssignments(req.user.id));
  })
);

export default router;

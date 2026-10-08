import { Router } from "express";
import { asyncRoute } from "../lib/http.js";
import { login, register, requireAuth } from "../lib/auth.js";

const router = Router();

router.post(
  "/register",
  asyncRoute(async (req, res) => {
    res.status(201).json(await register(req.body));
  })
);

router.post(
  "/login",
  asyncRoute(async (req, res) => {
    res.json(await login(req.body));
  })
);

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;

import express from "express";
import cors from "cors";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "./lib/prisma.js";
import { HttpError } from "./lib/http.js";
import { requireAuth } from "./lib/auth.js";
import authRouter from "./routes/auth.js";
import formsRouter from "./routes/forms.js";
import publicFormsRouter from "./routes/public-forms.js";
import usersRouter from "./routes/users.js";
import messagesRouter from "./routes/messages.js";

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", database: "connected" });
});

app.use("/auth", authRouter);
app.use("/forms", requireAuth, formsRouter);
app.use(usersRouter);
app.use(messagesRouter);
app.use("/public/forms", publicFormsRouter);

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.fieldId) {
      body.fieldId = err.fieldId;
    }

    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const issue = err.issues?.[0];
    res.status(400).json({ error: issue?.message ?? "Invalid request" });
    return;
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File must be 25 MB or smaller." : "Could not read the file.";
    res.status(400).json({ error: message });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2025" || err.code === "P2023")) {
    res.status(404).json({ error: "Form not found" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;

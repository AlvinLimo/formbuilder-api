import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", database: "connected" });
  console.log(`Connected to database`);
});

app.get("/forms", async (req, res) => {
  const forms = await prisma.form.findMany({
    include: { fields: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(forms);
});

app.post("/forms", async (req, res) => {
  const { title, description, fields = [] } = req.body;
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }

  const form = await prisma.form.create({
    data: {
      title,
      description,
      fields: {
        create: fields.map((field, index) => ({
          label: field.label,
          type: field.type,
          required: field.required ?? false,
          options: field.options,
          order: index,
        })),
      },
    },
    include: { fields: true },
  });
  res.status(201).json(form);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;


import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomBytes } from "crypto";

import { prisma } from "./lib/prisma.js";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";

const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Authentication routes
app.use("/auth", authRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// GET ALL FORMS BELONGING TO THE LOGGED-IN USER
app.get("/forms", requireAuth, async (req, res, next) => {
  try {
    const forms = await prisma.form.findMany({
      where: { ownerId: req.user.id },
      include: {
        _count: {
          select: {
            questions: true,
            responses: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(forms);
  } catch (error) {
    next(error);
  }
});

// GET ONE FORM FOR ITS OWNER / EDITOR
app.get("/forms/:id", requireAuth, async (req, res, next) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        ownerId: req.user.id,
      },
      include: {
        questions: {
          orderBy: { order: "asc" },
          include: { options: true },
        },
      },
    });

    if (!form) {
      return res.status(404).json({
        message: "Form not found.",
      });
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});

// PUBLIC FORM FOR RESPONDENTS USING THE RANDOM TOKEN
// No authentication required.
app.get(
  "/public/forms/token/:token",
  async (req, res, next) => {
    try {
      const form = await prisma.form.findFirst({
        where: {
          publicToken: req.params.token,
          isPublished: true,
        },
        select: {
          id: true,
          title: true,
          description: true,
          isPublished: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              text: true,
              type: true,
              required: true,
              order: true,
              options: {
                select: {
                  id: true,
                  text: true,
                },
              },
            },
          },
        },
      });

      if (!form) {
        return res.status(404).json({
          message: "Published form not found.",
        });
      }

      res.json(form);
    } catch (error) {
      next(error);
    }
  }
);

// OPTIONAL: KEEP YOUR OLD PUBLIC FORM ENDPOINT
// This supports any existing pages that use the internal ID.
app.get("/public/forms/:id", async (req, res, next) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        description: true,
        isPublished: true,
        questions: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            text: true,
            type: true,
            required: true,
            order: true,
            options: {
              select: {
                id: true,
                text: true,
              },
            },
          },
        },
      },
    });

    if (!form) {
      return res.status(404).json({
        message: "Published form not found.",
      });
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});

// CREATE FORM
app.post("/forms", requireAuth, async (req, res, next) => {
  try {
    const { title, description, questions = [] } = req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        message: "A form title is required.",
      });
    }

    if (!Array.isArray(questions)) {
      return res.status(400).json({
        message: "Questions must be an array.",
      });
    }

    const form = await prisma.form.create({
      data: {
        title: title.trim(),
        description:
          typeof description === "string" ? description : null,
        ownerId: req.user.id,
        questions: {
          create: questions.map((question, index) => ({
            text: question.text,
            type: question.type,
            required: Boolean(question.required),
            order: Number.isInteger(question.order)
              ? question.order
              : index,
            options: {
              create: Array.isArray(question.options)
                ? question.options.map((option) => ({
                    text:
                      typeof option === "string"
                        ? option
                        : option.text,
                  }))
                : [],
            },
          })),
        },
      },
      include: {
        questions: {
          orderBy: { order: "asc" },
          include: { options: true },
        },
      },
    });

    res.status(201).json(form);
  } catch (error) {
    next(error);
  }
});

// SUBMIT A RESPONSE TO A PUBLISHED FORM
// The respondent does not need to log in.
app.post("/forms/:id/responses", async (req, res, next) => {
  try {
    const { answers } = req.body ?? {};

    if (!Array.isArray(answers)) {
      return res.status(400).json({
        message: "Answers must be an array.",
      });
    }

    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        isPublished: true,
      },
      include: {
        questions: {
          include: { options: true },
        },
      },
    });

    if (!form) {
      return res.status(404).json({
        message: "Published form not found.",
      });
    }

    const questionIds = new Set(
      form.questions.map((question) => question.id)
    );

    const seenQuestionIds = new Set();

    for (const answer of answers) {
      if (
        !answer ||
        typeof answer.questionId !== "string" ||
        typeof answer.value !== "string" ||
        !questionIds.has(answer.questionId) ||
        seenQuestionIds.has(answer.questionId)
      ) {
        return res.status(400).json({
          message: "One or more answers are invalid.",
        });
      }

      seenQuestionIds.add(answer.questionId);
    }

    // Validate required answers.
    const missingRequired = form.questions.some((question) => {
      if (!question.required) return false;

      const answer = answers.find(
        (item) => item.questionId === question.id
      );

      return !answer || !answer.value.trim();
    });

    if (missingRequired) {
      return res.status(400).json({
        message: "Please answer all required questions.",
      });
    }

    // Validate that selected choice values are valid options.
    for (const answer of answers) {
      const question = form.questions.find(
        (item) => item.id === answer.questionId
      );

      if (!question) continue;

      if (
        question.type === "MULTIPLE_CHOICE" ||
        question.type === "DROPDOWN"
      ) {
        const validOptions = question.options.map(
          (option) => option.text
        );

        if (
          answer.value.trim() &&
          !validOptions.includes(answer.value)
        ) {
          return res.status(400).json({
            message: "An answer contains an invalid option.",
          });
        }
      }

      // Checkbox answers are stored as comma-separated values
      // by the public page below.
      if (question.type === "CHECKBOX") {
        const validOptions = new Set(
          question.options.map((option) => option.text)
        );

        const selectedOptions = answer.value
          ? answer.value.split(",").map((value) => value.trim())
          : [];

        if (
          selectedOptions.some(
            (value) => !validOptions.has(value)
          ) ||
          new Set(selectedOptions).size !== selectedOptions.length
        ) {
          return res.status(400).json({
            message: "An answer contains an invalid option.",
          });
        }
      }
    }

    const response = await prisma.response.create({
      data: {
        formId: form.id,
        answers: {
          create: answers.map((answer) => ({
            questionId: answer.questionId,
            value: answer.value,
          })),
        },
      },
      include: { answers: true },
    });

    res.status(201).json({
      message: "Response submitted successfully.",
      response,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE A FORM — OWNER ONLY
app.delete("/forms/:id", requireAuth, async (req, res, next) => {
  try {
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        ownerId: req.user.id,
      },
      select: { id: true },
    });

    if (!form) {
      return res.status(404).json({
        message: "Form not found.",
      });
    }

    await prisma.form.delete({
      where: { id: form.id },
    });

    res.json({ message: "Form deleted successfully." });
  } catch (error) {
    next(error);
  }
});

// DUPLICATE A FORM — OWNER ONLY
app.post(
  "/forms/:id/duplicate",
  requireAuth,
  async (req, res, next) => {
    try {
      const original = await prisma.form.findFirst({
        where: {
          id: req.params.id,
          ownerId: req.user.id,
        },
        include: {
          questions: {
            orderBy: { order: "asc" },
            include: { options: true },
          },
        },
      });

      if (!original) {
        return res.status(404).json({
          message: "Form not found.",
        });
      }

      const duplicate = await prisma.form.create({
        data: {
          title: `${original.title} (Copy)`,
          description: original.description,
          ownerId: req.user.id,
          isPublished: false,
          publicToken: null,
          questions: {
            create: original.questions.map((question) => ({
              text: question.text,
              type: question.type,
              required: question.required,
              order: question.order,
              options: {
                create: question.options.map((option) => ({
                  text: option.text,
                })),
              },
            })),
          },
        },
        include: {
          questions: {
            orderBy: { order: "asc" },
            include: { options: true },
          },
        },
      });

      res.status(201).json(duplicate);
    } catch (error) {
      next(error);
    }
  }
);

// UPDATE FORM DETAILS AND REPLACE QUESTIONS — OWNER ONLY
app.post("/forms/:id", requireAuth, async (req, res, next) => {
  try {
    const { title, description, questions } = req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        message: "A form title is required.",
      });
    }

    if (!Array.isArray(questions)) {
      return res.status(400).json({
        message: "Questions must be an array.",
      });
    }

    const existing = await prisma.form.findFirst({
      where: {
        id: req.params.id,
        ownerId: req.user.id,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Form not found.",
      });
    }

    const form = await prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({
        where: { formId: existing.id },
      });

      return tx.form.update({
        where: { id: existing.id },
        data: {
          title: title.trim(),
          description:
            typeof description === "string" ? description : null,
          questions: {
            create: questions.map((question, index) => ({
              text: question.text,
              type: question.type,
              required: Boolean(question.required),
              order: Number.isInteger(question.order)
                ? question.order
                : index,
              options: {
                create: Array.isArray(question.options)
                  ? question.options.map((option) => ({
                      text:
                        typeof option === "string"
                          ? option
                          : option.text,
                    }))
                  : [],
              },
            })),
          },
        },
        include: {
          questions: {
            orderBy: { order: "asc" },
            include: { options: true },
          },
        },
      });
    });

    res.json(form);
  } catch (error) {
    next(error);
  }
});

// REPLACE QUESTIONS — OWNER ONLY
app.post(
  "/forms/:id/questions",
  requireAuth,
  async (req, res, next) => {
    try {
      const { questions } = req.body ?? {};

      if (!Array.isArray(questions)) {
        return res.status(400).json({
          message: "Questions must be an array.",
        });
      }

      const form = await prisma.form.findFirst({
        where: {
          id: req.params.id,
          ownerId: req.user.id,
        },
        select: { id: true },
      });

      if (!form) {
        return res.status(404).json({
          message: "Form not found.",
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.question.deleteMany({
          where: { formId: form.id },
        });

        await tx.question.createMany({
          data: questions.map((question, index) => ({
            text: question.text,
            type: question.type,
            required: Boolean(question.required),
            order: Number.isInteger(question.order)
              ? question.order
              : index,
            formId: form.id,
          })),
        });

        const createdQuestions = await tx.question.findMany({
          where: { formId: form.id },
          orderBy: { order: "asc" },
        });

        for (let index = 0; index < createdQuestions.length; index++) {
          const question = questions[index];
          const created = createdQuestions[index];

          if (
            Array.isArray(question.options) &&
            question.options.length
          ) {
            await tx.option.createMany({
              data: question.options.map((option) => ({
                text:
                  typeof option === "string"
                    ? option
                    : option.text,
                questionId: created.id,
              })),
            });
          }
        }

        return tx.form.findUnique({
          where: { id: form.id },
          include: {
            questions: {
              orderBy: { order: "asc" },
              include: { options: true },
            },
          },
        });
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUBLISH FORM — OWNER ONLY
app.post(
  "/forms/:id/publish",
  requireAuth,
  async (req, res, next) => {
    try {
      const form = await prisma.form.findFirst({
        where: {
          id: req.params.id,
          ownerId: req.user.id,
        },
        select: {
          id: true,
          publicToken: true,
        },
      });

      if (!form) {
        return res.status(404).json({
          message: "Form not found.",
        });
      }

      // Reuse the token when republishing.
      // Create a random token if this is the first publication.
      const publicToken =
        form.publicToken ?? randomBytes(9).toString("base64url");

      const updated = await prisma.form.update({
        where: { id: form.id },
        data: {
          isPublished: true,
          publicToken,
        },
      });

      res.json({
        id: updated.id,
        title: updated.title,
        isPublished: updated.isPublished,
        publicToken: updated.publicToken,
      });
    } catch (error) {
      next(error);
    }
  }
);

// CENTRAL ERROR HANDLER
app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    message: "An unexpected server error occurred.",
  });
});

export default app;

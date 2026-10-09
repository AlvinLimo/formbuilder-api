import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
}));
app.use(express.json());


// =========================
// HEALTH CHECK
// =========================

app.get("/health", async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    next(error);
  }
});


// =========================
// GET ALL FORMS
// =========================

app.get("/forms", async (req, res, next) => {
  try {
    const forms = await prisma.form.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        _count: {
          select: {
            questions: true,
            responses: true,
          },
        },
      },
    });

    res.json(forms);
  } catch (error) {
    next(error);
  }
});


// =========================
// GET ONE FORM
// =========================

app.get("/forms/:id", async (req, res, next) => {
  try {
    const form = await prisma.form.findUnique({
      where: {
        id: req.params.id,
      },
      include: {
        questions: {
          orderBy: {
            order: "asc",
          },
          include: {
            options: true,
          },
        },
      },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});


// =========================
// CREATE FORM
// =========================

app.post("/forms", async (req, res, next) => {
  try {
    const {
      title,
      description,
      questions = [],
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: "Title is required",
      });
    }

    const form = await prisma.form.create({
      data: {
        title: title.trim(),
        description,

        // New forms start unpublished
        isPublished: false,

        questions: {
          create: questions.map((question, index) => ({
            text: question.text,
            type: question.type,
            required: question.required === true,
            order: index,

            options: {
              create: (question.options || []).map((option) => ({
                text: option.text,
              })),
            },
          })),
        },
      },

      include: {
        questions: {
          orderBy: {
            order: "asc",
          },
          include: {
            options: true,
          },
        },

        _count: {
          select: {
            questions: true,
            responses: true,
          },
        },
      },
    });

    res.status(201).json(form);
  } catch (error) {
    next(error);
  }
});


// =========================
// SUBMIT FORM RESPONSE
// =========================

app.post("/forms/:id/responses", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { answers = [] } = req.body;

    // Check that the form exists
    const form = await prisma.form.findUnique({
      where: {
        id,
      },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    // Check that the form is published
    if (!form.isPublished) {
      return res.status(400).json({
        error: "This form is not published",
      });
    }

    const response = await prisma.response.create({
      data: {
        formId: id,

        answers: {
          create: answers.map((answer) => ({
            questionId: answer.questionId,
            value: String(answer.value),
          })),
        },
      },

      include: {
        answers: true,
      },
    });

    res.status(201).json({
      message: "Response submitted successfully",
      response,
    });
  } catch (error) {
    next(error);
  }
});
// =========================
// DELETE FORM
// =========================

app.delete("/forms/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const form = await prisma.form.findUnique({
      where: {
        id,
      },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    await prisma.form.delete({
      where: {
        id,
      },
    });

    res.json({
      message: "Form deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});


// =========================
// DUPLICATE FORM
// =========================

app.post("/forms/:id/duplicate", async (req, res, next) => {
  try {
    const { id } = req.params;

    const originalForm = await prisma.form.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          orderBy: {
            order: "asc",
          },
          include: {
            options: true,
          },
        },
      },
    });

    if (!originalForm) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    const duplicatedForm = await prisma.form.create({
      data: {
        title: `${originalForm.title} (Copy)`,
        description: originalForm.description,
        isPublished: false,

        questions: {
          create: originalForm.questions.map((question) => ({
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
          orderBy: {
            order: "asc",
          },
          include: {
            options: true,
          },
        },

        _count: {
          select: {
            questions: true,
            responses: true,
          },
        },
      },
    });

    res.status(201).json(duplicatedForm);
  } catch (error) {
    next(error);
  }
});


// =========================
// SAVE / UPDATE QUESTIONS
// =========================
app.post("/forms/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, questions } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: "Form title is required",
      });
    }

    const existingForm = await prisma.form.findUnique({
      where: { id },
    });

    if (!existingForm) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    const updatedForm = await prisma.$transaction(async (tx) => {
      // Update form information
      await tx.form.update({
        where: { id },
        data: {
          title: title.trim(),
          description: description?.trim() || null,
        },
      });

      // If questions were supplied, replace the existing questions
      if (Array.isArray(questions)) {
        await tx.question.deleteMany({
          where: { formId: id },
        });

        for (let index = 0; index < questions.length; index++) {
          const question = questions[index];

          await tx.question.create({
            data: {
              formId: id,
              text: question.text,
              type: question.type,
              required: Boolean(question.required),
              order: index,
              options: {
                create:
                  Array.isArray(question.options)
                    ? question.options.map((option) => ({
                        text: option,
                      }))
                    : [],
              },
            },
          });
        }
      }

      return tx.form.findUnique({
        where: { id },
        include: {
          questions: {
            orderBy: {
              order: "asc",
            },
            include: {
              options: true,
            },
          },
          _count: {
            select: {
              questions: true,
              responses: true,
            },
          },
        },
      });
    });

    res.json(updatedForm);
  } catch (error) {
    console.error("Failed to update form:", error);

    res.status(500).json({
      error: "Failed to update form",
    });
  }
});

app.post("/forms/:id/questions", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { questions } = req.body;

    if (!Array.isArray(questions)) {
      return res.status(400).json({
        error: "questions must be an array",
      });
    }

    const form = await prisma.form.findUnique({
      where: {
        id,
      },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    // Delete the existing questions.
    // Their options are deleted automatically because
    // the Prisma relation uses onDelete: Cascade.
    await prisma.question.deleteMany({
      where: {
        formId: id,
      },
    });

    // Create the new questions and options.
    for (let index = 0; index < questions.length; index++) {
      const question = questions[index];

      await prisma.question.create({
        data: {
          text: question.text,
          type: question.type,
          required: question.required === true,
          order: index,
          formId: id,

          options: {
            create: Array.isArray(question.options)
              ? question.options.map((option) => ({
                  text: String(option),
                }))
              : [],
          },
        },
      });
    }

    // Return the updated form.
    const updatedForm = await prisma.form.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          orderBy: {
            order: "asc",
          },
          include: {
            options: true,
          },
        },
      },
    });

    res.json(updatedForm);
  } catch (error) {
    next(error);
  }
});



app.post("/forms/:id/publish", async (req, res, next) => {
  try {
    const { id } = req.params;

    const form = await prisma.form.update({
      where: { id },
      data: { isPublished: true },
    });

    res.json(form);
  } catch (error) {
    next(error);
  }
});


// =========================
// GLOBAL ERROR HANDLER
// =========================

app.use((err, req, res, next) => {
  console.error("API Error:", err);

  res.status(500).json({
    error: "Internal Server Error",
  });
});


export default app;
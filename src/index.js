import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "./lib/prisma.js";

const app = express();

app.use(cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
}));
app.use(express.json());

// Secret key for signing login tokens (In production, put this in your .env file)
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-auth-key";

// Helper function to map frontend question types directly to the aligned Prisma enum values
function mapQuestionType(type) {
  return (type || "SHORT_TEXT").toUpperCase();
}


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
// AUTHENTICATION ROUTES
// =========================

// Register a new user
app.post("/register", async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "Email is already registered" });
    }

    // Hash the password securely
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user in the database
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // Generate a login token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

    // Return the user (without the password) and the token
    res.status(201).json({
      message: "User registered successfully",
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// Login an existing user
app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find the user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Compare the provided password with the hashed password in the DB
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate a login token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      user: { id: user.id, email: user.email, name: user.name },
      token,
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
      userId, // Now accepts an optional userId to link the form to the logged-in user
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
        isPublished: false,
        userId: userId || null, // Links to user if provided

        questions: {
          create: questions.map((question, index) => ({
            text: question.text,
            type: mapQuestionType(question.type),
            required: question.required === true,
            order: index,

            options: {
              create: (question.options || []).map((option) => ({
                text: typeof option === 'string' ? option : option.text,
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

    const form = await prisma.form.findUnique({
      where: { id },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

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
// GET FORM RESPONSES
// =========================

app.get("/forms/:id/responses", async (req, res, next) => {
  try {
    const { id } = req.params;

    const form = await prisma.form.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: "asc" },
        },
        responses: {
          orderBy: { createdAt: "desc" },
          include: {
            answers: true,
          },
        },
      },
    });

    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }

    res.json(form);
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
      where: { id },
    });

    if (!form) {
      return res.status(404).json({
        error: "Form not found",
      });
    }

    await prisma.form.delete({
      where: { id },
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
      where: { id },
      include: {
        questions: {
          orderBy: { order: "asc" },
          include: { options: true },
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
        userId: originalForm.userId, // Copies the user ownership as well

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
          orderBy: { order: "asc" },
          include: { options: true },
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

      // If questions were supplied, replace existing questions
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
              type: mapQuestionType(question.type),
              required: Boolean(question.required),
              order: index,
              options: {
                create: Array.isArray(question.options)
                  ? question.options.map((option) => ({
                      text: typeof option === 'string' ? option : option.text,
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
            orderBy: { order: "asc" },
            include: { options: true },
          },
          _count: {
            select: {
              questions: true,
              responses: true,
            },
          },
        },
      });
    }, {
      timeout: 15000 // Extended timeout to 15 seconds to prevent expiration
    });

    res.json(updatedForm);
  } catch (error) {
    console.error("Failed to update form:", error);

    res.status(500).json({
      error: error.message || "Failed to update form",
    });
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
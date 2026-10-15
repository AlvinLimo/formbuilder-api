
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const router = express.Router();

const COOKIE_NAME = "token";
const TOKEN_EXPIRY = "1d";
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return secret;
}

function createToken(userId) {
  return jwt.sign(
    {},
    getJwtSecret(),
    {
      subject: userId,
      expiresIn: TOKEN_EXPIRY,
    }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

// REGISTER
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      password.length < 8
    ) {
      return res.status(400).json({
        message:
          "Enter a valid email and a password of at least 8 characters.",
      });
    }

    if (
      name !== undefined &&
      name !== null &&
      typeof name !== "string"
    ) {
      return res.status(400).json({
        message: "Name must be a string.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name:
          typeof name === "string"
            ? name.trim() || null
            : null,
        email: normalizedEmail,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    const token = createToken(user.id);

    setAuthCookie(res, token);

    return res.status(201).json({
      message: "Account created successfully.",
      user,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    next(error);
  }
});

// LOGIN
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: email.trim().toLowerCase(),
      },
    });

    if (
      !user ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const token = createToken(user.id);

    setAuthCookie(res, token);

    return res.json({
      message: "Logged in successfully.",
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

// CURRENT USER / SESSION CHECK
router.get("/me", async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        message: "Not authenticated.",
      });
    }

    let payload;

    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(401).json({
        message: "Invalid or expired session.",
      });
    }

    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string"
    ) {
      return res.status(401).json({
        message: "Invalid session.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        message: "User no longer exists.",
      });
    }

    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

// LOGOUT
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res.json({
    message: "Logged out successfully.",
  });
});

export default router;

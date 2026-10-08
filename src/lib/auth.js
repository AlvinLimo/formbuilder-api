import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { asyncRoute, HttpError } from "./http.js";

const TOKEN_TTL = "7d";

const emailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email("Enter a valid email address."));

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(200),
});

export function assertJwtSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
  }
}

function serializeUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function register(body) {
  const { name, email, password } = registerSchema.parse(body ?? {});
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) {
      throw new HttpError(409, "An account with that email already exists.");
    }

    const isFirstUser = (await tx.user.count()) === 0;
    const created = await tx.user.create({ data: { name, email, passwordHash } });

    if (isFirstUser) {
      await tx.form.updateMany({ where: { ownerId: null }, data: { ownerId: created.id } });
    }

    return created;
  });

  return { token: issueToken(user), user: serializeUser(user) };
}

export async function login(body) {
  const { email, password } = loginSchema.parse(body ?? {});
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Incorrect email or password.");
  }

  return { token: issueToken(user), user: serializeUser(user) };
}

function bearerToken(req) {
  const header = req.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  const user = typeof payload?.sub === "string" ? await prisma.user.findUnique({ where: { id: payload.sub } }) : null;
  return user ? serializeUser(user) : null;
}

export const requireAuth = asyncRoute(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) {
    throw new HttpError(401, "Sign in to continue.");
  }

  const user = await userFromToken(token);
  if (!user) {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }

  req.user = user;
  next();
});

// Public routes: identify the respondent if a valid token is sent, never reject.
export const optionalAuth = asyncRoute(async (req, res, next) => {
  const token = bearerToken(req);
  req.user = token ? await userFromToken(token) : null;
  next();
});

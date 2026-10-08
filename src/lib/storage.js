import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";

function bucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET || "form-uploads";
}

export function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function client() {
  if (!storageConfigured()) {
    throw new HttpError(
      503,
      "File upload is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let bucketReady = null;

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = client();
      const listed = await supabase.storage.listBuckets();
      if (listed.error) {
        throw new HttpError(503, "Could not reach file storage.");
      }

      const name = bucketName();
      if (!listed.data?.some((bucket) => bucket.name === name)) {
        const created = await supabase.storage.createBucket(name, { public: false });
        if (created.error && !/already exists/i.test(created.error.message ?? "")) {
          throw new HttpError(503, "Could not create the file storage bucket.");
        }
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }

  await bucketReady;
}

function safeFileName(name) {
  const base = String(name || "upload").split(/[/\\]/).pop() || "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "upload";
}

export async function uploadFormFile({ formId, fieldId, file }) {
  await ensureBucket();
  const path = `${formId}/${fieldId}/${randomUUID()}-${safeFileName(file.originalname)}`;
  const supabase = client();
  const uploaded = await supabase.storage.from(bucketName()).upload(path, file.buffer, {
    contentType: file.mimetype || "application/octet-stream",
    upsert: false,
  });

  if (uploaded.error) {
    throw new HttpError(502, "Could not store the file.");
  }

  return {
    path,
    fileName: file.originalname || "upload",
    mimeType: file.mimetype || "application/octet-stream",
    size: file.size,
  };
}

export async function downloadFormFile(path) {
  await ensureBucket();
  const supabase = client();
  const downloaded = await supabase.storage.from(bucketName()).download(path);
  if (downloaded.error || !downloaded.data) {
    throw new HttpError(404, "File not found.");
  }

  return Buffer.from(await downloaded.data.arrayBuffer());
}

export async function fileExists(path) {
  await ensureBucket();
  const supabase = client();
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").at(-1);
  const listed = await supabase.storage.from(bucketName()).list(folder, { search: name, limit: 100 });
  if (listed.error) {
    return false;
  }

  return listed.data?.some((item) => item.name === name) ?? false;
}

export async function removeFormFiles(paths) {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0 || !storageConfigured()) {
    return;
  }

  try {
    await ensureBucket();
    await client().storage.from(bucketName()).remove(unique);
  } catch (error) {
    console.error("Failed to delete stored files:", error.message);
  }
}

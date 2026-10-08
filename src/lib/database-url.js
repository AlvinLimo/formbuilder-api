import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));

loadEnv({ path: resolve(apiRoot, "../.env") });

function copyCertificateOutsideSpaces(certificatePath) {
  const directory = resolve(tmpdir(), "cic-form-builder");
  mkdirSync(directory, { recursive: true });
  const destination = resolve(directory, "prod-ca-2021.crt");
  copyFileSync(certificatePath, destination);
  return destination;
}

export function getDatabaseUrl(variableName) {
  const connectionString = process.env[variableName];
  if (!connectionString) {
    throw new Error(`${variableName} is required to connect to PostgreSQL.`);
  }

  const databaseUrl = new URL(connectionString);
  const certificatePath = process.env.DATABASE_CA_CERT_PATH?.trim();

  if (certificatePath) {
    const absoluteCertificatePath = isAbsolute(certificatePath)
      ? certificatePath
      : resolve(apiRoot, certificatePath);

    if (!existsSync(absoluteCertificatePath)) {
      throw new Error(
        `DATABASE_CA_CERT_PATH does not point to an existing file: ${absoluteCertificatePath}`
      );
    }

    const certificateForDriver = absoluteCertificatePath.includes(" ")
      ? copyCertificateOutsideSpaces(absoluteCertificatePath)
      : absoluteCertificatePath;

    databaseUrl.searchParams.set("sslmode", "verify-full");
    databaseUrl.searchParams.set("sslrootcert", certificateForDriver);
  } else if (!databaseUrl.searchParams.has("sslmode")) {
    // Supabase pooler rejects plaintext connections. verify-full is used when
    // DATABASE_CA_CERT_PATH is set; otherwise encrypt without a custom CA.
    databaseUrl.searchParams.set("sslmode", "require");
  }

  return databaseUrl.toString();
}

export function getPgConfig(variableName = "DIRECT_URL") {
  const databaseUrl = new URL(getDatabaseUrl(variableName));
  const certificatePath = databaseUrl.searchParams.get("sslrootcert");
  const servername = databaseUrl.hostname;
  const schema = databaseUrl.searchParams.get("schema") || "public";
  databaseUrl.searchParams.delete("sslmode");
  databaseUrl.searchParams.delete("sslrootcert");
  databaseUrl.searchParams.delete("pgbouncer");
  databaseUrl.searchParams.delete("schema");

  return {
    connectionString: databaseUrl.toString(),
    ssl: {
      rejectUnauthorized: true,
      servername,
      ...(certificatePath ? { ca: readFileSync(certificatePath) } : {}),
    },
    schema,
  };
}

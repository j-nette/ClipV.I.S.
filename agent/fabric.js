// Real Microsoft Fabric Lakehouse query via the SQL analytics endpoint.
// Falls back to the mock store in models.js if FABRIC_SQL_SERVER is unset or a query fails.
// Auth: explicit AzureCliCredential (run `az login`) -> token passed to tedious.
import sql from "mssql";
import { AzureCliCredential } from "@azure/identity";
import { MODELS } from "./models.js";

const FABRIC_READY = !!process.env.FABRIC_SQL_SERVER;
const credential = FABRIC_READY ? new AzureCliCredential() : null;

let poolPromise = null;

async function buildPool() {
  const tokenResponse = await credential.getToken("https://database.windows.net/.default");
  const config = {
    server: process.env.FABRIC_SQL_SERVER,
    database: process.env.FABRIC_SQL_DATABASE || "clipvis",
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: tokenResponse.token },
    },
    options: { encrypt: true, trustServerCertificate: false, connectTimeout: 30000 },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };
  return sql.connect(config);
}

function getPool() {
  if (!FABRIC_READY) return null;
  if (!poolPromise) {
    poolPromise = buildPool().catch((e) => {
      poolPromise = null; // allow retry on next call (e.g. after token refresh)
      throw e;
    });
  }
  return poolPromise;
}

// Returns one model's metadata row, or the mock row, or null.
export async function lookupModelMetadata(name) {
  if (!name) return null;
  if (FABRIC_READY) {
    try {
      const pool = await getPool();
      const r = await pool
        .request()
        .input("name", sql.VarChar, name)
        .query("SELECT name, file, weight, dimensions, material, price, owner, blurb FROM dbo.models WHERE name = @name");
      if (r.recordset.length) {
        const row = r.recordset[0];
        return { ...row, display: prettify(row.name) };
      }
    } catch (err) {
      console.error("[fabric] lookup failed, using mock:", err.message);
    }
  }
  return MODELS[name] || null;
}

// Returns all models keyed by name (real Fabric, else mock).
export async function getAllModels() {
  if (FABRIC_READY) {
    try {
      const pool = await getPool();
      const r = await pool.request().query("SELECT name, file, weight, dimensions, material, price, owner, blurb FROM dbo.models");
      if (r.recordset.length) {
        const out = {};
        for (const row of r.recordset) out[row.name] = { ...row, display: prettify(row.name) };
        return out;
      }
    } catch (err) {
      console.error("[fabric] getAll failed, using mock:", err.message);
    }
  }
  return MODELS;
}

export function fabricStatus() {
  return FABRIC_READY ? "Fabric" : "mock";
}

function prettify(name = "") {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/(\d+)/, " $1").trim();
}

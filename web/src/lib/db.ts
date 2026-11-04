import "server-only";

import { createClient, type Client } from "@libsql/client";

/** Turso in production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN), a local file in development. */
let client: Client | null = null;
let ready: Promise<void> | null = null;

export async function db(): Promise<Client> {
  client ??= createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}),
  });
  ready ??= migrate(client);
  await ready;
  return client;
}

async function migrate(c: Client): Promise<void> {
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS donations (
        id TEXT PRIMARY KEY,
        jar_id TEXT NOT NULL,
        method TEXT NOT NULL,             -- Wallet | Manual | NearCom
        source_chain TEXT NOT NULL,
        source_symbol TEXT NOT NULL,
        amount_in TEXT NOT NULL,
        usd_cents INTEGER NOT NULL,
        receive_asset TEXT NOT NULL,
        deposit_address TEXT NOT NULL,
        deposit_memo TEXT,
        intent_id TEXT NOT NULL,
        refund_address TEXT NOT NULL,
        source_tx TEXT,
        status TEXT NOT NULL,             -- awaiting_deposit | processing | delivered | refunded | failed | expired
        amount_out TEXT,
        delivered_usd_cents INTEGER,
        delivery_tx TEXT,
        recorded_tx TEXT,
        donor_name TEXT,
        message TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        valid_until INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS donations_jar ON donations (jar_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS donations_open ON donations (status, updated_at)`,
      // the jar page beyond the contract's fields, stored once its signed fingerprint is accepted
      `CREATE TABLE IF NOT EXISTS jar_pages (
        jar_id TEXT PRIMARY KEY,
        page TEXT NOT NULL,               -- canonical JSON, see lib/pageData.ts
        hash TEXT NOT NULL,               -- sha256 hex the owner signed
        slug TEXT UNIQUE,
        tx_hash TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS images (
        hash TEXT PRIMARY KEY,            -- sha256 hex of bytes
        mime TEXT NOT NULL,
        bytes BLOB NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ],
    "write",
  );
}

export interface DonationRow {
  id: string;
  jar_id: string;
  method: "Wallet" | "Manual" | "NearCom";
  source_chain: string;
  source_symbol: string;
  amount_in: string;
  usd_cents: number;
  receive_asset: string;
  deposit_address: string;
  deposit_memo: string | null;
  intent_id: string;
  refund_address: string;
  source_tx: string | null;
  status: "awaiting_deposit" | "processing" | "delivered" | "refunded" | "failed" | "expired";
  amount_out: string | null;
  delivered_usd_cents: number | null;
  delivery_tx: string | null;
  recorded_tx: string | null;
  donor_name: string | null;
  message: string | null;
  hidden: number;
  valid_until: number;
  created_at: number;
  updated_at: number;
}

/**
 * Shared login-failure counters.
 *
 * Counts are persisted in the application database, so every API replica sees
 * the same lock state. The identifier is normalized and HMAC-SHA-256 hashed before
 * storage; raw email/username values are never written to this table.
 */
import { createHmac } from "node:crypto";
import type { Repository } from "../repository.ts";

let writesSincePrune = 0;

function identifierDigest(identifier: string, sharedSecret: string): string {
  if (!sharedSecret || (process.env.NODE_ENV === "production" && sharedSecret.length < 32)) {
    throw new Error("A shared session secret is required for distributed login throttling");
  }
  return createHmac("sha256", sharedSecret)
    .update(identifier.trim().toLowerCase())
    .digest("hex");
}

/**
 * Atomically reserve a login attempt and return the window count.
 * A single UPSERT serializes concurrent attempts across SQLite/PG instances.
 */
export async function reserveLoginAttempt(
  repo: Repository,
  identifier: string,
  sharedSecret: string,
  now: number,
  windowMs: number,
): Promise<{ count: number; identifierHash: string }> {
  const identifierHash = identifierDigest(identifier, sharedSecret);
  const rows = await repo.raw(
    "INSERT INTO account_login_failures (identifier_hash, failure_count, first_at, updated_at) " +
      "VALUES (?, 1, ?, ?) " +
      "ON CONFLICT(identifier_hash) DO UPDATE SET " +
      "failure_count = CASE WHEN first_at <= ? THEN 1 ELSE failure_count + 1 END, " +
      "first_at = CASE WHEN first_at <= ? THEN ? ELSE first_at END, " +
      "updated_at = ? RETURNING failure_count",
    [identifierHash, now, now, now - windowMs, now - windowMs, now, now],
  );
  const count = Number(rows[0]?.failure_count ?? 0);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Could not reserve login attempt");
  }

  // Bound historical growth without adding a per-request full-table cleanup.
  // The route-level IP limiter remains the outer request-volume control.
  writesSincePrune += 1;
  if (writesSincePrune % 128 === 0) {
    await repo.runCount(
      "DELETE FROM account_login_failures WHERE updated_at < ?",
      [now - 24 * 60 * 60 * 1000],
    );
  }

  return { count, identifierHash };
}

/** Successful authentication clears the shared consecutive-attempt window. */
export async function clearLoginAttempts(repo: Repository, identifier: string, sharedSecret: string): Promise<void> {
  await repo.runCount(
    "DELETE FROM account_login_failures WHERE identifier_hash = ?",
    [identifierDigest(identifier, sharedSecret)],
  );
}

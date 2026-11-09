import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "./connection.js";

interface JournalEntry {
  tag: string;
  when: number;
}

interface AppliedMigration {
  rowId: number;
  hash: string;
  createdAt: number | null;
}

function readJournalEntries(migrationsFolder: string): JournalEntry[] {
  const journal: unknown = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  if (
    typeof journal !== "object" ||
    journal === null ||
    !("entries" in journal) ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error("Unexpected migration journal shape");
  }
  return journal.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("tag" in entry) ||
      typeof entry.tag !== "string" ||
      !("when" in entry) ||
      typeof entry.when !== "number"
    ) {
      throw new Error("Unexpected migration journal entry fields");
    }
    return { tag: entry.tag, when: entry.when };
  });
}

export function repairForkMigrationOrder(
  db: DbConnection,
  migrationsFolder: string,
  excludedTags: readonly string[],
): void {
  const sqlite = db.$client;
  if (
    !sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      )
      .get()
  ) {
    return;
  }

  const migrationFiles = readMigrationFiles({ migrationsFolder });
  const entries = readJournalEntries(migrationsFolder);
  if (migrationFiles.length !== entries.length) {
    throw new Error(
      `Migration journal length mismatch: found ${entries.length} journal entries and ${migrationFiles.length} migration files`,
    );
  }
  const migrations = migrationFiles.map((migration, index) => {
    const entry = entries[index];
    if (migration.folderMillis !== entry.when) {
      throw new Error(
        `Migration journal timestamp mismatch for ${entry.tag}: journal when=${entry.when}, migration when=${migration.folderMillis}`,
      );
    }
    return {
      ...migration,
      tag: entry.tag,
      fork: /^\d{4}_fork_/.test(entry.tag),
    };
  });
  const journalWhens = new Set(entries.map((entry) => entry.when));
  const forkWhens = new Set(
    migrations
      .filter((migration) => migration.fork)
      .map((migration) => migration.folderMillis),
  );
  const readApplied = sqlite.prepare<[], AppliedMigration>(
    "SELECT rowid AS rowId, hash, created_at AS createdAt FROM __drizzle_migrations",
  );
  const applied = readApplied.all();
  const appliedWhens = new Set(applied.map((row) => row.createdAt));

  sqlite.transaction(() => {
    for (const migration of migrations) {
      if (!migration.fork || appliedWhens.has(migration.folderMillis)) continue;
      if (
        migrations.filter((entry) => entry.hash === migration.hash).length !== 1
      )
        continue;
      const matches = applied.filter((row) => row.hash === migration.hash);
      if (matches.length !== 1) continue;
      const row = matches[0];
      if (row.createdAt !== null && journalWhens.has(row.createdAt)) continue;

      sqlite
        .prepare(
          "UPDATE __drizzle_migrations SET created_at = ? WHERE rowid = ?",
        )
        .run(migration.folderMillis, row.rowId);
      appliedWhens.delete(row.createdAt);
      appliedWhens.add(migration.folderMillis);
      row.createdAt = migration.folderMillis;
    }

    const latest = sqlite
      .prepare<[], { createdAt: number | null }>(
        "SELECT MAX(created_at) AS createdAt FROM __drizzle_migrations",
      )
      .get()?.createdAt;
    if (latest === null || latest === undefined) return;

    for (const migration of migrations) {
      if (
        migration.fork ||
        appliedWhens.has(migration.folderMillis) ||
        migration.folderMillis >= latest ||
        excludedTags.includes(migration.tag) ||
        applied.some(
          (row) =>
            row.createdAt !== null &&
            row.createdAt > migration.folderMillis &&
            !forkWhens.has(row.createdAt),
        )
      )
        continue;

      for (const statement of migration.sql) sqlite.exec(statement);
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(migration.hash, migration.folderMillis);
      appliedWhens.add(migration.folderMillis);
    }
  })();
}

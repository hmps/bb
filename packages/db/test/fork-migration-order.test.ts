import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../src/connection.js";
import { repairForkMigrationOrder } from "../src/fork-migration-order.js";

interface Migration {
  tag: string;
  when: number;
  sql: string;
}

const tempDirs: string[] = [];
const connections: DbConnection[] = [];
const upstream: Migration = {
  tag: "0000_upstream",
  when: 200,
  sql: "CREATE TABLE upstream (id INTEGER PRIMARY KEY);",
};
const fork: Migration = {
  tag: "0002_fork_cards",
  when: 300,
  sql: "CREATE TABLE cards (id INTEGER PRIMARY KEY);",
};
const skipped: Migration = {
  tag: "0001_skipped",
  when: 250,
  sql: "CREATE TABLE skipped (id INTEGER PRIMARY KEY);",
};

function createFolder(migrations: Migration[]): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fork-migrations-"));
  tempDirs.push(folder);
  fs.mkdirSync(path.join(folder, "meta"));
  fs.writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: migrations.map((migration, idx) => ({
        idx,
        version: "6",
        tag: migration.tag,
        when: migration.when,
        breakpoints: true,
      })),
    }),
  );
  for (const migration of migrations) {
    fs.writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }
  return folder;
}

function createDatabase(migrations: Migration[]): DbConnection {
  const db = createConnection(":memory:");
  connections.push(db);
  drizzleMigrate(db, { migrationsFolder: createFolder(migrations) });
  return db;
}

function readLedger(db: DbConnection) {
  return db.$client
    .prepare<[], { hash: string; createdAt: number }>(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at",
    )
    .all();
}

function readTables(db: DbConnection): string[] {
  return db.$client
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function repairAndMigrate(
  db: DbConnection,
  folder: string,
  excludedTags: readonly string[] = [],
): void {
  repairForkMigrationOrder(db, folder, excludedTags);
  drizzleMigrate(db, { migrationsFolder: folder });
}

function expectCompleteLedger(db: DbConnection, folder: string): void {
  expect(readLedger(db)).toEqual(
    readMigrationFiles({ migrationsFolder: folder })
      .map((migration) => ({
        hash: migration.hash,
        createdAt: migration.folderMillis,
      }))
      .sort((left, right) => left.createdAt - right.createdAt),
  );
}

afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
  for (const folder of tempDirs.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe("repairForkMigrationOrder", () => {
  it("applies an upstream migration skipped behind a fork row (A1)", () => {
    const db = createDatabase([upstream, fork]);
    const folder = createFolder([upstream, skipped, fork]);

    repairAndMigrate(db, folder);

    expect(readTables(db)).toContain("skipped");
    expectCompleteLedger(db, folder);
  });

  it("relocates a fork row without running its SQL again (A2)", () => {
    const db = createDatabase([upstream, fork]);
    db.$client.exec("INSERT INTO cards (id) VALUES (42)");
    const folder = createFolder([upstream, { ...fork, when: 400 }]);

    expect(() => repairAndMigrate(db, folder)).not.toThrow();

    expect(db.$client.prepare("SELECT id FROM cards").all()).toEqual([
      { id: 42 },
    ]);
    expectCompleteLedger(db, folder);
  });

  it("relocates a fork row and applies skipped upstream rows in one run", () => {
    const db = createDatabase([upstream, fork]);
    db.$client.exec("INSERT INTO cards (id) VALUES (7)");
    const later: Migration = {
      tag: "0002_later",
      when: 350,
      sql: "CREATE TABLE later (id INTEGER PRIMARY KEY);",
    };
    const folder = createFolder([
      upstream,
      skipped,
      later,
      { ...fork, tag: "0003_fork_cards", when: 400 },
    ]);

    repairAndMigrate(db, folder);

    expect(readTables(db)).toEqual(
      expect.arrayContaining(["cards", "later", "skipped"]),
    );
    expect(db.$client.prepare("SELECT id FROM cards").all()).toEqual([
      { id: 7 },
    ]);
    expectCompleteLedger(db, folder);
  });

  it("leaves ambiguous journal hashes in place (A3)", () => {
    const emptyFork = { ...fork, sql: "SELECT 1;" };
    const db = createDatabase([upstream, emptyFork]);
    const before = readLedger(db);
    const folder = createFolder([
      upstream,
      { ...emptyFork, when: 400 },
      { ...emptyFork, tag: "0003_fork_other", when: 500 },
    ]);

    repairForkMigrationOrder(db, folder, []);

    expect(readLedger(db)).toEqual(before);
  });

  it("leaves ambiguous ledger hashes in place (A3)", () => {
    const db = createDatabase([upstream, fork]);
    db.$client.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) SELECT hash, 350 FROM __drizzle_migrations WHERE created_at = 300",
    );
    const before = readLedger(db);
    const folder = createFolder([upstream, { ...fork, when: 400 }]);

    repairForkMigrationOrder(db, folder, []);

    expect(readLedger(db)).toEqual(before);
  });

  it("does not repair a hole behind an upstream row (A4)", () => {
    const laterUpstream = {
      tag: "0003_later_upstream",
      when: 400,
      sql: "CREATE TABLE later_upstream (id INTEGER PRIMARY KEY);",
    };
    const db = createDatabase([upstream, fork, laterUpstream]);
    const before = readLedger(db);
    const folder = createFolder([upstream, skipped, fork, laterUpstream]);

    repairAndMigrate(db, folder);

    expect(readLedger(db)).toEqual(before);
    expect(readTables(db)).not.toContain("skipped");
  });

  it("applies skipped prerequisites before newer pending SQL (A6)", () => {
    const db = createDatabase([upstream, fork]);
    const folder = createFolder([
      upstream,
      skipped,
      fork,
      {
        tag: "0003_pending",
        when: 400,
        sql: "ALTER TABLE skipped ADD COLUMN label TEXT;",
      },
    ]);

    repairAndMigrate(db, folder);

    db.$client.exec("INSERT INTO skipped (id, label) VALUES (1, 'ready')");
    expect(db.$client.prepare("SELECT label FROM skipped").get()).toEqual({
      label: "ready",
    });
    expectCompleteLedger(db, folder);
  });

  it("rolls back every statement and the ledger row for a failed entry (A7)", () => {
    const db = createDatabase([upstream, fork]);
    const before = readLedger(db);
    const folder = createFolder([
      upstream,
      {
        ...skipped,
        sql: `${skipped.sql}--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);`,
      },
      fork,
    ]);

    expect(() => repairAndMigrate(db, folder)).toThrow(/missing_table/);

    expect(readLedger(db)).toEqual(before);
    expect(readTables(db)).not.toContain("skipped");
  });

  it("leaves excluded cleanup entries for their existing migration path", () => {
    const db = createDatabase([upstream, fork]);
    const before = readLedger(db);
    const folder = createFolder([upstream, skipped, fork]);

    repairAndMigrate(db, folder, [skipped.tag]);

    expect(readLedger(db)).toEqual(before);
    expect(readTables(db)).not.toContain("skipped");
  });

  it("leaves fresh and current databases to drizzle", () => {
    const db = createConnection(":memory:");
    connections.push(db);
    const folder = createFolder([upstream, fork]);

    repairForkMigrationOrder(db, folder, []);
    expect(readTables(db)).not.toContain("__drizzle_migrations");
    repairAndMigrate(db, folder);
    const before = readLedger(db);
    repairAndMigrate(db, folder);

    expect(readLedger(db)).toEqual(before);
    expectCompleteLedger(db, folder);
  });
});

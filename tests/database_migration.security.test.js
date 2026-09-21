"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runDatabaseMigrations } = require("../src/config/database_migration");

test("migration adds session and trusted IP metadata columns and backfills safely", async () => {
  const statements = [];
  const sequelize = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("to_regclass('public.users')")) {
        return [[{ table_exists: "users" }]];
      }
      if (sql.includes("to_regclass(")) {
        return [[{ table_exists: null }]];
      }
      return [[], undefined];
    },
  };

  await runDatabaseMigrations(sequelize);

  const migrationSql = statements.join("\n");
  assert.match(
    migrationSql,
    /ADD COLUMN IF NOT EXISTS trusted_ip_records JSONB NOT NULL/,
  );
  assert.match(
    migrationSql,
    /ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL/,
  );
  assert.match(
    migrationSql,
    /WHERE jsonb_array_length\(u\.trusted_ip_records\) = 0/,
  );
  assert.doesNotMatch(migrationSql, /DROP\s+(TABLE|COLUMN)/i);
});

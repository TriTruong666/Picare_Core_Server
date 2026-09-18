"use strict";

const sequelize = require("./postgres.config");

/**
 * Run safe schema migrations for PostgreSQL database.
 * @param {import("sequelize").Sequelize} [customSequelize=sequelize]
 */
async function runDatabaseMigrations(customSequelize = sequelize) {
  console.log("[MIGRATION]: Checking database schema and running migrations...");

  try {
    // 1. Enable pgcrypto extension for UUID generation if needed
    await customSequelize.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 2. Safely add new columns to 'users' table if table exists
    const [userTableCheck] = await customSequelize.query(`
      SELECT to_regclass('public.users') as table_exists;
    `);

    if (userTableCheck?.[0]?.table_exists) {
      console.log("[MIGRATION]: Upgrading 'users' table columns...");

      await customSequelize.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS login_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS logout_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS login_ip VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_ips TEXT[] DEFAULT '{}';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS bypass_ip_verification BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE users SET trusted_ips = '{}' WHERE trusted_ips IS NULL;
        ALTER TABLE users ALTER COLUMN trusted_ips SET DEFAULT '{}';
        ALTER TABLE users ALTER COLUMN trusted_ips SET NOT NULL;
      `);

      await customSequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_key ON users (user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);
        CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users (phone);
      `);
    }

    // 3. Ensure unique indexes on other core tables if they exist
    const [roleTableCheck] = await customSequelize.query(`
      SELECT to_regclass('public.roles') as table_exists;
    `);
    if (roleTableCheck?.[0]?.table_exists) {
      await customSequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS roles_name_key ON roles (name);
      `);
    }

    const [permTableCheck] = await customSequelize.query(`
      SELECT to_regclass('public.permissions') as table_exists;
    `);
    if (permTableCheck?.[0]?.table_exists) {
      await customSequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_key ON permissions (name);
      `);
    }

    const [contractTableCheck] = await customSequelize.query(`
      SELECT to_regclass('public.contract') as table_exists;
    `);
    if (contractTableCheck?.[0]?.table_exists) {
      await customSequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS contract_contract_id_key ON contract (contract_id);
      `);
    }

    const [catalogueTableCheck] = await customSequelize.query(`
      SELECT to_regclass('public.catalogue') as table_exists;
    `);
    if (catalogueTableCheck?.[0]?.table_exists) {
      await customSequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS catalogue_catalogue_id_key ON catalogue (catalogue_id);
      `);
    }

    console.log("[MIGRATION]: Database migrations completed successfully.");
  } catch (error) {
    console.error("[MIGRATION_ERROR]: Failed to run database migrations:", error);
    throw error;
  }
}

if (require.main === module) {
  runDatabaseMigrations()
    .then(() => {
      console.log("[MIGRATION]: Finished standalone migration.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[MIGRATION]: Standalone migration failed.", err);
      process.exit(1);
    });
}

module.exports = {
  runDatabaseMigrations,
};

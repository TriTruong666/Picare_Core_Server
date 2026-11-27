"use strict";

const sequelize = require("./postgres.config");

/**
 * Run safe schema migrations for PostgreSQL database.
 * @param {import("sequelize").Sequelize} [customSequelize=sequelize]
 */
async function runDatabaseMigrations(customSequelize = sequelize) {
  console.log(
    "[MIGRATION]: Checking database schema and running migrations...",
  );

  try {
    // 1. Enable pgcrypto extension for UUID generation if needed
    await customSequelize.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await customSequelize.query(`DO $$ BEGIN
      IF to_regclass('public.conversations') IS NOT NULL THEN
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_secure BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS security_code_hash VARCHAR(100);
      END IF;
    END $$;`);

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
        ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_ip_records JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
        UPDATE users SET trusted_ips = '{}' WHERE trusted_ips IS NULL;
        ALTER TABLE users ALTER COLUMN trusted_ips SET DEFAULT '{}';
        ALTER TABLE users ALTER COLUMN trusted_ips SET NOT NULL;
      `);

      await customSequelize.query(`
        UPDATE users AS u
        SET trusted_ip_records = COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'ipAddress', trusted_ip,
                'trustedAt', COALESCE(u.login_at, NOW()),
                'lastUsedAt', COALESCE(u.login_at, NOW()),
                'expiresAt', NOW() + INTERVAL '30 days',
                'device', 'Migrated trusted IP'
              )
            )
            FROM unnest(u.trusted_ips) AS trusted_ip
            WHERE trusted_ip IS NOT NULL AND trusted_ip <> ''
          ),
          '[]'::jsonb
        )
        WHERE jsonb_array_length(u.trusted_ip_records) = 0
          AND cardinality(u.trusted_ips) > 0;
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

    // 4. Upgrade Chat Hub tables (C0 - C4) safely & idempotently
    const [conversationsCheck] = await customSequelize.query(`
      SELECT to_regclass('public.conversations') as table_exists;
    `);
    if (conversationsCheck?.[0]?.table_exists) {
      console.log("[MIGRATION]: Upgrading 'conversations' table columns...");
      await customSequelize.query(`
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scope_system VARCHAR(20) NOT NULL DEFAULT 'CORE';
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_type VARCHAR(50);
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_id VARCHAR(100);
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description TEXT;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS encrypted_dek TEXT;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS dek_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_count INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_conversations_scope_context ON conversations (scope_system, company_id, context_type, context_id);
      `);
    }

    const [convMembersCheck] = await customSequelize.query(`
      SELECT to_regclass('public.conversation_members') as table_exists;
    `);
    if (convMembersCheck?.[0]?.table_exists) {
      console.log(
        "[MIGRATION]: Upgrading 'conversation_members' table columns...",
      );
      await customSequelize.query(`
        ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS last_read_message_id UUID;
        ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS mention_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_conversation_members_active_user ON conversation_members (user_id, left_at, is_pinned);
        CREATE INDEX IF NOT EXISTS idx_conversation_members_visible_user ON conversation_members (user_id, left_at, hidden_at);
      `);
    }

    const [messagesCheck] = await customSequelize.query(`
      SELECT to_regclass('public.messages') as table_exists;
    `);
    if (messagesCheck?.[0]?.table_exists) {
      console.log("[MIGRATION]: Upgrading 'messages' table columns...");
      await customSequelize.query(`
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS ciphertext TEXT;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS iv VARCHAR(64);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS auth_tag VARCHAR(64);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_tokens TEXT[] NOT NULL DEFAULT '{}';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_metadata TEXT;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata_iv VARCHAR(64);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata_auth_tag VARCHAR(64);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(100);
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_recalled BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_by UUID;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_user_ids UUID[] NOT NULL DEFAULT '{}';
        CREATE INDEX IF NOT EXISTS idx_messages_conv_cursor ON messages (conversation_id, "createdAt" DESC, id DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_messages_search_tokens ON messages USING GIN (search_tokens);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_idempotency ON messages (conversation_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL;
      `);
    }

    const [attachmentsCheck] = await customSequelize.query(`
      SELECT to_regclass('public.message_attachments') as table_exists;
    `);
    if (attachmentsCheck?.[0]?.table_exists) {
      console.log(
        "[MIGRATION]: Upgrading 'message_attachments' table columns...",
      );
      await customSequelize.query(`
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS s3_asset_id UUID;
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS s3_key TEXT;
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS width INTEGER;
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS height INTEGER;
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS blurhash VARCHAR(120);
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
        ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_message_attachments_s3_key ON message_attachments (s3_key);
      `);
    }

    // 5. Create 'pinned_messages' and 'message_reactions' tables if 'conversations' exists
    if (conversationsCheck?.[0]?.table_exists) {
      await customSequelize.query(`
        CREATE TABLE IF NOT EXISTS pinned_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL,
          message_id UUID NOT NULL,
          pinned_by UUID NOT NULL,
          note VARCHAR(255),
          pin_order INTEGER NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_pinned_messages_conv_msg ON pinned_messages (conversation_id, message_id);
        CREATE INDEX IF NOT EXISTS idx_pinned_messages_conv_order ON pinned_messages (conversation_id, pin_order ASC, "createdAt" DESC);

        CREATE TABLE IF NOT EXISTS message_reactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          message_id UUID NOT NULL,
          conversation_id UUID NOT NULL,
          user_id UUID NOT NULL,
          emoji VARCHAR(32) NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_msg_user_emoji ON message_reactions (message_id, user_id, emoji);
        CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions (message_id);
      `);
    }

    // 6. Create 'user_push_tokens' table for Mobile Push Notifications (iOS APNs / Android FCM / Expo Push)
    await customSequelize.query(`
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        platform VARCHAR(16) NOT NULL,
        token_type VARCHAR(16) NOT NULL DEFAULT 'expo',
        token VARCHAR(512) NOT NULL,
        app_bundle_id VARCHAR(128) NOT NULL DEFAULT 'vn.picare.office',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_push_tokens_token ON user_push_tokens (token);
      CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_active ON user_push_tokens (user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_device ON user_push_tokens (user_id, device_id);
    `);

    console.log("[MIGRATION]: Database migrations completed successfully.");
  } catch (error) {
    console.error(
      "[MIGRATION_ERROR]: Failed to run database migrations:",
      error,
    );
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

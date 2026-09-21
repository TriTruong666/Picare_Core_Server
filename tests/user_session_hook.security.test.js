"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/user.model");

const buildPersistedUser = () => {
  const user = User.build(
    {
      userId: "424e7bd7-8f7f-46a0-8848-fb6bfa70c17a",
      name: "Security Test",
      email: "security-test@picare.vn",
      password: "already-hashed",
      role: "default",
      status: "ACTIVE",
      sessionVersion: 2,
    },
    { isNewRecord: false },
  );
  user._previousDataValues = { ...user.dataValues };
  user._changed.clear();
  return user;
};

test("security-sensitive account changes increment the session version", async () => {
  const roleChangedUser = buildPersistedUser();
  roleChangedUser.role = "admin";
  await User.runHooks("beforeUpdate", roleChangedUser);
  assert.equal(roleChangedUser.sessionVersion, 3);

  const lockedUser = buildPersistedUser();
  lockedUser.status = "INACTIVE";
  await User.runHooks("beforeUpdate", lockedUser);
  assert.equal(lockedUser.sessionVersion, 3);

  const policyChangedUser = buildPersistedUser();
  policyChangedUser.bypassIpVerification = true;
  await User.runHooks("beforeUpdate", policyChangedUser);
  assert.equal(policyChangedUser.sessionVersion, 3);
});

test("profile-only changes preserve the current session version", async () => {
  const user = buildPersistedUser();
  user.name = "Updated Display Name";
  await User.runHooks("beforeUpdate", user);
  assert.equal(user.sessionVersion, 2);
});

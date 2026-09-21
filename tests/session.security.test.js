"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

let currentUser = null;
mockModule("../src/models/user.model", {
  async findOne() {
    return currentUser;
  },
});

const JWTService = require("../src/services/jwt.service");
const SocketService = require("../src/services/socket.service");

test("accepts a token only when session version and account status match", async () => {
  const token = JWTService.signUser("User", "default", "user-1", 3);
  currentUser = {
    userId: "user-1",
    name: "Current User",
    role: "default",
    status: "ACTIVE",
    sessionVersion: 3,
  };

  const decoded = await JWTService.verifyUserSession(token);
  assert.equal(decoded.userId, "user-1");
  assert.equal(decoded.sessionVersion, 3);

  currentUser.sessionVersion = 4;
  assert.equal(await JWTService.verifyUserSession(token), null);

  currentUser.sessionVersion = 3;
  currentUser.status = "INACTIVE";
  assert.equal(await JWTService.verifyUserSession(token), null);
});

test("supports pre-migration tokens as session version zero", async () => {
  const token = JWTService.signJson({
    name: "Legacy User",
    role: "default",
    userId: "legacy-user",
  });
  currentUser = {
    userId: "legacy-user",
    name: "Legacy User",
    role: "default",
    status: "ACTIVE",
    sessionVersion: 0,
  };

  assert.equal((await JWTService.verifyUserSession(token)).sessionVersion, 0);
});

test("disconnects active sockets immediately when a user session is revoked", () => {
  const emitted = [];
  let disconnected = false;
  SocketService.io = {
    sockets: {
      sockets: new Map([
        [
          "socket-1",
          {
            emit(event, payload) {
              emitted.push({ event, payload });
            },
            disconnect(force) {
              disconnected = force;
            },
          },
        ],
      ]),
    },
  };
  SocketService.connectedUsers = new Map([
    ["user-1", new Set(["socket-1"])],
  ]);

  assert.equal(SocketService.disconnectUser("user-1", "password_changed"), 1);
  assert.deepEqual(emitted, [
    {
      event: "session_revoked",
      payload: { reason: "password_changed" },
    },
  ]);
  assert.equal(disconnected, true);

  SocketService.io = null;
  SocketService.connectedUsers.clear();
});

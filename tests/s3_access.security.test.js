"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { filename, id: filename, loaded: true, exports };
};

let controllerCalls = 0;
mockModule("../src/services/jwt.service", {
  async verifyUserSession(token) {
    return token === "valid-session" ? { userId: "test-user" } : null;
  },
});
mockModule("../src/controllers/s3.controller", new Proxy({}, {
  get(_target, action) {
    return (_req, _res, next) => {
      if (action === "viewObject" || action === "downloadObject") {
        controllerCalls += 1;
      }
      next();
    };
  },
}));

const router = require("../src/routes/s3.routes");

const runRoute = (path, token) => {
  const route = router.stack.find((layer) =>
    layer.route?.path instanceof RegExp && layer.route.path.test(path),
  )?.route;
  assert.ok(route, `Route not found: ${path}`);

  const req = { cookies: token ? { token } : {}, headers: {}, query: {} };
  return new Promise((resolve) => {
    let index = 0;
    const next = (error) => {
      if (error || index === route.stack.length) {
        resolve({ error, user: req.user });
        return;
      }
      route.stack[index++].handle(req, {}, next);
    };
    next();
  });
};

for (const path of [
  "/view/picare_office/credential/photo.jpeg",
  "/download/picare_office/credential/photo.jpeg",
]) {
  test(`${path} requires a valid login session`, async () => {
    controllerCalls = 0;

    const anonymous = await runRoute(path);
    assert.equal(anonymous.error?.statusCode, 401);
    assert.equal(controllerCalls, 0);

    const invalid = await runRoute(path, "invalid-session");
    assert.equal(invalid.error?.statusCode, 401);
    assert.equal(controllerCalls, 0);

    const authenticated = await runRoute(path, "valid-session");
    assert.equal(authenticated.error, undefined);
    assert.equal(authenticated.user?.userId, "test-user");
    assert.equal(controllerCalls, 1);
  });
}

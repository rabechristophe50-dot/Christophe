import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/server.js";

// Start the app on an ephemeral port for the duration of the test suite.
let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => server?.close());

test("GET /health returns ok", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.ok(body.model);
});

test("POST /webhook rejects a non-JSON-object body", async () => {
  const res = await fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify("not-an-object"),
  });
  assert.equal(res.status, 400);
});

const { beforeEach, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { app, resources, stores, nextIds } = require("../src/app");

beforeEach(() => {
  for (const resource of resources) {
    stores.get(resource).clear();
    nextIds.set(resource, 1);
  }
});

describe("REST CRUD resources", () => {
  for (const resource of resources) {
    test(`${resource} exposes six working CRUD endpoints`, async () => {
      const collectionPath = `/api/${resource}`;
      const itemPath = `${collectionPath}/1`;

      assert.equal((await request(app).get(collectionPath)).status, 200);
      assert.deepEqual((await request(app).get(collectionPath)).body, []);

      const created = await request(app)
        .post(collectionPath)
        .send({ name: `${resource} record`, detail: "test" });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body, { name: `${resource} record`, detail: "test", id: "1" });

      assert.deepEqual((await request(app).get(itemPath)).body, created.body);

      const updated = await request(app).put(itemPath).send({ name: "replaced" });
      assert.equal(updated.status, 200);
      assert.deepEqual(updated.body, { name: "replaced", id: "1" });

      const patched = await request(app).patch(itemPath).send({ name: "renamed", id: "999" });
      assert.equal(patched.status, 200);
      assert.deepEqual(patched.body, { name: "renamed", id: "1" });

      assert.equal((await request(app).delete(itemPath)).status, 204);
      assert.equal((await request(app).get(itemPath)).status, 404);
    });
  }

  test("provides at least 60 CRUD endpoints", () => {
    assert.ok(resources.length * 6 >= 60);
  });
});

describe("API validation and health", () => {
  test("returns a successful health check", async () => {
    const response = await request(app).get("/api/health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
  });

  for (const body of [{}, { name: "" }, { name: 123 }]) {
    test(`rejects invalid create body ${JSON.stringify(body)}`, async () => {
      const response = await request(app).post("/api/users").send(body);
      assert.equal(response.status, 400);
      assert.match(response.body.error, /name/);
    });
  }

  test("returns 404 for unknown item and endpoint paths", async () => {
    assert.equal((await request(app).get("/api/users/999")).status, 404);
    const unknown = await request(app).get("/not-an-endpoint");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: "endpoint not found" });
  });

  test("requires an existing item and a valid name for replacement", async () => {
    assert.equal((await request(app).put("/api/users/1").send({ name: "valid" })).status, 404);
    await request(app).post("/api/users").send({ name: "Ada" });
    assert.equal((await request(app).put("/api/users/1").send({ name: "" })).status, 400);
  });

  test("rejects empty or invalid patches and preserves the current record", async () => {
    assert.equal((await request(app).patch("/api/users/1").send({ name: "Ada" })).status, 404);
    await request(app).post("/api/users").send({ name: "Ada" });
    assert.equal((await request(app).patch("/api/users/1").send({})).status, 400);
    assert.equal((await request(app).patch("/api/users/1").send({ name: " " })).status, 400);
    assert.deepEqual(
      (await request(app).patch("/api/users/1").send({ nickname: "A" })).body,
      { name: "Ada", id: "1", nickname: "A" },
    );
  });

  test("only deletes existing records", async () => {
    assert.equal((await request(app).delete("/api/users/1")).status, 404);
    await request(app).post("/api/users").send({ name: "Ada" });
    assert.equal((await request(app).delete("/api/users/1")).status, 204);
  });
});

const express = require("express");

const resources = [
  "users",
  "products",
  "categories",
  "orders",
  "customers",
  "suppliers",
  "inventory",
  "carts",
  "reviews",
  "payments",
];

const stores = new Map(resources.map((resource) => [resource, new Map()]));
const nextIds = new Map(resources.map((resource) => [resource, 1]));
const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

for (const resource of resources) {
  const collectionPath = `/api/${resource}`;
  const itemPath = `${collectionPath}/:id`;
  const records = stores.get(resource);

  app.get(collectionPath, (_request, response) => {
    response.json([...records.values()]);
  });

  app.post(collectionPath, (request, response) => {
    const name = request.body && request.body.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return response.status(400).json({ error: "name must be a non-empty string" });
    }

    const id = String(nextIds.get(resource));
    nextIds.set(resource, nextIds.get(resource) + 1);
    const record = { ...request.body, name: name.trim(), id };
    records.set(id, record);
    return response.status(201).json(record);
  });

  app.get(itemPath, (request, response) => {
    const record = records.get(request.params.id);
    if (!record) {
      return response.status(404).json({ error: `${resource} record not found` });
    }
    return response.json(record);
  });

  app.put(itemPath, (request, response) => {
    if (!records.has(request.params.id)) {
      return response.status(404).json({ error: `${resource} record not found` });
    }
    const name = request.body && request.body.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return response.status(400).json({ error: "name must be a non-empty string" });
    }

    const record = { ...request.body, name: name.trim(), id: request.params.id };
    records.set(request.params.id, record);
    return response.json(record);
  });

  app.patch(itemPath, (request, response) => {
    const current = records.get(request.params.id);
    if (!current) {
      return response.status(404).json({ error: `${resource} record not found` });
    }
    if (!request.body || Object.keys(request.body).length === 0) {
      return response.status(400).json({ error: "request body must not be empty" });
    }
    if (request.body.name !== undefined
      && (typeof request.body.name !== "string" || request.body.name.trim().length === 0)) {
      return response.status(400).json({ error: "name must be a non-empty string" });
    }

    const changes = { ...request.body };
    delete changes.id;
    if (typeof changes.name === "string") {
      changes.name = changes.name.trim();
    }
    const record = { ...current, ...changes, id: request.params.id };
    records.set(request.params.id, record);
    return response.json(record);
  });

  app.delete(itemPath, (request, response) => {
    if (!records.has(request.params.id)) {
      return response.status(404).json({ error: `${resource} record not found` });
    }
    records.delete(request.params.id);
    return response.status(204).end();
  });
}

app.use((_request, response) => {
  response.status(404).json({ error: "endpoint not found" });
});

module.exports = { app, resources, stores, nextIds };

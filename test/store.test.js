import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { Store } from "../src/store.js";
let mf, db;
before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: "src/worker.js",
    compatibilityDate: "2025-10-01",
    d1Databases: ["DB"],
    bindings: { DEMO_MODE: "true" },
  });
  db = await mf.getD1Database("DB");
  const sql = (await readFile("migrations/0001_initial.sql", "utf8")).replace(
    /^--.*$/gm,
    "",
  );
  const statements = sql.match(
    /CREATE TRIGGER[\s\S]*?^END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/gm,
  );
  for (const q of statements) await db.prepare(q).run();
});
after(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  for (const table of ["sessions", "votes", "stakes", "props", "users"])
    await db.prepare(`DELETE FROM ${table}`).run();
});
async function fixture(method = "creator") {
  const s = new Store(db);
  for (const id of ["a", "b", "c"]) await s.user(id, id);
  const p = await s.create("a", "server", {
    title: "Will this test pass?",
    method,
    closes: Date.now() + 60000,
  });
  return { s, p };
}
async function close(p) {
  await db.prepare("UPDATE props SET closes=0 WHERE id=?").bind(p.id).run();
}
test("concurrent duplicate stakes debit once; overdrafts and fractions rejected", async () => {
  const { s, p } = await fixture();
  const results = await Promise.allSettled([
    s.stake("a", p.id, "yes", 100),
    s.stake("a", p.id, "no", 100),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(s.stake("b", p.id, "no", 1001));
  assert.equal((await s.user("a", "a")).balance, 900);
  assert.equal((await s.user("b", "b")).balance, 1000);
  await assert.rejects(s.stake("c", p.id, "yes", 1.5));
});
test("concurrent settlement pays once and conserves integer points", async () => {
  const { s, p } = await fixture();
  await s.stake("a", p.id, "yes", 100);
  await s.stake("b", p.id, "no", 51);
  await s.stake("c", p.id, "yes", 200);
  await assert.rejects(s.settle("a", p.id, "yes"));
  await close(p);
  await assert.rejects(s.settle("b", p.id, "yes"));
  const results = await Promise.allSettled([
    s.settle("a", p.id, "yes"),
    s.settle("a", p.id, "no"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const balances = await Promise.all(
    ["a", "b", "c"].map((id) => s.user(id, id)),
  );
  assert.equal(
    balances.reduce((n, u) => n + u.balance, 0),
    3000,
  );
  await assert.rejects(s.settle("a", p.id, "yes"));
});
test("majority requires eligible participants; no winners refunds everyone", async () => {
  const { s, p } = await fixture("vote");
  for (const id of ["a", "b", "c"]) await s.stake(id, p.id, "yes", 100);
  await close(p);
  await assert.rejects(s.settle("outsider", p.id, "yes"));
  assert.equal((await s.settle("a", p.id, "no")).pending, true);
  assert.equal((await s.user("a", "a")).balance, 900);
  assert.equal((await s.settle("b", p.id, "no")).outcome, "void");
  assert.equal((await s.user("a", "a")).balance, 1000);
});
test("wallet crosses servers; concurrent refills issue points once", async () => {
  const { s, p } = await fixture();
  await s.stake("a", p.id, "yes", 950);
  const snapshot = await s.snapshot("a", "other");
  assert.equal(snapshot.props.length, 0);
  assert.equal(snapshot.user.balance, 50);
  const results = await Promise.allSettled([s.refill("a"), s.refill("a")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await s.user("a", "a")).balance, 1000);
});
test("Worker HTTP flow persists hashed sessions and isolates servers", async () => {
  const call = (path, body, token) =>
    mf.dispatchFetch("http://localhost/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await call("state")).status, 401);
  const auth = await (await call("auth", {})).json();
  assert.equal(auth.session.length, 64);
  const row = await db.prepare("SELECT token FROM sessions").first();
  assert.notEqual(row.token, auth.session);
  let r = await call(
    "props",
    {
      title: "Will our game night happen?",
      method: "creator",
      closes: Date.now() + 60000,
    },
    auth.session,
  );
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(
    (
      await call(
        `props/${p.id}/stake`,
        { side: "yes", amount: 100 },
        auth.session,
      )
    ).status,
    200,
  );
  const state = await (await call("state", null, auth.session)).json();
  assert.equal(state.user.balance, 900);
  assert.equal(state.props[0].pool, 100);
  await db.prepare("UPDATE sessions SET guild='elsewhere'").run();
  assert.equal(
    (
      await call(
        `props/${p.id}/stake`,
        { side: "no", amount: 100 },
        auth.session,
      )
    ).status,
    403,
  );
  await db.prepare("UPDATE sessions SET expires=0").run();
  assert.equal((await call("state", null, auth.session)).status, 401);
  assert.equal(
    (
      await mf
        .dispatchFetch("https://public.example/api/config")
        .then((r) => r.json())
    ).demo,
    false,
  );
  assert.equal(
    (
      await mf.dispatchFetch("https://public.example/api/auth", {
        method: "POST",
        body: "{}",
      })
    ).status,
    503,
  );
});

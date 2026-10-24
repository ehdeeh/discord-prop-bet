import { Store } from "./store.js";
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const store = new Store(env.DB);
    // A deployed Worker can never enable the local demo by setting a variable alone.
    const demo =
      env.DEMO_MODE === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    try {
      if (url.pathname === "/api/config" && request.method === "GET")
        return json({ clientId: env.DISCORD_CLIENT_ID || "", demo });
      if (url.pathname === "/api/health" && request.method === "GET") {
        await env.DB.prepare("SELECT 1 FROM users LIMIT 1").all();
        return json({ ok: true });
      }
      let body = {};
      if (request.method === "POST") {
        if (Number(request.headers.get("content-length")) > 16384)
          return json({ error: "Request too large" }, 413);
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 16384)
          return json({ error: "Request too large" }, 413);
        try {
          body = JSON.parse(text);
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return json({ error: "Expected an object" }, 400);
      }
      if (url.pathname === "/api/auth" && request.method === "POST") {
        let user, guild, accessToken;
        if (demo) {
          user = { id: "demo-user", username: "You" };
          guild = "demo-server";
        } else {
          if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
            return json(
              { error: "Discord credentials are not configured" },
              503,
            );
          if (typeof body.code !== "string" || typeof body.guild !== "string")
            return json(
              { error: "Discord authorization and server required" },
              401,
            );
          const response = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: env.DISCORD_CLIENT_ID,
              client_secret: env.DISCORD_CLIENT_SECRET,
              grant_type: "authorization_code",
              code: body.code,
            }),
          });
          if (!response.ok)
            return json({ error: "Discord token exchange failed" }, 401);
          const token = await response.json();
          accessToken = token.access_token;
          const headers = { Authorization: `Bearer ${accessToken}` };
          const me = await fetch("https://discord.com/api/users/@me", {
            headers,
          });
          if (!me.ok) return json({ error: "Discord user lookup failed" }, 401);
          user = await me.json();
          let after;
          let member = false;
          for (let page = 0; page < 10; page++) {
            const r = await fetch(
              `https://discord.com/api/users/@me/guilds?limit=200${after ? `&after=${after}` : ""}`,
              { headers },
            );
            if (!r.ok)
              return json({ error: "Discord membership lookup failed" }, 401);
            const guilds = await r.json();
            if (guilds.some((g) => g.id === body.guild)) {
              member = true;
              break;
            }
            if (guilds.length < 200) break;
            after = guilds.at(-1).id;
          }
          if (!member)
            return json({ error: "Join this Discord server first" }, 403);
          guild = body.guild;
        }
        await store.user(user.id, user.global_name || user.username);
        const session = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (n) => n.toString(16).padStart(2, "0"),
        ).join("");
        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE expires<=?").bind(
            Date.now(),
          ),
          env.DB.prepare("INSERT INTO sessions VALUES(?,?,?,?)").bind(
            await hash(session),
            user.id,
            guild,
            Date.now() + 3600000,
          ),
        ]);
        return json({ session, accessToken });
      }
      const token = request.headers
        .get("Authorization")
        ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token)
        return json({ error: "Please reopen the Activity to sign in" }, 401);
      const session = await env.DB.prepare(
        "SELECT user,guild FROM sessions WHERE token=? AND expires>?",
      )
        .bind(await hash(token), Date.now())
        .first();
      if (!session)
        return json({ error: "Please reopen the Activity to sign in" }, 401);
      if (url.pathname === "/api/state" && request.method === "GET")
        return json(await store.snapshot(session.user, session.guild));
      if (url.pathname === "/api/props" && request.method === "POST")
        return json(await store.create(session.user, session.guild, body));
      if (url.pathname === "/api/refill" && request.method === "POST") {
        await store.refill(session.user);
        return json({ ok: true });
      }
      const route = url.pathname.match(
        /^\/api\/props\/([^/]+)\/(stake|settle)$/,
      );
      if (route && request.method === "POST") {
        const p = await store.get(route[1]);
        if (p.guild !== session.guild)
          return json({ error: "Prop is in another server" }, 403);
        const result =
          route[2] === "stake"
            ? await store.stake(session.user, p.id, body.side, body.amount)
            : await store.settle(session.user, p.id, body.side);
        return json(result || { ok: true });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      const message = e.message || "";
      if (/D1_|SQLITE|constraint/i.test(message)) {
        if (/UNIQUE/.test(message))
          return json({ error: "You already joined this prop" }, 400);
        for (const known of [
          "Insufficient points",
          "Betting is closed",
          "Voting is unavailable",
          "Only participants can vote",
          "Already settled",
        ])
          if (message.includes(known)) return json({ error: known }, 400);
        console.error("Database operation failed");
        return json({ error: "Database operation failed" }, 500);
      }
      return json({ error: message }, 400);
    }
  },
};

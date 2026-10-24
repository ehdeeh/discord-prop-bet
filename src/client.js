import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
const app = document.querySelector("#app");
let session, state, sdk;
let busy = false;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
async function refresh() {
  state = await api("state");
  render();
}
function render() {
  app.innerHTML = `<header><a class="brand" href="#">◈ sidebet</a><span class="tag">FRIENDLY COMPETITION</span><div class="wallet">◉ ${state.user.balance.toLocaleString()} <small>points</small></div></header><section class="hero"><div class="eyebrow">YOUR SERVER’S PREDICTION CLUB</div><h1>Big takes.<br><span>Friendly stakes.</span></h1><p>Put your points where your predictions are.<br>Make a prop. Pick a side. Settle the debate.</p><button id="new">+ Create a prop</button></section><div class="layout"><section><div class="section-title"><h2>The board</h2><span>${state.props.filter((p) => p.status === "open").length} open props</span></div><div class="cards">${
    state.props.length
      ? state.props
          .map((p) => {
            const mine = state.stakes.find((s) => s.prop === p.id);
            const closed = p.closes <= Date.now();
            return `<article><div class="meta">${p.status === "settled" ? "SETTLED · " + esc(p.outcome.toUpperCase()) : closed ? "AWAITING RESULT" : "OPEN FOR PICKS"} <span>${p.method === "vote" ? "Community vote" : "Creator settles"}</span></div><h3>${esc(p.title)}</h3><div class="stats"><b>◉ ${p.pool} <small>in the pool</small></b><span>${p.players} players</span></div><p class="deadline">Closes ${esc(new Date(p.closes).toLocaleString())}</p>${p.status === "settled" ? '<p class="result">Result recorded. Points paid out.</p>' : closed ? `<div class="choices"><button data-settle="${p.id}" data-side="yes">${p.method === "vote" ? "Vote" : "Settle"} Yes</button><button data-settle="${p.id}" data-side="no">${p.method === "vote" ? "Vote" : "Settle"} No</button>${p.method === "creator" && p.creator === state.user.id ? `<button data-settle="${p.id}" data-side="void">Void / refund</button>` : ""}</div>` : mine ? `<p class="result">Your pick: ${esc(mine.side.toUpperCase())} · ${mine.amount} points</p>` : `<div class="choices"><button data-bet="${p.id}" data-side="yes">↗ Yes</button><button data-bet="${p.id}" data-side="no">↘ No</button></div>`}</article>`;
          })
          .join("")
      : '<article class="empty"><div>✦</div><h3>The next big take is yours.</h3><p>Create the first prop and invite your friends to pick a side.</p></article>'
  }</div></section><aside><h2>Server leaderboard</h2><p class="muted">Global wallets. Local bragging rights.</p>${state.leaderboard.length ? state.leaderboard.map((u, i) => `<div class="rank"><span>${i + 1}. ${esc(u.name)}</span><b>${u.balance}</b></div>`).join("") : '<p class="muted">Place a pick to join the leaderboard.</p>'}<hr><h3>All fun. No real money.</h3><p class="muted">Start with 1,000 points. Winners share the pool. If no one wins, everyone gets refunded.</p><button class="secondary" id="refill">Claim daily refill</button><p class="muted">Below 100? Refill to 1,000 once every 24 hours.</p></aside></div><footer>SIDEBET · Points have no monetary value.</footer><dialog id="dialog"></dialog><div role="status" id="notice"></div>`;
  document.querySelector("#new").onclick = () => {
    const d = document.querySelector("#dialog");
    d.innerHTML = `<form id="create"><h2>Set the stakes.</h2><label>Your prediction<input name="title" required minlength="5" maxlength="180" placeholder="Will Alex finish the marathon?"></label><label>How is it settled?<select name="method"><option value="creator">Creator decides</option><option value="vote">Participant majority vote</option></select></label><label>Betting closes<input name="closes" type="datetime-local" required></label><p class="muted">Agree on clear outcome criteria before friends join. Votes need a majority of all participants.</p><button>Create prop</button><button type="button" class="secondary" id="cancel">Cancel</button></form>`;
    d.showModal();
    d.querySelector("#cancel").onclick = () => d.close();
    d.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      act(() =>
        api("props", {
          title: f.get("title"),
          method: f.get("method"),
          closes: new Date(f.get("closes")).getTime(),
        }),
      );
    };
  };
  document.querySelector("#refill").onclick = () =>
    act(() => api("refill", {}));
  document.querySelectorAll("[data-bet]").forEach(
    (b) =>
      (b.onclick = () => {
        const amount = prompt("How many points?", "100");
        if (amount !== null)
          act(() =>
            api(`props/${b.dataset.bet}/stake`, {
              side: b.dataset.side,
              amount: Number(amount),
            }),
          );
      }),
  );
  document.querySelectorAll("[data-settle]").forEach(
    (b) =>
      (b.onclick = () => {
        if (
          confirm(
            `Record ${b.dataset.side.toUpperCase()}? Creator settlement is final; votes can change until a majority is reached.`,
          )
        )
          act(async () => {
            const r = await api(`props/${b.dataset.settle}/settle`, {
              side: b.dataset.side,
            });
            return r.pending
              ? "Vote recorded. Waiting for a majority."
              : "Prop settled.";
          });
      }),
  );
}
async function act(fn) {
  if (busy) return;
  busy = true;
  try {
    const msg = await fn();
    await refresh();
    notice(typeof msg === "string" ? msg : "Saved.");
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
  }
}
function notice(message) {
  const el = document.querySelector("#notice");
  if (el) el.textContent = message;
}
try {
  const config = await api("config");
  let auth;
  if (config.demo) auth = await api("auth", {});
  else {
    if (!config.clientId)
      throw Error(
        "Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to open this Activity in Discord, or use DEMO_MODE=true for local development.",
      );
    sdk = new DiscordSDK(config.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({
      client_id: config.clientId,
      response_type: "code",
      state: crypto.randomUUID(),
      prompt: "none",
      scope: ["identify", "guilds"],
    });
    auth = await api("auth", { code, guild: sdk.guildId });
    await sdk.commands.authenticate({ access_token: auth.accessToken });
  }
  session = auth.session;
  await refresh();
  setInterval(() => {
    if (!document.querySelector("dialog[open]") && !busy)
      refresh().catch((e) => notice(e.message));
  }, 15000);
} catch (e) {
  app.innerHTML = `<section class="hero"><div class="brand">◈ sidebet</div><h1>Let’s get connected.</h1><p>${esc(e.message)}</p></section>`;
}

export class Store {
  constructor(db) {
    this.db = db;
  }
  stmt(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  async user(id, name) {
    await this.stmt(
      "INSERT INTO users(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      id,
      name,
    ).run();
    return this.stmt("SELECT * FROM users WHERE id=?", id).first();
  }
  async get(id) {
    const p = await this.stmt("SELECT * FROM props WHERE id=?", id).first();
    if (!p) throw Error("Prop not found");
    return p;
  }
  async create(user, guild, { title, method, closes }) {
    if (
      typeof title !== "string" ||
      title.trim().length < 5 ||
      title.length > 180
    )
      throw Error("Use a title of 5–180 characters");
    if (!["creator", "vote"].includes(method))
      throw Error("Sports settlement requires a configured provider");
    if (
      !Number.isSafeInteger(closes) ||
      closes <= Date.now() ||
      closes > Date.now() + 90 * 86400000
    )
      throw Error("Choose a closing time within 90 days");
    const id = crypto.randomUUID();
    await this.stmt(
      "INSERT INTO props(id,guild,creator,title,method,closes) VALUES(?,?,?,?,?,?)",
      id,
      guild,
      user,
      title.trim(),
      method,
      closes,
    ).run();
    return this.get(id);
  }
  async stake(user, id, side, amount) {
    if (
      !["yes", "no"].includes(side) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1000000
    )
      throw Error("Choose Yes or No and a whole-number stake");
    await this.stmt(
      "INSERT INTO stakes VALUES(?,?,?,?)",
      id,
      user,
      side,
      amount,
    ).run();
  }
  async settle(actor, id, side) {
    if (!["yes", "no", "void"].includes(side)) throw Error("Invalid outcome");
    const p = await this.get(id);
    if (p.status !== "open") throw Error("Already settled");
    if (Date.now() < p.closes) throw Error("Wait until betting closes");
    const outcome =
      "CASE WHEN ?='void' OR NOT EXISTS(SELECT 1 FROM stakes WHERE prop=? AND side=?) THEN 'void' ELSE ? END";
    if (p.method === "creator") {
      if (actor !== p.creator) throw Error("Only the creator can settle");
      const r = await this.stmt(
        `UPDATE props SET status='settled',outcome=${outcome} WHERE id=? AND status='open' AND creator=? AND closes<=?`,
        side,
        id,
        side,
        side,
        id,
        actor,
        Date.now(),
      ).run();
      if (!r.meta.changes) throw Error("Already settled");
    } else {
      if (side === "void") throw Error("Only Yes or No votes are allowed");
      await this.db.batch([
        this.stmt(
          "INSERT INTO votes VALUES(?,?,?) ON CONFLICT(prop,user) DO UPDATE SET side=excluded.side",
          id,
          actor,
          side,
        ),
        this.stmt(
          `UPDATE props SET status='settled',outcome=${outcome} WHERE id=? AND status='open' AND (SELECT COUNT(*) FROM votes WHERE prop=? AND side=?) * 2 > (SELECT COUNT(*) FROM stakes WHERE prop=?)`,
          side,
          id,
          side,
          side,
          id,
          id,
          side,
          id,
        ),
      ]);
    }
    const result = await this.get(id);
    return { pending: result.status === "open", outcome: result.outcome };
  }
  async refill(id) {
    const now = Date.now();
    const r = await this.stmt(
      "UPDATE users SET balance=1000,refill=? WHERE id=? AND balance<100 AND refill<=?",
      now,
      id,
      now - 86400000,
    ).run();
    if (!r.meta.changes)
      throw Error("Refill available below 100 points, once every 24 hours");
  }
  async snapshot(user, guild) {
    const [u, props, stakes, leaderboard] = await this.db.batch([
      this.stmt("SELECT id,name,balance FROM users WHERE id=?", user),
      this.stmt(
        "SELECT p.*,COALESCE(SUM(s.amount),0) AS pool,COUNT(s.user) AS players FROM props p LEFT JOIN stakes s ON s.prop=p.id WHERE p.guild=? GROUP BY p.id ORDER BY p.closes DESC LIMIT 100",
        guild,
      ),
      this.stmt(
        "SELECT s.* FROM stakes s JOIN props p ON p.id=s.prop WHERE s.user=? AND p.guild=?",
        user,
        guild,
      ),
      this.stmt(
        "SELECT DISTINCT u.id,u.name,u.balance FROM users u JOIN stakes s ON s.user=u.id JOIN props p ON p.id=s.prop WHERE p.guild=? ORDER BY u.balance DESC LIMIT 10",
        guild,
      ),
    ]);
    return {
      user: u.results[0],
      props: props.results,
      stakes: stakes.results,
      leaderboard: leaderboard.results,
    };
  }
}

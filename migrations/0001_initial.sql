CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 1000 CHECK(balance>=0), refill INTEGER NOT NULL DEFAULT 0);
CREATE TABLE props(id TEXT PRIMARY KEY, guild TEXT NOT NULL, creator TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('creator','vote')), closes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', outcome TEXT CHECK(outcome IN ('yes','no','void')));
CREATE INDEX props_guild ON props(guild,closes);
CREATE TABLE stakes(prop TEXT NOT NULL REFERENCES props(id), user TEXT NOT NULL REFERENCES users(id), side TEXT NOT NULL CHECK(side IN ('yes','no')), amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000), PRIMARY KEY(prop,user));
CREATE TABLE votes(prop TEXT NOT NULL REFERENCES props(id), user TEXT NOT NULL REFERENCES users(id), side TEXT NOT NULL CHECK(side IN ('yes','no')), PRIMARY KEY(prop,user));
CREATE TABLE sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),guild TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
-- Triggers make mutations atomic across concurrent Worker requests.
CREATE TRIGGER stake_guard BEFORE INSERT ON stakes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop AND status='open' AND closes>unixepoch('subsec')*1000) THEN RAISE(ABORT,'Betting is closed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user AND balance>=NEW.amount) THEN RAISE(ABORT,'Insufficient points') END;
END;
CREATE TRIGGER stake_debit AFTER INSERT ON stakes BEGIN UPDATE users SET balance=balance-NEW.amount WHERE id=NEW.user; END;
CREATE TRIGGER vote_guard BEFORE INSERT ON votes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop AND method='vote' AND status='open' AND closes<=unixepoch('subsec')*1000) THEN RAISE(ABORT,'Voting is unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stakes WHERE prop=NEW.prop AND user=NEW.user) THEN RAISE(ABORT,'Only participants can vote') END;
END;
CREATE TRIGGER vote_update_guard BEFORE UPDATE ON votes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop AND status='open') THEN RAISE(ABORT,'Already settled') END;
END;
-- Distribute integer payouts in user-ID order; the final winner receives rounding remainder.
CREATE TRIGGER payout AFTER UPDATE OF status ON props WHEN OLD.status='open' AND NEW.status='settled' BEGIN
 UPDATE users SET balance=balance+COALESCE((
 SELECT CASE WHEN NEW.outcome='void' THEN s.amount
 WHEN s.side!=NEW.outcome THEN 0
 WHEN s.user=(SELECT MAX(user) FROM stakes WHERE prop=NEW.id AND side=NEW.outcome)
 THEN (SELECT SUM(amount) FROM stakes WHERE prop=NEW.id)-COALESCE((SELECT SUM(CAST(w.amount*(SELECT SUM(amount) FROM stakes WHERE prop=NEW.id)/(SELECT SUM(amount) FROM stakes WHERE prop=NEW.id AND side=NEW.outcome) AS INTEGER)) FROM stakes w WHERE w.prop=NEW.id AND w.side=NEW.outcome AND w.user!=s.user),0)
 ELSE CAST(s.amount*(SELECT SUM(amount) FROM stakes WHERE prop=NEW.id)/(SELECT SUM(amount) FROM stakes WHERE prop=NEW.id AND side=NEW.outcome) AS INTEGER) END
 FROM stakes s WHERE s.prop=NEW.id AND s.user=users.id),0)
 WHERE id IN (SELECT user FROM stakes WHERE prop=NEW.id);
END;

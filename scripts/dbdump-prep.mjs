import { writeFileSync } from "node:fs";
const u = process.env.DATABASE_URL || "";
if (!u) { console.error("NO DATABASE_URL"); process.exit(1); }
const x = new URL(u);
const info = {
  host: x.hostname,
  port: x.port || "3306",
  db: decodeURIComponent(x.pathname.slice(1)),
  user: decodeURIComponent(x.username),
  pass: decodeURIComponent(x.password),
  ssl: /ssl|tls/i.test(x.search),
};
// Write a defaults-extra-file so the password never lands in argv / shell history.
const cnf = `[client]\nhost=${info.host}\nport=${info.port}\nuser=${info.user}\npassword="${info.pass}"\n${info.ssl ? "ssl-mode=REQUIRED\n" : ""}`;
writeFileSync("/tmp/.my.cnf", cnf, { mode: 0o600 });
writeFileSync("/tmp/dbname.txt", info.db);
console.log(`host=${info.host} port=${info.port} db=${info.db} ssl=${info.ssl}`);

const u = process.env.DATABASE_URL || "";
if (!u) { console.log(JSON.stringify({ hasUrl: false })); process.exit(0); }
const x = new URL(u);
console.log(JSON.stringify({
  hasUrl: true,
  protocol: x.protocol,
  host: x.hostname,
  port: x.port || "3306",
  db: decodeURIComponent(x.pathname.slice(1)),
  user: decodeURIComponent(x.username),
  hasPassword: !!x.password,
  search: x.search,
}));

// Local preview: builds with BASE_PATH=/ and serves dist/ at http://localhost:8080
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

execFileSync(process.execPath, [join(ROOT, "scripts", "build.mjs")], { stdio: "inherit", env: { ...process.env, BASE_PATH: "/" } });
const DIST = join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const port = Number(process.env.PORT ?? 8080);
createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!p.startsWith(DIST) || !existsSync(p)) { res.writeHead(404); return res.end(readFileSync(join(DIST, "404.html"))); }
  res.writeHead(200, { "Content-Type": (TYPES[extname(p)] ?? "application/octet-stream") + "; charset=utf-8" });
  res.end(readFileSync(p));
}).listen(port, () => console.log(`Preview at http://localhost:${port}/`));

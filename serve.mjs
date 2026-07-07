import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4280);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png"
};

function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const relative = normalized === "/" ? "manuals-webapp/index.html" : normalized.replace(/^[/\\]/, "");
  const fullPath = path.resolve(projectRoot, relative);
  if (!fullPath.startsWith(projectRoot)) return null;
  if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
    return path.join(fullPath, "index.html");
  }
  return fullPath;
}

const server = http.createServer((request, response) => {
  const fullPath = resolveRequest(request.url || "/");
  if (!fullPath || !existsSync(fullPath) || !statSync(fullPath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  response.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(fullPath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Manuals web app: http://127.0.0.1:${port}/manuals-webapp/`);
});

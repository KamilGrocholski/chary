import path from "node:path";

// A local preview of what lands on GitHub Pages.
const ROOT = path.resolve("public");

function resolveInsideRoot(pathname: string): string | null {
  // Without normalising, `/../src/world-scraper.ts` escaped public/.
  const resolved = path.resolve(ROOT, `.${path.posix.normalize(pathname)}`);
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = resolveInsideRoot(pathname);
    if (filePath) {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    }

    const notFound = Bun.file(path.join(ROOT, "404.html"));
    if (await notFound.exists()) return new Response(notFound, { status: 404 });

    return new Response("Not found", { status: 404 });
  },
});

console.log(`http://localhost:${server.port}`);

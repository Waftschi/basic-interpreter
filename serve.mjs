import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT ?? 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.bas': 'text/plain', '.css': 'text/css' };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path === '/') path = '/web/index.html';
  if (!/^\/(web|dist|examples)\//.test(path) || path.includes('..')) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`BASIC terminal: http://127.0.0.1:${port}/`));

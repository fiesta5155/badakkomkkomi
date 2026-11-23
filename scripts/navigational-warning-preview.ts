import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseWarningSnapshot, parseWarningAttempt } from '../src/services/navigationalWarningService.ts';

export function createWarningPreviewMiddleware({ enabled, base = '/', directory = path.resolve('.dev/fixtures/navigational-warnings') }: {
  enabled: boolean; base?: string; directory?: string;
}) {
  const prefix = `${base}__dev/data/navigational-warnings/`;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const file = pathname.slice(prefix.length);
    if (!enabled || !['latest.json', 'status.json'].includes(file)) { response.statusCode = 404; response.end('{"error":"Preview unavailable"}'); return; }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.statusCode = 405; response.end(); return; }
    try {
      const texts = await Promise.all(['latest.json', 'status.json'].map(name => readFile(path.join(directory, name), 'utf8')));
      const snapshot = parseWarningSnapshot(JSON.parse(texts[0]));
      const status = parseWarningAttempt(JSON.parse(texts[1]));
      if (snapshot.documents.length !== 9 || snapshot.documents.reduce((sum, document) => sum + document.areas.length, 0) !== 94
        || status.status !== 'success' || snapshot.lastSuccessfulAt !== status.lastSuccessfulAt) throw Error();
      const secrets = [process.env.KHOA_NAV_WARNING_SERVICE_KEY, process.env.KHOA_SERVICE_KEY].filter((s): s is string => !!s)
        .flatMap(s => [s, decodeURIComponent(s), encodeURIComponent(decodeURIComponent(s))]);
      if (texts.some(text => secrets.some(secret => text.includes(secret)) || /[?&]servicekey=/i.test(text))) throw Error();
      response.statusCode = 200;
      response.end(request.method === 'HEAD' ? undefined : texts[file === 'latest.json' ? 0 : 1]);
    } catch {
      // Files may be missing or invalid; never disclose file contents, paths or credentials.
      response.statusCode = 503; response.end('{"error":"Verified historical preview fixture unavailable"}');
    }
  };
}

export function navigationalWarningPreviewPlugin(base: string): Plugin {
  const enabled = process.env.BADA_NAV_WARNING_PREVIEW === '1';
  return { name: 'bada-navigational-warning-preview', apply: 'serve',
    transformIndexHtml(_html, context) {
      // Capture the explicit entry URL before the application's router normalizes it.
      const selected = new URL(context.originalUrl ?? '/', 'http://localhost').searchParams.get('navWarningPreview') === '1';
      return enabled && selected ? [{ tag: 'meta', attrs: { name: 'bada-nav-warning-preview', content: '1' }, injectTo: 'head' }] : [];
    },
    configureServer(server) {
      server.middlewares.use(createWarningPreviewMiddleware({ base, enabled }));
    },
  };
}

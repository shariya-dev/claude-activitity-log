/**
 * The API client's HTTP transport on `node:http` / `node:https`.
 *
 * Why not the global `fetch`: it loads undici, whose WASM HTTP parser costs ~30 MB of RSS during
 * the initial sync (H31/H33 measurements), more than the whole remaining budget. This transport
 * sends exactly the bytes the client hands it (headers and body, no Accept-Encoding of its own),
 * validates TLS certificates against Node's default CAs (plus NODE_EXTRA_CA_CERTS), aborts the
 * socket when the signal fires, and caps the decoded response body.
 */
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  /** A response header by case-insensitive name, or null when absent. */
  header(name: string): string | null;
  /**
   * Reads the whole body once, as UTF-8 (a leading BOM is dropped, like `Response.text()`).
   * Callers must always call it: reading (or failing) the body releases the socket and the
   * abort listener.
   */
  text(): Promise<string>;
}

/**
 * Resolves once the response head arrives. Rejects on DNS, TLS, connection and abort failures.
 * `text()` rejects on a failed or aborted body read, and with a ResponseBodyError for a body over
 * the cap or in an unsupported encoding.
 */
export type HttpTransport = (req: TransportRequest) => Promise<TransportResponse>;

/** Largest decoded response body accepted. Every Sync API v1 response is a few KB. */
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** A response body the client cannot accept (not a transport failure): §9.3 `invalid_response`. */
export class ResponseBodyError extends Error {
  override name = 'ResponseBodyError';
}

export class ResponseTooLargeError extends ResponseBodyError {
  override name = 'ResponseTooLargeError';
  constructor(limit: number) {
    super(`response body over ${limit} bytes`);
  }
}

function abortError(): Error {
  const err = new Error('the request was aborted');
  err.name = 'AbortError';
  return err;
}

function decoded(res: http.IncomingMessage): Readable {
  const encoding = (res.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  let decoder: Readable & NodeJS.WritableStream;
  if (encoding === 'identity' || encoding === '') return res;
  if (encoding === 'gzip' || encoding === 'x-gzip') decoder = createGunzip();
  else if (encoding === 'deflate') decoder = createInflate();
  else if (encoding === 'br') decoder = createBrotliDecompress();
  else throw new ResponseBodyError(`unsupported response content-encoding ${encoding}`);
  pipeline(res, decoder, () => undefined);
  return decoder;
}

async function readBody(res: http.IncomingMessage, limit: number): Promise<string> {
  try {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) throw new ResponseTooLargeError(limit);
    const stream = decoded(res);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > limit) throw new ResponseTooLargeError(limit);
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks, size).toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch (err) {
    res.destroy();
    throw err;
  }
}

function response(
  res: http.IncomingMessage,
  signal: AbortSignal,
  limit: number,
  done: () => void,
): TransportResponse {
  let read: Promise<string> | null = null;
  return {
    status: res.statusCode ?? 0,
    header(name) {
      const value = res.headers[name.toLowerCase()];
      if (value === undefined) return null;
      return Array.isArray(value) ? value.join(', ') : value;
    },
    text() {
      read ??= (async () => {
        try {
          if (signal.aborted) {
            res.destroy();
            throw abortError();
          }
          return await readBody(res, limit);
        } finally {
          done();
        }
      })();
      return read;
    },
  };
}

export function createHttpTransport(
  o: {
    maxResponseBytes?: number;
    /** Replaces the default CA list. Tests only: production relies on the default CAs. */
    ca?: string | Buffer;
  } = {},
): HttpTransport {
  const limit = o.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  return (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      if (req.signal.aborted) {
        reject(abortError());
        return;
      }
      const url = new URL(req.url);
      const secure = url.protocol === 'https:';
      if (!secure && url.protocol !== 'http:') {
        reject(new Error(`unsupported protocol ${url.protocol}`));
        return;
      }

      let body: Buffer | undefined;
      if (typeof req.body === 'string') body = Buffer.from(req.body, 'utf8');
      else if (req.body !== undefined) {
        body = Buffer.from(req.body.buffer, req.body.byteOffset, req.body.byteLength);
      }
      const headers: http.OutgoingHttpHeaders = { ...req.headers };
      // Like fetch: an explicit length for every POST (0 without a body), none for a bodyless GET.
      if (body !== undefined || req.method === 'POST') {
        headers['Content-Length'] = body?.byteLength ?? 0;
      }

      const options: https.RequestOptions = { method: req.method, headers };
      if (secure && o.ca !== undefined) options.ca = o.ca;
      const client = (secure ? https : http).request(url, options);

      const onAbort = (): void => {
        client.destroy(abortError());
      };
      const done = (): void => req.signal.removeEventListener('abort', onAbort);
      req.signal.addEventListener('abort', onAbort, { once: true });

      client.on('error', (err) => {
        done();
        reject(err);
      });
      client.once('response', (res) => {
        resolve(response(res, req.signal, limit, done));
      });
      client.end(body);
    });
}

/** Adapts a `fetch` implementation (the test seam) to the transport interface. */
export function fetchTransport(fetchImpl: typeof fetch): HttpTransport {
  return async (req) => {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.body === undefined ? {} : { body: req.body }),
      signal: req.signal,
    });
    return {
      status: res.status,
      header: (name) => res.headers.get(name),
      text: () => res.text(),
    };
  };
}

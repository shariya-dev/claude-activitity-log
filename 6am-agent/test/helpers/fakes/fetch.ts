/** One scripted outcome for a fetch call. */
export type FakeFetchReply =
  | Response
  | { status?: number; body?: unknown; headers?: Record<string, string> }
  | { error: unknown }
  | 'hang';

export interface RecordedRequest {
  url: string;
  method: string;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  /** Raw body as passed to fetch: a string, a Buffer (e.g. gzip), or null. */
  body: string | Buffer | null;
}

export type FakeFetch = typeof fetch & {
  requests: RecordedRequest[];
  /** Appends outcomes, consumed in order. With an empty queue, fetch answers 200 `{}`. */
  reply(...replies: FakeFetchReply[]): FakeFetch;
};

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

function toResponse(r: Exclude<FakeFetchReply, 'hang' | { error: unknown }>): Response {
  if (r instanceof Response) return r;
  const status = r.status ?? 200;
  const headers = new Headers(r.headers);
  let body: string | null = null;
  if (r.body !== undefined && status !== 204 && status !== 304) {
    body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    if (typeof r.body !== 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return new Response(body, { status, headers });
}

function recordBody(body: RequestInit['body']): string | Buffer | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  throw new Error('fake fetch: unsupported body type');
}

/**
 * Scriptable `fetch`. Records every request; replies come from a queue of Responses, response
 * builders, `{ error }` rejections, or `'hang'` (pending until `init.signal` aborts, then rejects
 * with an AbortError DOMException like the real fetch).
 */
export function createFakeFetch(...initial: FakeFetchReply[]): FakeFetch {
  const queue: FakeFetchReply[] = [...initial];
  const requests: RecordedRequest[] = [];

  const impl = (input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: recordBody(init.body),
    });

    const signal = init.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    const next = queue.shift() ?? { status: 200, body: {} };

    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    if (!(next instanceof Response) && 'error' in next) return Promise.reject(next.error);
    return Promise.resolve(toResponse(next));
  };

  const fake = Object.assign(impl, {
    requests,
    reply(...replies: FakeFetchReply[]): FakeFetch {
      queue.push(...replies);
      return fake;
    },
  }) as FakeFetch;
  return fake;
}

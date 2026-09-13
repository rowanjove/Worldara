import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const REQUEST_HEADERS = ['accept', 'content-type', 'if-match', 'idempotency-key', 'x-asset-media-type', 'x-file-name'] as const;
const RESPONSE_HEADERS = ['content-type', 'content-disposition', 'etag', 'cache-control'] as const;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const baseUrl = process.env.WORLD_CODEX_API_URL ?? process.env.WEB_API_URL ?? 'http://127.0.0.1:4000';
  const token = process.env.WORLD_CODEX_API_TOKEN;
  if (!token && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: { code: 'SERVER_MISCONFIGURED', message: 'WORLD_CODEX_API_TOKEN is required by the web proxy in production' } }, { status: 503 });
  }
  const target = new URL(path.map(encodeURIComponent).join('/'), `${baseUrl.replace(/\/$/, '')}/`);
  target.search = request.nextUrl.search;
  const headers = new Headers();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  } else {
    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) headers.set('authorization', incomingAuth);
  }
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const method = request.method.toUpperCase();
  const response = await fetch(target, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: await request.arrayBuffer() }), cache: 'no-store', redirect: 'manual' });
  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;

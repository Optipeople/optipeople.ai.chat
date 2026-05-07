// Catch-all proxy for the Optipeople auth API.
//
// The browser hits /auth-api/Authentication/login etc. — this handler
// forwards to <OPTIPEOPLE_API_TARGET>/api/Authentication/login, preserving
// method, body, and the Authorization header. Replaces the dev-only
// proxy that used to live in client/vite.config.ts and unblocks production
// deploy on Vercel.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET =
  process.env.OPTIPEOPLE_API_TARGET ?? "https://api-staging.optipeople.dk";

// Headers we should not forward in either direction — they're
// connection/transport concerns the runtime sets for us, and forwarding
// them confuses fetch (or, on the response side, the browser).
//
// content-encoding + content-length are critical on the *response* path:
// undici's fetch transparently gunzips the upstream body, so forwarding
// the original gzip headers makes the browser try to decode plaintext as
// gzip → ERR_CONTENT_DECODING_FAILED.
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
]);

async function proxy(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const upstreamUrl = new URL(
    `/api/${path.join("/")}`,
    TARGET,
  );
  // Preserve query string from the incoming request.
  const incomingUrl = new URL(req.url);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    // Only methods that can have a body get one — passing body for
    // GET/HEAD throws.
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.arrayBuffer(),
    redirect: "manual",
  };

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (err) {
    console.error("auth-api proxy error:", err);
    return Response.json(
      { error: "Upstream unreachable" },
      { status: 502 },
    );
  }

  // Strip hop-by-hop response headers similarly.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;

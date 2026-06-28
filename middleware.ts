import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { method, nextUrl } = request;
  const path = nextUrl.pathname;
  const ts = new Date().toISOString();

  let body: unknown;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.clone().json();
    } catch {
      // not JSON or empty body
    }
  }

  console.log(`[api] ${ts} ${method} ${path}`, body ?? "");

  return NextResponse.next();
}

export const config = {
  // Only run on API routes — skip static files, _next, etc.
  matcher: ["/job/:path*", "/api/:path*"],
};

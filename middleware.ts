import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { method, nextUrl } = request;
  const path = nextUrl.pathname;
  const ts = new Date().toISOString();

  console.log(`[api] ${ts} ${method} ${path}`);

  return NextResponse.next();
}

export const config = {
  // Only run on API routes — skip static files, _next, etc.
  matcher: ["/job/:path*", "/api/:path*"],
};

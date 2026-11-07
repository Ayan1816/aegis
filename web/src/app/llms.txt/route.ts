import { buildLlmsTxt } from "../../lib/judge-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

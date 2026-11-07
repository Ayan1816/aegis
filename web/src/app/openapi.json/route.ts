import { buildOpenApiSpec } from "../../lib/judge-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify(buildOpenApiSpec()), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

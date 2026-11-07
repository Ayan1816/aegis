import { NextResponse } from "next/server";
import { readExecutionRaw } from "@/lib/near-vault-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id || id.length > 200) {
    return NextResponse.json({ error: { code: "invalid_receipt", message: "Receipt id is required." } }, { status: 400 });
  }
  const raw = await readExecutionRaw(id);
  return NextResponse.json({ raw });
}

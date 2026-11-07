import { NextResponse } from "next/server";
import { receiptBytesForDownload } from "@/lib/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const receiptId = decodeURIComponent(id || "").trim();
  if (!receiptId || receiptId.length > 200) {
    return NextResponse.json({ error: { code: "invalid_receipt", message: "Receipt id is required." } }, { status: 400 });
  }
  const bytes = await receiptBytesForDownload(receiptId);
  if (!bytes) {
    return NextResponse.json({ error: { code: "receipt_not_found", message: "No frozen receipt is stored for that id." } }, { status: 404 });
  }
  const safeName = receiptId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="kotha-receipt-${safeName}.json"`,
    },
  });
}

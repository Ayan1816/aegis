import { buildAuditStatementHtml } from "../../../../lib/judge-portal";
import { listReceiptRecords } from "../../../../lib/receipt-store";
import { publicContractId } from "../../../../lib/wallet-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const records = await listReceiptRecords();
  const html = buildAuditStatementHtml({
    contractId: publicContractId(),
    records,
    generatedAt: new Date().toISOString(),
  });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

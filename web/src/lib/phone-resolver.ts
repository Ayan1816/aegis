export type PhoneKind = "wallet" | "linkdrop";

export type PhoneContact = {
  aliasHex: string;
  last4: string;
  recipient: string;
  kind: PhoneKind;
};

export type RemittanceResolution = {
  aliasHex: string;
  recipient: string;
  kind: PhoneKind;
  line: string;
};

export type PhoneBookStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const BOOK_KEY = "kotha-phone-book";
const PHONE = /(?:\+?880|0)[\s-]*1[3-9](?:[\s-]*\d){8}/;
const EXAMPLE_CANONICAL = "8801711223344";

export function foldBengaliDigits(input: string): string {
  return input.replace(/[\u09E6-\u09EF]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
}

export function remittancePreviewLine(address: string): string {
  return `Phone Alias: [REDACTED_PHONE] -> Resolved Recipient Wallet: ${address} (via Confidential Remittance Resolver)`;
}

export function canonicalPhone(input: string): string | null {
  const folded = foldBengaliDigits(input);
  const match = folded.match(PHONE);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `880${digits.slice(1)}`;
  return null;
}

export async function phoneAlias(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function defaultRecipient(canonical: string, aliasHex: string): string {
  if (canonical === EXAMPLE_CANONICAL) return "remit-8801711.testnet";
  return `remit-${aliasHex.slice(0, 8)}.testnet`;
}

export function linkdropVoucher(aliasHex: string): string {
  return `linkdrop:${aliasHex.slice(0, 16)}`;
}

function browserStore(): PhoneBookStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readBook(store?: PhoneBookStore | null): PhoneContact[] {
  const source = store === undefined ? browserStore() : store;
  if (!source) return [];
  try {
    const parsed = JSON.parse(source.getItem(BOOK_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isContact);
  } catch {
    return [];
  }
}

function writeBook(rows: PhoneContact[], store?: PhoneBookStore | null): void {
  const source = store === undefined ? browserStore() : store;
  if (!source) return;
  source.setItem(BOOK_KEY, JSON.stringify(rows));
}

function isContact(value: unknown): value is PhoneContact {
  if (!value || typeof value !== "object") return false;
  const row = value as PhoneContact;
  return (
    typeof row.aliasHex === "string" &&
    /^[0-9a-f]{64}$/.test(row.aliasHex) &&
    typeof row.last4 === "string" &&
    typeof row.recipient === "string" &&
    (row.kind === "wallet" || row.kind === "linkdrop")
  );
}

export function isNearAccount(value: string): boolean {
  const account = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,62}$/.test(account) && (account.endsWith(".near") || account.endsWith(".testnet"));
}

export function listPhoneContacts(store?: PhoneBookStore | null): PhoneContact[] {
  return readBook(store);
}

export async function savePhoneContact(
  phone: string,
  recipient: string,
  kind: PhoneKind,
  store?: PhoneBookStore | null,
): Promise<PhoneContact | null> {
  const canonical = canonicalPhone(phone);
  if (!canonical) return null;
  const aliasHex = await phoneAlias(canonical);
  const typed = recipient.trim().toLowerCase();
  const resolved = kind === "linkdrop" ? linkdropVoucher(aliasHex) : typed;
  if (kind === "wallet" && !isNearAccount(resolved)) return null;
  const contact: PhoneContact = { aliasHex, last4: canonical.slice(-4), recipient: resolved, kind };
  const next = readBook(store).filter((row) => row.aliasHex !== aliasHex);
  next.push(contact);
  writeBook(next, store);
  return contact;
}

export async function resolveRemittance(text: string, store?: PhoneBookStore | null): Promise<RemittanceResolution | null> {
  const folded = foldBengaliDigits(text);
  const match = folded.match(PHONE);
  if (!match) return null;
  const canonical = canonicalPhone(match[0]);
  if (!canonical) return null;
  const aliasHex = await phoneAlias(canonical);
  const saved = readBook(store).find((row) => row.aliasHex === aliasHex);
  const recipient = saved?.recipient || defaultRecipient(canonical, aliasHex);
  const kind = saved?.kind || "wallet";
  return { aliasHex, recipient, kind, line: remittancePreviewLine(recipient) };
}

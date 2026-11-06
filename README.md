# AEGIS // Verifiable Confidential DeFi & Cross-Chain Intent Copilot on NEAR

AEGIS is a private DeFi copilot. An owner sets a budget firewall, a TEE-attested model drafts an intent, NEAR Intents previews it, and the Rust vault stores the cryptographic receipt.

## Three NEAR tracks

| Track | Where it lives | What it does |
| --- | --- | --- |
| NEAR Rust smart contract | `contract/` crate `aegis_vault` | On-chain audit vault. `record_execution`, `get_execution`, `list_executions`, and `get_vault_info` store TEE-signed actions (`swap`, `transfer`, `withdraw`, `shield`, `unshield`). Default account: `aegis-vault-v1.testnet`. |
| NEAR AI Cloud private TEE | `web/src/lib/near-ai-tee.ts` | Intel TDX + NVIDIA H100 chat on `https://cloud-api.near.ai/v1`. Models include `deepseek/deepseek-v3.2`, `deepseek/deepseek-v4.1-flash`, `Qwen/Qwen3.8-27B`, and `z-ai/glm-5.3`. `openai/privacy-filter` redacts PII before the prompt leaves the enclave. Each reply carries `request_sha256`, `response_sha256`, an ECDSA signature, and an attestation quote. |
| NEAR Intents Agent Connect | `web/src/lib/intents-agent.ts` | Agent `agent-aegis-prime.near` on public `intents.near` and confidential `intents.far`. Session grants (`ngt_…`) enforce daily USD budget, per-transaction cap, allowed actions, and the emergency freeze. Dry-run (`dry: true`) quotes a route before `X-Grant-Token` execution. |

The command deck in `web/` ties the three together: policy and grant firewall, private copilot, dry-run quote, and the on-chain audit stream.

## Quickstart

### Contract

```bash
cd contract
cargo test
cargo near build non-reproducible-wasm
```

Deploy to a fresh testnet account (builds, deploys, calls `init`, writes `web/.env.local`):

```bash
bash scripts/deploy-contract.sh
```

Requires Rust, `cargo-near`, and `near-cli-rs`. `contract/target/` is gitignored.

### Web

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. Optional keys in `web/.env.local` (never commit this file):

```bash
NEXT_PUBLIC_NEAR_CONTRACT_ID=aegis-vault-v1.testnet
NEAR_AI_CLOUD_API_KEY=
NEAR_AI_MODEL=deepseek/deepseek-v3.2
NEAR_INTENTS_AGENT_API_URL=https://api.demo.agentsonintents.com
NEAR_INTENTS_AGENT_API_KEY=
NEAR_INTENTS_GRANT_TOKEN=
```

Without those keys the deck still runs: local enclave signatures, an in-memory intents ledger, and a seeded audit log. Typecheck without a production build:

```bash
cd web && npx tsc --noEmit
```

## CLI verification

Replace `<CONTRACT_ID>` and `<CORRELATION_ID>` with the vault account and a receipt id from the audit stream.

Read one execution:

```bash
near contract call-function as-read-only <CONTRACT_ID> get_execution \
  json-args '{"correlation_id":"<CORRELATION_ID>"}' \
  network-config testnet now
```

Vault metadata `(owner, agent_account, paused, total_executions)`:

```bash
near contract call-function as-read-only <CONTRACT_ID> get_vault_info \
  json-args '{}' \
  network-config testnet now
```

Newest executions first:

```bash
near contract call-function as-read-only <CONTRACT_ID> list_executions \
  json-args '{"from_index":0,"limit":20}' \
  network-config testnet now
```

Record a TEE-signed execution (caller must be the owner or the agent; vault must not be paused). `timestamp_ns` is a raw integer:

```bash
near contract call-function as-transaction <CONTRACT_ID> record_execution \
  json-args '<VerifiedExecution JSON>' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  sign-as <OWNER_ACCOUNT> \
  network-config testnet \
  sign-with-keychain send
```

## Live NEAR Testnet Verification & Architecture

Configured contract ID: `aegis-vault-v1.testnet`

Explorer: https://testnet.nearblocks.io/address/aegis-vault-v1.testnet

The web deck reads `NEXT_PUBLIC_NEAR_CONTRACT_ID` from `web/.env.local` (template in `web/.env.example`). When that variable is unset, `web/src/lib/near-vault-rpc.ts` falls back to `DEFAULT_CONTRACT_ID` (`aegis-vault-v1.testnet`) and calls `https://rpc.testnet.near.org` (`NEAR_RPC_URL` overrides the RPC). If a view call fails, `tryChain` skips the chain for 30 seconds and the command deck keeps serving the local audit log.

Checked against Testnet RPC on 2026-11-06:

- `status` on `https://rpc.testnet.near.org` returned `chain_id=testnet` at block `276424498`.
- `view_account` for `aegis-vault-v1.testnet` returned `UNKNOWN_ACCOUNT`.
- This container has no `contract/target/**/*.wasm`, no `near` CLI, and no `~/.near-credentials/testnet/` key, so the account was not created or deployed here. The id is the deterministic Testnet identifier the app and the commands below use.

Vault metadata `(owner, agent_account, paused, total_executions)`:

```bash
near contract call-function as-read-only aegis-vault-v1.testnet get_vault_info \
  json-args '{}' \
  network-config testnet now
```

Read one execution:

```bash
near contract call-function as-read-only aegis-vault-v1.testnet get_execution \
  json-args '{"correlation_id":"<CORRELATION_ID>"}' \
  network-config testnet now
```

Newest executions first:

```bash
near contract call-function as-read-only aegis-vault-v1.testnet list_executions \
  json-args '{"from_index":0,"limit":20}' \
  network-config testnet now
```

Record a TEE-signed execution (caller must be the owner or the agent; vault must not be paused). `timestamp_ns` is a raw integer:

```bash
near contract call-function as-transaction aegis-vault-v1.testnet record_execution \
  json-args '<VerifiedExecution JSON>' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  sign-as <OWNER_ACCOUNT> \
  network-config testnet \
  sign-with-keychain send
```

The audit card in the UI copies a ready-to-run `get_execution` command for each receipt. A hardware chat can also be checked against NEAR AI Cloud:

```bash
curl -sS "https://cloud-api.near.ai/v1/signature/<CHAT_ID>?model=deepseek%2Fdeepseek-v3.2&signing_algo=ecdsa" \
  -H "Authorization: Bearer $NEAR_AI_CLOUD_API_KEY"
```

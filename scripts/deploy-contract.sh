#!/usr/bin/env bash
# Deploy the AEGIS vault to a fresh NEAR testnet account and record its id.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="${ROOT}/contract"
WEB_DIR="${ROOT}/web"
ENV_FILE="${WEB_DIR}/.env.local"
WASM_PATH="./target/near/aegis_vault.wasm"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is not on PATH. Install Rust, then re-run this script." >&2
  exit 1
fi
if ! command -v near >/dev/null 2>&1; then
  echo "error: near CLI is not on PATH. Install near-cli-rs, then re-run this script." >&2
  exit 1
fi
if ! cargo near --version >/dev/null 2>&1; then
  echo "error: cargo-near is not installed. Run: cargo install cargo-near --locked" >&2
  exit 1
fi

echo "==> Running contract unit tests"
(cd "${CONTRACT_DIR}" && cargo test)

echo "==> Building non-reproducible WASM"
(cd "${CONTRACT_DIR}" && cargo near build non-reproducible-wasm)

if [[ ! -f "${CONTRACT_DIR}/target/near/aegis_vault.wasm" ]]; then
  echo "error: WASM artifact not found at ${CONTRACT_DIR}/target/near/aegis_vault.wasm" >&2
  exit 1
fi

CONTRACT_ID="aegis-$(date +%s).testnet"
echo "==> Creating testnet account ${CONTRACT_ID}"
near account create-account sponsor-by-faucet-service "${CONTRACT_ID}" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

echo "==> Deploying ${WASM_PATH} to ${CONTRACT_ID}"
(
  cd "${CONTRACT_DIR}"
  near contract deploy "${CONTRACT_ID}" use-file "${WASM_PATH}" without-init-call network-config testnet sign-with-legacy-keychain send
)

INIT_ARGS='{"owner": "'"${CONTRACT_ID}"'", "agent_account": "'"${CONTRACT_ID}"'"}'
echo "==> Calling init with ${INIT_ARGS}"
near contract call-function as-transaction "${CONTRACT_ID}" init json-args "${INIT_ARGS}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "${CONTRACT_ID}" network-config testnet sign-with-legacy-keychain send

echo "==> Writing NEXT_PUBLIC_NEAR_CONTRACT_ID to ${ENV_FILE}"
mkdir -p "${WEB_DIR}"
if [[ -f "${ENV_FILE}" ]] && grep -q '^NEXT_PUBLIC_NEAR_CONTRACT_ID=' "${ENV_FILE}"; then
  tmp="$(mktemp)"
  awk -v value="${CONTRACT_ID}" '
    BEGIN { updated = 0 }
    /^NEXT_PUBLIC_NEAR_CONTRACT_ID=/ {
      print "NEXT_PUBLIC_NEAR_CONTRACT_ID=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print "NEXT_PUBLIC_NEAR_CONTRACT_ID=" value
      }
    }
  ' "${ENV_FILE}" > "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
else
  printf 'NEXT_PUBLIC_NEAR_CONTRACT_ID=%s\n' "${CONTRACT_ID}" >> "${ENV_FILE}"
fi

echo "==> Deployed AEGIS vault to ${CONTRACT_ID}"
echo "    NEXT_PUBLIC_NEAR_CONTRACT_ID=${CONTRACT_ID}"

"use client";

import {
  ATTACKS,
  CORE_TEST_CASES,
  GITHUB_REPO,
  JUDGE_TITLE,
  LIVE_CALLS,
  LIVE_CONTRACT_ID,
  LIVE_ORIGIN,
  NEARBLOCKS_ACCOUNT,
  PILLARS,
  SCOPE_ROWS,
  SOURCE_MODULES,
  TEST_FILES,
} from "@/lib/judge-catalog";
import Link from "next/link";
import { useEffect, useState } from "react";

type LiveResult = { status: number; contentType: string; body: string; ms: number; error?: string };

const CLIP = 12000;

export default function DocsPage() {
  const [pillarId, setPillarId] = useState<(typeof PILLARS)[number]["id"]>(PILLARS[0].id);
  const [stageId, setStageId] = useState<string>(PILLARS[0].stages[0].id);
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState<Record<string, LiveResult | "loading">>({});

  useEffect(() => {
    const previous = document.title;
    document.title = "Kotha Docs & Judge Portal";
    return () => {
      document.title = previous;
    };
  }, []);

  const pillar = PILLARS.find((item) => item.id === pillarId) ?? PILLARS[0];
  const stage = pillar.stages.find((item) => item.id === stageId) ?? pillar.stages[0];

  async function copyUrl(path: string) {
    const response = await fetch(path);
    const text = await response.text();
    await navigator.clipboard.writeText(text);
    setNotice(`Copied ${path}`);
  }

  async function downloadUrl(path: string, filename: string, type: string) {
    const response = await fetch(path);
    const text = await response.text();
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${filename}`);
  }

  async function copyCurl(curl: string) {
    await navigator.clipboard.writeText(curl);
    setNotice("Copied curl");
  }

  async function runLive(call: (typeof LIVE_CALLS)[number]) {
    setResults((current) => ({ ...current, [call.id]: "loading" }));
    const started = performance.now();
    try {
      const response = await fetch(call.path, call.form
        ? { method: "POST", body: new FormData() }
        : call.body
          ? { method: "POST", headers: { "content-type": "application/json" }, body: call.body }
          : undefined);
      const text = await response.text();
      const clipped = text.length > CLIP ? `${text.slice(0, CLIP)}\n… truncated ${text.length - CLIP} characters` : text;
      setResults((current) => ({
        ...current,
        [call.id]: {
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          body: clipped,
          ms: Math.round(performance.now() - started),
        },
      }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [call.id]: {
          status: 0,
          contentType: "",
          body: "",
          ms: Math.round(performance.now() - started),
          error: error instanceof Error ? error.message : "Request failed.",
        },
      }));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 text-[#e8fff6]">
      <header className="flex flex-col gap-3">
        <Link href="/" className="w-fit text-sm text-[#00EC97] underline-offset-4 hover:underline">
          Back to Kotha
        </Link>
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#00EC97]">Docs & Judge Portal</p>
        <h1 className="text-2xl font-semibold leading-snug text-white">{JUDGE_TITLE}</h1>
        <p className="max-w-3xl text-sm leading-6 text-white/70">
          Contract <span className="break-all font-mono text-[#d9ffe8]">{LIVE_CONTRACT_ID}</span>. Live app{" "}
          <a className="text-[#00EC97] underline-offset-4 hover:underline" href={LIVE_ORIGIN}>{LIVE_ORIGIN}</a>
          {" · "}
          <a className="text-[#00EC97] underline-offset-4 hover:underline" href={GITHUB_REPO}>GitHub</a>
          {" · "}
          <a className="break-all text-[#00EC97] underline-offset-4 hover:underline" href={NEARBLOCKS_ACCOUNT}>NearBlocks</a>
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <a className={ghost} href="/llms.txt" target="_blank" rel="noreferrer">View /llms.txt</a>
          <button type="button" className={ghost} onClick={() => void copyUrl("/llms.txt")}>Copy /llms.txt</button>
          <button type="button" className={ghost} onClick={() => void downloadUrl("/llms.txt", "llms.txt", "text/plain")}>Download /llms.txt</button>
          <a className={ghost} href="/openapi.json" target="_blank" rel="noreferrer">View /openapi.json</a>
          <button type="button" className={ghost} onClick={() => void copyUrl("/openapi.json")}>Copy /openapi.json</button>
          <button type="button" className={ghost} onClick={() => void downloadUrl("/openapi.json", "openapi.json", "application/json")}>Download /openapi.json</button>
          <a className={solid} href="/api/receipts/export-statement" target="_blank" rel="noreferrer">Printable Audit Statement (PDF)</a>
        </div>
        {notice ? <p className="text-xs text-[#00EC97]">{notice}</p> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">Architecture Overview & 3 Cryptographic Pillars</h2>
        <div className="flex flex-wrap gap-2">
          {PILLARS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPillarId(item.id);
                setStageId(item.stages[0].id);
              }}
              className={item.id === pillar.id ? solid : ghost}
            >
              {item.index}. {item.name}
            </button>
          ))}
        </div>
        <p className="text-sm leading-6 text-white/75">{pillar.summary}</p>
        <div className="flex flex-wrap gap-2">
          {pillar.stages.map((item) => (
            <button key={item.id} type="button" onClick={() => setStageId(item.id)} className={item.id === stage.id ? solid : ghost}>
              {item.title}
            </button>
          ))}
        </div>
        <article className="rounded-2xl border border-[#00EC97]/30 bg-black/30 p-4">
          <h3 className="text-base font-semibold text-white">{stage.title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/80">{stage.body}</p>
        </article>
        <ul className="grid gap-2 text-sm text-white/70">
          {SOURCE_MODULES.map((mod) => (
            <li key={mod.path}>
              <code className="text-[#d9ffe8]">{mod.path}</code> — {mod.role}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">
          Honest Scope & Limitations (What is 100% Live Network Execution vs Testnet / Dry-Run Boundary)
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-white/5 text-white">
              <tr>
                <th className="p-3 font-medium">Surface</th>
                <th className="p-3 font-medium">100% live network execution</th>
                <th className="p-3 font-medium">Testnet / dry-run boundary</th>
              </tr>
            </thead>
            <tbody>
              {SCOPE_ROWS.map((row) => (
                <tr key={row.surface} className="border-t border-white/10 align-top text-white/75">
                  <td className="p-3 font-medium text-white">{row.surface}</td>
                  <td className="p-3">{row.live}</td>
                  <td className="p-3">{row.boundary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Interactive Endpoint Explorer (LIVE)</h2>
        <p className="text-sm leading-6 text-white/70">
          Nothing runs until you press Test Live / Run Live Request. The button calls this origin. The curl samples target {LIVE_ORIGIN}. Responses are clipped at {CLIP} characters. Execute-without-a-proof stops at 401 and does not broadcast.
        </p>
        {LIVE_CALLS.map((call) => {
          const result = results[call.id];
          return (
            <article key={call.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#00EC97]/15 px-2 py-0.5 font-mono text-[11px] text-[#00EC97]">{call.method}</span>
                <code className="break-all text-sm text-white">{call.path}</code>
              </div>
              <h3 className="mt-2 text-base font-semibold text-white">{call.title}</h3>
              <p className="mt-1 text-sm leading-6 text-white/70">{call.detail}</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/50 p-3 font-mono text-[11px] text-[#d9ffe8]">{call.curl}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={solid} onClick={() => void runLive(call)} disabled={result === "loading"}>
                  Test Live / Run Live Request
                </button>
                <button type="button" className={ghost} onClick={() => void copyCurl(call.curl)}>Copy curl</button>
              </div>
              {result === "loading" ? <p className="mt-3 text-sm text-white/60">Running…</p> : null}
              {result && result !== "loading" ? (
                <div className="mt-3">
                  <p className="text-xs text-white/60">
                    HTTP {result.status || "network error"} · {result.contentType || "no content-type"} · {result.ms} ms
                    {result.error ? ` · ${result.error}` : ""}
                  </p>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/50 p-3 font-mono text-[11px] text-white/85">{result.body || result.error || ""}</pre>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">Adversarial Stress & Attack Rejection Suite</h2>
        <p className="text-sm text-white/70">
          {CORE_TEST_CASES} core node:test cases, plus judge-portal response checks for /llms.txt, /openapi.json, and the audit statement.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="p-3 font-medium">Test file</th>
                <th className="p-3 font-medium">Cases</th>
                <th className="p-3 font-medium">Covers</th>
              </tr>
            </thead>
            <tbody>
              {TEST_FILES.map((file) => (
                <tr key={file.file} className="border-t border-white/10 align-top text-white/75">
                  <td className="p-3 font-mono text-[12px] text-[#d9ffe8]">{file.file}</td>
                  <td className="p-3">{file.cases}</td>
                  <td className="p-3">{file.covers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="p-3 font-medium">Attack vector</th>
                <th className="p-3 font-medium">Rejection</th>
                <th className="p-3 font-medium">Where it is tested</th>
              </tr>
            </thead>
            <tbody>
              {ATTACKS.map((attack) => (
                <tr key={attack.vector} className="border-t border-white/10 align-top text-white/75">
                  <td className="p-3 font-medium text-white">{attack.vector}</td>
                  <td className="p-3">{attack.rejection}</td>
                  <td className="p-3">{attack.tests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const ghost = "rounded-full border border-white/15 px-3 py-1.5 text-left text-[12px] text-white/80";
const solid = "rounded-full border border-[#00EC97]/50 bg-[#00EC97] px-3 py-1.5 text-left text-[12px] font-semibold text-[#04140c] disabled:opacity-60";

"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

const EMERALD = "#00EC97";
const CYAN = "#00D2FF";
const VIOLET = "#7B61FF";
const CRIMSON = "#FF3B5C";
const AMBER = "#FF8A00";

export function AuroraEnclaveBackground({ frozen, thinking }: { frozen: boolean; thinking: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const [pointer, setPointer] = useState({ x: 520, y: 220 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const primary = frozen ? CRIMSON : EMERALD;
  const secondary = frozen ? AMBER : CYAN;
  const tertiary = frozen ? CRIMSON : VIOLET;
  const duration = reduce ? 0 : frozen ? 3.4 : thinking ? 5.2 : 16;
  const glow = frozen ? "rgba(255,59,92,0.22)" : thinking ? "rgba(0,236,151,0.28)" : "rgba(0,236,151,0.14)";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#05070B]" aria-hidden="true">
      <div className="absolute inset-0 bg-[#05070B]" />
      <AuroraBlob
        color={primary}
        className={cn("left-[-8%] top-[-12%] h-[46vh] w-[46vh]", thinking && !frozen ? "opacity-90" : "opacity-60")}
        duration={duration}
        drift={28}
        reduce={reduce}
        pulse={frozen || thinking}
      />
      <AuroraBlob
        color={secondary}
        className="right-[-10%] top-[8%] h-[40vh] w-[40vh] opacity-50"
        duration={duration ? duration * 1.25 : 0}
        drift={-36}
        reduce={reduce}
        pulse={frozen}
      />
      <AuroraBlob
        color={tertiary}
        className="bottom-[-18%] left-[28%] h-[48vh] w-[48vh] opacity-45"
        duration={duration ? duration * 1.45 : 0}
        drift={22}
        reduce={reduce}
        pulse={frozen || thinking}
      />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ background: `radial-gradient(640px circle at ${pointer.x}px ${pointer.y}px, ${glow}, transparent 58%)` }}
      />
      <div className="aegis-vignette absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#05070B_78%)]" />
    </div>
  );
}

function AuroraBlob({
  color,
  className,
  duration,
  drift,
  reduce,
  pulse,
}: {
  color: string;
  className: string;
  duration: number;
  drift: number;
  reduce: boolean;
  pulse: boolean;
}) {
  return (
    <motion.div
      className={cn("absolute rounded-full blur-3xl mix-blend-screen", className)}
      style={{ background: `radial-gradient(circle, ${color} 0%, transparent 68%)` }}
      animate={
        reduce
          ? { x: 0, y: 0, scale: 1 }
          : {
              x: [0, drift, drift * -0.6, 0],
              y: [0, drift * -0.8, drift * 0.45, 0],
              scale: pulse ? [1, 1.14, 0.96, 1] : [1, 1.05, 1],
            }
      }
      transition={reduce ? { duration: 0 } : { duration: Math.max(duration, 0.8), repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

export function SpotlightGlassCard({
  children,
  className,
  alert = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  alert?: boolean;
  id?: string;
}) {
  const [spot, setSpot] = useState({ x: 80, y: 36, on: false });
  const rim = alert ? "rgba(255,59,92,0.85)" : "rgba(0,236,151,0.75)";
  const wash = alert ? "rgba(255,59,92,0.16)" : "rgba(0,236,151,0.14)";

  return (
    <div
      id={id}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setSpot({ x: event.clientX - rect.left, y: event.clientY - rect.top, on: true });
      }}
      onMouseLeave={() => setSpot((current) => ({ ...current, on: false }))}
      className={cn(
        "spotlight-shell group relative overflow-hidden rounded-2xl p-px shadow-[0_0_50px_rgba(0,236,151,0.06)]",
        alert && "shadow-[0_0_50px_rgba(255,59,92,0.16)]",
        className,
      )}
      style={{
        background: spot.on
          ? `radial-gradient(420px circle at ${spot.x}px ${spot.y}px, ${rim}, rgba(255,255,255,0.08) 42%)`
          : "rgba(255,255,255,0.08)",
      }}
    >
      <div className="relative h-full rounded-[15px] border border-emerald-500/20 bg-white/[0.03] backdrop-blur-xl">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-300",
            spot.on ? "opacity-100" : "opacity-0",
          )}
          style={{ background: `radial-gradient(320px circle at ${spot.x}px ${spot.y}px, ${wash}, transparent 46%)` }}
        />
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}

type ShimmerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "danger" | "ghost";
};

export function ShimmerActionButton({
  children,
  loading = false,
  variant = "primary",
  className,
  disabled,
  type = "button",
  ...props
}: ShimmerProps) {
  const blocked = Boolean(disabled || loading);
  const metal =
    variant === "danger"
      ? "bg-[linear-gradient(180deg,#3a1018_0%,#1a0a0e_100%)] text-[#ffd0d8] shadow-[0_10px_30px_rgba(255,59,92,0.22)]"
      : variant === "ghost"
        ? "bg-white/[0.03] text-white/85 shadow-none"
        : "bg-[linear-gradient(180deg,#0c3b2c_0%,#07140f_100%)] text-[#d9ffe8] shadow-[0_10px_30px_rgba(0,236,151,0.18)]";
  const sweep =
    variant === "danger"
      ? "via-[#ff8a9a]/70"
      : variant === "ghost"
        ? "via-white/40"
        : "via-white/70";

  return (
    <button
      type={type}
      disabled={blocked}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border px-4 py-2.5 text-left text-[13px] font-semibold tracking-wide transition duration-200",
        metal,
        variant === "danger" ? "border-[#FF3B5C]/50" : "border-[#00EC97]/35",
        blocked
          ? "cursor-not-allowed opacity-45 saturate-50"
          : "hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0",
        className,
      )}
      {...props}
    >
      {blocked ? null : (
        <span
          className={cn(
            "aegis-shimmer pointer-events-none absolute inset-y-[-40%] left-0 w-1/2 bg-gradient-to-r from-transparent to-transparent",
            sweep,
          )}
        />
      )}
      {loading ? <span className="aegis-spin h-4 w-4 shrink-0 rounded-full border-2 border-white/25 border-t-white" /> : null}
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </button>
  );
}

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function AnimatedNumberTicker({
  value,
  format = "number",
  maximumFractionDigits = 2,
  minimumFractionDigits = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  format?: "number" | "usd" | "percent";
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(Number.isFinite(value) ? value : 0);
  const shownRef = useRef(shown);

  useEffect(() => {
    const from = shownRef.current;
    const to = Number.isFinite(value) ? value : 0;
    if (Math.abs(to - from) < 0.0000001) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 680);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (to - from) * eased;
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const factor = 10 ** Math.max(0, maximumFractionDigits);
  const rounded = Math.round(shown * factor) / factor;
  const text =
    format === "usd"
      ? usdFormat.format(rounded)
      : format === "percent"
        ? `${rounded.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits })}%`
        : `${prefix}${rounded.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits })}${suffix}`;

  return <span className={cn("font-mono tabular-nums tracking-tight", className)}>{text}</span>;
}

export function EnclaveSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={hint}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full border transition",
        checked ? "border-[#00EC97]/50 bg-[#00EC97]/25" : "border-white/15 bg-white/5",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full transition-all",
          checked ? "left-6 bg-[#00EC97] shadow-[0_0_12px_#00EC97]" : "left-0.5 bg-white/70",
        )}
      />
    </button>
  );
}

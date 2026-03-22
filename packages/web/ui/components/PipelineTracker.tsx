/**
 * PipelineTracker — vertical step indicator for the 10-step Mnemo protocol.
 * Sits in the left column (~300px) and tells the story of the negotiation.
 */

import { useState, useCallback } from "react"

export interface PipelineStep {
  step: number
  name: string
  status: "pending" | "running" | "done" | "error"
  detail?: Record<string, string>
}

interface Props {
  steps: PipelineStep[]
}

/** Returns true if the value looks like a hex hash or address. */
function isHashOrAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,}$/.test(value)
}

/** Truncate hash to first 10 + last 8 characters for display. */
function truncateHash(hash: string): string {
  if (hash.length <= 22) return hash
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

/** Copyable monospace value — click to copy, shows brief "Copied" feedback. */
function CopyableHash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])

  return (
    <button
      onClick={handleCopy}
      title={`Click to copy: ${value}`}
      className="text-[10px] text-zinc-400 font-mono break-all text-left cursor-pointer hover:text-zinc-200 transition-colors relative group"
    >
      {truncateHash(value)}
      <span
        className={`
          absolute -top-5 left-0 text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-emerald-400
          pointer-events-none transition-opacity duration-200
          ${copied ? "opacity-100" : "opacity-0"}
        `}
      >
        Copied
      </span>
    </button>
  )
}

function StatusIcon({ status }: { status: PipelineStep["status"] }) {
  switch (status) {
    case "done":
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-400/15 text-emerald-400 text-xs font-bold flex-shrink-0 glow-green">
          &#10003;
        </span>
      )
    case "running":
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-amber-400 flex-shrink-0 animate-spin-slow glow-amber">
          <span className="block w-1.5 h-1.5 bg-amber-400 rounded-full" />
        </span>
      )
    case "error":
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-400/15 text-red-400 text-xs font-bold flex-shrink-0 glow-red">
          &#10005;
        </span>
      )
    default:
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 flex-shrink-0">
          <span className="block w-1.5 h-1.5 bg-zinc-600 rounded-full" />
        </span>
      )
  }
}

function StepNumber({ step, status }: { step: number; status: PipelineStep["status"] }) {
  const colorMap: Record<string, string> = {
    done: "text-emerald-400 bg-emerald-400/10",
    running: "text-amber-400 bg-amber-400/10",
    error: "text-red-400 bg-red-400/10",
    pending: "text-zinc-600 bg-zinc-800/50",
  }
  const color = colorMap[status] ?? colorMap.pending
  return (
    <span className={`text-[10px] font-mono font-bold w-4 text-center ${color} rounded px-0.5`}>
      {step}
    </span>
  )
}

function StepRow({ step }: { step: PipelineStep }) {
  const isActive = step.status === "running"
  const isDone = step.status === "done"
  const isError = step.status === "error"

  return (
    <div
      className={`
        flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
        ${isActive
          ? "bg-amber-400/5 border-l-2 border-l-amber-400 border border-amber-400/10 shadow-sm shadow-amber-400/5"
          : isDone
            ? "bg-zinc-900/40 border-l-2 border-l-emerald-400/40 border border-transparent hover:bg-zinc-800/40"
            : isError
              ? "bg-red-400/5 border-l-2 border-l-red-400 border border-red-400/10"
              : "border-l-2 border-l-zinc-800 border border-transparent hover:bg-zinc-800/30"
        }
      `}
    >
      <StatusIcon status={step.status} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StepNumber step={step.step} status={step.status} />
          <span
            className={`text-xs ${
              isDone
                ? "text-zinc-300"
                : isActive
                  ? "text-zinc-100 font-medium"
                  : isError
                    ? "text-red-300"
                    : "text-zinc-500"
            }`}
          >
            {step.name}
          </span>
        </div>

        {/* Detail key-value pairs */}
        {step.detail && Object.keys(step.detail).length > 0 && (
          <div className="mt-2 space-y-1 pl-6">
            {Object.entries(step.detail).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-zinc-600 font-mono">{key}:</span>
                {isHashOrAddress(value) ? (
                  <CopyableHash value={value} />
                ) : (
                  <span className="text-[10px] text-zinc-400 font-mono break-all">
                    {value}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PipelineTracker({ steps }: Props) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-4">
      <h3 className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest mb-4 px-3 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 bg-emerald-400/60 rounded-full" />
        Pipeline
      </h3>
      <div className="space-y-1">
        {steps.map((step) => (
          <StepRow key={step.step} step={step} />
        ))}
      </div>
    </div>
  )
}

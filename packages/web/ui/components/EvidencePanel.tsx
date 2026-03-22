/**
 * EvidencePanel — displays forge verification output, escrow status, and IPFS archival.
 */

import { useState, useCallback } from "react"

interface VerificationData {
  status: "running" | "passed" | "failed" | "error"
  verdict?: string
  evidence?: string
  executionTimeMs?: number
}

interface EscrowData {
  escrowId: string
  status: string
  txHash?: string
}

interface IpfsData {
  cid: string
  url: string
}

interface Props {
  evidence?: string
  verification?: VerificationData | null
  escrow?: EscrowData | null
  ipfs?: IpfsData | null
}

const verdictConfig: Record<string, { label: string; color: string; badge: string }> = {
  VALID_BUG: { label: "Valid Bug", color: "text-emerald-400", badge: "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20" },
  INVALID: { label: "Invalid", color: "text-red-400", badge: "bg-red-400/10 text-red-400 ring-1 ring-red-400/20" },
  TEST_ARTIFACT: { label: "Test Artifact", color: "text-amber-400", badge: "bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20" },
  BUILD_FAILURE: { label: "Build Failure", color: "text-red-400", badge: "bg-red-400/10 text-red-400 ring-1 ring-red-400/20" },
}

const escrowStatusConfig: Record<string, { color: string; badge: string }> = {
  Created: { color: "text-zinc-400", badge: "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700" },
  Funded: { color: "text-amber-400", badge: "bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20" },
  Released: { color: "text-emerald-400", badge: "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20" },
  Refunded: { color: "text-red-400", badge: "bg-red-400/10 text-red-400 ring-1 ring-red-400/20" },
  Expired: { color: "text-zinc-600", badge: "bg-zinc-800 text-zinc-600 ring-1 ring-zinc-700" },
}

/** Copyable monospace value with click-to-copy and visual feedback. */
function CopyableValue({ value, className = "" }: { value: string; className?: string }) {
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
      className={`font-mono text-left cursor-pointer hover:text-zinc-200 transition-colors relative group ${className}`}
    >
      <span className="break-all">{value}</span>
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

export function EvidencePanel({ evidence, verification, escrow, ipfs }: Props) {
  const hasContent = evidence || verification || escrow || ipfs
  if (!hasContent) return null

  return (
    <div className="space-y-4">
      {/* Forge Verification */}
      {verification && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400/60" />
              Forge Verification
            </h3>
            {verification.status !== "running" && verification.verdict && (
              <span className={`text-[10px] font-mono font-medium px-2.5 py-1 rounded-full ${verdictConfig[verification.verdict]?.badge ?? "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700"}`}>
                {verdictConfig[verification.verdict]?.label ?? verification.verdict}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mb-2">
            {verification.status === "running" ? (
              <span className="flex items-center gap-2 text-sm text-amber-400">
                <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse glow-amber" />
                Running forge tests...
              </span>
            ) : (
              <>
                <span className={`text-sm font-mono font-medium ${verdictConfig[verification.verdict ?? ""]?.color ?? "text-zinc-400"}`}>
                  {verification.status === "passed" ? "Tests passed" : verification.status === "failed" ? "Tests failed" : verification.status}
                </span>
                {verification.executionTimeMs != null && (
                  <span className="text-xs text-zinc-600 font-mono">
                    {(verification.executionTimeMs / 1000).toFixed(1)}s
                  </span>
                )}
              </>
            )}
          </div>
          {evidence && (
            <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed mt-3 max-h-48 overflow-y-auto bg-zinc-950/50 rounded-lg p-3 ring-1 ring-zinc-800">
              {evidence}
            </pre>
          )}
        </div>
      )}

      {/* Escrow Status */}
      {escrow && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60" />
              Escrow
            </h3>
            <span className={`text-[10px] font-mono font-medium px-2.5 py-1 rounded-full ${escrowStatusConfig[escrow.status]?.badge ?? "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700"}`}>
              {escrow.status}
            </span>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2">
              <span className="text-xs text-zinc-500 flex-shrink-0 w-8">ID:</span>
              <CopyableValue value={escrow.escrowId} className="text-xs text-zinc-300" />
            </div>
            {escrow.txHash && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-zinc-500 flex-shrink-0 w-8">tx:</span>
                <CopyableValue value={escrow.txHash} className="text-xs text-zinc-400" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* IPFS Archival */}
      {ipfs && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
              Evidence Archive
            </h3>
            <span className="text-[10px] font-mono font-medium px-2.5 py-1 rounded-full bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20">
              Pinned
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs text-zinc-500 flex-shrink-0 w-8">CID:</span>
            <CopyableValue value={ipfs.cid} className="text-xs text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  )
}

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

const verdictConfig: Record<string, { label: string; color: string }> = {
  VALID_BUG: { label: "Valid Bug", color: "text-emerald-400" },
  INVALID: { label: "Invalid", color: "text-red-400" },
  TEST_ARTIFACT: { label: "Test Artifact", color: "text-amber-400" },
  BUILD_FAILURE: { label: "Build Failure", color: "text-red-400" },
}

const escrowStatusColor: Record<string, string> = {
  Created: "text-zinc-400",
  Funded: "text-amber-400",
  Released: "text-emerald-400",
  Refunded: "text-red-400",
  Expired: "text-zinc-600",
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
    <div className="mt-4 space-y-3">
      {/* Forge Verification */}
      {verification && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Forge Verification
          </h3>
          <div className="flex items-center gap-3 mb-2">
            {verification.status === "running" ? (
              <span className="flex items-center gap-2 text-sm text-amber-400">
                <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Running forge tests...
              </span>
            ) : (
              <>
                <span className={`text-sm font-mono font-medium ${verdictConfig[verification.verdict ?? ""]?.color ?? "text-zinc-400"}`}>
                  {verdictConfig[verification.verdict ?? ""]?.label ?? verification.verdict ?? verification.status}
                </span>
                {verification.executionTimeMs != null && (
                  <span className="text-xs text-zinc-600">
                    {(verification.executionTimeMs / 1000).toFixed(1)}s
                  </span>
                )}
              </>
            )}
          </div>
          {evidence && (
            <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed mt-2 max-h-48 overflow-y-auto">
              {evidence}
            </pre>
          )}
        </div>
      )}

      {/* Escrow Status */}
      {escrow && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Escrow
          </h3>
          <div className="space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-xs text-zinc-500 flex-shrink-0">ID:</span>
              <CopyableValue value={escrow.escrowId} className="text-xs text-zinc-300" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Status:</span>
              <span className={`text-xs font-mono font-medium ${escrowStatusColor[escrow.status] ?? "text-zinc-400"}`}>
                {escrow.status}
              </span>
            </div>
            {escrow.txHash && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-zinc-500 flex-shrink-0">tx:</span>
                <CopyableValue value={escrow.txHash} className="text-xs text-zinc-400" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* IPFS Archival */}
      {ipfs && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Evidence Archive
          </h3>
          <div className="flex items-start gap-2">
            <span className="text-xs text-zinc-500 flex-shrink-0">CID:</span>
            <CopyableValue value={ipfs.cid} className="text-xs text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  )
}

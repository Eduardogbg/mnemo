/**
 * EvidencePanel — displays forge verification output, escrow status, and IPFS archival.
 */

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
                Running forge tests…
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">ID:</span>
              <span className="text-xs font-mono text-zinc-300">{escrow.escrowId}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Status:</span>
              <span className={`text-xs font-mono font-medium ${escrowStatusColor[escrow.status] ?? "text-zinc-400"}`}>
                {escrow.status}
              </span>
            </div>
          </div>
          {escrow.txHash && (
            <div className="mt-1">
              <span className="text-xs text-zinc-600 font-mono">
                tx: {escrow.txHash.slice(0, 18)}…
              </span>
            </div>
          )}
        </div>
      )}

      {/* IPFS Archival */}
      {ipfs && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
            Evidence Archive
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">CID:</span>
            <span className="text-xs font-mono text-emerald-400">
              {ipfs.cid.slice(0, 24)}…
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

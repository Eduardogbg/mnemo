/**
 * EvidencePanel — displays forge verification output / invariant results.
 * Placeholder for now — will be populated when forge pipeline is integrated.
 */

interface Props {
  evidence?: string
}

export function EvidencePanel({ evidence }: Props) {
  if (!evidence) return null

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
        Verification Evidence
      </h3>
      <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
        {evidence}
      </pre>
    </div>
  )
}

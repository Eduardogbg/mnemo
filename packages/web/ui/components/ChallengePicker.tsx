import { useQuery } from "@tanstack/react-query"

interface Challenge {
  id: string
  name: string
  description: string
  difficulty: string
}

interface Props {
  onSelect: (challengeId: string, challengeName: string) => void
}

const difficultyColor: Record<string, string> = {
  trivial: "text-emerald-400 bg-emerald-400/10 ring-1 ring-emerald-400/20",
  low: "text-emerald-400 bg-emerald-400/10 ring-1 ring-emerald-400/20",
  moderate: "text-amber-400 bg-amber-400/10 ring-1 ring-amber-400/20",
  hard: "text-red-400 bg-red-400/10 ring-1 ring-red-400/20",
}

async function fetchChallenges(): Promise<Challenge[]> {
  const res = await fetch("/api/challenges")
  if (!res.ok) throw new Error(`Failed to fetch challenges: ${res.status}`)
  const data = (await res.json()) as { challenges: Challenge[] }
  return data.challenges
}

export function ChallengePicker({ onSelect }: Props) {
  const { data: challenges, isLoading, isError, error } = useQuery({
    queryKey: ["challenges"],
    queryFn: fetchChallenges,
  })

  if (isLoading) {
    return (
      <div className="text-zinc-500 text-center py-12">Loading challenges...</div>
    )
  }

  if (isError) {
    return (
      <div className="text-red-400 text-center py-12 text-sm font-mono">
        Failed to load challenges: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-medium text-zinc-200">Choose a challenge</h2>
        <p className="text-sm text-zinc-500 mt-1">Select a smart contract to audit and negotiate.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {(challenges ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id, c.name)}
            className="group text-left p-5 rounded-xl bg-zinc-900/80 border border-zinc-800 shadow-lg shadow-black/20
                       hover:border-emerald-400/40 hover:shadow-xl hover:shadow-emerald-400/5
                       hover:translate-y-[-2px] transition-all duration-200
                       ring-1 ring-zinc-800 hover:ring-emerald-400/30"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-sm font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors">
                {c.name}
              </span>
              <span className={`text-[10px] font-mono rounded-full px-2.5 py-0.5 ${difficultyColor[c.difficulty] ?? "text-zinc-400 bg-zinc-800 ring-1 ring-zinc-700"}`}>
                {c.difficulty}
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
              {c.description}
            </p>
            <div className="mt-4 flex items-center gap-1 text-[10px] text-zinc-600 group-hover:text-emerald-400/60 transition-colors font-mono">
              <span>Start audit</span>
              <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

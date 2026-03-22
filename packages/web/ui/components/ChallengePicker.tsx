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
  trivial: "text-emerald-400 border-emerald-400/30",
  low: "text-emerald-400 border-emerald-400/30",
  moderate: "text-amber-400 border-amber-400/30",
  hard: "text-red-400 border-red-400/30",
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
      <h2 className="text-lg font-medium text-zinc-200 mb-4">Choose a challenge</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(challenges ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id, c.name)}
            className="group text-left p-4 rounded-lg border border-zinc-800 bg-zinc-900/50
                       hover:border-emerald-400/40 hover:bg-zinc-900 transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-sm font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors">
                {c.name}
              </span>
              <span className={`text-xs border rounded px-1.5 py-0.5 ${difficultyColor[c.difficulty] ?? "text-zinc-400 border-zinc-700"}`}>
                {c.difficulty}
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
              {c.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

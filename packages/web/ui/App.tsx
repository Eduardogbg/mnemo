import { useState, useCallback } from "react"
import { ChallengePicker } from "./components/ChallengePicker"
import { Transcript } from "./components/Transcript"
import { OutcomeDisplay } from "./components/OutcomeDisplay"

export interface Turn {
  turnNumber: number
  agentId: string
  message: string
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
}

export interface Outcome {
  outcome: "ACCEPTED" | "REJECTED" | "EXHAUSTED"
  totalTurns: number
  assignedSeverity?: string
  agreedSeverity?: string
}

type AppState =
  | { phase: "pick" }
  | { phase: "running"; roomId: string; turns: Turn[]; challengeName: string }
  | { phase: "done"; roomId: string; turns: Turn[]; outcome: Outcome; challengeName: string }

export function App() {
  const [state, setState] = useState<AppState>({ phase: "pick" })

  const handleStart = useCallback(async (challengeId: string, challengeName: string) => {
    // Create room via REST
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId }),
    })
    if (!res.ok) {
      alert(`Failed to create room: ${await res.text()}`)
      return
    }
    const { roomId } = (await res.json()) as { roomId: string }

    setState({ phase: "running", roomId, turns: [], challengeName })

    // Connect WebSocket for real-time turns
    const wsUrl = `ws://${window.location.host}/ws/${roomId}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as
        | { type: "turn"; data: Turn }
        | { type: "outcome"; data: Outcome }

      if (msg.type === "turn") {
        setState((prev) => {
          if (prev.phase !== "running") return prev
          return { ...prev, turns: [...prev.turns, msg.data] }
        })
      } else if (msg.type === "outcome") {
        setState((prev) => {
          const turns = prev.phase === "running" ? prev.turns : []
          return {
            phase: "done",
            roomId,
            turns,
            outcome: msg.data,
            challengeName: prev.phase === "pick" ? challengeName : (prev as any).challengeName,
          }
        })
      }
    }

    ws.onerror = () => {
      // Fall back to polling if WS fails
      pollRoom(roomId, challengeName)
    }
  }, [])

  const pollRoom = useCallback(async (roomId: string, challengeName: string) => {
    const poll = async () => {
      const res = await fetch(`/api/rooms/${roomId}`)
      if (!res.ok) return
      const data = await res.json()
      const turns = data.turns as Turn[]

      if (data.status === "finished") {
        setState({
          phase: "done",
          roomId,
          turns,
          outcome: {
            outcome: data.outcome,
            totalTurns: turns.length,
            assignedSeverity: data.assignedSeverity,
            agreedSeverity: data.agreedSeverity,
          },
          challengeName,
        })
      } else {
        setState({ phase: "running", roomId, turns, challengeName })
        setTimeout(poll, 1000)
      }
    }
    poll()
  }, [])

  const handleReset = useCallback(() => {
    setState({ phase: "pick" })
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-emerald-400">mnemo</span>
          <span className="text-zinc-500 text-lg ml-2 font-normal">private negotiation demo</span>
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Watch a prover and verifier negotiate a bug disclosure in real-time.
        </p>
      </header>

      {/* Main content */}
      {state.phase === "pick" && (
        <ChallengePicker onSelect={handleStart} />
      )}

      {state.phase === "running" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-zinc-200">
              {state.challengeName}
            </h2>
            <span className="flex items-center gap-2 text-sm text-amber-400">
              <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              Negotiating…
            </span>
          </div>
          <Transcript turns={state.turns} />
        </div>
      )}

      {state.phase === "done" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-zinc-200">
              {state.challengeName}
            </h2>
            <button
              onClick={handleReset}
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ← Back to challenges
            </button>
          </div>
          <Transcript turns={state.turns} />
          <OutcomeDisplay outcome={state.outcome} />
        </div>
      )}
    </div>
  )
}

/**
 * Autonomous agent unit test with mock LanguageModel.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mockModel, InMemoryLayer } from "@mnemo/core"
import { runAutonomous } from "../AutonomousAgent.js"
import { ExecutionLogLive } from "../ExecutionLog.js"

describe("AutonomousAgent", () => {
  test("runs through phases with mock model", async () => {
    let callCount = 0

    const program = runAutonomous({
      id: "test-researcher",
      maxIterations: 5,
      maxCallsPerPhase: 1,
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel(() => {
            callCount++
            return { text: `Phase response ${callCount}. [DONE]` }
          })
        ),
        Effect.provide(InMemoryLayer),
        Effect.provide(ExecutionLogLive),
      )
    )

    expect(result.agentId).toBe("test-researcher")
    expect(result.phases.length).toBeGreaterThan(0)
    expect(result.outcome).toBe("completed")
  })

  test("respects maxIterations budget", async () => {
    let callCount = 0

    const program = runAutonomous({
      id: "budget-test",
      maxIterations: 2,
      maxCallsPerPhase: 3,
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel(() => {
            callCount++
            return {
              text: `Response ${callCount}`,
              toolCalls: [{ name: "analyze_challenge", args: { challengeId: "test" } }],
            }
          })
        ),
        Effect.provide(InMemoryLayer),
        Effect.provide(ExecutionLogLive),
      )
    )

    expect(result.totalIterations).toBeLessThanOrEqual(2)
    expect(result.outcome).toBe("budget_exhausted")
  })
})

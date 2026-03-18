/**
 * HttpApi handler implementations.
 *
 * Wires the MnemoApi endpoints to the RoomManager service.
 */
import { HttpApiBuilder } from "@effect/platform"
import { Effect, Option } from "effect"
import { MnemoApi, NotFound } from "./api.js"
import { RoomManager } from "./RoomManager.js"

export const RoomsApiLive = HttpApiBuilder.group(MnemoApi, "rooms", (handlers) =>
  handlers
    .handle("createRoom", ({ payload }) =>
      Effect.gen(function* () {
        const mgr = yield* RoomManager
        const roomId = yield* mgr.createRoom(payload.challengeId).pipe(
          Effect.mapError((e) => new NotFound({ message: e.message }))
        )
        return { roomId }
      })
    )
    .handle("getRoom", ({ path }) =>
      Effect.gen(function* () {
        const mgr = yield* RoomManager
        const status = mgr.getStatus(path.roomId)
        if (Option.isNone(status)) {
          return yield* Effect.fail(new NotFound({ message: `Room not found: ${path.roomId}` }))
        }
        const s = status.value
        return {
          roomId: path.roomId,
          status: s.status,
          turns: s.turns.map((t) => ({
            turnNumber: t.turnNumber,
            agentId: t.agentId,
            message: t.message,
            toolCalls: t.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
          })),
          outcome: s.result ? Option.some(s.result.outcome) : Option.none(),
          assignedSeverity: s.result?.assignedSeverity ? Option.some(s.result.assignedSeverity) : Option.none(),
          agreedSeverity: s.result?.agreedSeverity ? Option.some(s.result.agreedSeverity) : Option.none(),
        }
      })
    )
    .handle("listChallenges", () =>
      Effect.gen(function* () {
        const mgr = yield* RoomManager
        const challenges = mgr.listChallenges()
        return {
          challenges: challenges.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            difficulty: c.difficulty,
          })),
        }
      })
    )
)

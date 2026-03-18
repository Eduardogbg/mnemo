/**
 * Effect HttpApi definitions for the Mnemo demo server.
 *
 * Defines REST endpoints:
 *   POST /api/rooms         — create a negotiation room
 *   GET  /api/rooms/:roomId — get room status (turns + outcome)
 *   GET  /api/challenges    — list available challenges
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export class CreateRoomBody extends Schema.Class<CreateRoomBody>("CreateRoomBody")({
  challengeId: Schema.String,
}) {}

export class RoomCreated extends Schema.Class<RoomCreated>("RoomCreated")({
  roomId: Schema.String,
}) {}

export class ToolCallSchema extends Schema.Class<ToolCallSchema>("ToolCallSchema")({
  name: Schema.String,
  args: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
}) {}

export class TurnSchema extends Schema.Class<TurnSchema>("TurnSchema")({
  turnNumber: Schema.Number,
  agentId: Schema.String,
  message: Schema.String,
  toolCalls: Schema.Array(ToolCallSchema),
}) {}

export class RoomStatus extends Schema.Class<RoomStatus>("RoomStatus")({
  roomId: Schema.String,
  status: Schema.Literal("running", "finished"),
  turns: Schema.Array(TurnSchema),
  outcome: Schema.optionalWith(Schema.Literal("ACCEPTED", "REJECTED", "EXHAUSTED"), { as: "Option" }),
  assignedSeverity: Schema.optionalWith(Schema.String, { as: "Option" }),
  agreedSeverity: Schema.optionalWith(Schema.String, { as: "Option" }),
}) {}

export class ChallengeInfo extends Schema.Class<ChallengeInfo>("ChallengeInfo")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  difficulty: Schema.String,
}) {}

export class ChallengeList extends Schema.Class<ChallengeList>("ChallengeList")({
  challenges: Schema.Array(ChallengeInfo),
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { status: 404 },
) {}

// ---------------------------------------------------------------------------
// API Group: rooms
// ---------------------------------------------------------------------------

export class RoomsApi extends HttpApiGroup.make("rooms")
  .add(
    HttpApiEndpoint.post("createRoom", "/api/rooms")
      .setPayload(CreateRoomBody)
      .addSuccess(RoomCreated)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get("getRoom", "/api/rooms/:roomId")
      .setPath(Schema.Struct({ roomId: Schema.String }))
      .addSuccess(RoomStatus)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get("listChallenges", "/api/challenges")
      .addSuccess(ChallengeList)
  ) {}

// ---------------------------------------------------------------------------
// Top-level API
// ---------------------------------------------------------------------------

export class MnemoApi extends HttpApi.make("mnemo").add(RoomsApi) {}

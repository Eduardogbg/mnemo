/**
 * Shared tool utilities.
 *
 * Tool definitions now use @effect/ai's Tool.make() / Toolkit.make().
 * This module keeps only validation helpers used by Room.
 */
import { SEVERITIES, type Severity } from "@mnemo/verity"

export const isValidSeverity = (s: unknown): s is Severity =>
  typeof s === "string" && SEVERITIES.includes(s as Severity)

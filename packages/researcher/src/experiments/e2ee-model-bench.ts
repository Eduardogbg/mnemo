/**
 * e2ee-model-bench.ts — Test E2EE models for:
 *   1. Blind vulnerability discovery (no hints beyond contract source)
 *   2. Tool calling (approve_bug / reject_bug in negotiation)
 *
 * Tests: e2ee-qwen3-30b-a3b-p, e2ee-gpt-oss-20b-p, e2ee-glm-5
 *
 * Usage:
 *   set -a && source .env && set +a
 *   bun run src/experiments/e2ee-model-bench.ts
 */
import { Effect } from "effect"
import * as LanguageModel from "@effect/ai/LanguageModel"
import { model, type ChatCompletionsConfig } from "@mnemo/core"

const VENICE_API_KEY = process.env.VENICE_API_KEY
if (!VENICE_API_KEY) {
  console.error("VENICE_API_KEY required")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Models to test
// ---------------------------------------------------------------------------

const MODELS = [
  "e2ee-qwen3-30b-a3b-p",
  "e2ee-gpt-oss-20b-p",
  "e2ee-glm-5",
] as const

// ---------------------------------------------------------------------------
// Contract source
// ---------------------------------------------------------------------------

const CONTRACT_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

interface IFlashLoanEtherReceiver {
    function execute() external payable;
}

contract SideEntranceLenderPool {
    mapping(address => uint256) public balances;

    error RepayFailed();

    event Deposit(address indexed who, uint256 amount);
    event Withdraw(address indexed who, uint256 amount);

    function deposit() external payable {
        unchecked {
            balances[msg.sender] += msg.value;
        }
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];

        delete balances[msg.sender];
        emit Withdraw(msg.sender, amount);

        SafeTransferLib.safeTransferETH(msg.sender, amount);
    }

    function flashLoan(uint256 amount) external {
        uint256 balanceBefore = address(this).balance;

        IFlashLoanEtherReceiver(msg.sender).execute{value: amount}();

        if (address(this).balance < balanceBefore) {
            revert RepayFailed();
        }
    }
}`;

// ---------------------------------------------------------------------------
// Test 1: Blind audit
// ---------------------------------------------------------------------------

const AUDIT_SYSTEM = `You are a smart contract security auditor. You perform thorough audits of Solidity contracts, looking for vulnerabilities, logic errors, and attack vectors. Be specific about:
- The exact vulnerability mechanism
- Which functions are affected
- How an attacker would exploit it step-by-step
- The severity (Critical / High / Medium / Low / Informational)
- Recommended fix

Do not speculate. Only report findings you are confident about based on the code.`

const AUDIT_USER = `Audit the following Solidity contract for security vulnerabilities:

\`\`\`solidity
${CONTRACT_SOURCE}
\`\`\`

Provide a detailed security audit report.`

function scoreAudit(text: string): { score: number; total: number; checks: Record<string, boolean> } {
  const response = text.toLowerCase()
  const checks: Record<string, boolean> = {
    mentionsFlashLoan: /flash\s*loan/i.test(response),
    mentionsDeposit: /deposit/i.test(response),
    mentionsBalanceCheck: /balance/i.test(response),
    mentionsReentrancy: /reentran/i.test(response),
    mentionsDrainOrSteal: /drain|steal|siphon|extract/i.test(response),
    mentionsCallback: /callback|execute|call/i.test(response),
    mentionsDepositDuringFlashLoan:
      /deposit.*flash|flash.*deposit|deposit.*during|during.*callback.*deposit/i.test(response),
    severityCriticalOrHigh: /critical|high/i.test(response),
  }
  const score = Object.values(checks).filter(Boolean).length
  return { score, total: Object.keys(checks).length, checks }
}

// ---------------------------------------------------------------------------
// Test 2: Tool calling
// ---------------------------------------------------------------------------

const TOOL_SYSTEM = `You are a security verification agent. A researcher found a vulnerability and forge tests confirm:
- Exploit test: PASSED (vulnerability exists)
- Patched test: PASSED (fix works)

The researcher says: "The flash loan callback allows deposit() to be called during the loan, creating fake credit. After the loan, the attacker withdraws to drain the pool."

You MUST use the approve_bug tool to approve this finding with severity "critical". Do not just write text — you MUST call the approve_bug tool.`

// For E2EE models, we test tool calling via the provider's native format.
// The chat completions provider serializes tools into OpenAI function format.
const TOOL_DEFS = [
  {
    name: "approve_bug",
    description: "Approve a reported vulnerability with a severity classification.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Severity of the vulnerability",
        },
        reason: {
          type: "string",
          description: "Brief reason for approval",
        },
      },
      required: ["severity", "reason"],
    },
  },
  {
    name: "reject_bug",
    description: "Reject a reported vulnerability.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief reason for rejection",
        },
      },
      required: ["reason"],
    },
  },
]

// ---------------------------------------------------------------------------
// Run bench
// ---------------------------------------------------------------------------

async function benchModel(modelName: string) {
  const config: ChatCompletionsConfig = {
    apiKey: VENICE_API_KEY!,
    baseURL: "https://api.venice.ai/api/v1",
    model: modelName,
    temperature: 0.3,
    maxTokens: 4096,
  }

  const modelLayer = model(config)

  console.log(`\n${"=".repeat(70)}`)
  console.log(`MODEL: ${modelName}`)
  console.log("=".repeat(70))

  // --- Test 1: Blind audit ---
  console.log("\n--- TEST 1: Blind Vulnerability Audit ---")
  const auditStart = Date.now()

  let auditText: string
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* LanguageModel.generateText({
          prompt: [
            { role: "system" as const, content: AUDIT_SYSTEM },
            { role: "user" as const, content: AUDIT_USER },
          ],
        }).pipe(Effect.scoped)
      }).pipe(Effect.provide(modelLayer))
    )
    auditText = result.text
  } catch (err) {
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return { model: modelName, audit: null, toolCall: null }
  }

  const auditLatency = Date.now() - auditStart
  const { score, total, checks } = scoreAudit(auditText)

  console.log(`  Latency: ${auditLatency}ms | Length: ${auditText.length} chars`)
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`  ${passed ? "[PASS]" : "[MISS]"} ${check}`)
  }
  console.log(`  Score: ${score}/${total}`)
  console.log(`  Verdict: ${score >= 6 ? "STRONG FIND" : score >= 4 ? "PARTIAL FIND" : "WEAK/NO FIND"}`)

  console.log(`\n  Response preview:`)
  for (const line of auditText.slice(0, 600).split("\n")) {
    console.log(`    ${line}`)
  }
  if (auditText.length > 600) console.log("    ...")

  // --- Test 2: Tool calling ---
  // Note: E2EE models may not support native tool calling via /chat/completions.
  // This tests whether the provider can handle tool definitions at all.
  console.log("\n--- TEST 2: Tool Calling (approve_bug) ---")
  const toolStart = Date.now()

  let toolText: string
  let toolCalls: Array<{ name: string; params: Record<string, unknown> }> = []
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* LanguageModel.generateText({
          prompt: [
            { role: "system" as const, content: TOOL_SYSTEM },
            { role: "user" as const, content: "Please evaluate and issue your verdict using the approve_bug tool." },
          ],
        }).pipe(Effect.scoped)
      }).pipe(Effect.provide(modelLayer))
    )
    toolText = result.text
    toolCalls = (result.toolCalls as Array<{ name: string; params: unknown }>).map((tc) => ({
      name: tc.name,
      params: tc.params as Record<string, unknown>,
    }))
  } catch (err) {
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return { model: modelName, audit: { score, total, latency: auditLatency }, toolCall: null }
  }

  const toolLatency = Date.now() - toolStart
  const approveCall = toolCalls.find(tc => tc.name === "approve_bug")
  const rejectCall = toolCalls.find(tc => tc.name === "reject_bug")

  console.log(`  Latency: ${toolLatency}ms`)
  console.log(`  Text: "${toolText.slice(0, 200)}"`)
  console.log(`  Tool calls: ${toolCalls.length}`)
  for (const tc of toolCalls) {
    console.log(`    -> ${tc.name}(${JSON.stringify(tc.params)})`)
  }

  if (approveCall) {
    console.log(`  PASS: Called approve_bug with severity="${approveCall.params.severity}"`)
  } else if (rejectCall) {
    console.log(`  PARTIAL: Called reject_bug instead of approve_bug`)
  } else {
    console.log(`  FAIL: No tool calls — model did not use tools`)
  }

  return {
    model: modelName,
    audit: { score, total, latency: auditLatency },
    toolCall: {
      called: approveCall ? "approve_bug" : rejectCall ? "reject_bug" : "none",
      severity: approveCall?.params.severity ?? null,
      latency: toolLatency,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("E2EE Model Benchmark — Blind Audit + Tool Calling")
  console.log(`Testing ${MODELS.length} models against SideEntranceLenderPool`)
  console.log("(contract name is in source — training data risk acknowledged)")

  const results = []
  for (const m of MODELS) {
    const r = await benchModel(m)
    results.push(r)
  }

  // Summary table
  console.log(`\n${"=".repeat(70)}`)
  console.log("SUMMARY")
  console.log("=".repeat(70))
  console.log(
    "Model".padEnd(30) +
    "Audit".padEnd(12) +
    "Latency".padEnd(10) +
    "Tool Call".padEnd(15) +
    "Severity"
  )
  console.log("-".repeat(75))
  for (const r of results) {
    const audit = r.audit ? `${r.audit.score}/${r.audit.total}` : "FAIL"
    const latency = r.audit ? `${r.audit.latency}ms` : "-"
    const tool = r.toolCall?.called ?? "FAIL"
    const sev = r.toolCall?.severity ?? "-"
    console.log(
      r.model.padEnd(30) +
      audit.padEnd(12) +
      latency.padEnd(10) +
      tool.padEnd(15) +
      String(sev)
    )
  }
}

main().catch((err) => {
  console.error("Bench failed:", err)
  process.exit(1)
})

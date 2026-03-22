#!/usr/bin/env bun
/**
 * benchmark-models.ts — Benchmark Venice AI models for smart contract audit
 * speed and quality.
 *
 * Tests multiple models against the same Solidity contract audit prompt,
 * measuring TTFT, total time, output tokens, and whether the bug is found.
 *
 * Usage:
 *   bun run packages/researcher/src/experiments/benchmark-models.ts
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VENICE_API_KEY = process.env.VENICE_API_KEY ?? ""
if (!VENICE_API_KEY) {
  console.error("VENICE_API_KEY not set in environment")
  process.exit(1)
}

const BASE_URL = "https://api.venice.ai/api/v1"

const MODELS = [
  "deepseek-v3.2",
  "qwen3-235b-a22b-instruct-2507",
  "zai-org-glm-5",
  "openai-gpt-oss-120b",
  "qwen3-coder-480b-a35b-instruct",
]

// ---------------------------------------------------------------------------
// Contract under test — SideEntranceLenderPool (reentrancy via flash loan)
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
}`

const SYSTEM_PROMPT = `You are a smart contract security auditor. You perform thorough audits of Solidity contracts, looking for vulnerabilities, logic errors, and attack vectors. Be specific about:
- The exact vulnerability mechanism
- Which functions are affected
- How an attacker would exploit it step-by-step
- The severity (Critical / High / Medium / Low / Informational)
- Recommended fix

Do not speculate. Only report findings you are confident about based on the code.`

const USER_PROMPT = `Audit the following Solidity contract for security vulnerabilities:

\`\`\`solidity
${CONTRACT_SOURCE}
\`\`\`

Provide a detailed security audit report.`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  model: string
  ttftMs: number
  totalMs: number
  approxTokens: number
  foundBug: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Streaming benchmark for a single model
// ---------------------------------------------------------------------------

async function benchmarkModel(modelName: string): Promise<BenchmarkResult> {
  const body = {
    model: modelName,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    stream: true,
  }

  const startTime = performance.now()
  let ttftMs = -1
  let fullText = ""

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VENICE_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000), // 60s timeout per model
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        model: modelName,
        ttftMs: -1,
        totalMs: performance.now() - startTime,
        approxTokens: 0,
        foundBug: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      }
    }

    if (!response.body) {
      return {
        model: modelName,
        ttftMs: -1,
        totalMs: performance.now() - startTime,
        approxTokens: 0,
        foundBug: false,
        error: "No response body (streaming not supported)",
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data: ")) continue
        const data = trimmed.slice(6)
        if (data === "[DONE]") continue

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string | null }
            }>
          }

          const content = chunk.choices?.[0]?.delta?.content
          if (content) {
            if (ttftMs < 0) {
              ttftMs = performance.now() - startTime
            }
            fullText += content
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    const totalMs = performance.now() - startTime
    const wordCount = fullText.split(/\s+/).filter(Boolean).length
    const approxTokens = Math.round(wordCount * 1.3)
    const lowerText = fullText.toLowerCase()
    const foundBug = /reentran/i.test(lowerText)

    return {
      model: modelName,
      ttftMs: Math.round(ttftMs),
      totalMs: Math.round(totalMs),
      approxTokens,
      foundBug,
    }
  } catch (err) {
    return {
      model: modelName,
      ttftMs: -1,
      totalMs: Math.round(performance.now() - startTime),
      approxTokens: 0,
      foundBug: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(78))
  console.log("BENCHMARK: Venice AI Models for Smart Contract Audit")
  console.log("=".repeat(78))
  console.log(`Models:    ${MODELS.length}`)
  console.log(`Contract:  SideEntranceLenderPool (known reentrancy via flash loan)`)
  console.log(`Endpoint:  ${BASE_URL}`)
  console.log(`Max tokens: 4096`)
  console.log("=".repeat(78))
  console.log()

  const results: BenchmarkResult[] = []

  for (const modelName of MODELS) {
    process.stdout.write(`Testing ${modelName}... `)
    const result = await benchmarkModel(modelName)
    results.push(result)

    if (result.error) {
      console.log(`ERROR: ${result.error.slice(0, 80)}`)
    } else {
      console.log(
        `TTFT=${(result.ttftMs / 1000).toFixed(1)}s  Total=${(result.totalMs / 1000).toFixed(1)}s  ~${result.approxTokens} tokens  Bug=${result.foundBug ? "Yes" : "No"}`,
      )
    }
  }

  // Print formatted table
  console.log()
  console.log("=".repeat(78))
  console.log("RESULTS")
  console.log("=".repeat(78))
  console.log()

  const header =
    "Model                                | TTFT    | Total   | Tokens  | Found Bug?"
  const separator =
    "-------------------------------------|---------|---------|---------|----------"

  console.log(header)
  console.log(separator)

  for (const r of results) {
    const name = r.model.padEnd(37)
    const ttft = r.error
      ? "ERR    "
      : `${(r.ttftMs / 1000).toFixed(1)}s`.padStart(7)
    const total = r.error
      ? "ERR    "
      : `${(r.totalMs / 1000).toFixed(1)}s`.padStart(7)
    const tokens = r.error ? "ERR    " : `~${r.approxTokens}`.padStart(7)
    const found = r.error ? `ERR` : r.foundBug ? "Yes" : "No"

    console.log(`${name}| ${ttft} | ${total} | ${tokens} | ${found}`)
  }

  if (results.some((r) => r.error)) {
    console.log()
    console.log("Errors:")
    for (const r of results) {
      if (r.error) {
        console.log(`  ${r.model}: ${r.error}`)
      }
    }
  }

  // Best model recommendation
  const successful = results.filter((r) => !r.error && r.foundBug)
  if (successful.length > 0) {
    const fastest = successful.reduce((a, b) =>
      a.totalMs < b.totalMs ? a : b,
    )
    const fastestTTFT = successful.reduce((a, b) =>
      a.ttftMs < b.ttftMs ? a : b,
    )
    console.log()
    console.log("=".repeat(78))
    console.log("RECOMMENDATION")
    console.log("=".repeat(78))
    console.log(`Fastest total (found bug):  ${fastest.model} (${(fastest.totalMs / 1000).toFixed(1)}s)`)
    console.log(`Fastest TTFT (found bug):   ${fastestTTFT.model} (${(fastestTTFT.ttftMs / 1000).toFixed(1)}s)`)
  } else {
    const anySuccess = results.filter((r) => !r.error)
    if (anySuccess.length > 0) {
      console.log()
      console.log("WARNING: No model found the reentrancy bug.")
    }
  }

  console.log()
}

main().catch((err) => {
  console.error("Benchmark failed:", err)
  process.exit(1)
})

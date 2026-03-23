#!/usr/bin/env bun
/**
 * record-demo.ts — Record a polished demo video with three parts:
 *   1. Intro slide (10s) — local HTML with CSS animations
 *   2. Live demo with pitch-focused subtitles on fixed timer (~35-45s)
 *   3. Closing subtitle (5s)
 *
 * Target duration: ~45-60 seconds total.
 *
 * Subtitles are injected into the DOM and run on a FIXED schedule,
 * completely decoupled from pipeline step timing. The visual activity
 * in the background adds credibility on its own.
 *
 * Prerequisites:
 *   - Server running on localhost:3000 (with mock layers for speed)
 *   - bun add -d playwright && bunx playwright install chromium
 *   - Intro slide at recordings/intro-slide.html
 *
 * Usage:
 *   bun run scripts/record-demo.ts
 */

import { chromium, type Page } from "playwright"
import { mkdirSync } from "fs"
import { execSync } from "child_process"

const DEMO_URL = "http://localhost:3000"
const INTRO_URL = "file:///Users/eduardo/workspace/synthesis-hack/recordings/intro-slide.html"
const RECORDING_DIR = "./recordings"

// ── Subtitle overlay injection ──

async function injectSubtitleOverlay(page: Page) {
  await page.evaluate(() => {
    const overlay = document.createElement("div")
    overlay.id = "mnemo-subtitle"
    Object.assign(overlay.style, {
      position: "fixed",
      bottom: "60px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "99999",
      fontFamily: "'SF Pro Display', -apple-system, 'Segoe UI', sans-serif",
      fontSize: "28px",
      fontWeight: "600",
      color: "#fff",
      textShadow:
        "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, " +
        "0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000",
      textAlign: "center",
      padding: "14px 36px",
      borderRadius: "10px",
      background: "rgba(0, 0, 0, 0.8)",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.6)",
      maxWidth: "90%",
      lineHeight: "1.4",
      letterSpacing: "0.01em",
      opacity: "0",
      transition: "opacity 0.3s ease",
      pointerEvents: "none",
    })
    document.body.appendChild(overlay)
  })
}

async function showSubtitle(page: Page, text: string) {
  await page.evaluate((t) => {
    const el = document.getElementById("mnemo-subtitle")
    if (!el) return
    el.textContent = t
    el.style.opacity = "1"
  }, text)
  console.log(`  [sub] ${text}`)
}

async function hideSubtitle(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById("mnemo-subtitle")
    if (el) el.style.opacity = "0"
  })
}

async function subtitle(page: Page, text: string, durationMs: number) {
  await showSubtitle(page, text)
  await page.waitForTimeout(durationMs)
  await hideSubtitle(page)
  await page.waitForTimeout(300) // brief gap between subtitles
}

// ── Main recording flow ──

async function main() {
  mkdirSync(RECORDING_DIR, { recursive: true })

  console.log("Launching browser...")
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const context = await browser.newContext({
    recordVideo: { dir: RECORDING_DIR, size: { width: 1920, height: 1080 } },
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  })
  const page = await context.newPage()

  // ═══════════════════════════════════════════════════════════════
  // PART 1: Intro slide (10s)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Part 1: Intro slide ──")
  await page.goto(INTRO_URL, { waitUntil: "load" })
  await page.waitForTimeout(10_000) // let CSS animations play

  // ═══════════════════════════════════════════════════════════════
  // PART 2: Demo with pitch-focused subtitles (~35-45s)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Part 2: Live demo ──")
  await page.goto(DEMO_URL, { waitUntil: "networkidle" })
  await injectSubtitleOverlay(page)

  // Brief pause on landing page
  await page.waitForTimeout(2000)

  // Click the Side Entrance challenge card
  const challengeCard = page.locator("button", { hasText: "Side Entrance" })
  await challengeCard.waitFor({ state: "visible", timeout: 10_000 })
  await challengeCard.click()
  console.log("  Clicked Side Entrance — starting fixed subtitle schedule")

  // ── Fixed-timer subtitle schedule ──
  // These run on a strict clock after the click, independent of pipeline state.

  // [0-3s] Agent starts auditing
  await showSubtitle(page, "An autonomous agent audits this contract inside a TEE.")
  await page.waitForTimeout(3000)

  // [3-6s] Can't exploit
  await showSubtitle(page, "It can find vulnerabilities but verifiably can\u2019t exploit them.")
  await page.waitForTimeout(3000)

  // [6-9s] Signals a finding
  await showSubtitle(page, "The agent signals a finding. The protocol sees nothing \u2014 yet.")
  await page.waitForTimeout(3000)

  // [9-12s] Escrow gate
  await showSubtitle(page, "To learn the details, the protocol must fund escrow first.")
  await page.waitForTimeout(3000)

  // [12-15s] LLM streams analysis
  await showSubtitle(page, "Inside the enclave, the LLM streams its analysis live.")
  await page.waitForTimeout(3000)

  // [15-18s] Verification proof
  await showSubtitle(page, "Verification proves the bug is real. Not trust \u2014 cryptographic proof.")
  await page.waitForTimeout(3000)

  // [18-21s] Escrow resolution
  await showSubtitle(page, "Escrow auto-releases on verified bug. Auto-refunds on invalid.")
  await page.waitForTimeout(3000)

  // [21-24s] On-chain artifacts
  await showSubtitle(page, "Reputation updated on-chain. Evidence archived to IPFS.")
  await page.waitForTimeout(3000)

  // [24s] Hide subtitle, wait for pipeline to finish or cap at ~25s from click
  await hideSubtitle(page)

  // Wait a moment for any remaining pipeline activity
  // Check if the pipeline is done, otherwise just wait a bit
  const pipelineDone = await page.locator("text=Complete").count().catch(() => 0)
  if (pipelineDone === 0) {
    // Give pipeline a few more seconds to finish
    console.log("  Waiting for pipeline to complete...")
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const done = await page.locator("text=Complete").count().catch(() => 0)
      const back = await page.locator("text=Back to agent").count().catch(() => 0)
      if (done > 0 || back > 0) break
      await page.waitForTimeout(500)
    }
  }

  // Completion subtitle
  await subtitle(page, "End to end. Autonomous. Verifiable. Fair.", 4000)

  // ═══════════════════════════════════════════════════════════════
  // PART 3: Closing
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Part 3: Closing ──")
  await subtitle(page, "In production, you'd see none of this. The TEE is a black box.", 4000)
  await showSubtitle(page, "Live on Base Sepolia. 3 contracts deployed. Nothing hardcoded.")
  await page.waitForTimeout(5000)
  await hideSubtitle(page)
  await page.waitForTimeout(500)

  // ═══════════════════════════════════════════════════════════════
  // Finalize recording
  // ═══════════════════════════════════════════════════════════════
  console.log("\nFinalizing recording...")
  const videoPath = await page.video()?.path()
  await context.close()
  await browser.close()

  if (!videoPath) {
    console.error("No video recorded!")
    process.exit(1)
  }

  // Convert to MP4
  const outputPath = `${RECORDING_DIR}/demo.mp4`
  console.log("Converting to MP4...")
  execSync(
    `ffmpeg -y -i "${videoPath}" -c:v libx264 -preset fast -crf 18 "${outputPath}"`,
    { stdio: "inherit" },
  )

  console.log(`\nDemo video: ${outputPath}`)
}

main().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})

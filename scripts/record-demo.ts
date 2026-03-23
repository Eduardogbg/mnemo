#!/usr/bin/env bun
/**
 * record-demo.ts — Record a demo video of the Mnemo frontend using Playwright.
 *
 * Prerequisites:
 *   - Server running on localhost:3000
 *   - bun add -d playwright && bunx playwright install chromium
 *
 * Usage:
 *   bun run scripts/record-demo.ts
 */

import { chromium } from "playwright"

const DEMO_URL = "http://localhost:3000"
const RECORDING_DIR = "./recordings"
const CHALLENGE_ID = "side-entrance"

async function main() {
  console.log("Launching browser...")

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  })

  const context = await browser.newContext({
    recordVideo: {
      dir: RECORDING_DIR,
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  })

  const page = await context.newPage()

  // Navigate to frontend
  console.log("Opening frontend...")
  await page.goto(DEMO_URL, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000) // Show the landing page with agent status

  // Click the Side Entrance challenge card
  console.log("Selecting Side Entrance challenge...")
  const challengeCard = page.locator("button", { hasText: "Side Entrance" })
  await challengeCard.waitFor({ state: "visible", timeout: 10000 })
  await page.waitForTimeout(1000) // Brief pause before clicking
  await challengeCard.click()

  console.log("Pipeline started — recording...")

  // Wait for the pipeline to run through all 10 steps
  // Monitor for the "Complete" badge or outcome to appear
  let completed = false
  const startTime = Date.now()
  const MAX_WAIT = 180_000 // 3 minutes max

  while (!completed && Date.now() - startTime < MAX_WAIT) {
    // Check if we're done
    const completeIndicator = await page.locator("text=Complete").count()
    const outcomeIndicator = await page.locator("text=Back to agent").count()

    if (completeIndicator > 0 || outcomeIndicator > 0) {
      console.log("Pipeline completed!")
      completed = true
      await page.waitForTimeout(5000) // Show the final state for 5 seconds
    } else {
      // Log progress
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      if (elapsed % 10 === 0) {
        console.log(`  ${elapsed}s elapsed...`)
      }
      await page.waitForTimeout(1000)
    }
  }

  if (!completed) {
    console.log("Max wait time reached — saving what we have")
    await page.waitForTimeout(3000)
  }

  // Scroll down to show evidence if present
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }))
  await page.waitForTimeout(2000)

  // Close to finalize video
  console.log("Finalizing recording...")
  const videoPath = await page.video()?.path()
  await context.close()
  await browser.close()

  if (videoPath) {
    console.log(`\nRecording saved: ${videoPath}`)
    console.log(`\nConvert to MP4:`)
    console.log(`  ffmpeg -i "${videoPath}" -c:v libx264 -preset fast -crf 20 demo.mp4`)
  }
}

main().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})

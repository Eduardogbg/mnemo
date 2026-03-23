import { chromium } from "playwright"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto("file:///Users/eduardo/workspace/synthesis-hack/recordings/banner.html")
await page.screenshot({ path: "/Users/eduardo/workspace/synthesis-hack/recordings/banner.png" })
await browser.close()
console.log("Banner saved to recordings/banner.png")

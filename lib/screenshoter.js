/**
 * Screenshoter Module
 * Renders generated HTML in Puppeteer and captures a screenshot for the "after" preview.
 *
 * Uses the shared browser instance from scraper.js to avoid launching a second
 * Chromium process on Railway (which fails due to memory/resource limits).
 */

const { getBrowser } = require('./scraper');

/**
 * Render HTML string in a browser and capture a screenshot.
 * Reuses the shared Puppeteer browser from scraper.js.
 */
async function screenshotHTML(htmlContent, outputPath) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1440, height: 900 });

    // Load HTML directly (no server needed)
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 20000
    });

    // Wait for fonts to load and animations to settle
    await new Promise(r => setTimeout(r, 2000));

    await page.screenshot({
      path: outputPath,
      fullPage: false, // Above-the-fold for comparison
      type: 'png'
    });

    return outputPath;
  } finally {
    await page.close();
    // Don't close the browser — it's shared and reused
  }
}

module.exports = { screenshotHTML };

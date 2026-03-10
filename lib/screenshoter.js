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

    // Load HTML directly — use networkidle2 instead of networkidle0
    // because networkidle0 hangs on Railway when Google Fonts or other
    // external resources are slow to resolve. networkidle2 allows up to
    // 2 outstanding connections, which is enough for font loading.
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle2',
      timeout: 15000
    });

    // Wait for fonts to load and content to render
    await new Promise(r => setTimeout(r, 2500));

    await page.screenshot({
      path: outputPath,
      fullPage: false, // Above-the-fold for comparison
      type: 'png'
    });

    console.log(`[SCREENSHOT] Captured: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`[SCREENSHOT] Failed for ${outputPath}: ${err.message}`);
    throw err;
  } finally {
    await page.close();
    // Don't close the browser — it's shared and reused
  }
}

module.exports = { screenshotHTML };

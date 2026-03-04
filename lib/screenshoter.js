/**
 * Screenshoter Module
 * Renders generated HTML in Puppeteer and captures a screenshot for the "after" preview.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Render HTML string in a browser and capture a screenshot
 */
async function screenshotHTML(htmlContent, outputPath) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox']
  });

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
    await browser.close();
  }
}

module.exports = { screenshotHTML };

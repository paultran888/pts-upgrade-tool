/**
 * Website Scraper Module
 * Uses Puppeteer to capture screenshots and extract content from websites.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Reuse browser instance for performance
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security'
      ]
    });
  }
  return browserInstance;
}

/**
 * Capture a full-page screenshot of a URL
 */
async function captureScreenshot(url, outputPath) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait a moment for any animations to settle
    await new Promise(r => setTimeout(r, 1500));

    await page.screenshot({
      path: outputPath,
      fullPage: false, // Above-the-fold only for comparison
      type: 'png'
    });

    return outputPath;
  } finally {
    await page.close();
  }
}

/**
 * Extract structured content from a website for AI analysis
 */
async function extractContent(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    const data = await page.evaluate(() => {
      const getComputedColor = (el, prop) => {
        try { return window.getComputedStyle(el)[prop]; } catch(e) { return ''; }
      };

      const body = document.body;
      const html = document.documentElement;

      // Extract all text content by section
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
        .slice(0, 20)
        .map(h => ({ tag: h.tagName, text: h.textContent.trim() }));

      const paragraphs = Array.from(document.querySelectorAll('p'))
        .slice(0, 30)
        .map(p => p.textContent.trim())
        .filter(t => t.length > 10);

      // Extract navigation links
      const navLinks = Array.from(document.querySelectorAll('nav a, header a'))
        .slice(0, 15)
        .map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));

      // Extract logo specifically
      const logoSelectors = [
        'header img[class*="logo"]', 'header img[alt*="logo"]', 'header img[src*="logo"]',
        '.logo img', '#logo img', '[class*="logo"] img', 'header a:first-child img',
        'nav img', '.navbar-brand img', 'header svg', '.logo svg'
      ];
      let logoUrl = null;
      for (const sel of logoSelectors) {
        const el = document.querySelector(sel);
        if (el && el.tagName === 'IMG' && el.src) { logoUrl = el.src; break; }
        if (el && el.tagName === 'SVG') { logoUrl = '__SVG_LOGO__'; break; }
      }
      // Also check for text-based logos
      let logoText = null;
      if (!logoUrl) {
        const headerLink = document.querySelector('header a:first-child, .logo, [class*="logo"]');
        if (headerLink) logoText = headerLink.textContent.trim().substring(0, 50);
      }

      // Extract images (with context about where they appear)
      const images = Array.from(document.querySelectorAll('img'))
        .slice(0, 20)
        .map(img => {
          const parent = img.closest('section, header, .hero, [class*="hero"], [class*="banner"], main');
          const isHero = img.closest('header, .hero, [class*="hero"], [class*="banner"], section:first-of-type') !== null;
          const isLarge = (img.naturalWidth > 400 && img.naturalHeight > 300) ||
                          (img.offsetWidth > 300 && img.offsetHeight > 200);
          return {
            src: img.src,
            alt: img.alt,
            width: img.naturalWidth,
            height: img.naturalHeight,
            isHeroImage: isHero && isLarge,
            isLargeImage: isLarge,
            parentSection: parent ? (parent.className || parent.tagName).substring(0, 60) : 'unknown'
          };
        });

      // Extract CSS background images (hero banners, section backgrounds)
      const bgImages = [];
      const bgElements = document.querySelectorAll('[style*="background"], section, header, .hero, [class*="hero"], [class*="banner"], [class*="bg"]');
      bgElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (match && match[1] && !match[1].startsWith('data:image/svg')) {
            const section = el.closest('section, header, main');
            bgImages.push({
              url: match[1],
              element: (el.className || el.tagName).substring(0, 60),
              isHero: el.closest('header, .hero, [class*="hero"], [class*="banner"], section:first-of-type') !== null,
              parentSection: section ? (section.className || section.tagName).substring(0, 60) : 'unknown'
            });
          }
        }
      });

      // Extract colors
      const allElements = Array.from(document.querySelectorAll('*')).slice(0, 200);
      const bgColors = new Set();
      const textColors = new Set();
      allElements.forEach(el => {
        const bg = getComputedColor(el, 'backgroundColor');
        const color = getComputedColor(el, 'color');
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bgColors.add(bg);
        if (color) textColors.add(color);
      });

      // Extract fonts
      const fonts = new Set();
      allElements.forEach(el => {
        const font = getComputedColor(el, 'fontFamily');
        if (font) fonts.add(font.split(',')[0].trim().replace(/['"]/g, ''));
      });

      // Extract meta tags
      const metaTitle = document.title;
      const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';

      // Extract CTAs (buttons and prominent links)
      const ctas = Array.from(document.querySelectorAll('a[class*="btn"], a[class*="cta"], button, a[class*="button"], .btn, .cta'))
        .slice(0, 10)
        .map(el => ({ text: el.textContent.trim(), href: el.getAttribute('href') || '' }));

      // Extract contact info
      const allText = body.innerText;
      const phoneMatch = allText.match(/[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/);
      const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

      // Extract social links
      const socialLinks = Array.from(document.querySelectorAll('a[href*="facebook"], a[href*="instagram"], a[href*="twitter"], a[href*="linkedin"], a[href*="yelp"], a[href*="tiktok"]'))
        .map(a => a.href);

      // Get HTML structure (limited)
      const htmlSnippet = html.outerHTML.slice(0, 8000);

      return {
        url: window.location.href,
        metaTitle,
        metaDesc,
        ogTitle,
        ogDesc,
        headings,
        paragraphs,
        navLinks,
        logoUrl,
        logoText,
        images: images.slice(0, 12),
        backgroundImages: bgImages.slice(0, 8),
        colors: {
          backgrounds: Array.from(bgColors).slice(0, 10),
          text: Array.from(textColors).slice(0, 10)
        },
        fonts: Array.from(fonts).slice(0, 5),
        ctas,
        contactInfo: {
          phone: phoneMatch ? phoneMatch[0] : null,
          email: emailMatch ? emailMatch[0] : null
        },
        socialLinks,
        htmlSnippet
      };
    });

    return data;
  } finally {
    await page.close();
  }
}

/**
 * Full scrape: screenshot + content extraction
 */
async function scrapeWebsite(url, jobId, screenshotsDir) {
  const screenshotPath = path.join(screenshotsDir, `${jobId}-before.png`);

  const [screenshot, content] = await Promise.all([
    captureScreenshot(url, screenshotPath),
    extractContent(url)
  ]);

  return {
    screenshotPath: screenshot,
    content
  };
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { scrapeWebsite, captureScreenshot, extractContent, closeBrowser };

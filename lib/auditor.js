/**
 * Lightweight Website Auditor
 * Fast checks that don't require AI — runs in seconds, not minutes.
 * Used for the free audit score funnel (/audit).
 */

const { getBrowser } = require('./scraper');

/**
 * Run a quick audit on a URL. Returns a score (0-100) with specific findings.
 * Designed to complete in < 10 seconds.
 */
async function auditWebsite(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const findings = [];
  let totalPoints = 0;
  let maxPoints = 0;

  try {
    // ── Measure load time ──
    const loadStart = Date.now();
    await page.setViewport({ width: 1440, height: 900 });

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch (navErr) {
      // If networkidle2 times out, try with domcontentloaded
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    }
    const loadTimeMs = Date.now() - loadStart;

    // ── 1. HTTPS (10 pts) ──
    maxPoints += 10;
    const isHttps = page.url().startsWith('https://');
    if (isHttps) {
      totalPoints += 10;
      findings.push({ category: 'Security', label: 'HTTPS enabled', pass: true, points: 10, maxPoints: 10, detail: 'Your site uses a secure SSL connection. Visitors won\'t see scary browser warnings.' });
    } else {
      findings.push({ category: 'Security', label: 'No HTTPS — visitors see "Not Secure"', pass: false, points: 0, maxPoints: 10, detail: 'Every visitor sees a "Not Secure" warning in their browser bar. Studies show 82% of people will leave a site that shows this warning. Google also drops your search ranking as a penalty.' });
    }

    // ── 2. Page Load Speed (15 pts) ──
    maxPoints += 15;
    let speedPoints = 0;
    let speedDetail = '';
    if (loadTimeMs < 2000) {
      speedPoints = 15;
      speedDetail = `Your site loaded in ${(loadTimeMs / 1000).toFixed(1)}s — fast enough that visitors stay engaged. You're ahead of 75% of small business websites.`;
    } else if (loadTimeMs < 4000) {
      speedPoints = 10;
      speedDetail = `Your site loaded in ${(loadTimeMs / 1000).toFixed(1)}s. Not bad, but Google data shows every extra second of load time increases bounce rate by 32%. Getting under 2s could noticeably improve your conversion rate.`;
    } else if (loadTimeMs < 7000) {
      speedPoints = 5;
      speedDetail = `Your site took ${(loadTimeMs / 1000).toFixed(1)}s to load. At this speed, you're likely losing over half your visitors — Google research shows 53% of mobile users abandon sites that take longer than 3 seconds. That's potential customers walking out the door.`;
    } else {
      speedPoints = 0;
      speedDetail = `Your site took ${(loadTimeMs / 1000).toFixed(1)}s to load. At this speed, roughly 90% of visitors will leave before seeing your content. If you're getting 100 visitors a day, around 90 of them never even see what you offer.`;
    }
    totalPoints += speedPoints;
    findings.push({ category: 'Performance', label: 'Page load speed', pass: speedPoints >= 10, points: speedPoints, maxPoints: 15, detail: speedDetail, metric: `${(loadTimeMs / 1000).toFixed(1)}s` });

    // ── Run all in-page checks at once ──
    const pageData = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;

      // Meta tags
      const title = document.title || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

      // Viewport meta (mobile-friendliness signal)
      const viewportMeta = document.querySelector('meta[name="viewport"]')?.content || '';

      // Headings
      const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()).filter(t => t);
      const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()).filter(t => t);
      const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      let headingOrderValid = true;
      let prevLevel = 0;
      for (const h of allHeadings) {
        const level = parseInt(h.tagName[1]);
        if (prevLevel > 0 && level > prevLevel + 1) {
          headingOrderValid = false;
          break;
        }
        prevLevel = level;
      }

      // Images
      const allImages = Array.from(document.querySelectorAll('img'));
      const imagesWithAlt = allImages.filter(img => img.alt && img.alt.trim().length > 0);
      const imagesWithoutAlt = allImages.length - imagesWithAlt.length;
      const totalImages = allImages.length;

      // CTAs
      const ctaSelectors = 'a[class*="btn"], a[class*="cta"], button:not([type="submit"]):not([aria-hidden="true"]), a[class*="button"], .btn, .cta, a[href*="contact"], a[href*="book"], a[href*="order"], a[href*="reserve"], a[href*="call"]';
      const ctas = Array.from(document.querySelectorAll(ctaSelectors))
        .filter(el => el.textContent.trim().length > 0 && el.offsetParent !== null)
        .map(el => el.textContent.trim());

      // Contact info
      const allText = body.innerText || '';
      const hasPhone = /[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/.test(allText);
      const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(allText);
      const hasAddress = /\d{2,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl)/i.test(allText);

      // Social links
      const socialPlatforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'yelp', 'tiktok', 'youtube'];
      const socialLinks = socialPlatforms.filter(p =>
        document.querySelector(`a[href*="${p}"]`) !== null
      );

      // Clickable phone/email
      const hasClickablePhone = document.querySelector('a[href^="tel:"]') !== null;
      const hasClickableEmail = document.querySelector('a[href^="mailto:"]') !== null;

      // Forms
      const forms = document.querySelectorAll('form');
      const hasContactForm = forms.length > 0;

      // Favicon
      const hasFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') !== null;

      // Language attribute
      const hasLangAttr = html.getAttribute('lang') ? true : false;

      // Structured data
      const hasJsonLd = document.querySelector('script[type="application/ld+json"]') !== null;

      // Text content length (very basic content check)
      const bodyTextLength = (body.innerText || '').trim().length;

      return {
        title,
        metaDesc,
        ogTitle,
        ogDesc,
        ogImage,
        viewportMeta,
        h1s,
        h2s,
        headingOrderValid,
        totalImages,
        imagesWithoutAlt,
        ctas: ctas.slice(0, 5),
        ctaCount: ctas.length,
        hasPhone,
        hasEmail,
        hasAddress,
        hasClickablePhone,
        hasClickableEmail,
        socialLinks,
        hasContactForm,
        hasFavicon,
        hasLangAttr,
        hasJsonLd,
        bodyTextLength
      };
    });

    // ── 3. Mobile-Friendliness (10 pts) ──
    maxPoints += 10;
    const hasMobileViewport = pageData.viewportMeta.includes('width=device-width') || pageData.viewportMeta.includes('width=device');
    if (hasMobileViewport) {
      totalPoints += 10;
      findings.push({ category: 'Mobile', label: 'Mobile viewport configured', pass: true, points: 10, maxPoints: 10, detail: 'Your site has a responsive viewport meta tag, which is essential for mobile display.' });
    } else {
      findings.push({ category: 'Mobile', label: 'Not mobile-friendly', pass: false, points: 0, maxPoints: 10, detail: 'Your site has no responsive viewport tag. On phones, it appears as a tiny, shrunken desktop page. Over 60% of web traffic is mobile — that means most of your visitors are getting a broken experience and leaving.' });
    }

    // ── Check mobile layout (bonus) ──
    await page.setViewport({ width: 375, height: 812 }); // iPhone size
    await new Promise(r => setTimeout(r, 500));
    const mobileCheck = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const viewWidth = window.innerWidth;
      return { overflows: docWidth > viewWidth + 10, docWidth, viewWidth };
    });
    maxPoints += 5;
    if (!mobileCheck.overflows) {
      totalPoints += 5;
      findings.push({ category: 'Mobile', label: 'No horizontal scroll on mobile', pass: true, points: 5, maxPoints: 5, detail: 'Your content fits within a mobile screen without horizontal scrolling.' });
    } else {
      findings.push({ category: 'Mobile', label: 'Horizontal scroll detected on mobile', pass: false, points: 0, maxPoints: 5, detail: `Your page is ${mobileCheck.docWidth}px wide on a ${mobileCheck.viewWidth}px screen. This causes awkward side-scrolling for mobile visitors.` });
    }

    // ── 4. Page Title (5 pts) ──
    maxPoints += 5;
    if (pageData.title && pageData.title.length >= 10 && pageData.title.length <= 70) {
      totalPoints += 5;
      findings.push({ category: 'SEO', label: 'Good page title', pass: true, points: 5, maxPoints: 5, detail: `Your title "${pageData.title.substring(0, 50)}${pageData.title.length > 50 ? '...' : ''}" is a good length and will display well in search results.` });
    } else if (pageData.title) {
      totalPoints += 2;
      const issue = pageData.title.length < 10 ? 'too short' : 'too long (may get truncated in search results)';
      findings.push({ category: 'SEO', label: `Page title ${issue}`, pass: false, points: 2, maxPoints: 5, detail: `Your title is ${pageData.title.length} characters. Aim for 30-60 characters for best search visibility.` });
    } else {
      findings.push({ category: 'SEO', label: 'Missing page title', pass: false, points: 0, maxPoints: 5, detail: 'Your site has no <title> tag. This is what shows up in Google search results and browser tabs.' });
    }

    // ── 5. Meta Description (5 pts) ──
    maxPoints += 5;
    if (pageData.metaDesc && pageData.metaDesc.length >= 50 && pageData.metaDesc.length <= 160) {
      totalPoints += 5;
      findings.push({ category: 'SEO', label: 'Good meta description', pass: true, points: 5, maxPoints: 5, detail: 'Your meta description is well-crafted and will help click-through from search results.' });
    } else if (pageData.metaDesc) {
      totalPoints += 2;
      findings.push({ category: 'SEO', label: 'Meta description needs work', pass: false, points: 2, maxPoints: 5, detail: `Your description is ${pageData.metaDesc.length} characters. Aim for 120-155 characters to avoid truncation in Google.` });
    } else {
      findings.push({ category: 'SEO', label: 'Missing meta description', pass: false, points: 0, maxPoints: 5, detail: 'No meta description found. When your site appears in Google, the preview text will be a random snippet of your page — usually awkward and unhelpful. A good meta description can increase your click-through rate by 5-10%.' });
    }

    // ── 6. Open Graph Tags (5 pts) ──
    maxPoints += 5;
    const ogCount = [pageData.ogTitle, pageData.ogDesc, pageData.ogImage].filter(Boolean).length;
    if (ogCount === 3) {
      totalPoints += 5;
      findings.push({ category: 'SEO', label: 'Social sharing tags complete', pass: true, points: 5, maxPoints: 5, detail: 'Your Open Graph tags (title, description, image) are set. Links shared on social media will look great.' });
    } else if (ogCount > 0) {
      totalPoints += 2;
      findings.push({ category: 'SEO', label: 'Incomplete social sharing tags', pass: false, points: 2, maxPoints: 5, detail: `You have ${ogCount}/3 Open Graph tags. Missing: ${[!pageData.ogTitle && 'og:title', !pageData.ogDesc && 'og:description', !pageData.ogImage && 'og:image'].filter(Boolean).join(', ')}.` });
    } else {
      findings.push({ category: 'SEO', label: 'No social sharing tags', pass: false, points: 0, maxPoints: 5, detail: 'No Open Graph tags found. When someone shares your link on Facebook, LinkedIn, or Twitter, it shows up as a plain URL with no image or description. Posts with rich previews get 2-3x more engagement than bare links — you\'re missing free exposure.' });
    }

    // ── 7. Heading Structure (10 pts) ──
    maxPoints += 10;
    let headingPoints = 0;
    if (pageData.h1s.length === 1) {
      headingPoints += 5;
    } else if (pageData.h1s.length === 0) {
      findings.push({ category: 'SEO', label: 'Missing H1 heading', pass: false, points: 0, maxPoints: 5, detail: 'Your page has no H1 tag. Search engines use H1 to understand what your page is about.' });
    } else {
      headingPoints += 2;
      findings.push({ category: 'SEO', label: 'Multiple H1 headings', pass: false, points: 2, maxPoints: 5, detail: `Your page has ${pageData.h1s.length} H1 tags. Best practice is exactly one H1 per page for SEO clarity.` });
    }
    if (pageData.headingOrderValid && pageData.h1s.length > 0) {
      headingPoints += 5;
      findings.push({ category: 'SEO', label: 'Good heading structure', pass: true, points: headingPoints, maxPoints: 10, detail: `Your heading hierarchy (H1 → H2 → H3...) is well-organized. This helps both search engines and screen readers.` });
    } else if (pageData.h1s.length > 0) {
      headingPoints += 1;
      findings.push({ category: 'SEO', label: 'Heading hierarchy issues', pass: false, points: headingPoints, maxPoints: 10, detail: 'Your headings skip levels (e.g., H1 → H3). This confuses search engines about your content structure.' });
    }
    totalPoints += headingPoints;

    // ── 8. Image Alt Tags (10 pts) ──
    maxPoints += 10;
    if (pageData.totalImages === 0) {
      totalPoints += 5;
      findings.push({ category: 'Accessibility', label: 'No images found', pass: true, points: 5, maxPoints: 10, detail: 'No images detected. Consider adding images to make your site more engaging.' });
    } else {
      const altPercent = ((pageData.totalImages - pageData.imagesWithoutAlt) / pageData.totalImages) * 100;
      let altPoints = 0;
      if (altPercent === 100) {
        altPoints = 10;
      } else if (altPercent >= 75) {
        altPoints = 7;
      } else if (altPercent >= 50) {
        altPoints = 4;
      } else {
        altPoints = 1;
      }
      totalPoints += altPoints;
      findings.push({
        category: 'Accessibility',
        label: altPercent === 100 ? 'All images have alt text' : `${pageData.imagesWithoutAlt} image${pageData.imagesWithoutAlt > 1 ? 's' : ''} missing alt text`,
        pass: altPercent >= 75,
        points: altPoints,
        maxPoints: 10,
        detail: altPercent === 100
          ? `All ${pageData.totalImages} images have descriptive alt text. Great for SEO and accessibility.`
          : `${pageData.imagesWithoutAlt} of ${pageData.totalImages} images are missing alt text. Screen readers can't describe these to blind users, and search engines can't index them.`
      });
    }

    // ── 9. Call-to-Action (10 pts) ──
    maxPoints += 10;
    if (pageData.ctaCount >= 2) {
      totalPoints += 10;
      findings.push({ category: 'Conversion', label: 'Clear calls-to-action', pass: true, points: 10, maxPoints: 10, detail: `Found ${pageData.ctaCount} call-to-action element(s): "${pageData.ctas.slice(0, 3).join('", "')}". Good — visitors know what to do next.` });
    } else if (pageData.ctaCount === 1) {
      totalPoints += 5;
      findings.push({ category: 'Conversion', label: 'Only one call-to-action', pass: false, points: 5, maxPoints: 10, detail: `Found 1 CTA: "${pageData.ctas[0]}". Consider adding more CTAs throughout the page so visitors always have a clear next step.` });
    } else {
      findings.push({ category: 'Conversion', label: 'No clear call-to-action', pass: false, points: 0, maxPoints: 10, detail: 'No CTA buttons found anywhere on the page. Your visitors literally don\'t know what to do next — call you? Email you? Book online? Without a clear next step, most will just leave. This is likely your biggest conversion leak.' });
    }

    // ── 10. Contact Info Visibility (10 pts) ──
    maxPoints += 10;
    let contactPoints = 0;
    const contactItems = [];
    if (pageData.hasPhone) { contactPoints += 3; contactItems.push('phone'); }
    if (pageData.hasEmail) { contactPoints += 3; contactItems.push('email'); }
    if (pageData.hasAddress || pageData.hasContactForm) { contactPoints += 2; contactItems.push(pageData.hasContactForm ? 'contact form' : 'address'); }
    if (pageData.hasClickablePhone) { contactPoints += 1; contactItems.push('clickable phone link'); }
    if (pageData.hasClickableEmail) { contactPoints += 1; contactItems.push('clickable email link'); }
    contactPoints = Math.min(contactPoints, 10);
    totalPoints += contactPoints;
    findings.push({
      category: 'Conversion',
      label: contactPoints >= 7 ? 'Contact info easily accessible' : 'Contact info needs improvement',
      pass: contactPoints >= 7,
      points: contactPoints,
      maxPoints: 10,
      detail: contactItems.length > 0
        ? `Found: ${contactItems.join(', ')}. ${contactPoints < 7 ? 'Consider adding clickable tel: and mailto: links so mobile users can call or email with one tap.' : 'Nice — making it easy for customers to reach you.'}`
        : 'No phone number, email, or contact form found anywhere on the page. A potential customer who wants to hire you right now literally cannot figure out how. This is revenue walking out the door every single day.'
    });

    // ── 11. Structured Data (5 pts) ──
    maxPoints += 5;
    if (pageData.hasJsonLd) {
      totalPoints += 5;
      findings.push({ category: 'SEO', label: 'Structured data present', pass: true, points: 5, maxPoints: 5, detail: 'Your site uses JSON-LD structured data, which helps Google display rich results (star ratings, hours, etc.).' });
    } else {
      findings.push({ category: 'SEO', label: 'No structured data', pass: false, points: 0, maxPoints: 5, detail: 'No structured data found. This means Google can\'t show rich results for your business — no star ratings, no business hours, no price ranges in search. Your competitors who have this show up bigger and more trustworthy in Google results.' });
    }

    // Compute final score (normalize to 0-100)
    const score = Math.round((totalPoints / maxPoints) * 100);

    // Categorize findings
    const passing = findings.filter(f => f.pass);
    const failing = findings.filter(f => !f.pass);

    // Sort: biggest impact failures first
    failing.sort((a, b) => (b.maxPoints - b.points) - (a.maxPoints - a.points));

    return {
      url: page.url(),
      score,
      totalPoints,
      maxPoints,
      loadTimeMs,
      findings,
      passing,
      failing,
      summary: {
        title: pageData.title,
        h1: pageData.h1s[0] || null,
        hasHttps: isHttps,
        hasMobileViewport: hasMobileViewport,
        loadTime: `${(loadTimeMs / 1000).toFixed(1)}s`,
        ctaCount: pageData.ctaCount,
        imageCount: pageData.totalImages,
        missingAltCount: pageData.imagesWithoutAlt,
        socialPlatforms: pageData.socialLinks,
        hasContactForm: pageData.hasContactForm
      }
    };

  } finally {
    await page.close();
  }
}

module.exports = { auditWebsite };

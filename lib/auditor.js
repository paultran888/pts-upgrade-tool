/**
 * Lightweight Website Auditor
 * Fast checks that don't require AI — runs in seconds, not minutes.
 * Used for the free audit score funnel (/audit).
 *
 * Each finding now includes:
 *   - fix:        Actionable how-to-fix tip
 *   - difficulty:  'easy' | 'moderate' | 'developer'
 *   - impact:      'high' | 'medium' | 'low'
 *
 * GEO (Generative Engine Optimization) checks are added as bonus points
 * alongside the main 100-point scale.
 */

const { getBrowser } = require('./scraper');

/**
 * Run a quick audit on a URL. Returns a score (0-100) with specific findings.
 * Also includes GEO (Generative Engine Optimization) bonus checks.
 * Designed to complete in < 10 seconds (plus ~2-3s for GEO fetch calls).
 */
async function auditWebsite(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const findings = [];
  let totalPoints = 0;
  let maxPoints = 0;

  const geoFindings = [];
  let geoTotalPoints = 0;
  let geoMaxPoints = 0;

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
      findings.push({
        category: 'Security', label: 'HTTPS enabled', pass: true, points: 10, maxPoints: 10,
        detail: 'Your site uses a secure SSL connection.',
        fix: null, difficulty: null, impact: null
      });
    } else {
      findings.push({
        category: 'Security', label: 'No HTTPS', pass: false, points: 0, maxPoints: 10,
        detail: 'Your site isn\'t using HTTPS. Visitors see a "Not Secure" warning in their browser, and Google penalizes your search ranking for it.',
        fix: 'Most hosting providers offer free SSL through Let\'s Encrypt. Log into your hosting dashboard (GoDaddy, Bluehost, Squarespace, etc.), look for "SSL" or "Security," and enable it. Takes about 5 minutes.',
        difficulty: 'easy',
        impact: 'high'
      });
    }

    // ── 2. Page Load Speed (15 pts) ──
    maxPoints += 15;
    let speedPoints = 0;
    let speedDetail = '';
    let speedFix = null;
    let speedDifficulty = null;
    let speedImpact = null;
    if (loadTimeMs < 2000) {
      speedPoints = 15;
      speedDetail = `Your site loaded in ${(loadTimeMs / 1000).toFixed(1)}s — that's fast. Google recommends under 2.5 seconds.`;
    } else if (loadTimeMs < 4000) {
      speedPoints = 10;
      speedDetail = `Your site loaded in ${(loadTimeMs / 1000).toFixed(1)}s — decent, but there's room to improve. Under 2s is ideal.`;
      speedFix = 'Compress your images (use TinyPNG or ShortPixel), enable browser caching, and ask your host about a CDN. These three changes alone can cut load time in half.';
      speedDifficulty = 'moderate';
      speedImpact = 'medium';
    } else if (loadTimeMs < 7000) {
      speedPoints = 5;
      speedDetail = `Your site took ${(loadTimeMs / 1000).toFixed(1)}s to load. 53% of visitors leave if a page takes longer than 3 seconds — you're losing more than half your traffic before they even see your content.`;
      speedFix = 'Start with images — they\'re usually the biggest culprit. Run every image through TinyPNG.com (free). Then check if your hosting plan is shared — upgrading to a better host or adding Cloudflare (free plan) can dramatically help.';
      speedDifficulty = 'moderate';
      speedImpact = 'high';
    } else {
      speedPoints = 0;
      speedDetail = `Your site took ${(loadTimeMs / 1000).toFixed(1)}s to load. That's slow enough to lose the vast majority of visitors before they even see your content. Every extra second costs you roughly 7% in conversions.`;
      speedFix = 'This needs immediate attention. The most common causes: uncompressed images (run them through TinyPNG.com), slow hosting (consider switching to Netlify, Vercel, or a faster host), and too many third-party scripts. A developer can audit your specific bottlenecks with Google PageSpeed Insights.';
      speedDifficulty = 'developer';
      speedImpact = 'high';
    }
    totalPoints += speedPoints;
    findings.push({
      category: 'Performance', label: 'Page load speed', pass: speedPoints >= 10,
      points: speedPoints, maxPoints: 15, detail: speedDetail,
      metric: `${(loadTimeMs / 1000).toFixed(1)}s`,
      fix: speedFix, difficulty: speedDifficulty, impact: speedImpact
    });

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
        title, metaDesc, ogTitle, ogDesc, ogImage, viewportMeta,
        h1s, h2s, headingOrderValid, totalImages, imagesWithoutAlt,
        ctas: ctas.slice(0, 5), ctaCount: ctas.length,
        hasPhone, hasEmail, hasAddress, hasClickablePhone, hasClickableEmail,
        socialLinks, hasContactForm, hasFavicon, hasLangAttr, hasJsonLd, bodyTextLength
      };
    });

    // ── 3. Mobile-Friendliness (10 pts) ──
    maxPoints += 10;
    const hasMobileViewport = pageData.viewportMeta.includes('width=device-width') || pageData.viewportMeta.includes('width=device');
    if (hasMobileViewport) {
      totalPoints += 10;
      findings.push({
        category: 'Mobile', label: 'Mobile viewport configured', pass: true, points: 10, maxPoints: 10,
        detail: 'Your site has a responsive viewport meta tag, which is essential for mobile display.',
        fix: null, difficulty: null, impact: null
      });
    } else {
      findings.push({
        category: 'Mobile', label: 'No mobile viewport', pass: false, points: 0, maxPoints: 10,
        detail: 'Your site is missing a responsive viewport meta tag. On phones, it will look like a shrunken desktop page — hard to read and impossible to navigate with a thumb.',
        fix: 'Add this line to your HTML <head> section: <meta name="viewport" content="width=device-width, initial-scale=1.0">. If you\'re on WordPress, most modern themes include this automatically — you may just need to update your theme.',
        difficulty: 'easy',
        impact: 'high'
      });
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
      findings.push({
        category: 'Mobile', label: 'No horizontal scroll on mobile', pass: true, points: 5, maxPoints: 5,
        detail: 'Your content fits within a mobile screen without horizontal scrolling.',
        fix: null, difficulty: null, impact: null
      });
    } else {
      findings.push({
        category: 'Mobile', label: 'Horizontal scroll detected on mobile', pass: false, points: 0, maxPoints: 5,
        detail: `Your page is ${mobileCheck.docWidth}px wide on a ${mobileCheck.viewWidth}px screen. This causes awkward side-scrolling that makes your site feel broken on phones.`,
        fix: 'The usual culprits: images wider than the screen (add max-width: 100% to all images), fixed-width containers (switch to percentage-based widths), or content that doesn\'t wrap. A developer can identify the exact overflowing element using Chrome DevTools.',
        difficulty: 'developer',
        impact: 'high'
      });
    }

    // ── 4. Page Title (5 pts) ──
    maxPoints += 5;
    if (pageData.title && pageData.title.length >= 10 && pageData.title.length <= 70) {
      totalPoints += 5;
      findings.push({
        category: 'SEO', label: 'Good page title', pass: true, points: 5, maxPoints: 5,
        detail: `Your title "${pageData.title.substring(0, 50)}${pageData.title.length > 50 ? '...' : ''}" is a good length and will display well in search results.`,
        fix: null, difficulty: null, impact: null
      });
    } else if (pageData.title) {
      totalPoints += 2;
      const issue = pageData.title.length < 10 ? 'too short' : 'too long (may get truncated in search results)';
      findings.push({
        category: 'SEO', label: `Page title ${issue}`, pass: false, points: 2, maxPoints: 5,
        detail: `Your title is ${pageData.title.length} characters. Aim for 30-60 characters for best search visibility.`,
        fix: pageData.title.length < 10
          ? 'Write a title that includes your business name + what you do + location. Example: "Joe\'s Plumbing — 24/7 Emergency Plumber in Austin, TX". This tells both Google and visitors exactly what you offer.'
          : 'Shorten your title to under 60 characters. Put the most important keywords first — Google truncates anything longer. Format: "Primary Keyword — Business Name".',
        difficulty: 'easy',
        impact: 'medium'
      });
    } else {
      findings.push({
        category: 'SEO', label: 'Missing page title', pass: false, points: 0, maxPoints: 5,
        detail: 'Your site has no <title> tag. This is what shows up in Google search results and browser tabs — without it, Google guesses (badly).',
        fix: 'Add a <title> tag inside your <head> section. Format: "What You Do — Business Name | Location". Example: <title>Custom Wedding Cakes — Sweet Delights Bakery | Portland, OR</title>. On WordPress, install the Yoast SEO plugin to edit this easily.',
        difficulty: 'easy',
        impact: 'high'
      });
    }

    // ── 5. Meta Description (5 pts) ──
    maxPoints += 5;
    if (pageData.metaDesc && pageData.metaDesc.length >= 50 && pageData.metaDesc.length <= 160) {
      totalPoints += 5;
      findings.push({
        category: 'SEO', label: 'Good meta description', pass: true, points: 5, maxPoints: 5,
        detail: 'Your meta description is well-crafted and will help improve click-through rates from search results.',
        fix: null, difficulty: null, impact: null
      });
    } else if (pageData.metaDesc) {
      totalPoints += 2;
      findings.push({
        category: 'SEO', label: 'Meta description needs work', pass: false, points: 2, maxPoints: 5,
        detail: `Your description is ${pageData.metaDesc.length} characters. Aim for 120-155 characters to avoid truncation in Google.`,
        fix: `${pageData.metaDesc.length < 50 ? 'Your description is too short to be useful.' : 'Your description is getting cut off in search results.'} Write 1-2 sentences that answer: "Why should someone click on this?" Include your main service and a reason to choose you. Example: "Family-owned bakery in Portland serving custom wedding cakes, birthday cakes, and pastries since 1998. Free tastings available."`,
        difficulty: 'easy',
        impact: 'medium'
      });
    } else {
      findings.push({
        category: 'SEO', label: 'Missing meta description', pass: false, points: 0, maxPoints: 5,
        detail: 'No meta description found. Google will auto-generate one from random page content, which almost never looks good and can hurt your click-through rate.',
        fix: 'Add this to your <head>: <meta name="description" content="Your 120-155 character description here">. Write it like a mini-ad — what you do, why you\'re good, and a reason to click. On WordPress, the Yoast SEO plugin adds a simple field for this.',
        difficulty: 'easy',
        impact: 'medium'
      });
    }

    // ── 6. Open Graph Tags (5 pts) ──
    maxPoints += 5;
    const ogCount = [pageData.ogTitle, pageData.ogDesc, pageData.ogImage].filter(Boolean).length;
    if (ogCount === 3) {
      totalPoints += 5;
      findings.push({
        category: 'SEO', label: 'Social sharing tags complete', pass: true, points: 5, maxPoints: 5,
        detail: 'Your Open Graph tags (title, description, image) are set. Links shared on social media will display with a rich preview.',
        fix: null, difficulty: null, impact: null
      });
    } else if (ogCount > 0) {
      totalPoints += 2;
      const missing = [!pageData.ogTitle && 'og:title', !pageData.ogDesc && 'og:description', !pageData.ogImage && 'og:image'].filter(Boolean);
      findings.push({
        category: 'SEO', label: 'Incomplete social sharing tags', pass: false, points: 2, maxPoints: 5,
        detail: `You have ${ogCount}/3 Open Graph tags. Missing: ${missing.join(', ')}.`,
        fix: `Add the missing tags to your <head>: ${missing.map(t => {
          if (t === 'og:title') return '<meta property="og:title" content="Your Page Title">';
          if (t === 'og:description') return '<meta property="og:description" content="A compelling description">';
          return '<meta property="og:image" content="https://yoursite.com/preview-image.jpg"> (use a 1200x630px image)';
        }).join(' ')} Posts with rich previews get 2-3x more engagement than plain links.`,
        difficulty: 'easy',
        impact: 'medium'
      });
    } else {
      findings.push({
        category: 'SEO', label: 'No social sharing tags', pass: false, points: 0, maxPoints: 5,
        detail: 'No Open Graph tags found. When someone shares your site on Facebook, LinkedIn, or Twitter, it shows up as a plain URL with no image, no title, and no description — easy to scroll past.',
        fix: 'Add these 3 tags to your <head>: og:title (your headline), og:description (1-2 sentence pitch), and og:image (a 1200x630px image — this is the most important one). On WordPress, Yoast SEO generates these automatically. Test the result at developers.facebook.com/tools/debug.',
        difficulty: 'easy',
        impact: 'medium'
      });
    }

    // ── 7. Heading Structure (10 pts) ──
    maxPoints += 10;
    let headingPoints = 0;
    if (pageData.h1s.length === 1) {
      headingPoints += 5;
    } else if (pageData.h1s.length === 0) {
      findings.push({
        category: 'SEO', label: 'Missing H1 heading', pass: false, points: 0, maxPoints: 5,
        detail: 'Your page has no H1 tag. Search engines use the H1 to understand what your page is about — without it, you\'re invisible for your main keyword.',
        fix: 'Add one H1 tag to your page with your primary keyword. Example: <h1>Emergency Plumbing Services in Austin</h1>. There should be exactly one H1 per page — think of it as the "title" of the page for Google.',
        difficulty: 'easy',
        impact: 'high'
      });
    } else {
      headingPoints += 2;
      findings.push({
        category: 'SEO', label: 'Multiple H1 headings', pass: false, points: 2, maxPoints: 5,
        detail: `Your page has ${pageData.h1s.length} H1 tags. Best practice is exactly one H1 per page — multiple H1s dilute your SEO focus.`,
        fix: 'Keep your most important H1 and change the others to H2 tags. Your single H1 should be the main topic of the page. Everything else is a subsection (H2) or sub-subsection (H3).',
        difficulty: 'easy',
        impact: 'medium'
      });
    }
    if (pageData.headingOrderValid && pageData.h1s.length > 0) {
      headingPoints += 5;
      findings.push({
        category: 'SEO', label: 'Good heading structure', pass: true, points: headingPoints, maxPoints: 10,
        detail: 'Your heading hierarchy (H1 → H2 → H3...) is well-organized. This helps both search engines and screen readers understand your content.',
        fix: null, difficulty: null, impact: null
      });
    } else if (pageData.h1s.length > 0) {
      headingPoints += 1;
      findings.push({
        category: 'SEO', label: 'Heading hierarchy issues', pass: false, points: headingPoints, maxPoints: 10,
        detail: 'Your headings skip levels (e.g., H1 jumps to H3, skipping H2). This confuses search engines about how your content is structured.',
        fix: 'Think of headings like an outline: H1 is the page title, H2s are major sections, H3s are subsections within each H2. Never skip a level — go H1 → H2 → H3, not H1 → H3. Most website builders let you change heading levels in the text editor toolbar.',
        difficulty: 'easy',
        impact: 'low'
      });
    }
    totalPoints += headingPoints;

    // ── 8. Image Alt Tags (10 pts) ──
    maxPoints += 10;
    if (pageData.totalImages === 0) {
      totalPoints += 5;
      findings.push({
        category: 'Accessibility', label: 'No images found', pass: true, points: 5, maxPoints: 10,
        detail: 'No images detected on the page. Images make your site more engaging and can drive traffic through Google Image Search.',
        fix: 'Consider adding relevant photos — team photos, product images, or work examples. Pages with images get 94% more views than text-only pages.',
        difficulty: 'easy',
        impact: 'medium'
      });
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

      let altFix = null;
      let altDiff = null;
      let altImpact = null;
      if (altPercent < 100) {
        altFix = `${pageData.imagesWithoutAlt} of your ${pageData.totalImages} images need alt text. Alt text should describe the image in plain language — not keyword stuffing. Example: alt="Chef preparing fresh pasta in our kitchen" not alt="best italian restaurant food chef cooking". On WordPress, click any image and fill in the "Alt Text" field.`;
        altDiff = 'easy';
        altImpact = pageData.imagesWithoutAlt > 3 ? 'high' : 'medium';
      }

      findings.push({
        category: 'Accessibility',
        label: altPercent === 100 ? 'All images have alt text' : `${pageData.imagesWithoutAlt} image${pageData.imagesWithoutAlt > 1 ? 's' : ''} missing alt text`,
        pass: altPercent >= 75,
        points: altPoints,
        maxPoints: 10,
        detail: altPercent === 100
          ? `All ${pageData.totalImages} images have descriptive alt text. Great for SEO, accessibility, and Google Image Search traffic.`
          : `${pageData.imagesWithoutAlt} of ${pageData.totalImages} images are missing alt text. Screen readers can't describe these to blind visitors, and Google can't index them — you're missing out on image search traffic.`,
        fix: altFix,
        difficulty: altDiff,
        impact: altImpact
      });
    }

    // ── 9. Call-to-Action (10 pts) ──
    maxPoints += 10;
    if (pageData.ctaCount >= 2) {
      totalPoints += 10;
      findings.push({
        category: 'Conversion', label: 'Clear calls-to-action', pass: true, points: 10, maxPoints: 10,
        detail: `Found ${pageData.ctaCount} call-to-action element(s): "${pageData.ctas.slice(0, 3).join('", "')}". Visitors know what to do next.`,
        fix: null, difficulty: null, impact: null
      });
    } else if (pageData.ctaCount === 1) {
      totalPoints += 5;
      findings.push({
        category: 'Conversion', label: 'Only one call-to-action', pass: false, points: 5, maxPoints: 10,
        detail: `Found 1 CTA: "${pageData.ctas[0]}". Visitors who scroll past it have no second chance to take action.`,
        fix: 'Add CTAs in at least 3 places: top of page (hero section), middle (after showing your work or services), and bottom (before footer). Use specific action words — "Book a Free Consultation" beats "Contact Us". Make the button a contrasting color that stands out.',
        difficulty: 'moderate',
        impact: 'high'
      });
    } else {
      findings.push({
        category: 'Conversion', label: 'No clear call-to-action', pass: false, points: 0, maxPoints: 10,
        detail: 'No obvious CTA buttons found. Visitors don\'t know what action to take — call, book, order? Every second of confusion costs you a potential customer.',
        fix: 'Add a prominent button in your hero section with a specific action: "Book a Table", "Get a Free Quote", "Schedule a Call" — whatever your #1 desired customer action is. Make it a bright, contrasting color and large enough to tap on mobile. Then repeat that CTA throughout the page.',
        difficulty: 'moderate',
        impact: 'high'
      });
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

    let contactFix = null;
    let contactDiff = null;
    let contactImpact = null;
    if (contactPoints < 7) {
      const missingContact = [];
      if (!pageData.hasPhone) missingContact.push('a phone number');
      if (!pageData.hasEmail) missingContact.push('an email address');
      if (!pageData.hasContactForm) missingContact.push('a contact form');
      if (!pageData.hasClickablePhone && pageData.hasPhone) missingContact.push('a clickable tel: link for the phone number');
      if (!pageData.hasClickableEmail && pageData.hasEmail) missingContact.push('a clickable mailto: link for the email');

      contactFix = `Add ${missingContact.join(', ')}. ` + (
        !pageData.hasClickablePhone && pageData.hasPhone
          ? 'For the phone number, wrap it in a link: <a href="tel:+15551234567">555-123-4567</a>. This lets mobile visitors call with one tap — huge for local businesses. '
          : ''
      ) + (
        !pageData.hasClickableEmail && pageData.hasEmail
          ? 'For email, use: <a href="mailto:you@business.com">you@business.com</a>. '
          : ''
      ) + 'Put your contact info in the header or footer so it\'s visible on every page.';
      contactDiff = 'easy';
      contactImpact = 'high';
    }

    findings.push({
      category: 'Conversion',
      label: contactPoints >= 7 ? 'Contact info easily accessible' : 'Contact info needs improvement',
      pass: contactPoints >= 7,
      points: contactPoints,
      maxPoints: 10,
      detail: contactItems.length > 0
        ? `Found: ${contactItems.join(', ')}. ${contactPoints < 7 ? 'But visitors still have to work too hard to reach you.' : 'Nice — making it easy for customers to reach you.'}`
        : 'No phone number, email, or contact form found on the page. Visitors who want to hire you literally cannot figure out how. This is revenue walking out the door every day.',
      fix: contactFix || (!contactItems.length ? 'Add your phone number, email address, and a simple contact form. Put them in the footer (visible on every page) AND in a dedicated contact section. Make the phone number clickable with a tel: link so mobile visitors can call with one tap.' : null),
      difficulty: contactDiff || (!contactItems.length ? 'easy' : null),
      impact: contactImpact || (!contactItems.length ? 'high' : null)
    });

    // ── 11. Structured Data (5 pts) ──
    maxPoints += 5;
    if (pageData.hasJsonLd) {
      totalPoints += 5;
      findings.push({
        category: 'SEO', label: 'Structured data present', pass: true, points: 5, maxPoints: 5,
        detail: 'Your site uses JSON-LD structured data, which helps Google display rich results (star ratings, business hours, price ranges) in search.',
        fix: null, difficulty: null, impact: null
      });
    } else {
      findings.push({
        category: 'SEO', label: 'No structured data', pass: false, points: 0, maxPoints: 5,
        detail: 'No JSON-LD structured data found. Without it, you\'re missing out on rich snippets in Google — those eye-catching search results with star ratings, hours, and prices that get more clicks.',
        fix: 'Add a JSON-LD script to your page with your business info (name, address, phone, hours, reviews). Google has a free tool to generate it: search "Google Structured Data Markup Helper". On WordPress, plugins like Yoast SEO or Rank Math can add this automatically.',
        difficulty: 'moderate',
        impact: 'medium'
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // GEO (Generative Engine Optimization) BONUS CHECKS
    // ═══════════════════════════════════════════════════════════════

    // Extract base URL for fetch calls
    let baseUrl = url;
    try {
      const urlObj = new URL(url);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
      baseUrl = url.split('/').slice(0, 3).join('/');
    }

    // ── GEO 1. AI Crawler Access (5 pts) ──
    geoMaxPoints += 5;
    let robotsScore = 0;
    let robotsDetail = 'Could not fetch /robots.txt';
    try {
      const robotsResponse = await fetch(`${baseUrl}/robots.txt`, { timeout: 5000 });
      if (robotsResponse.ok) {
        const robotsText = await robotsResponse.text();

        // Check for explicit allowances for AI crawlers
        const gptBotAllowed = /User-agent:\s*GPTBot|User-agent:\s*\*/i.test(robotsText) &&
                             !new RegExp(`User-agent:\\s*GPTBot\\s*[\\s\\S]*?Disallow:\\s*/`, 'i').test(robotsText);
        const perplexityBotAllowed = /User-agent:\s*PerplexityBot|User-agent:\s*\*/i.test(robotsText) &&
                                     !new RegExp(`User-agent:\\s*PerplexityBot\\s*[\\s\\S]*?Disallow:\\s*/`, 'i').test(robotsText);
        const claudeBotAllowed = /User-agent:\s*ClaudeBot|User-agent:\s*\*/i.test(robotsText) &&
                                !new RegExp(`User-agent:\\s*ClaudeBot\\s*[\\s\\S]*?Disallow:\\s*/`, 'i').test(robotsText);

        const allowedCount = [gptBotAllowed, perplexityBotAllowed, claudeBotAllowed].filter(Boolean).length;

        if (allowedCount >= 2) {
          robotsScore = 5;
          robotsDetail = `robots.txt explicitly allows ${allowedCount}/3 AI crawlers (GPTBot, PerplexityBot, ClaudeBot).`;
        } else if (allowedCount === 1) {
          robotsScore = 3;
          robotsDetail = `robots.txt explicitly allows 1/3 AI crawlers. Consider allowing more (GPTBot, PerplexityBot, ClaudeBot).`;
        } else {
          robotsScore = 0;
          robotsDetail = 'robots.txt blocks or does not explicitly allow AI crawlers. Add: User-agent: GPTBot / User-agent: PerplexityBot / User-agent: ClaudeBot — all with Disallow: (empty).';
        }
      } else {
        robotsScore = 0;
        robotsDetail = '/robots.txt not found (HTTP ' + robotsResponse.status + '). Create one and allow AI crawlers.';
      }
    } catch (err) {
      robotsScore = 0;
      robotsDetail = 'Could not fetch /robots.txt: ' + err.message;
    }
    geoTotalPoints += robotsScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: robotsScore >= 5 ? 'AI crawler access optimal' : 'AI crawler access needs work',
      pass: robotsScore >= 5,
      points: robotsScore,
      maxPoints: 5,
      detail: robotsDetail,
      fix: robotsScore < 5 ? 'Add or update /robots.txt to explicitly allow GPTBot, PerplexityBot, and ClaudeBot. Example:\n\nUser-agent: GPTBot\nDisallow:\n\nUser-agent: PerplexityBot\nDisallow:\n\nUser-agent: ClaudeBot\nDisallow:\n\nThis allows AI models to index your content for generative search results.' : null,
      difficulty: robotsScore < 5 ? 'easy' : null,
      impact: robotsScore < 5 ? 'medium' : null
    });

    // ── GEO 2. llms.txt Present (5 pts) ──
    geoMaxPoints += 5;
    let llmsTxtScore = 0;
    let llmsTxtDetail = 'Could not fetch /llms.txt';
    try {
      const llmsResponse = await fetch(`${baseUrl}/llms.txt`, { timeout: 5000 });
      if (llmsResponse.ok) {
        const llmsText = await llmsResponse.text();
        const isPlainText = !llmsText.includes('<html') && !llmsText.includes('<HTML');
        const hasLength = llmsText.trim().length > 100;

        if (isPlainText && hasLength) {
          llmsTxtScore = 5;
          llmsTxtDetail = `/llms.txt found and properly formatted (${llmsText.length} characters of plain text).`;
        } else if (isPlainText && llmsText.trim().length > 0) {
          llmsTxtScore = 2;
          llmsTxtDetail = `/llms.txt found but too short (${llmsText.length} chars). Aim for 100+ characters with details about your site.`;
        } else {
          llmsTxtScore = 0;
          llmsTxtDetail = '/llms.txt found but appears to be HTML, not plain text.';
        }
      } else {
        llmsTxtScore = 0;
        llmsTxtDetail = '/llms.txt not found (HTTP ' + llmsResponse.status + '). Create one to help AI models understand your site.';
      }
    } catch (err) {
      llmsTxtScore = 0;
      llmsTxtDetail = 'Could not fetch /llms.txt: ' + err.message;
    }
    geoTotalPoints += llmsTxtScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: llmsTxtScore >= 5 ? 'llms.txt complete' : 'llms.txt missing or incomplete',
      pass: llmsTxtScore >= 5,
      points: llmsTxtScore,
      maxPoints: 5,
      detail: llmsTxtDetail,
      fix: llmsTxtScore < 5 ? 'Create a /llms.txt file at your site root with at least 100 characters describing your business, mission, or content. Example:\n\nAbout: We are a sustainable bakery in Portland specializing in organic, gluten-free wedding cakes and pastries. Founded in 1998.\nProducts: Custom cakes, pastries, bread\nLocation: Portland, OR\nContact: hello@ourbakery.com\n\nThis helps AI models provide accurate context about your company in generative search.' : null,
      difficulty: llmsTxtScore < 5 ? 'easy' : null,
      impact: llmsTxtScore < 5 ? 'low' : null
    });

    // ── GEO 3. FAQ Schema Depth (5 pts) ──
    geoMaxPoints += 5;
    const faqSchemaData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          if (json['@type'] === 'FAQPage' || (Array.isArray(json) && json.some(item => item['@type'] === 'FAQPage'))) {
            const faqPage = json['@type'] === 'FAQPage' ? json : json.find(item => item['@type'] === 'FAQPage');
            const questions = faqPage.mainEntity || [];
            return { hasFaq: true, questionCount: questions.length };
          }
        } catch (e) {
          // Continue to next script
        }
      }
      return { hasFaq: false, questionCount: 0 };
    });

    let faqScore = 0;
    let faqDetail = 'No FAQPage schema found on the page.';
    if (faqSchemaData.hasFaq && faqSchemaData.questionCount >= 5) {
      faqScore = 5;
      faqDetail = `FAQPage schema found with ${faqSchemaData.questionCount} questions. Excellent for voice search and generative engines.`;
    } else if (faqSchemaData.hasFaq && faqSchemaData.questionCount > 0) {
      faqScore = 3;
      faqDetail = `FAQPage schema found with only ${faqSchemaData.questionCount} question(s). Aim for 5+ for better generative engine coverage.`;
    } else {
      faqScore = 0;
      faqDetail = 'No FAQPage schema detected. Adding an FAQ helps AI models answer user queries about your business.';
    }
    geoTotalPoints += faqScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: faqScore >= 5 ? 'FAQ schema comprehensive' : 'FAQ schema missing or sparse',
      pass: faqScore >= 5,
      points: faqScore,
      maxPoints: 5,
      detail: faqDetail,
      fix: faqScore < 5 ? 'Add a FAQPage schema with at least 5 Q&A pairs relevant to your business. Use Google\'s FAQ schema documentation (search "Google FAQPage schema"). Example:\n\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n    {\n      "@type": "Question",\n      "name": "How long does custom cake decorating take?",\n      "acceptedAnswer": {"@type": "Answer", "text": "Typically 1-2 weeks..."}\n    }\n  ]\n}\n</script>' : null,
      difficulty: faqScore < 5 ? 'moderate' : null,
      impact: faqScore < 5 ? 'medium' : null
    });

    // ── GEO 4. Schema Cross-Referencing (5 pts) ──
    geoMaxPoints += 5;
    const schemaRefData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      let schemasWithId = 0;
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            if (item['@id']) {
              schemasWithId++;
            }
          }
        } catch (e) {
          // Continue
        }
      }
      return { schemasWithId };
    });

    let refScore = 0;
    let refDetail = 'No @id fields found in JSON-LD schemas.';
    if (schemaRefData.schemasWithId >= 2) {
      refScore = 5;
      refDetail = `${schemaRefData.schemasWithId} schemas use @id for cross-referencing. Excellent for knowledge graph integration.`;
    } else if (schemaRefData.schemasWithId === 1) {
      refScore = 3;
      refDetail = 'One schema has @id cross-reference. Consider linking more entities for richer knowledge graphs.';
    } else {
      refScore = 0;
      refDetail = 'Schemas lack @id cross-references. This prevents knowledge graph linking between entities.';
    }
    geoTotalPoints += refScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: refScore >= 5 ? 'Schema cross-referencing optimal' : 'Schema cross-referencing needed',
      pass: refScore >= 5,
      points: refScore,
      maxPoints: 5,
      detail: refDetail,
      fix: refScore < 5 ? 'Add @id fields to your JSON-LD schemas to link related entities. Example:\n\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "@id": "https://yoursite.com#business",\n  "name": "Your Business",\n  "address": {"@id": "https://yoursite.com#address"}\n},\n{\n  "@context": "https://schema.org",\n  "@type": "PostalAddress",\n  "@id": "https://yoursite.com#address",\n  "streetAddress": "123 Main St"\n}\n\nThis helps knowledge graphs understand relationships between data.' : null,
      difficulty: refScore < 5 ? 'developer' : null,
      impact: refScore < 5 ? 'low' : null
    });

    // ── GEO 5. Entity Grounding (5 pts) ──
    geoMaxPoints += 5;
    const entityGroundingData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      let hasGrounding = false;
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            // Check for sameAs with Wikipedia or Wikidata
            if (item.sameAs) {
              const sameAsArray = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
              if (sameAsArray.some(url => typeof url === 'string' && (url.includes('wikipedia') || url.includes('wikidata')))) {
                hasGrounding = true;
              }
            }
            // Check for about array with sameAs
            if (item.about && Array.isArray(item.about)) {
              for (const aboutItem of item.about) {
                if (aboutItem.sameAs) {
                  hasGrounding = true;
                }
              }
            }
          }
        } catch (e) {
          // Continue
        }
      }
      return { hasGrounding };
    });

    let groundingScore = entityGroundingData.hasGrounding ? 5 : 0;
    let groundingDetail = entityGroundingData.hasGrounding
      ? 'Entity grounding with Wikipedia/Wikidata links found. Great for disambiguation and knowledge graphs.'
      : 'No sameAs links to Wikipedia or Wikidata found in JSON-LD. This limits knowledge graph linking.';
    geoTotalPoints += groundingScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: entityGroundingData.hasGrounding ? 'Entity grounding present' : 'Entity grounding missing',
      pass: entityGroundingData.hasGrounding,
      points: groundingScore,
      maxPoints: 5,
      detail: groundingDetail,
      fix: !entityGroundingData.hasGrounding ? 'Add sameAs links to Wikipedia or Wikidata URLs in your JSON-LD schemas. Example:\n\n{\n  "@context": "https://schema.org",\n  "@type": "Person",\n  "name": "Jane Doe",\n  "sameAs": "https://en.wikipedia.org/wiki/Jane_Doe"\n}\n\nOr for organizations:\n\n{\n  "@type": "LocalBusiness",\n  "name": "Your Business",\n  "sameAs": "https://www.wikidata.org/wiki/Q123456"\n}\n\nThis helps search engines disambiguate your entity and connect it to the larger knowledge graph.' : null,
      difficulty: !entityGroundingData.hasGrounding ? 'moderate' : null,
      impact: !entityGroundingData.hasGrounding ? 'low' : null
    });

    // ── GEO 6. Speakable Schema (5 pts) ──
    geoMaxPoints += 5;
    const speakableData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            if (item.speakableSpecification || (item.potentialAction && Array.isArray(item.potentialAction) && item.potentialAction.some(p => p['@type'] === 'ListenAction'))) {
              return { hasSpeakable: true };
            }
          }
        } catch (e) {
          // Continue
        }
      }
      return { hasSpeakable: false };
    });

    let speakableScore = speakableData.hasSpeakable ? 5 : 0;
    let speakableDetail = speakableData.hasSpeakable
      ? 'SpeakableSpecification found. Your content is optimized for voice assistants and audio generation.'
      : 'No SpeakableSpecification found. Voice assistants and audio models can\'t identify the best content to speak.';
    geoTotalPoints += speakableScore;
    geoFindings.push({
      category: 'GEO Readiness',
      label: speakableData.hasSpeakable ? 'Voice-optimized' : 'Not voice-optimized',
      pass: speakableData.hasSpeakable,
      points: speakableScore,
      maxPoints: 5,
      detail: speakableDetail,
      fix: !speakableData.hasSpeakable ? 'Add a SpeakableSpecification to your JSON-LD to mark content suitable for voice assistants. Example:\n\n{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "Your Article",\n  "speakableSpecification": {\n    "@type": "SpeakableSpecification",\n    "cssSelector": ["h1", "p"]\n  }\n}\n\nOr use a selector to mark specific content:\n"xpath": "//*[@class=\'article-body\']\n\nThis helps voice assistants and AI models find the most important content to read aloud.' : null,
      difficulty: !speakableData.hasSpeakable ? 'moderate' : null,
      impact: !speakableData.hasSpeakable ? 'low' : null
    });

    // Compute final score (normalize to 0-100)
    const score = Math.round((totalPoints / maxPoints) * 100);
    const geoScore = geoMaxPoints > 0 ? Math.round((geoTotalPoints / geoMaxPoints) * 100) : 0;

    // Categorize findings
    const passing = findings.filter(f => f.pass);
    const failing = findings.filter(f => !f.pass);

    // Sort: biggest impact failures first
    failing.sort((a, b) => (b.maxPoints - b.points) - (a.maxPoints - a.points));

    // Categorize GEO findings
    const geoPassing = geoFindings.filter(f => f.pass);
    const geoFailing = geoFindings.filter(f => !f.pass);
    geoFailing.sort((a, b) => (b.maxPoints - b.points) - (a.maxPoints - a.points));

    return {
      url: page.url(),
      score,
      totalPoints,
      maxPoints,
      geoScore,
      geoTotalPoints,
      geoMaxPoints,
      loadTimeMs,
      findings,
      passing,
      failing,
      geoFindings,
      geoPassing,
      geoFailing,
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

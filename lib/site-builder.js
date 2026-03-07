/**
 * Website Builder Module
 * Uses Claude Opus to generate a complete upgraded HTML page from the analysis strategy.
 * Prompt incorporates Paul Tran Studio v5 build methodology.
 */

// NOTE: We bypass the Anthropic SDK for the builder because the SDK's
// _calculateNonstreamingTimeout pre-flight check throws for Opus + 32k max_tokens,
// even when streaming is enabled. Using fetch + SSE directly avoids this entirely.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Generate a complete self-contained HTML page from the analysis strategy
 * @param {Object} analysis — upgrade strategy from analyzer
 * @param {Object} options
 * @param {string} options.model — Claude model to use
 */
async function buildUpgradedSite(analysis, { model = 'claude-opus-4-6' } = {}) {
  const prompt = `You are an elite frontend developer for Paul Tran Studio. Build a complete, production-quality, single-file HTML website from this upgrade strategy.

<strategy>
${JSON.stringify(analysis, null, 2)}
</strategy>

OUTPUT FORMAT: Only the complete HTML file. No explanation, no markdown, no code fences. Start with <!DOCTYPE html> and end with </html>. All CSS in a <style> tag. All JS in a <script> tag before </body>. Google Fonts via <link> tag.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#1 RULE — COMPLETENESS (READ THIS FIRST)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST generate ALL 7 sections listed below with REAL content in each one. An incomplete page is a FAILED page. The business owner will see this side-by-side with their current site — if sections are empty or missing, the upgrade looks WORSE than what they already have.

Before you finish, mentally check: Does my HTML contain all 7 sections? Does each section have real text content? If any section is empty or missing, GO BACK and add it.

CONTENT RULE: Use ALL copy from the strategy's "copy" object VERBATIM:
- heroHeadline and heroSub in the hero
- aboutHeading and aboutText (full paragraphs — every word, do not truncate) in the about section
- services array as cards with names and descriptions
- testimonials array with real quotes and attribution
- ctaHeading and ctaText in the contact/CTA section
- footerTagline in the footer

Use ALL business info from contentPreserved:
- businessName, phone (as clickable tel: link), email (as mailto: link), address, hours
- socialLinks as icon links in footer
- reservationUrl and menuUrl for CTA buttons if available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON FAILURE MODES — AVOID AT ALL COSTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NO empty sections — every section needs real visible text content (headings AND paragraphs)
- NO decorative full-screen sections before the hero
- NO giant oversized display text in the hero — headline should be clamp(2rem, 5vw, 3.5rem), NOT 6rem+ block text that fills the whole screen
- NO invisible or low-opacity decorative background text
- NO sections that are just a background color with no content
- NO truncating or skipping content from the strategy — use ALL of it

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE 7 REQUIRED SECTIONS (in this exact order)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — NAVIGATION
- Fixed/sticky nav with SOLID background (navBackground color from palette)
- Logo: if "logoUrl" → <img> max-height 40px; if "logoText" → styled text 1.25-1.5rem, font-weight 700; else businessName as text
- Logo area: display: flex; flex-direction: column; gap: 2px (name + tagline never overlap)
- ALL nav links from contentPreserved.navLinks
- Primary CTA as a styled button on the right (primary color)
- Mobile: hamburger menu with JS toggle
- 4.5:1 contrast ratio for nav text

SECTION 2 — HERO
- FIRST section after nav. min-height: 100vh with content vertically centered
- heroHeadline as H1: clamp(2rem, 5vw, 3.5rem) — refined and elegant, NOT giant block letters
- heroSub below it: clamp(1rem, 2.5vw, 1.25rem), lighter weight, max-width 600px
- Primary + secondary CTA buttons below the subheadline
- If heroImageUrl exists: use as background-image with background-size: cover and a dark gradient overlay (linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.6))) for text readability
- Hero text should be left-aligned or centered, clean and professional — NOT filling the entire viewport with massive text
- Must pass the 5-second phone test: visitor sees headline, understands the business, sees the CTA

SECTION 3 — ABOUT
- aboutHeading as H2
- aboutText as FULL paragraphs (every word from the strategy — do NOT truncate)
- If a keyImage fits here, use it side-by-side with text on desktop, stacked on mobile
- Generous padding, readable line-height (1.6-1.8)

SECTION 4 — SERVICES / MENU / FEATURES
- Cards with service names and descriptions from the services array
- Grid: 2-3 columns on desktop, 1 on mobile
- Each card: heading + description paragraph + optional icon/image
- Subtle shadow, slight lift on hover

SECTION 5 — TESTIMONIALS or GALLERY
- If testimonials exist: styled quote cards with attribution and source
- If no testimonials but keyImages exist: image gallery grid
- If neither: skip this section (the only section that CAN be skipped)

SECTION 6 — CONTACT / CTA
- ctaHeading as H2 + ctaText paragraph
- Contact form: name, email, message fields with labels
- Business info: phone (tel: link), email (mailto: link), address, hours
- If address exists: consider a Google Maps embed or a styled address card

SECTION 7 — FOOTER
- Logo/brand name, nav links repeated, social media icon links (SVG icons)
- Copyright with current year, footerTagline
- Clean layout, not cluttered

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This should look like a $15,000 custom site, not a template.

THEME: Check "darkTheme" in the strategy:
- LIGHT: white/off-white backgrounds, dark text, soft shadows, subtle borders, clean and airy
- DARK: dark backgrounds, light text, subtle gradients, atmospheric and premium

Use CSS custom properties for ALL colors — never hardcode color values in individual selectors:
:root {
  --color-bg: [background];
  --color-surface: [surface];
  --color-primary: [primary];
  --color-secondary: [secondary];
  --color-text: [text];
  --color-text-secondary: [textSecondary];
  --color-nav-bg: [navBackground];
}

TEXT VISIBILITY (CRITICAL — this is the #1 visual bug we see):
- Set body { color: var(--color-text); background: var(--color-bg); } as the BASE
- ALL headings (h1-h6) must use color: var(--color-text) or var(--color-primary)
- ALL body text and paragraphs must use color: var(--color-text) or var(--color-text-secondary)
- NEVER set text color to a dark value (#1a1a1a, #333, #000, etc.) on a dark-themed site
- NEVER set text color to a light value (#fff, #f5f5f5, etc.) on a light-themed site
- If a section has a dark background, ALL text in that section MUST be light (white or near-white)
- If a section has a light background, ALL text in that section MUST be dark
- Test every section mentally: "Can I read this text against this background?" If not, fix the contrast
- Cards on dark backgrounds: use var(--color-surface) as card background with var(--color-text) for card text

TYPOGRAPHY: Use the fonts from the strategy (Google Fonts). Headlines use the display font. Body uses the body font. Establish a clear type scale — don't make everything big. Hero headline is the biggest, section headings are medium (clamp(1.5rem, 3vw, 2.25rem)), body text is 1rem-1.125rem.

IMAGES:
- heroImageUrl → hero background-image with cover
- keyImages → distribute through about, gallery, or section backgrounds
- NEVER leave a section as just a solid color when images are available
- object-fit: cover on all images. loading="lazy" except hero.

SPACING: Generous padding between sections (clamp(4rem, 8vw, 8rem) vertical padding). Alternate background colors between sections for visual rhythm.

ANIMATIONS: Subtle hover on cards and buttons. Do NOT use scroll-reveal or IntersectionObserver animations — all content must be visible immediately on load (opacity:1, no reveal classes). Animations must respect prefers-reduced-motion.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECHNICAL STANDARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Semantic HTML5 with ARIA landmarks
- Mobile-first responsive: 375px → 768px → 1024px → 1440px
- All tap targets minimum 44x44px on mobile
- Body text never below 16px on mobile
- Single H1 (hero headline), logical H1 → H2 → H3 hierarchy
- Meta title and description from strategy copy
- OG tags and JSON-LD structured data for the business type
- data-track attributes on CTAs and clickable contact info
- data-section attributes on major sections

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before outputting, verify:
1. Nav has logo + all links + CTA button? ✓
2. Hero has headline + subheadline + 2 CTA buttons + background image? ✓
3. About section has heading + full paragraphs of text? ✓
4. Services section has cards with names + descriptions? ✓
5. Contact section has heading + form + business info? ✓
6. Footer has brand + links + social icons + copyright? ✓
7. All text from the strategy's copy object is included verbatim? ✓
8. All images from the strategy are used? ✓
9. Phone and email are clickable links? ✓
10. TEXT CONTRAST: Every section's text is readable against its background? No dark text on dark backgrounds? No light text on light backgrounds? ✓

The business owner sees this side-by-side with their current site. It MUST be dramatically better AND complete.`;

  console.log(`  → Builder using model: ${model}`);

  // Log key analysis fields to verify analyzer is providing content
  const copy = analysis.copy || {};
  const cp = analysis.contentPreserved || {};
  const strat = analysis.upgradeStrategy || {};
  console.log(`[BUILDER-DIAG] Analysis input check:`);
  console.log(`  heroHeadline: ${copy.heroHeadline ? copy.heroHeadline.substring(0, 80) : 'MISSING'}`);
  console.log(`  heroSub: ${copy.heroSub ? copy.heroSub.substring(0, 80) : 'MISSING'}`);
  console.log(`  aboutText length: ${copy.aboutText ? copy.aboutText.length : 0} chars`);
  console.log(`  services count: ${Array.isArray(copy.services) ? copy.services.length : 0}`);
  console.log(`  testimonials count: ${Array.isArray(copy.testimonials) ? copy.testimonials.length : 0}`);
  console.log(`  ctaHeading: ${copy.ctaHeading ? copy.ctaHeading.substring(0, 80) : 'MISSING'}`);
  console.log(`  heroImageUrl: ${strat.heroImageUrl ? 'YES' : 'MISSING'}`);
  console.log(`  keyImages count: ${Array.isArray(strat.keyImages) ? strat.keyImages.length : 0}`);
  console.log(`  phone: ${cp.phone || 'MISSING'} | email: ${cp.email || 'MISSING'}`);

  // Direct fetch to Anthropic streaming API — bypasses SDK's pre-flight timeout check
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 64000,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  let html = '';
  let stopReason = null;
  let outputTokens = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            html += event.delta.text;
          }
          // Capture stop reason and token usage
          if (event.type === 'message_delta') {
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            if (event.usage?.output_tokens) outputTokens = event.usage.output_tokens;
          }
        } catch (e) {
          // Skip non-JSON lines (e.g., event: headers)
        }
      }
    }
  }

  html = html.trim();

  // Diagnostic logging — this tells us exactly what happened
  console.log(`[BUILDER-DIAG] Generation complete:`);
  console.log(`  stop_reason: ${stopReason}`);
  console.log(`  output_tokens: ${outputTokens}`);
  console.log(`  HTML length: ${html.length} chars`);
  console.log(`  ends with </html>: ${html.endsWith('</html>')}`);
  console.log(`  contains </body>: ${html.includes('</body>')}`);

  // Check which sections exist in the HTML
  const sectionChecks = {
    'nav': /<nav[\s>]/i.test(html),
    'hero/h1': /<h1[\s>]/i.test(html),
    'about': /about/i.test(html) && /<h2[\s>]/i.test(html),
    'services': /service|menu|feature/i.test(html),
    'testimonial': /testimonial|review|gallery/i.test(html),
    'contact': /contact|form/i.test(html) && /<form[\s>]/i.test(html),
    'footer': /<footer[\s>]/i.test(html),
  };
  console.log(`[BUILDER-DIAG] Section presence:`, JSON.stringify(sectionChecks));

  // Log the last 200 chars to see where HTML ends
  console.log(`[BUILDER-DIAG] HTML tail (last 200 chars): ${html.substring(html.length - 200)}`);

  // Strip any markdown wrapping if present
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
  }

  // Validate it's actually HTML
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    throw new Error('Builder did not return valid HTML');
  }

  return html;
}

module.exports = { buildUpgradedSite };
// CACHE_BUST_1772913665

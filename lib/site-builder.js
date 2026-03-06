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

OUTPUT: Only the complete HTML file. No explanation, no markdown, no code fences. Start with <!DOCTYPE html> and end with </html>. All CSS in a <style> tag. All JS in a <script> tag before </body>. Google Fonts via <link> tag.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This must look like a $15,000 custom site, not a template. Before building each section, ask:
- INVERSION: "What would make this section feel like a cheap template? What would make the CTA invisible? What would make text unreadable?" Then avoid those failures.
- 5-SECOND PHONE TEST: "On a 375px phone, what does a visitor see without scrolling? Is the most important element visible?"
- BRAND CHECK: "If I removed the logo and business name, could I still tell what business this is from the design alone?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON FAILURE MODES — AVOID THESE AT ALL COSTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NO decorative full-screen sections before the hero. No giant watermark text, no spacer divs, no "cinematic reveal" sections. The hero with its headline, image, and CTAs must be the FIRST content visible after the nav.
- NO empty sections. If a section doesn't have real text content, don't include it.
- NO invisible or barely-visible decorative text (low-opacity large text as background decoration). It looks broken, not artistic.
- NO sections that are just a background color with no content.
- The hero MUST fill the first viewport with all its content visible: headline, subheadline, CTA buttons, and hero image. A visitor should not have to scroll to see any of these.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOGO (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- If "logoUrl" exists → use as <img> in nav, max-height: 40px, width: auto
- If "logoText" exists → display as styled text: font-size 1.25-1.5rem, display font, font-weight 700, letter-spacing 0.05em. If there's a subtitle/tagline, put it below at 0.65rem with lighter weight.
- If neither → use businessName as styled text in the same format
- Logo area should use display: flex; flex-direction: column; gap: 2px — NEVER let the business name and tagline run together or overlap
- Logo MUST be clearly visible against nav background. Use the navBackground color from the palette.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGES (CRITICAL — THIS IS WHAT MAKES OR BREAKS THE PREVIEW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- If "heroImageUrl" exists → MUST be used as hero background-image with background-size: cover, or as a prominent full-width image
- If "keyImages" has URLs → distribute throughout sections: about, gallery, features, testimonials background
- NEVER leave a section with just a solid color block when images are available
- NEVER use placeholder rectangles, gradient-only backgrounds, or colored divs where a real photo should be
- For restaurants/food: images of food, interiors, ambiance are ESSENTIAL — use them generously
- For personal brands: the person's photo MUST be prominently in the hero
- Use object-fit: cover on all images. Add loading="lazy" except hero.
- Check each section's imageUrl in the strategy — if it has one, USE IT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAVIGATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Fixed/sticky nav with SOLID or frosted-glass background (never transparent — text must ALWAYS be readable even over hero images)
- Use navBackground color from palette, or a solid dark/light background
- Include ALL nav links from contentPreserved.navLinks
- Primary CTA as a styled button on the right (using primary color)
- Mobile: hamburger menu with JS toggle, full-screen overlay with solid background
- All nav links must have at least 44px tap target height on mobile
- 4.5:1 contrast ratio for nav text against nav background

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT — EVERY SECTION MUST HAVE REAL, VISIBLE CONTENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use ALL copy from the strategy's "copy" object VERBATIM:
- heroHeadline and heroSub in the hero
- aboutHeading and aboutText (full paragraphs) in the about section
- services array as cards with names and descriptions
- testimonials array with real quotes and attribution
- ctaHeading and ctaText in the contact/CTA section
- footerTagline in the footer

Use ALL business info from contentPreserved:
- businessName, phone (as tel: link), email (as mailto: link), address, hours
- socialLinks as icon links in footer
- reservationUrl and menuUrl for CTA buttons if available

NO EMPTY SECTIONS. Every section must have substantial visible text content — headings AND body paragraphs. If a section has an image background, ensure text is readable with a dark overlay (rgba(0,0,0,0.4) minimum) or text-shadow. If the strategy's copy object has content for a section, you MUST include every word of it. Do not skip or truncate copy to save space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THEME-AWARE DESIGN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Check "darkTheme" in the strategy:
- LIGHT THEMES: white/off-white backgrounds, dark text, soft shadows, subtle borders, elegant spacing. Feel: clean, airy, trustworthy.
- DARK THEMES: dark backgrounds, light text, gradients, glows, dramatic contrast. Feel: moody, premium, atmospheric.
Match the brand mood: restaurants should feel atmospheric and appetizing, real estate warm and trustworthy, tech bold and innovative.

Use CSS custom properties for the ENTIRE color palette:
:root {
  --color-bg: [background];
  --color-surface: [surface];
  --color-primary: [primary];
  --color-secondary: [secondary];
  --color-text: [text];
  --color-text-secondary: [textSecondary];
  --color-nav-bg: [navBackground];
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECHNICAL STANDARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Semantic HTML5 with ARIA landmarks (nav, main, section[aria-labelledby], footer)
- Skip-to-content link as first focusable element (visually hidden, visible on focus)
- Mobile-first responsive: 375px → 768px → 1024px → 1440px
- BEM-style class naming
- 4.5:1 contrast ratio for body text, 3:1 for large text
- All SVGs with explicit width/height attributes
- prefers-reduced-motion: disable ALL animations and transitions
- All images with explicit width and height attributes

MOBILE UX (not just responsive — must feel native on phones):
- All tap targets minimum 44x44px (nav links, buttons, phone numbers, social icons)
- Primary CTA reachable in thumb zone (bottom 60% of screen)
- For restaurants/services: add a sticky bottom CTA bar on mobile that appears after scrolling past the hero
- Forms: use type="tel" for phone, type="email" for email
- Body text never below 16px on mobile
- CSS scroll-snap for any horizontal scrolling sections

ANIMATIONS:
- Smooth scroll-reveal using IntersectionObserver with a single "reveal" class
- Subtle hover effects on cards (lift with shadow) and buttons (brightness/scale)
- All animations respect prefers-reduced-motion
- Hero section should have an entrance animation (fade-in + slight translate-up)

SEO BASICS:
- Single H1 per page (the hero headline)
- Logical heading hierarchy: H1 → H2 → H3
- Meta title and description from the strategy's copy
- Canonical URL placeholder
- OG tags (og:title, og:description, og:type, og:site_name)
- JSON-LD structured data for the business type (LocalBusiness, Restaurant, etc.) with all available fields from contentPreserved

ANALYTICS READINESS:
- Add data-track="cta-primary" to primary CTA buttons
- Add data-track="cta-secondary" to secondary CTAs
- Add data-track="phone-click" to tel: links
- Add data-track="email-click" to mailto: links
- Add data-section="hero", data-section="about", etc. to major sections

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTIONS TO BUILD (in this order)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NAVIGATION: Logo (properly spaced, not cramped) + all nav links + primary CTA button. Fixed with solid background.

2. HERO: This is the FIRST section after the nav — nothing else before it. Full-viewport height (min-height: 100vh). ALL of these must be visible without scrolling: heroHeadline (as H1), heroSub, primary + secondary CTA buttons. If heroImageUrl exists: use as CSS background-image with background-size: cover and a dark gradient overlay (linear-gradient with rgba(0,0,0,0.5)) for text readability. If personal brand: feature their photo prominently. Must pass the 5-second phone test — a visitor sees the headline, understands the business, and sees the CTA without scrolling.

3. ABOUT: aboutHeading (H2) + full aboutText paragraphs. If a keyImage fits here, use it alongside the text (image + text side by side on desktop, stacked on mobile).

4. SERVICES/MENU/FEATURES: Cards with service names and descriptions from the services array. Use icons (SVG) or images if available. Grid layout: 2-3 columns on desktop, 1 on mobile.

5. TESTIMONIALS: If testimonials exist in the strategy, display them as styled quote cards with attribution and source. If no testimonials but multiple keyImages exist, create an image gallery instead.

6. CONTACT/CTA: ctaHeading (H2) + ctaText + contact form (name, email, message fields with labels) + business info display (phone, email, address, hours). Google Maps embed if address exists.

7. FOOTER: Logo/brand name, nav links, social media icon links (SVG icons for each platform found in socialLinks), copyright line with current year, footerTagline.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MAKE IT STUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- The hero should stop someone mid-scroll — big bold typography, beautiful imagery, clear CTA
- Use whitespace deliberately — generous padding between sections
- Cards should have subtle shadows and lift on hover with smooth transitions
- Typography should be refined: clamp() for responsive sizing, proper line-height, letter-spacing on headings
- Subtle gradients for depth (not flat)
- For light themes: soft box-shadows, thin borders, warm accent colors
- For dark themes: gradient overlays, subtle glows, dramatic contrast
- Section transitions: alternate background colors between sections for visual rhythm

The business owner will see this as a before/after comparison against their current site. It MUST be dramatically better at first glance while still feeling like THEIR brand — evolved, not replaced.`;

  console.log(`  → Builder using model: ${model}`);

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
      max_tokens: 32000,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  let html = '';
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
        } catch (e) {
          // Skip non-JSON lines (e.g., event: headers)
        }
      }
    }
  }

  html = html.trim();

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

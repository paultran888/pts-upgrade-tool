/**
 * Website Builder Module
 * Uses Claude API to generate a complete upgraded HTML page from the analysis strategy.
 * This is a condensed version of Part 2 (build) prompt.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

/**
 * Generate a complete self-contained HTML page from the analysis strategy
 * @param {Object} analysis — upgrade strategy from analyzer
 * @param {Object} options
 * @param {string} options.model — Claude model to use (default: sonnet for preview)
 */
async function buildUpgradedSite(analysis, { model = 'claude-sonnet-4-6' } = {}) {
  const prompt = `You are an elite frontend developer for Paul Tran Studio. Build a complete, production-quality, single-file HTML website from this upgrade strategy.

<strategy>
${JSON.stringify(analysis, null, 2)}
</strategy>

BUILD RULES:
1. Output ONLY the complete HTML file. No explanation, no markdown, no code fences. Start with <!DOCTYPE html> and end with </html>.
2. All CSS must be inline in a <style> tag in the <head>.
3. All JS must be inline in a <script> tag before </body>.
4. Load Google Fonts via <link> tag for the fonts specified in the strategy.
5. Use the EXACT color palette from the strategy as CSS custom properties.
6. Use the EXACT copy from the strategy — do not rewrite or "improve" it.
7. Preserve ALL business info from contentPreserved (name, phone, email, address, social links).

CRITICAL — IMAGE PRESERVATION:
- If the strategy includes "heroImageUrl", you MUST use it as a real <img> tag or CSS background-image in the hero section. This is the most important visual on the page.
- If the strategy includes "keyImages", use them throughout the page in appropriate sections (about, services, gallery, etc.)
- NEVER replace real photos with placeholder divs, colored blocks, or gradient backgrounds. Real imagery is what makes a site feel authentic.
- For personal brands (isPersonalBrand: true), the person's photo MUST be prominently displayed in the hero — it's their #1 trust signal.
- Use object-fit: cover for hero images to ensure they look good at any size.

THEME AND COLOR:
- Check the "darkTheme" field in the strategy. If false, build a LIGHT theme.
- For light themes: use white/off-white backgrounds, dark text, and the brand's accent colors. Light themes should feel clean, airy, and trustworthy.
- For dark themes: use dark backgrounds with light text and vibrant accent colors.
- MATCH THE BRAND MOOD — a real estate site should feel warm and trustworthy, a tech startup should feel bold and innovative, a restaurant should feel atmospheric.

DESIGN STANDARDS:
- Mobile-first responsive: 375px → 768px → 1024px → 1440px
- Semantic HTML5 with ARIA landmarks
- BEM class naming
- Smooth scroll-reveal animations (IntersectionObserver)
- prefers-reduced-motion: disable all animations
- Skip-to-content link
- 4.5:1 contrast ratio for body text
- All SVG icons must have explicit width/height attributes

SECTIONS TO BUILD (in order):
- Fixed navigation with logo + links + primary CTA button
- Hero section: headline, subheadline, primary + secondary CTA buttons, AND the hero image if one exists
- About section (include personal/team photo if available in keyImages)
- Services/features section (use cards with icons)
- Testimonials section (if data exists, otherwise skip)
- Contact section with form (name, email, message) + mailto fallback
- Footer with tagline, nav links, copyright

MAKE IT STUNNING:
- This must look like a $15,000 custom site, not a template
- Use subtle gradients, refined hover effects, polished typography
- Cards should lift on hover with smooth transitions
- The hero should stop someone mid-scroll — especially if there's a great photo, FEATURE IT prominently
- Use whitespace deliberately
- For light themes: use soft shadows, subtle borders, and elegant spacing instead of glows and neons
- For dark themes: use gradients, glows, and dramatic contrast

The business owner will see this as a before/after comparison against their current site. It MUST be dramatically better — obvious at a glance — while still feeling like THEIR brand, not someone else's.`;

  console.log(`  → Builder using model: ${model}`);
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }]
  });

  let html = response.content[0].text.trim();

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

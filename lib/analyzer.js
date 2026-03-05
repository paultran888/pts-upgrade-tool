/**
 * Website Analyzer Module
 * Uses Claude API to analyze scraped website data and produce an upgrade strategy.
 * Prompt incorporates Paul Tran Studio v5 methodology.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

/**
 * Analyze scraped website data and produce an upgrade strategy
 * @param {Object} scrapedContent — scraped website data
 * @param {Object} options
 * @param {string} options.model — Claude model to use (default: sonnet for analysis)
 */
async function analyzeWebsite(scrapedContent, { model = 'claude-sonnet-4-6' } = {}) {
  const prompt = `You are an elite website strategist for Paul Tran Studio. Analyze this existing website and produce a complete upgrade strategy.

<scraped_data>
${JSON.stringify(scrapedContent, null, 2)}
</scraped_data>

THINKING PROCESS — work through each step before writing the strategy:

1. BUSINESS IDENTIFICATION: What business is this? What do they do? What industry? Who is their customer?

2. WHAT'S WORKING: What elements of the current site should be preserved? Good branding? Decent photos? Clear contact info?

3. INVERSION — WHAT WOULD MAKE A VISITOR LEAVE IN 5 SECONDS?
Ask: "What on this current site destroys trust? Creates confusion? Looks broken or dated?" These become top-priority fixes.

4. CTA HIERARCHY:
- Primary CTA: The single most important action (Call, Book, Order, Reserve, etc.) — must be impossible to miss
- Secondary CTA: Next most valuable action (View Menu, See Work, Learn More)
- What's the shortest path from landing to taking action?

5. 5-SECOND PHONE TEST: A visitor lands on their phone. In 5 seconds, they should know: (1) what this business does, (2) why they should care, (3) what to do next.

6. IMAGE PRESERVATION (CRITICAL):
- Check the images array for hero images, team photos, food photos, interior shots
- Check backgroundImages array for CSS background-image hero banners
- Check logoUrl and logoText for the brand logo
- For personal brands: the person's photo IS their brand's most valuable visual asset
- Rank images by importance — hero and personal photos are always Priority 1

7. THEME SELECTION (light vs. dark):
Choose based on INDUSTRY and BRAND, not by default:
- Real estate, healthcare, wedding, education, consulting → LIGHT theme
- Restaurants, bars, nightlife, gaming, tech/SaaS → DARK theme
- If the original site uses a light theme and it fits the brand, keep it light
- JUSTIFY your choice

8. COLOR EVOLUTION: Your palette should EVOLVE the brand's existing colors, not replace them. Changing the color identity makes the upgrade feel like a different business.

9. COPY QUALITY — your copy must pass these tests:
- Could a competitor use this exact same headline? If yes, make it more specific
- Does it sound like AI wrote it? Kill phrases like "passionate about," "committed to excellence," "cutting-edge," "seamless experience," "holistic approach"
- Include specific numbers and details: "25 years" beats "decades," "$12 cocktails" beats "great prices"
- Match how the business actually talks, not corporate filler

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:

{
  "businessName": "extracted or inferred business name",
  "businessType": "restaurant/bar/saas/professional-service/real-estate/consultant/etc",
  "isPersonalBrand": true/false,
  "location": "city, state if found",
  "currentAssessment": {
    "designScore": 1-10,
    "whatWorks": ["list of things working well"],
    "whatsFailing": ["list of things broken or dated"],
    "wouldMakeVisitorLeave": ["specific instant-leave triggers from inversion analysis"]
  },
  "upgradeStrategy": {
    "primaryCTA": { "text": "Specific action text like 'Reserve a Table'", "action": "tel/mailto/link/form", "url": "link URL if applicable" },
    "secondaryCTA": { "text": "Specific action text like 'View Our Menu'", "action": "anchor/link", "url": "link URL if applicable" },
    "heroHeadline": "compelling, specific headline — NOT generic like 'Welcome to Our Restaurant'",
    "heroSubheadline": "supporting text that adds specificity",
    "logoUrl": "URL of the business logo image, or null if text-only",
    "logoText": "Text of the logo if no image (e.g., 'CACHÉ'), or null",
    "heroImageUrl": "URL of the most important hero/banner image — check BOTH images and backgroundImages arrays",
    "keyImages": ["ALL important image URLs to preserve — hero, about, gallery, food, team, interior, products"],
    "colorPalette": {
      "background": "#hex — main page background",
      "surface": "#hex — card/section backgrounds",
      "primary": "#hex — CTAs, accent highlights, interactive elements",
      "secondary": "#hex — secondary accents",
      "text": "#hex — main body text",
      "textSecondary": "#hex — muted/secondary text",
      "navBackground": "#hex — navigation bar background (must contrast with nav text)"
    },
    "fonts": {
      "display": "Google Font name for headlines",
      "body": "Google Font name for body text"
    },
    "mood": ["3-5 adjective words describing the visual mood"],
    "darkTheme": true/false,
    "themeRationale": "1-2 sentences explaining WHY this theme fits this business",
    "sections": [
      { "name": "hero", "purpose": "what this section does", "hasImage": true/false, "imageUrl": "URL or null" },
      { "name": "about", "purpose": "...", "hasImage": true/false, "imageUrl": "URL or null" },
      { "name": "services/menu/features", "purpose": "...", "hasImage": true/false },
      { "name": "testimonials/gallery", "purpose": "..." },
      { "name": "contact", "purpose": "..." }
    ]
  },
  "copy": {
    "metaTitle": "under 60 chars — specific to this business",
    "metaDescription": "under 155 chars — compelling and specific",
    "heroHeadline": "main headline — must pass the 'could a competitor use this?' test",
    "heroSub": "subheadline that adds detail and specificity",
    "aboutHeading": "heading for about section",
    "aboutText": "2-3 FULL paragraphs of compelling about copy. Not generic. Include specific details, history, personality. Write how the business actually talks. Vary sentence length. Use contractions. Include one personality quirk or unexpected detail.",
    "services": [
      { "name": "service/menu category name", "description": "benefit-driven description with specific details" }
    ],
    "testimonials": [
      { "text": "verbatim review text from scraped data", "author": "reviewer name if found", "source": "Google/Yelp/etc" }
    ],
    "ctaHeading": "heading for CTA/contact section",
    "ctaText": "supporting text that motivates action",
    "footerTagline": "short brand tagline"
  },
  "contentPreserved": {
    "businessName": "exact name to keep",
    "phone": "phone number if found",
    "email": "email if found",
    "address": "full address if found",
    "hours": "hours if found",
    "socialLinks": ["all social media URLs found"],
    "navLinks": ["text labels from navigation — e.g., About, Menu, Contact, Press"],
    "reservationUrl": "booking/reservation URL if found",
    "menuUrl": "menu page URL if found",
    "mapUrl": "Google Maps URL if found"
  }
}

CRITICAL RULES:
- NEVER fabricate business info, awards, credentials, or claims not found in the scraped data
- If info is missing, use null — never make things up
- Copy must sound like THIS business, not generic corporate filler
- PRESERVE KEY IMAGERY: Include ALL important image URLs. Check BOTH the images array AND backgroundImages array
- PRESERVE THE LOGO: If logoUrl exists, include it. If logoText exists, include it
- For PERSONAL BRANDS: the person's photo MUST appear prominently in the hero
- aboutText must be 2-3 real paragraphs, not one sentence. Use specific details from the scraped data
- services array must have actual items with real descriptions from the site
- If reviews/testimonials exist in the scraped paragraphs, extract them for the testimonials array`;

  console.log(`  → Analyzer using model: ${model}`);
  const response = await client.messages.create({
    model,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();

  // Parse JSON, handling potential markdown wrapping and common AI JSON errors
  let json = text;
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try parsing as-is first
  try {
    return JSON.parse(json);
  } catch (firstError) {
    console.log(`[ANALYZER] First JSON parse failed: ${firstError.message}`);
    console.log(`[ANALYZER] Attempting JSON repair...`);

    // Common AI JSON errors: trailing commas, unescaped quotes in strings, truncated output
    let repaired = json;

    // Remove trailing commas before } or ]
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // Fix unescaped newlines inside strings (replace with \\n)
    repaired = repaired.replace(/(?<=": "(?:[^"\\]|\\.)*)(?:\r?\n)(?=(?:[^"\\]|\\.)*")/g, '\\n');

    // If JSON is truncated (missing closing braces), try to close it
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    // Close any unclosed brackets/braces
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';

    try {
      const result = JSON.parse(repaired);
      console.log(`[ANALYZER] JSON repair succeeded`);
      return result;
    } catch (secondError) {
      console.error(`[ANALYZER] JSON repair also failed: ${secondError.message}`);
      console.error(`[ANALYZER] Raw output (first 500 chars): ${text.substring(0, 500)}`);

      // Last resort: retry the API call once
      console.log(`[ANALYZER] Retrying API call...`);
      const retryResponse = await client.messages.create({
        model,
        max_tokens: 6000,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your JSON output was malformed and could not be parsed. Please output the SAME analysis as valid JSON. Fix any syntax errors. Output ONLY the JSON, nothing else.' }
        ]
      });

      let retryJson = retryResponse.content[0].text.trim();
      if (retryJson.startsWith('```')) {
        retryJson = retryJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      // Remove trailing commas
      retryJson = retryJson.replace(/,\s*([}\]])/g, '$1');

      return JSON.parse(retryJson); // If this fails, let it throw — we've tried our best
    }
  }
}

module.exports = { analyzeWebsite };

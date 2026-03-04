/**
 * Website Analyzer Module
 * Uses Claude API to analyze scraped website data and produce an upgrade strategy.
 * This is a condensed version of Part 1 (research-strategy) prompt.
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

/**
 * Analyze scraped website data and produce an upgrade strategy
 * @param {Object} scrapedContent — scraped website data
 * @param {Object} options
 * @param {string} options.model — Claude model to use (default: sonnet for preview)
 */
async function analyzeWebsite(scrapedContent, { model = 'claude-sonnet-4-6' } = {}) {
  const prompt = `You are an elite website strategist for Paul Tran Studio. Analyze this existing website and produce a complete upgrade strategy.

<scraped_data>
${JSON.stringify(scrapedContent, null, 2)}
</scraped_data>

Based on the scraped data, produce a JSON upgrade strategy. Think step by step:
1. What business is this? What do they do? What industry?
2. What's working on the current site? What's broken or dated?
3. What would make a visitor leave in 5 seconds? (Inversion)
4. What's the primary CTA this business needs?
5. What visual direction would elevate this brand?
6. CRITICAL: Are there hero images or personal photos (headshots, team photos, lifestyle imagery)? For personal brands (real estate agents, consultants, coaches, lawyers, photographers), their photo IS their brand. It must be preserved.
7. What color scheme fits this industry? Match the mood to the business — warm and inviting for hospitality/real estate, bold and techy for SaaS, clean and trustworthy for professional services.

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:

{
  "businessName": "extracted or inferred business name",
  "businessType": "restaurant/bar/saas/professional-service/real-estate/consultant/etc",
  "isPersonalBrand": true/false,
  "location": "city, state if found",
  "currentAssessment": {
    "designScore": 1-10,
    "whatWorks": ["list of things working"],
    "whatsFailing": ["list of things broken/dated"],
    "wouldMakeVisitorLeave": ["list of instant-leave triggers"]
  },
  "upgradeStrategy": {
    "primaryCTA": { "text": "Book Now / Call Us / etc", "action": "tel/mailto/link/form" },
    "secondaryCTA": { "text": "View Menu / See Work / etc", "action": "anchor/link" },
    "heroHeadline": "compelling headline for the upgraded site",
    "heroSubheadline": "supporting text under the headline",
    "heroImageUrl": "URL of the most important hero/banner image from the original site, or null if none",
    "keyImages": ["URLs of the most important images to preserve from the original site"],
    "colorPalette": {
      "background": "#hex",
      "surface": "#hex",
      "primary": "#hex",
      "secondary": "#hex",
      "text": "#hex",
      "textSecondary": "#hex"
    },
    "fonts": {
      "display": "Google Font name",
      "body": "Google Font name"
    },
    "mood": ["3-5 adjective words"],
    "darkTheme": true/false,
    "sections": [
      { "name": "hero", "purpose": "what this section does" },
      { "name": "about", "purpose": "..." },
      { "name": "services", "purpose": "..." },
      { "name": "testimonials", "purpose": "..." },
      { "name": "contact", "purpose": "..." }
    ]
  },
  "copy": {
    "metaTitle": "under 60 chars",
    "metaDescription": "under 155 chars",
    "heroHeadline": "main headline",
    "heroSub": "subheadline text",
    "aboutHeading": "heading for about section",
    "aboutText": "2-3 paragraphs of compelling about copy",
    "sections": [
      { "heading": "section heading", "body": "section body text" }
    ],
    "ctaHeading": "heading for CTA/contact section",
    "ctaText": "supporting text",
    "footerTagline": "short brand tagline"
  },
  "contentPreserved": {
    "businessName": "exact name to keep",
    "phone": "phone if found",
    "email": "email if found",
    "address": "address if found",
    "hours": "hours if found",
    "socialLinks": ["urls found"]
  }
}

RULES:
- NEVER fabricate business info not found in the scraped data
- If info is missing, use null
- Copy should sound like the business, not generic corporate
- Color palette should EVOLVE the brand, not replace it. If the current site uses warm blues, use refined warm blues — don't switch to black and gold
- If the current site has good branding colors, preserve and REFINE them — do NOT completely change the color identity
- THEME SELECTION: Choose light or dark based on the INDUSTRY and BRAND, not by default:
  * Real estate, healthcare, wedding, education, consulting → LIGHT theme (trustworthy, approachable)
  * Restaurants, bars, nightlife, gaming, tech/SaaS → DARK theme (moody, premium)
  * If the original site uses a light theme and it fits the brand, keep it light
  * Only use dark if it genuinely serves the brand
- PRESERVE KEY IMAGERY: If the original site has hero photos, headshots, team photos, or product images, include their URLs in heroImageUrl and keyImages. These are critical brand assets
- For PERSONAL BRANDS (real estate agents, coaches, consultants, lawyers): the person's photo is their #1 trust signal. It MUST appear prominently in the hero
- The hero headline should pass the "could a competitor use this?" test — if yes, make it more specific`;

  console.log(`  → Analyzer using model: ${model}`);
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();

  // Parse JSON, handling potential markdown wrapping
  let json = text;
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(json);
}

module.exports = { analyzeWebsite };

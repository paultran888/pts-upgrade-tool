/**
 * Paul Tran Studio — Website Upgrade Tool
 * Free preview tool + lead capture. No payments — leads book a call.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { scrapeWebsite, closeBrowser } = require('./lib/scraper');
const { analyzeWebsite } = require('./lib/analyzer');
const { buildUpgradedSite } = require('./lib/builder');
const { screenshotHTML } = require('./lib/screenshoter');

const app = express();
const PORT = process.env.PORT || 3090;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JOBS_DIR = path.join(__dirname, 'data', 'jobs');
const LEADS_DIR = path.join(__dirname, 'data', 'leads');
const SCREENSHOTS_DIR = path.join(__dirname, 'public', 'screenshots');

/* ── Model Config ── */
const MODEL = 'claude-sonnet-4-6';

// Ensure directories exist
[JOBS_DIR, LEADS_DIR, SCREENSHOTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ============================================
   MIDDLEWARE
   ============================================ */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================
   JOB PERSISTENCE (JSON files for MVP)
   ============================================ */
function getJob(jobId) {
  const fp = path.join(JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveJob(job) {
  const fp = path.join(JOBS_DIR, `${job.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(job, null, 2));
}

/* ============================================
   API: ANALYZE WEBSITE
   POST /api/analyze { url: "https://example.com" }
   Returns: { jobId, status }
   ============================================ */
app.post('/api/analyze', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const jobId = uuidv4().split('-')[0]; // Short ID
  const job = {
    id: jobId,
    url: parsedUrl.href,
    status: 'queued',
    progress: 0,
    progressMessage: 'Starting analysis...',
    createdAt: new Date().toISOString(),
    analysis: null,
    generatedHtml: null,
    beforeScreenshot: null,
    afterScreenshot: null,
    error: null
  };

  saveJob(job);

  // Start processing in background (non-blocking)
  processJob(jobId).catch(err => {
    console.error(`Job ${jobId} failed:`, err.message);
  });

  res.json({ jobId, status: 'queued' });
});

/* ============================================
   API: GET JOB STATUS
   GET /api/status/:jobId
   ============================================ */
app.get('/api/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    url: job.url,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    progressDetail: job.progressDetail || '',
    beforeScreenshot: job.beforeScreenshot ? `/screenshots/${job.id}-before.png` : null,
    afterScreenshot: job.afterScreenshot ? `/screenshots/${job.id}-after.png` : null,
    analysis: job.status === 'complete' ? {
      businessName: job.analysis?.businessName,
      businessType: job.analysis?.businessType,
      designScore: job.analysis?.currentAssessment?.designScore
    } : null,
    error: job.error,
    createdAt: job.createdAt
  });
});

/* ============================================
   API: PREVIEW GENERATED HTML
   GET /api/preview/:jobId
   ============================================ */
app.get('/api/preview/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || !job.generatedHtml) {
    return res.status(404).send('Preview not available');
  }
  res.type('html').send(job.generatedHtml);
});

/* ============================================
   API: CAPTURE LEAD
   POST /api/lead { jobId, name, email, phone, message }
   ============================================ */
app.post('/api/lead', (req, res) => {
  const { jobId, name, email, phone, message } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const job = jobId ? getJob(jobId) : null;

  const lead = {
    id: uuidv4().split('-')[0],
    jobId: jobId || null,
    url: job?.url || null,
    businessName: job?.analysis?.businessName || null,
    name: name || null,
    email,
    phone: phone || null,
    message: message || null,
    createdAt: new Date().toISOString()
  };

  // Save lead
  const fp = path.join(LEADS_DIR, `${lead.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(lead, null, 2));

  // Append to summary file for easy scanning
  try {
    const summaryPath = path.join(__dirname, 'data', 'LEADS.txt');
    const line = `NEW LEAD: ${lead.businessName || lead.url || 'Unknown'}\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone || 'N/A'}\nMessage: ${lead.message || 'N/A'}\nJob: ${lead.jobId || 'N/A'}\nTime: ${lead.createdAt}\n---\n`;
    fs.appendFileSync(summaryPath, line);
  } catch (e) { /* ignore */ }

  console.log(`NEW LEAD: ${lead.email} — ${lead.businessName || lead.url}`);

  res.json({ success: true });
});

/* ============================================
   JOB PROCESSING PIPELINE
   ============================================ */
async function processJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  console.log(`[PREVIEW] Job ${jobId} — using ${MODEL}`);

  try {
    // Step 1: Scrape
    updateJob(jobId, { status: 'processing', progress: 10, progressMessage: 'Scanning your website...', progressDetail: 'Loading your site in a real browser and capturing every element — layout, colors, fonts, images, and content.' });
    const scraped = await scrapeWebsite(job.url, jobId, SCREENSHOTS_DIR);
    updateJob(jobId, { progress: 30, progressMessage: 'Website scanned successfully', progressDetail: 'Got it. Your current site has been fully captured. Moving on to the deep analysis.', beforeScreenshot: true });

    // Step 2: AI analysis
    updateJob(jobId, { progress: 35, progressMessage: 'Analyzing your design and conversion flow...', progressDetail: 'Our AI is reviewing your layout, copy, calls-to-action, SEO structure, and mobile experience — the same analysis a senior designer would do.' });
    const analysis = await analyzeWebsite(scraped.content, { model: MODEL });
    updateJob(jobId, { progress: 55, progressMessage: 'Analysis complete. Building upgrade strategy...', progressDetail: 'Found opportunities to improve. Now writing a custom upgrade strategy for your specific business.', analysis });

    // Step 3: AI build
    updateJob(jobId, { progress: 60, progressMessage: 'Writing custom HTML from scratch...', progressDetail: 'This isn\'t a template — our AI is writing a completely new page tailored to your brand, with modern design patterns and conversion-optimized layout.' });
    const html = await buildUpgradedSite(analysis, { model: MODEL });
    updateJob(jobId, { progress: 85, progressMessage: 'Upgrade built. Generating preview...', progressDetail: 'Your upgraded site is ready. Now capturing a screenshot so you can compare side-by-side.', generatedHtml: html });

    // Step 4: Screenshot
    const afterPath = path.join(SCREENSHOTS_DIR, `${jobId}-after.png`);
    await screenshotHTML(html, afterPath);
    updateJob(jobId, { status: 'complete', progress: 100, progressMessage: 'Your upgrade is ready!', progressDetail: '', afterScreenshot: true });

    console.log(`[PREVIEW] Job ${jobId} complete — ${analysis.businessName || job.url}`);

  } catch (err) {
    console.error(`Job ${jobId} error:`, err);
    updateJob(jobId, {
      status: 'error',
      progress: 0,
      progressMessage: 'Something went wrong. Please try again.',
      error: err.message
    });
  }
}

function updateJob(jobId, updates) {
  const job = getJob(jobId);
  if (!job) return;
  Object.assign(job, updates);
  saveJob(job);
}

/* ============================================
   404 FALLBACK
   ============================================ */
app.use((req, res) => {
  res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Not Found</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0A0E1A;color:#F1F5F9;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}h1{font-size:2rem;margin-bottom:1rem}p{color:#94A3B8;margin-bottom:2rem}a{color:#3B82F6;font-weight:600;text-decoration:none}</style>
</head><body><div><h1>404</h1><p>Page not found.</p><a href="/">Go Home</a></div></body></html>`);
});

/* ============================================
   START SERVER
   ============================================ */
app.listen(PORT, () => {
  console.log(`Paul Tran Studio Upgrade Tool running on port ${PORT}`);
  console.log(`Open ${BASE_URL} to get started`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

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

/* ── Persistent data paths (set DATA_DIR to a Railway volume mount, e.g. /data) ── */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const LEADS_DIR = path.join(DATA_DIR, 'leads');
const SCREENSHOTS_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'screenshots')        // Volume: screenshots persist alongside jobs
  : path.join(__dirname, 'public', 'screenshots'); // Local dev: serve from public/

/* ── Model Config ── */
const MODEL = 'claude-sonnet-4-6';

/* ── Preview expiry (30 days) ── */
const PREVIEW_TTL_DAYS = 30;
const PREVIEW_TTL_MS = PREVIEW_TTL_DAYS * 24 * 60 * 60 * 1000;

/* ══════════════════════════════════════════════
   ABUSE PREVENTION — Rate Limits & Guardrails
   ══════════════════════════════════════════════ */
const RATE_LIMIT_PER_IP     = parseInt(process.env.RATE_LIMIT_PER_IP, 10)     || 3;   // Max analyses per IP per day
const RATE_LIMIT_CONCURRENT = parseInt(process.env.RATE_LIMIT_CONCURRENT, 10) || 1;   // Max in-flight jobs per IP
const GLOBAL_DAILY_CAP      = parseInt(process.env.GLOBAL_DAILY_CAP, 10)      || 50;  // Max total analyses per day (server-wide)
const URL_COOLDOWN_HOURS    = parseInt(process.env.URL_COOLDOWN_HOURS, 10)    || 24;  // Skip re-analyzing same URL within this window
const MIN_SUBMIT_TIME_MS    = 2000; // Minimum time between page load and submit (bot detection)

// In-memory rate tracking (resets on redeploy, which is fine for Railway)
const ipRequestLog  = new Map(); // IP -> [{ timestamp, jobId }]
let   globalDailyCount = 0;
let   globalDayKey     = todayKey();

function todayKey() { return new Date().toISOString().slice(0, 10); }

function resetDailyCountIfNeeded() {
  const today = todayKey();
  if (globalDayKey !== today) {
    globalDailyCount = 0;
    globalDayKey = today;
    ipRequestLog.clear(); // Fresh day, clear all IP logs
  }
}

function getIp(req) {
  // Railway / Cloudflare / nginx proxy
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || req.ip;
}

function getIpLog(ip) {
  if (!ipRequestLog.has(ip)) ipRequestLog.set(ip, []);
  return ipRequestLog.get(ip);
}

function countTodayRequests(ip) {
  const log = getIpLog(ip);
  const dayStart = new Date(todayKey()).getTime();
  return log.filter(e => e.timestamp >= dayStart).length;
}

function countActiveJobs(ip) {
  const log = getIpLog(ip);
  return log.filter(e => {
    const job = getJob(e.jobId);
    return job && (job.status === 'queued' || job.status === 'processing');
  }).length;
}

function recentUrlMatch(url) {
  // Check if this exact URL (normalized) was analyzed recently
  const cutoff = Date.now() - (URL_COOLDOWN_HOURS * 60 * 60 * 1000);
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const fp = path.join(JOBS_DIR, file);
      const job = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (job.url === url && new Date(job.createdAt).getTime() > cutoff && job.status === 'complete') {
        return job.id; // Return existing jobId so we can reuse it
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

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
  const { url, _hp, _t } = req.body; // _hp = honeypot, _t = page load timestamp

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // ── Bot detection: honeypot field should be empty ──
  if (_hp) {
    console.log(`[BLOCKED] Honeypot triggered from ${getIp(req)}`);
    return res.status(400).json({ error: 'Invalid request' });
  }

  // ── Bot detection: too fast (submitted < 2s after page load) ──
  if (_t && (Date.now() - parseInt(_t, 10)) < MIN_SUBMIT_TIME_MS) {
    console.log(`[BLOCKED] Too-fast submit from ${getIp(req)} (${Date.now() - parseInt(_t, 10)}ms)`);
    return res.status(429).json({ error: 'Please wait a moment before submitting.' });
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // ── Block obviously invalid targets ──
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'test.com'];
  if (blockedHosts.some(h => hostname === h) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return res.status(400).json({ error: 'Please enter a real website URL' });
  }

  // ── Rate limiting ──
  resetDailyCountIfNeeded();
  const ip = getIp(req);

  // Global daily cap
  if (globalDailyCount >= GLOBAL_DAILY_CAP) {
    console.log(`[RATE LIMIT] Global daily cap (${GLOBAL_DAILY_CAP}) reached`);
    return res.status(429).json({ error: 'Our tool is very popular today! Please try again tomorrow.' });
  }

  // Per-IP daily limit
  if (countTodayRequests(ip) >= RATE_LIMIT_PER_IP) {
    console.log(`[RATE LIMIT] IP ${ip} hit daily limit (${RATE_LIMIT_PER_IP})`);
    return res.status(429).json({ error: `You've used all ${RATE_LIMIT_PER_IP} free analyses for today. Come back tomorrow, or contact us to get started now.` });
  }

  // Per-IP concurrent limit
  if (countActiveJobs(ip) >= RATE_LIMIT_CONCURRENT) {
    console.log(`[RATE LIMIT] IP ${ip} has active job in progress`);
    return res.status(429).json({ error: 'You already have an analysis in progress. Please wait for it to finish.' });
  }

  // ── URL dedup: reuse recent result for same URL ──
  const existingJobId = recentUrlMatch(parsedUrl.href);
  if (existingJobId) {
    console.log(`[DEDUP] Reusing job ${existingJobId} for ${parsedUrl.href} (IP: ${ip})`);
    return res.json({ jobId: existingJobId, status: 'complete', reused: true });
  }

  // ── All checks passed — create job ──
  const jobId = uuidv4().split('-')[0]; // Short ID
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
  const job = {
    id: jobId,
    url: parsedUrl.href,
    ip: ip, // Track for logging
    status: 'queued',
    progress: 0,
    progressMessage: 'Starting analysis...',
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    analysis: null,
    generatedHtml: null,
    beforeScreenshot: null,
    afterScreenshot: null,
    error: null
  };

  saveJob(job);
  globalDailyCount++;
  getIpLog(ip).push({ timestamp: Date.now(), jobId });

  // Start processing in background (non-blocking)
  processJob(jobId).catch(err => {
    console.error(`Job ${jobId} failed:`, err.message);
  });

  console.log(`[NEW JOB] ${jobId} for ${parsedUrl.href} (IP: ${ip}, today: ${countTodayRequests(ip)}/${RATE_LIMIT_PER_IP}, global: ${globalDailyCount}/${GLOBAL_DAILY_CAP})`);
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
    createdAt: job.createdAt,
    expiresAt: job.expiresAt || null
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
/**
 * Timed sub-updates — fires progress messages at intervals during long AI calls
 * so the user never stares at a frozen progress bar.
 */
function startSubUpdates(jobId, steps, intervalMs = 6000) {
  let i = 0;
  const timer = setInterval(() => {
    if (i >= steps.length) { clearInterval(timer); return; }
    updateJob(jobId, steps[i]);
    i++;
  }, intervalMs);
  return timer;
}

async function processJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  console.log(`[PREVIEW] Job ${jobId} — using ${MODEL}`);

  try {
    // ── Step 1: Scrape ──
    updateJob(jobId, { status: 'processing', progress: 10, progressMessage: 'Scanning your website...', progressDetail: 'Loading your site in a real browser and capturing every element — layout, colors, fonts, images, and content.' });

    const scrapeUpdates = startSubUpdates(jobId, [
      { progress: 15, progressMessage: 'Reading your page structure...', progressDetail: 'Mapping out your navigation, headers, sections, and footer to understand the full layout.' },
      { progress: 20, progressMessage: 'Capturing visual design...', progressDetail: 'Analyzing your color palette, typography, spacing, and imagery for the redesign.' },
      { progress: 25, progressMessage: 'Extracting content and links...', progressDetail: 'Pulling your headlines, body text, calls-to-action, and internal links.' },
    ], 5000);

    const scraped = await scrapeWebsite(job.url, jobId, SCREENSHOTS_DIR);
    clearInterval(scrapeUpdates);
    updateJob(jobId, { progress: 30, progressMessage: 'Website scanned successfully', progressDetail: 'Got it. Your current site has been fully captured. Moving on to the deep analysis.', beforeScreenshot: true });

    // ── Step 2: AI Analysis ──
    updateJob(jobId, { progress: 35, progressMessage: 'Analyzing your design and conversion flow...', progressDetail: 'Our AI is reviewing your layout, copy, calls-to-action, SEO structure, and mobile experience — the same analysis a senior designer would do.' });

    const analysisUpdates = startSubUpdates(jobId, [
      { progress: 38, progressMessage: 'Evaluating mobile responsiveness...', progressDetail: 'Checking how your site looks and performs on phones and tablets — over 60% of web traffic is mobile.' },
      { progress: 41, progressMessage: 'Reviewing SEO structure...', progressDetail: 'Analyzing your meta tags, heading hierarchy, structured data, and content organization for search engines.' },
      { progress: 44, progressMessage: 'Scoring your calls-to-action...', progressDetail: 'Evaluating button placement, form design, and conversion paths — are visitors being guided to take action?' },
      { progress: 47, progressMessage: 'Assessing visual hierarchy...', progressDetail: 'Looking at how your design directs attention. Good hierarchy means visitors see the right things first.' },
      { progress: 50, progressMessage: 'Benchmarking against modern standards...', progressDetail: 'Comparing your design patterns to current best practices used by top-performing sites in your industry.' },
      { progress: 53, progressMessage: 'Finalizing analysis report...', progressDetail: 'Compiling all findings into an upgrade strategy tailored to your specific business and audience.' },
    ], 8000);

    const analysis = await analyzeWebsite(scraped.content, { model: MODEL });
    clearInterval(analysisUpdates);
    updateJob(jobId, { progress: 55, progressMessage: 'Analysis complete — building your upgrade strategy', progressDetail: 'Found opportunities to improve. Now writing a custom upgrade strategy for your specific business.', analysis });

    // ── Step 3: AI Build ──
    updateJob(jobId, { progress: 60, progressMessage: 'Writing custom HTML from scratch...', progressDetail: 'This isn\'t a template — our AI is writing a completely new page tailored to your brand, with modern design patterns and conversion-optimized layout.' });

    const buildUpdates = startSubUpdates(jobId, [
      { progress: 63, progressMessage: 'Crafting your new hero section...', progressDetail: 'Designing the first thing visitors see — a compelling headline, clear value proposition, and strong call-to-action.' },
      { progress: 66, progressMessage: 'Building navigation and layout...', progressDetail: 'Creating a clean, intuitive navigation structure and responsive page layout that works on every screen size.' },
      { progress: 69, progressMessage: 'Designing content sections...', progressDetail: 'Laying out your services, features, and key selling points in a modern, scannable format.' },
      { progress: 72, progressMessage: 'Adding social proof and trust signals...', progressDetail: 'Incorporating testimonials, credentials, and trust elements that help convert visitors into customers.' },
      { progress: 75, progressMessage: 'Optimizing forms and CTAs...', progressDetail: 'Designing conversion-focused contact forms and call-to-action buttons with proven placement strategies.' },
      { progress: 78, progressMessage: 'Applying your brand colors and typography...', progressDetail: 'Matching your brand identity while modernizing the visual feel — your site, but elevated.' },
      { progress: 81, progressMessage: 'Polishing responsive design...', progressDetail: 'Fine-tuning the layout for phones, tablets, and desktops so it looks sharp everywhere.' },
      { progress: 83, progressMessage: 'Final code review...', progressDetail: 'Cleaning up the code, optimizing performance, and ensuring everything renders perfectly.' },
    ], 7000);

    const html = await buildUpgradedSite(analysis, { model: MODEL });
    clearInterval(buildUpdates);
    updateJob(jobId, { progress: 85, progressMessage: 'Upgrade built! Generating preview...', progressDetail: 'Your upgraded site is ready. Now capturing a screenshot so you can compare side-by-side.', generatedHtml: html });

    // ── Step 4: Screenshot ──
    updateJob(jobId, { progress: 90, progressMessage: 'Capturing your before & after screenshots...', progressDetail: 'Taking high-resolution screenshots of both versions for the side-by-side comparison.' });
    const afterPath = path.join(SCREENSHOTS_DIR, `${jobId}-after.png`);
    await screenshotHTML(html, afterPath);
    updateJob(jobId, { progress: 95, progressMessage: 'Almost there — preparing your results...', progressDetail: 'Packaging everything up for the big reveal.' });

    // Brief pause so user sees the 95% message before completion
    await new Promise(r => setTimeout(r, 1500));
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
   SERVE SCREENSHOTS FROM VOLUME (when DATA_DIR is set)
   ============================================ */
if (process.env.DATA_DIR) {
  app.use('/screenshots', express.static(SCREENSHOTS_DIR));
}

/* ============================================
   AUTO-CLEANUP: Remove previews older than 30 days
   Runs once on startup, then every 24 hours.
   ============================================ */
function cleanupExpiredJobs() {
  try {
    const now = Date.now();
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    let cleaned = 0;

    for (const file of files) {
      const fp = path.join(JOBS_DIR, file);
      const job = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const createdAt = new Date(job.createdAt).getTime();

      if (now - createdAt > PREVIEW_TTL_MS) {
        // Remove job file
        fs.unlinkSync(fp);

        // Remove associated screenshots
        const jobId = job.id;
        const beforePath = path.join(SCREENSHOTS_DIR, `${jobId}-before.png`);
        const afterPath = path.join(SCREENSHOTS_DIR, `${jobId}-after.png`);
        if (fs.existsSync(beforePath)) fs.unlinkSync(beforePath);
        if (fs.existsSync(afterPath)) fs.unlinkSync(afterPath);

        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[CLEANUP] Removed ${cleaned} expired preview(s) older than ${PREVIEW_TTL_DAYS} days`);
    }
  } catch (err) {
    console.error('[CLEANUP] Error:', err.message);
  }
}

// Run cleanup on startup and every 24 hours
cleanupExpiredJobs();
setInterval(cleanupExpiredJobs, 24 * 60 * 60 * 1000);

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

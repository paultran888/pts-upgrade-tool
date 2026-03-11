/**
 * Paul Tran Studio — Website Upgrade Tool
 * Analysis-first flow: free report → payment → Opus build
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { scrapeWebsite, closeBrowser } = require('./lib/scraper');
const { analyzeWebsite } = require('./lib/analyzer');
const { buildUpgradedSite, buildTeaserSite } = require('./lib/site-builder');
const { screenshotHTML } = require('./lib/screenshoter');
const { auditWebsite } = require('./lib/auditor');

/* ── Stripe (optional — works without it, just hides checkout) ── */
let stripe = null;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('[STRIPE] Initialized');
} else {
  console.log('[STRIPE] No STRIPE_SECRET_KEY — checkout disabled');
}

/* ── Resend (optional — works without it, just skips emails) ── */
let resend = null;
const RESEND_FROM = process.env.RESEND_FROM || 'Paul Tran Studio <hello@paultranstudio.com>';
const PAUL_EMAIL = process.env.PAUL_EMAIL || 'paul@paultranstudio.com';
if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('[RESEND] Initialized');
} else {
  console.log('[RESEND] No RESEND_API_KEY — emails disabled');
}

const app = express();
const PORT = process.env.PORT || 3090;
const BASE_URL = process.env.BASE_URL || 'https://pts-upgrade-tool-production.up.railway.app';

/* ── Persistent data paths ── */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const LEADS_DIR = path.join(DATA_DIR, 'leads');
const SCREENSHOTS_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'screenshots')
  : path.join(__dirname, 'public', 'screenshots');

/* ── Model Config ── */
const ANALYZE_MODEL = process.env.ANALYZE_MODEL || 'claude-sonnet-4-6';
const BUILD_MODEL = process.env.BUILD_MODEL || 'claude-opus-4-6';

/* ── Preview expiry (30 days) ── */
const PREVIEW_TTL_DAYS = 30;
const PREVIEW_TTL_MS = PREVIEW_TTL_DAYS * 24 * 60 * 60 * 1000;

/* ══════════════════════════════════════════════
   ABUSE PREVENTION
   ══════════════════════════════════════════════ */
const RATE_LIMIT_PER_IP     = parseInt(process.env.RATE_LIMIT_PER_IP, 10)     || 3;
const RATE_LIMIT_CONCURRENT = parseInt(process.env.RATE_LIMIT_CONCURRENT, 10) || 1;
const GLOBAL_DAILY_CAP      = parseInt(process.env.GLOBAL_DAILY_CAP, 10)      || 50;
const URL_COOLDOWN_HOURS    = parseInt(process.env.URL_COOLDOWN_HOURS, 10)    || 24;
const MIN_SUBMIT_TIME_MS    = 2000;

const ipRequestLog  = new Map();
let   globalDailyCount = 0;
let   globalDayKey     = todayKey();

function todayKey() { return new Date().toISOString().slice(0, 10); }

function resetDailyCountIfNeeded() {
  const today = todayKey();
  if (globalDayKey !== today) {
    globalDailyCount = 0;
    globalDayKey = today;
    ipRequestLog.clear();
  }
}

function getIp(req) {
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
    return job && (job.status === 'queued' || job.status === 'analyzing' || job.status === 'building');
  }).length;
}

function recentUrlMatch(url) {
  const cutoff = Date.now() - (URL_COOLDOWN_HOURS * 60 * 60 * 1000);
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const fp = path.join(JOBS_DIR, file);
      const job = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (job.url === url && new Date(job.createdAt).getTime() > cutoff && (job.status === 'analyzed' || job.status === 'complete')) {
        return job.id;
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
// Stripe webhook needs raw body — must be BEFORE express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const jobId = session.metadata?.jobId;
    const customerEmail = session.customer_details?.email || session.metadata?.email;

    console.log(`[STRIPE] Payment received for job ${jobId} from ${customerEmail}`);

    if (jobId) {
      const job = getJob(jobId);
      if (job) {
        job.paid = true;
        job.paidAt = new Date().toISOString();
        job.customerEmail = customerEmail;
        job.stripeSessionId = session.id;
        job.amountPaid = session.amount_total;
        saveJob(job);

        // Trigger build phase in background (Opus build happens AFTER payment)
        processBuild(jobId).catch(err => {
          console.error(`[BUILD] Job ${jobId} post-payment build failed:`, err.message);
        });
      }
    }

    // Notify Paul
    await sendEmail({
      to: PAUL_EMAIL,
      subject: `💰 Payment! ${session.metadata?.businessName || 'Website Upgrade'} — $${(session.amount_total / 100).toFixed(0)}`,
      html: `<h2>New payment received!</h2>
        <p><strong>Customer:</strong> ${customerEmail}</p>
        <p><strong>Business:</strong> ${session.metadata?.businessName || 'N/A'}</p>
        <p><strong>URL:</strong> ${session.metadata?.url || 'N/A'}</p>
        <p><strong>Amount:</strong> $${(session.amount_total / 100).toFixed(0)}</p>
        <p><strong>Job ID:</strong> ${jobId}</p>
        <p>Build started automatically. Preview will be ready shortly.</p>`
    });

    // Send confirmation to customer
    if (customerEmail) {
      await sendEmail({
        to: customerEmail,
        subject: 'Payment Confirmed — Building Your Upgrade Now!',
        html: `<h2>You're all set!</h2>
          <p>Your payment is confirmed and we're building your upgraded site right now. This typically takes 1-2 minutes.</p>
          <p>We'll email you the preview link as soon as it's ready.</p>
          <p>Paul will also personally review and polish your upgrade before final delivery within 24 hours.</p>
          <p>— Paul Tran Studio</p>`
      });
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================
   JOB PERSISTENCE
   ============================================ */
function getJob(jobId) {
  const fp = path.join(JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveJob(job) {
  const htmlContent = job.generatedHtml;
  if (htmlContent && htmlContent !== '__FILE__') {
    const revealOverride = '.reveal,.reveal-left,.reveal-right,.reveal--visible,[class*="reveal"]{opacity:1!important;transform:none!important;transition:none!important;visibility:visible!important;}';
    const contrastFix = 'h1,h2,h3,h4,h5,h6{color:var(--color-text)!important;}p,li,span:not(.nav *),td,th,label,blockquote,figcaption,.description,.subtitle,.tagline{color:var(--color-text-secondary,var(--color-text))!important;}';
    const allFixes = '\n<style>' + revealOverride + contrastFix + '</style>';
    let fixedHtml = htmlContent;
    if (htmlContent.includes('</head>')) {
      fixedHtml = htmlContent.replace('</head>', allFixes + '\n</head>');
    } else {
      fixedHtml = htmlContent + allFixes;
    }
    const htmlPath = path.join(JOBS_DIR, `${job.id}.html`);
    fs.writeFileSync(htmlPath, fixedHtml, 'utf8');
    console.log(`[SAVE] Wrote ${htmlContent.length} chars of HTML to ${job.id}.html`);
    job.generatedHtml = '__FILE__';
  }
  const fp = path.join(JOBS_DIR, `${job.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(job, null, 2));
}

function getJobHtml(jobId) {
  const htmlPath = path.join(JOBS_DIR, `${jobId}.html`);
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf8');
  }
  const job = getJob(jobId);
  if (job && job.generatedHtml && job.generatedHtml !== '__FILE__') {
    return job.generatedHtml;
  }
  return null;
}

function getJobTeaserHtml(jobId) {
  const htmlPath = path.join(JOBS_DIR, `${jobId}-teaser.html`);
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf8');
  }
  return null;
}

/* ============================================
   API: QUICK AUDIT (No AI — fast, lightweight)
   ============================================ */
const AUDIT_RATE_PER_IP = parseInt(process.env.AUDIT_RATE_PER_IP, 10) || 10;
const auditIpLog = new Map();

function countTodayAudits(ip) {
  if (!auditIpLog.has(ip)) return 0;
  const dayStart = new Date(todayKey()).getTime();
  return auditIpLog.get(ip).filter(ts => ts >= dayStart).length;
}

app.post('/api/audit', async (req, res) => {
  const { url, _hp, _t } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (_hp) return res.status(400).json({ error: 'Invalid request' });
  if (_t && (Date.now() - parseInt(_t, 10)) < MIN_SUBMIT_TIME_MS) {
    return res.status(429).json({ error: 'Please wait a moment before submitting.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'test.com'];
  if (blockedHosts.some(h => hostname === h) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return res.status(400).json({ error: 'Please enter a real website URL' });
  }

  resetDailyCountIfNeeded();
  const ip = getIp(req);

  if (countTodayAudits(ip) >= AUDIT_RATE_PER_IP) {
    return res.status(429).json({ error: `You've used all ${AUDIT_RATE_PER_IP} free audits for today. Come back tomorrow!` });
  }

  // Track this audit
  if (!auditIpLog.has(ip)) auditIpLog.set(ip, []);
  auditIpLog.get(ip).push(Date.now());

  console.log(`[AUDIT] Starting audit for ${parsedUrl.href} (IP: ${ip})`);

  try {
    const result = await auditWebsite(parsedUrl.href);
    console.log(`[AUDIT] Complete: ${parsedUrl.href} — Score: ${result.score}/100`);
    res.json(result);
  } catch (err) {
    console.error(`[AUDIT] Failed for ${parsedUrl.href}:`, err.message);
    const userMessage = err.message.includes('timeout') || err.message.includes('Timeout')
      ? 'This site took too long to load. It may be down or blocking our scanner.'
      : 'We couldn\'t reach this website. Please check the URL and try again.';
    res.status(500).json({ error: userMessage });
  }
});

/* ============================================
   API: ANALYZE WEBSITE (Phase 1 only — cheap Sonnet call)
   ============================================ */
app.post('/api/analyze', (req, res) => {
  const { url, _hp, _t } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (_hp) {
    console.log(`[BLOCKED] Honeypot triggered from ${getIp(req)}`);
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (_t && (Date.now() - parseInt(_t, 10)) < MIN_SUBMIT_TIME_MS) {
    console.log(`[BLOCKED] Too-fast submit from ${getIp(req)} (${Date.now() - parseInt(_t, 10)}ms)`);
    return res.status(429).json({ error: 'Please wait a moment before submitting.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'test.com'];
  if (blockedHosts.some(h => hostname === h) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return res.status(400).json({ error: 'Please enter a real website URL' });
  }

  resetDailyCountIfNeeded();
  const ip = getIp(req);

  if (globalDailyCount >= GLOBAL_DAILY_CAP) {
    console.log(`[RATE LIMIT] Global daily cap (${GLOBAL_DAILY_CAP}) reached`);
    return res.status(429).json({ error: 'Our tool is very popular today! Please try again tomorrow.' });
  }

  if (countTodayRequests(ip) >= RATE_LIMIT_PER_IP) {
    console.log(`[RATE LIMIT] IP ${ip} hit daily limit (${RATE_LIMIT_PER_IP})`);
    return res.status(429).json({ error: `You've used all ${RATE_LIMIT_PER_IP} free analyses for today. Come back tomorrow, or contact us to get started now.` });
  }

  if (countActiveJobs(ip) >= RATE_LIMIT_CONCURRENT) {
    console.log(`[RATE LIMIT] IP ${ip} has active job in progress`);
    return res.status(429).json({ error: 'You already have an analysis in progress. Please wait for it to finish.' });
  }

  const existingJobId = recentUrlMatch(parsedUrl.href);
  if (existingJobId) {
    const existingJob = getJob(existingJobId);
    console.log(`[DEDUP] Reusing job ${existingJobId} for ${parsedUrl.href} (IP: ${ip})`);
    return res.json({ jobId: existingJobId, status: existingJob?.status || 'analyzed', reused: true });
  }

  const jobId = uuidv4().split('-')[0];
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
  const job = {
    id: jobId,
    url: parsedUrl.href,
    ip: ip,
    status: 'queued',
    progress: 0,
    progressMessage: 'Starting analysis...',
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    analysis: null,
    generatedHtml: null,
    beforeScreenshot: null,
    afterScreenshot: null,
    paid: false,
    error: null
  };

  saveJob(job);
  globalDailyCount++;
  getIpLog(ip).push({ timestamp: Date.now(), jobId });

  // Phase 1 only: scrape + analyze (cheap Sonnet call)
  processAnalysis(jobId).catch(err => {
    console.error(`Job ${jobId} analysis failed:`, err.message);
  });

  console.log(`[NEW JOB] ${jobId} for ${parsedUrl.href} (IP: ${ip}, today: ${countTodayRequests(ip)}/${RATE_LIMIT_PER_IP}, global: ${globalDailyCount}/${GLOBAL_DAILY_CAP})`);
  res.json({ jobId, status: 'queued' });
});

/* ============================================
   API: GET JOB STATUS
   ============================================ */
app.get('/api/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const response = {
    id: job.id,
    url: job.url,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    progressDetail: job.progressDetail || '',
    paid: job.paid || false,
    beforeScreenshot: job.beforeScreenshot ? `/screenshots/${job.id}-before.png` : null,
    afterScreenshot: job.afterScreenshot ? `/screenshots/${job.id}-after.png` : null,
    teaserScreenshot: job.teaserScreenshot ? `/screenshots/${job.id}-teaser.png` : null,
    error: job.error,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt || null
  };

  // Include full analysis when report is ready (analyzed or later)
  if (job.analysis && (job.status === 'analyzed' || job.status === 'building' || job.status === 'complete')) {
    response.analysis = {
      businessName: job.analysis.businessName,
      businessType: job.analysis.businessType,
      currentAssessment: job.analysis.currentAssessment,
      upgradeStrategy: job.analysis.upgradeStrategy,
      copy: job.analysis.copy,
      contentPreserved: job.analysis.contentPreserved
    };
  }

  res.json(response);
});

/* ============================================
   API: DEBUG
   ============================================ */
app.get('/api/debug/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const html = getJobHtml(req.params.jobId);
  const analysis = job.analysis || {};
  const copy = analysis.copy || {};
  const strat = analysis.upgradeStrategy || {};
  const cp = analysis.contentPreserved || {};

  const sectionChecks = html ? {
    'has_nav': /<nav[\s>]/i.test(html),
    'has_h1': /<h1[\s>]/i.test(html),
    'has_about': /about/i.test(html),
    'has_services': /service|menu|feature/i.test(html),
    'has_testimonial': /testimonial|review|gallery/i.test(html),
    'has_form': /<form[\s>]/i.test(html),
    'has_footer': /<footer[\s>]/i.test(html),
    'ends_with_html': html.endsWith('</html>'),
    'has_closing_body': html.includes('</body>'),
  } : null;

  res.json({
    jobId: job.id,
    status: job.status,
    paid: job.paid,
    url: job.url,
    htmlLength: html ? html.length : 0,
    htmlTail: html ? html.substring(html.length - 300) : null,
    sectionChecks,
    analysisSummary: {
      businessName: analysis.businessName,
      heroHeadline: copy.heroHeadline,
      heroSub: copy.heroSub,
      aboutTextLength: copy.aboutText ? copy.aboutText.length : 0,
      servicesCount: Array.isArray(copy.services) ? copy.services.length : 0,
      testimonialsCount: Array.isArray(copy.testimonials) ? copy.testimonials.length : 0,
      ctaHeading: copy.ctaHeading,
      ctaText: copy.ctaText,
      heroImageUrl: strat.heroImageUrl ? 'YES' : 'MISSING',
      keyImagesCount: Array.isArray(strat.keyImages) ? strat.keyImages.length : 0,
      phone: cp.phone || 'MISSING',
      email: cp.email || 'MISSING',
      address: cp.address || 'MISSING',
      hours: cp.hours || 'MISSING',
    },
    fullAnalysis: analysis,
  });
});

/* ============================================
   API: PREVIEW GENERATED HTML
   ============================================ */
app.get('/api/preview/:jobId', (req, res) => {
  const html = getJobHtml(req.params.jobId);
  if (!html) {
    return res.status(404).send('Preview not available — upgrade has not been built yet.');
  }
  console.log(`[PREVIEW] Serving ${html.length} chars of HTML for job ${req.params.jobId}`);
  const revealFix = '\n<style>.reveal,.reveal-left,.reveal-right,[class*="reveal"]{opacity:1!important;transform:none!important;transition:none!important;visibility:visible!important;}</style>';
  res.type('html').send(html + revealFix);
});

/* ============================================
   API: TEASER PREVIEW HTML
   ============================================ */
app.get('/api/teaser/:jobId', (req, res) => {
  const html = getJobTeaserHtml(req.params.jobId);
  if (!html) {
    return res.status(404).send('Teaser preview not available.');
  }
  console.log(`[TEASER] Serving ${html.length} chars of teaser HTML for job ${req.params.jobId}`);
  res.type('html').send(html);
});

/* ============================================
   API: CAPTURE LEAD
   ============================================ */
app.post('/api/lead', async (req, res) => {
  const { jobId, email, source, auditUrl, auditScore, auditData } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const job = jobId ? getJob(jobId) : null;
  const businessName = job?.analysis?.businessName || null;

  const lead = {
    id: uuidv4().split('-')[0],
    jobId: jobId || null,
    url: job?.url || auditUrl || null,
    businessName,
    email,
    source: source || 'talk-to-paul',
    createdAt: new Date().toISOString()
  };

  const fp = path.join(LEADS_DIR, `${lead.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(lead, null, 2));

  try {
    const summaryPath = path.join(DATA_DIR, 'LEADS.txt');
    const line = `NEW LEAD [${lead.source}]: ${lead.businessName || lead.url || 'Unknown'}\nEmail: ${lead.email}\nJob: ${lead.jobId || 'N/A'}\nTime: ${lead.createdAt}\n---\n`;
    fs.appendFileSync(summaryPath, line);
  } catch (e) { /* ignore */ }

  console.log(`[LEAD][${lead.source}] ${lead.email} — ${lead.businessName || lead.url}`);

  // Build email based on source type
  let userEmailHtml;
  let userEmailSubject;

  if (source === 'audit' && auditData && auditData.findings) {
    // ── Rich audit results email ──
    userEmailSubject = `Your Website Audit: ${auditData.score}/100${auditUrl ? ` — ${auditUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}`;
    userEmailHtml = buildAuditEmail(auditData, auditUrl);
  } else {
    // ── Default upgrade tool email ──
    const previewUrl = (jobId && job?.status === 'complete') ? `${BASE_URL}/api/preview/${jobId}` : null;
    userEmailSubject = `Your Website Analysis${businessName ? ` — ${businessName}` : ''}`;
    userEmailHtml = `<h2>Thanks for checking out our upgrade tool!</h2>
      ${previewUrl ? `<p><a href="${previewUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Your Preview</a></p>` : '<p>Your analysis report is ready. Visit the upgrade tool to see it and get your full upgrade built.</p>'}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p><strong>Ready to make it real?</strong></p>
      <p>Paul will personally review and polish your upgrade into a production-ready site. Starting at $500, delivered in 24 hours.</p>
      <p>Just reply to this email or <a href="${BASE_URL}">visit the upgrade tool</a> to get started.</p>
      <p>— Paul Tran Studio</p>`;
  }

  await sendEmail({ to: email, subject: userEmailSubject, html: userEmailHtml });

  // Notify Paul
  const previewUrl = (jobId && job?.status === 'complete') ? `${BASE_URL}/api/preview/${jobId}` : null;
  await sendEmail({
    to: PAUL_EMAIL,
    subject: `New Lead [${source || 'unknown'}]: ${businessName || lead.url || email}${auditScore ? ` (Score: ${auditScore})` : ''}`,
    html: buildNotificationEmail({ email, businessName, url: lead.url, source, auditScore, jobId, previewUrl })
  });

  res.json({ success: true });
});

/**
 * Build a rich HTML email with full audit results.
 */
function buildNotificationEmail({ email, businessName, url, source, auditScore, jobId, previewUrl }) {
  const sourceLabel = source === 'audit' ? '🔍 Free Audit' : '⚡ Upgrade Tool';
  const sourceColor = source === 'audit' ? '#3B82F6' : '#10B981';
  let scoreBadge = '';
  if (auditScore) {
    let sc = '#EF4444';
    if (auditScore >= 80) sc = '#10B981';
    else if (auditScore >= 60) sc = '#F59E0B';
    else if (auditScore >= 40) sc = '#F97316';
    scoreBadge = `<div style="text-align:center;margin:16px 0">
      <div style="display:inline-block;width:72px;height:72px;border-radius:50%;border:4px solid ${sc};line-height:72px;font-size:28px;font-weight:700;color:${sc}">${auditScore}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">Audit Score</div>
    </div>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,${sourceColor},#6366f1);padding:24px 32px;text-align:center">
    <div style="font-size:13px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">New Lead</div>
    <div style="font-size:22px;font-weight:700;color:#fff">${sourceLabel}</div>
  </td></tr>
  <tr><td style="padding:28px 32px">
    ${scoreBadge}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
      <tr><td style="padding:10px 0;border-bottom:1px solid #334155">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase">Email</span><br>
        <a href="mailto:${email}" style="color:#60a5fa;font-size:15px;text-decoration:none">${email}</a>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #334155">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase">Business</span><br>
        <span style="color:#f1f5f9;font-size:15px">${businessName || 'N/A'}</span>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #334155">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase">URL</span><br>
        <a href="${url || '#'}" style="color:#60a5fa;font-size:15px;text-decoration:none">${url || 'N/A'}</a>
      </td></tr>
      ${jobId ? `<tr><td style="padding:10px 0;border-bottom:1px solid #334155">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase">Job ID</span><br>
        <span style="color:#cbd5e1;font-size:13px;font-family:monospace">${jobId}</span>
      </td></tr>` : ''}
    </table>
    ${previewUrl ? `<div style="text-align:center;margin-top:24px">
      <a href="${previewUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Preview →</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 32px;background:#0f172a;text-align:center;border-top:1px solid #334155">
    <span style="color:#475569;font-size:11px">Paul Tran Studio · Lead Notification</span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function buildAuditEmail(data, auditUrl) {
  const score = data.score || 0;
  const findings = data.findings || [];

  // Score color
  let scoreColor = '#EF4444';
  if (score >= 80) scoreColor = '#10B981';
  else if (score >= 60) scoreColor = '#F59E0B';
  else if (score >= 40) scoreColor = '#F97316';

  // Score headline
  let headline = 'Your website is holding you back';
  if (score >= 80) headline = 'Looking good!';
  else if (score >= 60) headline = 'Decent, but leaving money on the table';
  else if (score >= 40) headline = 'Your website needs work';

  // Difficulty labels
  const diffLabels = { easy: 'Easy Fix', moderate: 'Moderate', developer: 'Needs a Developer' };
  const diffColors = { easy: '#10B981', moderate: '#3B82F6', developer: '#A855F7' };
  const impactLabels = { high: 'High Impact', medium: 'Medium Impact', low: 'Low Impact' };
  const impactColors = { high: '#EF4444', medium: '#F59E0B', low: '#94A3B8' };

  // Group findings by category
  const categories = {};
  findings.forEach(f => {
    if (!categories[f.category]) categories[f.category] = [];
    categories[f.category].push(f);
  });

  // Category icons (text-safe)
  const catEmojis = {
    'Performance': '⚡', 'Security': '🔒', 'Mobile': '📱',
    'SEO': '🔍', 'Accessibility': '♿', 'Conversion': '🎯'
  };

  // Build findings HTML
  let findingsHtml = '';
  for (const [cat, items] of Object.entries(categories)) {
    const catPoints = items.reduce((sum, f) => sum + f.points, 0);
    const catMax = items.reduce((sum, f) => sum + f.maxPoints, 0);
    const catPercent = Math.round((catPoints / catMax) * 100);
    let catColor = '#EF4444';
    if (catPercent >= 80) catColor = '#10B981';
    else if (catPercent >= 50) catColor = '#F59E0B';

    findingsHtml += `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#f8fafc;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
            <span style="font-size:16px;">${catEmojis[cat] || '⚡'}</span>
            <strong style="font-size:15px;color:#1e293b;margin-left:6px;">${cat}</strong>
            <span style="float:right;font-weight:700;color:${catColor};font-size:14px;">${catPoints}/${catMax}</span>
          </td>
        </tr>
        ${items.map(f => {
          const statusIcon = f.pass ? '✓' : '✗';
          const statusColor = f.pass ? '#10B981' : '#EF4444';
          const statusBg = f.pass ? '#ECFDF5' : '#FEF2F2';

          let badges = '';
          if (!f.pass && (f.impact || f.difficulty)) {
            const parts = [];
            if (f.impact && impactLabels[f.impact]) {
              parts.push(`<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:${impactColors[f.impact]}20;color:${impactColors[f.impact]};">${impactLabels[f.impact]}</span>`);
            }
            if (f.difficulty && diffLabels[f.difficulty]) {
              parts.push(`<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:${diffColors[f.difficulty]}20;color:${diffColors[f.difficulty]};">${diffLabels[f.difficulty]}</span>`);
            }
            badges = `<div style="margin-top:6px;">${parts.join(' ')}</div>`;
          }

          let fixBox = '';
          if (!f.pass && f.fix) {
            fixBox = `
              <div style="margin-top:8px;padding:10px 12px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:0 6px 6px 0;">
                <span style="font-size:13px;color:#1e40af;"><strong>How to fix:</strong> ${f.fix}</span>
              </div>`;
          }

          return `
            <tr>
              <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                <table cellpadding="0" cellspacing="0" width="100%"><tr>
                  <td width="28" valign="top">
                    <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${statusBg};color:${statusColor};text-align:center;line-height:22px;font-size:12px;font-weight:700;">${statusIcon}</span>
                  </td>
                  <td valign="top" style="padding-left:8px;">
                    <strong style="font-size:13px;color:#1e293b;">${f.label}</strong>
                    ${badges}
                    <p style="font-size:13px;color:#64748b;line-height:1.5;margin:4px 0 0;">${f.detail}</p>
                    ${fixBox}
                  </td>
                </tr></table>
              </td>
            </tr>`;
        }).join('')}
      </table>`;
  }

  // Domain display
  let domain = auditUrl || '';
  try { domain = new URL(auditUrl.startsWith('http') ? auditUrl : `https://${auditUrl}`).hostname; } catch (e) { /* keep raw */ }

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;">

      <!-- Header -->
      <div style="text-align:center;padding:32px 20px 24px;">
        <p style="font-size:13px;color:#64748b;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Paul Tran Studio — Website Audit</p>
        <div style="display:inline-block;width:80px;height:80px;border-radius:50%;border:4px solid ${scoreColor};text-align:center;line-height:72px;">
          <span style="font-size:28px;font-weight:800;color:${scoreColor};">${score}</span>
        </div>
        <h1 style="font-size:22px;margin:12px 0 4px;color:#0f172a;">${headline}</h1>
        <p style="font-size:14px;color:#64748b;margin:0;">${domain}</p>
      </div>

      <!-- Summary -->
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:0 0 24px;text-align:center;">
        <p style="font-size:14px;color:#475569;margin:0;">
          Your site scored <strong style="color:${scoreColor};">${score}/100</strong> across ${findings.length} checks in 6 categories.
          ${score < 70 ? 'The issues below are costing you visitors and customers.' : 'A few improvements could take it even further.'}
        </p>
      </div>

      <!-- Findings -->
      ${findingsHtml}

      <!-- CTA -->
      <div style="text-align:center;background:#0f172a;border-radius:8px;padding:32px 24px;margin:24px 0;">
        <h2 style="font-size:18px;color:#fff;margin:0 0 8px;">Don't want to fix all this yourself?</h2>
        <p style="font-size:14px;color:#94a3b8;margin:0 0 20px;">Our AI will redesign your entire website — fixing every issue above — and show you a live before/after preview.</p>
        <a href="${BASE_URL}?url=${encodeURIComponent(auditUrl || '')}" style="display:inline-block;background:#3B82F6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Fix Everything With AI →</a>
      </div>

      <!-- Footer -->
      <div style="text-align:center;padding:20px 0;">
        <p style="font-size:12px;color:#94a3b8;margin:0;">Paul Tran Studio · <a href="https://paultranstudio.com" style="color:#3B82F6;text-decoration:none;">paultranstudio.com</a></p>
        <p style="font-size:11px;color:#cbd5e1;margin:8px 0 0;">You received this because you requested an audit at ${BASE_URL}</p>
      </div>
    </div>`;
}

/* ============================================
   API: STRIPE CHECKOUT
   ============================================ */
app.post('/api/checkout', async (req, res) => {
  if (!stripe || !STRIPE_PRICE_ID) {
    return res.status(400).json({ error: 'Payments are not yet configured. Please contact paul@paultranstudio.com to get started.' });
  }

  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      metadata: {
        jobId,
        url: job.url,
        businessName: job.analysis?.businessName || ''
      },
      success_url: `${BASE_URL}?paid=1&job=${jobId}`,
      cancel_url: `${BASE_URL}?cancelled=1&job=${jobId}`,
    });

    console.log(`[STRIPE] Checkout session created for job ${jobId}: ${session.id}`);
    res.json({ url: session.url });

  } catch (err) {
    console.error('[STRIPE] Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

/* ============================================
   EMAIL HELPER
   ============================================ */
async function sendEmail({ to, subject, html }) {
  if (!resend) {
    console.log(`[EMAIL SKIPPED] No Resend configured — would have sent to ${to}: ${subject}`);
    return;
  }

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to,
      subject,
      html
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
  }
}

/* ============================================
   JOB PROCESSING — PHASE 1: Analysis Only (Sonnet)
   ============================================ */
function startSubUpdates(jobId, steps, intervalMs = 6000) {
  let i = 0;
  const timer = setInterval(() => {
    if (i >= steps.length) { clearInterval(timer); return; }
    updateJob(jobId, steps[i]);
    i++;
  }, intervalMs);
  return timer;
}

async function processAnalysis(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  console.log(`[ANALYSIS] Job ${jobId} — model: ${ANALYZE_MODEL}`);

  try {
    // ── Step 1: Scrape ──
    updateJob(jobId, { status: 'analyzing', progress: 5, progressMessage: 'Scanning your website...', progressDetail: 'Loading your site in a real browser and capturing every element — layout, colors, fonts, images, and content.' });

    const scrapeUpdates = startSubUpdates(jobId, [
      { progress: 10, progressMessage: 'Reading your page structure...', progressDetail: 'Mapping out your navigation, headers, sections, and footer to understand the full layout.' },
      { progress: 15, progressMessage: 'Capturing visual design...', progressDetail: 'Analyzing your color palette, typography, spacing, and imagery for the redesign.' },
      { progress: 20, progressMessage: 'Extracting content and links...', progressDetail: 'Pulling your headlines, body text, calls-to-action, and internal links.' },
    ], 5000);

    const scraped = await scrapeWebsite(job.url, jobId, SCREENSHOTS_DIR);
    clearInterval(scrapeUpdates);
    updateJob(jobId, { progress: 25, progressMessage: 'Website scanned successfully', progressDetail: 'Got it. Your current site has been fully captured. Moving on to the deep analysis.', beforeScreenshot: true });

    // ── Step 2: AI Analysis ──
    updateJob(jobId, { progress: 30, progressMessage: 'Analyzing your design and conversion flow...', progressDetail: 'Our AI is reviewing your layout, copy, calls-to-action, SEO structure, and mobile experience.' });

    const analysisUpdates = startSubUpdates(jobId, [
      { progress: 33, progressMessage: 'Evaluating mobile responsiveness...', progressDetail: 'Checking how your site looks and performs on phones and tablets — over 60% of web traffic is mobile.' },
      { progress: 36, progressMessage: 'Reviewing SEO structure...', progressDetail: 'Analyzing your meta tags, heading hierarchy, structured data, and content organization.' },
      { progress: 39, progressMessage: 'Scoring your calls-to-action...', progressDetail: 'Evaluating button placement, form design, and conversion paths.' },
      { progress: 42, progressMessage: 'Assessing visual hierarchy...', progressDetail: 'Looking at how your design directs attention. Good hierarchy means visitors see the right things first.' },
      { progress: 45, progressMessage: 'Benchmarking against modern standards...', progressDetail: 'Comparing your design patterns to current best practices in your industry.' },
      { progress: 48, progressMessage: 'Finalizing analysis report...', progressDetail: 'Compiling all findings into your personalized upgrade report.' },
    ], 8000);

    const analysis = await analyzeWebsite(scraped.content, { model: ANALYZE_MODEL });
    clearInterval(analysisUpdates);

    updateJob(jobId, { progress: 48, progressMessage: 'Analysis complete! Building your upgrade preview...', progressDetail: 'Crafting a 3-section preview of your upgraded site using AI.', analysis });

    // ── Step 3: Teaser Build (Sonnet — free) ──
    const teaserUpdates = startSubUpdates(jobId, [
      { progress: 52, progressMessage: 'Crafting a preview of your upgrade...', progressDetail: 'Our AI is designing a modern hero section with your content.' },
      { progress: 58, progressMessage: 'Designing your new layout...', progressDetail: 'Building a compelling preview with your brand colors and typography.' },
      { progress: 64, progressMessage: 'Polishing the preview...', progressDetail: 'Adding responsive design and visual polish to your preview.' },
    ], 6000);

    let teaserBuilt = false;
    try {
      const teaserHtml = await buildTeaserSite(analysis, { model: ANALYZE_MODEL });
      clearInterval(teaserUpdates);
      console.log(`[TEASER] Job ${jobId} — generated ${teaserHtml ? teaserHtml.length : 0} chars of teaser HTML`);

      // Save teaser HTML
      const teaserHtmlPath = path.join(JOBS_DIR, `${jobId}-teaser.html`);
      fs.writeFileSync(teaserHtmlPath, teaserHtml, 'utf8');

      // Screenshot the teaser
      updateJob(jobId, { progress: 68, progressMessage: 'Capturing preview screenshot...', progressDetail: 'Taking a screenshot of your upgrade preview.' });
      const teaserScreenshotPath = path.join(SCREENSHOTS_DIR, `${jobId}-teaser.png`);
      await screenshotHTML(teaserHtml, teaserScreenshotPath);
      teaserBuilt = true;
    } catch (teaserErr) {
      clearInterval(teaserUpdates);
      console.error(`[TEASER] Job ${jobId} teaser build failed (non-fatal):`, teaserErr.message);
      console.error(`[TEASER] Full error:`, teaserErr.stack);
    }

    // Analysis complete — set status to 'analyzed' (NOT 'complete')
    // This is where we stop for free users. No Opus build yet.
    updateJob(jobId, {
      status: 'analyzed',
      progress: 75,
      progressMessage: 'Your analysis report is ready!',
      progressDetail: '',
      analysis,
      teaserScreenshot: teaserBuilt
    });

    console.log(`[ANALYSIS] Job ${jobId} complete — ${analysis.businessName || job.url}. Teaser: ${teaserBuilt}. Awaiting payment for build.`);

  } catch (err) {
    console.error(`Job ${jobId} analysis error:`, err);
    const userMessage = err.message.includes('JSON')
      ? 'We had trouble analyzing this site. Please try again — it usually works on the second attempt.'
      : 'Something went wrong. Please try again.';
    updateJob(jobId, {
      status: 'error',
      progress: 0,
      progressMessage: userMessage,
      error: err.message
    });
  }
}

/* ============================================
   JOB PROCESSING — PHASE 2: Build (Opus) — Only after payment
   ============================================ */
async function processBuild(jobId) {
  const job = getJob(jobId);
  if (!job) return;
  if (!job.paid) {
    console.error(`[BUILD] Job ${jobId} — not paid, skipping build`);
    return;
  }

  console.log(`[BUILD] Job ${jobId} — model: ${BUILD_MODEL} (paid, starting build)`);

  try {
    // ── Step 3: AI Build ──
    updateJob(jobId, { status: 'building', progress: 55, progressMessage: 'Building your upgraded website...', progressDetail: 'Payment confirmed! Our AI is now writing a completely new page tailored to your brand.' });

    const buildUpdates = startSubUpdates(jobId, [
      { progress: 60, progressMessage: 'Crafting your new hero section...', progressDetail: 'Designing a compelling headline, clear value proposition, and strong call-to-action.' },
      { progress: 65, progressMessage: 'Building navigation and layout...', progressDetail: 'Creating a clean, intuitive navigation structure and responsive page layout.' },
      { progress: 70, progressMessage: 'Designing content sections...', progressDetail: 'Laying out your services, features, and key selling points in a modern format.' },
      { progress: 75, progressMessage: 'Adding social proof and trust signals...', progressDetail: 'Incorporating testimonials, credentials, and trust elements.' },
      { progress: 80, progressMessage: 'Applying your brand colors and typography...', progressDetail: 'Matching your brand identity while modernizing the visual feel.' },
      { progress: 83, progressMessage: 'Polishing responsive design...', progressDetail: 'Fine-tuning the layout for phones, tablets, and desktops.' },
    ], 7000);

    const html = await buildUpgradedSite(job.analysis, { model: BUILD_MODEL });
    clearInterval(buildUpdates);
    console.log(`[BUILD] Job ${jobId} — generated ${html ? html.length : 0} chars of HTML`);
    updateJob(jobId, { progress: 88, progressMessage: 'Upgrade built! Generating preview...', progressDetail: 'Your upgraded site is ready. Now capturing screenshots.', generatedHtml: html });

    // ── Step 4: Screenshot ──
    updateJob(jobId, { progress: 92, progressMessage: 'Capturing your before & after screenshots...', progressDetail: 'Taking high-resolution screenshots for the side-by-side comparison.' });
    const afterPath = path.join(SCREENSHOTS_DIR, `${jobId}-after.png`);
    await screenshotHTML(html, afterPath);
    updateJob(jobId, { progress: 96, progressMessage: 'Almost there...', progressDetail: 'Packaging everything up for the big reveal.' });

    await new Promise(r => setTimeout(r, 1500));
    updateJob(jobId, { status: 'complete', progress: 100, progressMessage: 'Your upgrade is ready!', progressDetail: '', afterScreenshot: true });

    console.log(`[BUILD] Job ${jobId} complete — ${job.analysis?.businessName || job.url}`);

    // Email the customer their preview link
    if (job.customerEmail) {
      const previewUrl = `${BASE_URL}/api/preview/${jobId}`;
      await sendEmail({
        to: job.customerEmail,
        subject: `Your Upgraded Site is Ready! — ${job.analysis?.businessName || 'Website Upgrade'}`,
        html: `<h2>Your upgrade is built!</h2>
          <p><a href="${previewUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Your Upgraded Site</a></p>
          <p>This preview will be available for 30 days.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p>Paul will personally review and polish your upgrade, then deliver your production-ready site within 24 hours.</p>
          <p>If you have any questions, reply to this email or reach out to paul@paultranstudio.com.</p>
          <p>— Paul Tran Studio</p>`
      });
    }

    // Notify Paul build is done
    await sendEmail({
      to: PAUL_EMAIL,
      subject: `✅ Build Complete: ${job.analysis?.businessName || job.url}`,
      html: `<h3>Build finished for paid job</h3>
        <p><strong>Job:</strong> ${jobId}</p>
        <p><strong>Customer:</strong> ${job.customerEmail || 'N/A'}</p>
        <p><a href="${BASE_URL}/api/preview/${jobId}">View Preview</a></p>`
    });

  } catch (err) {
    console.error(`Job ${jobId} build error:`, err);
    updateJob(jobId, {
      status: 'error',
      progress: 50,
      progressMessage: 'Build failed — our team has been notified. We\'ll email you when it\'s ready.',
      error: err.message
    });

    // Notify Paul of build failure
    await sendEmail({
      to: PAUL_EMAIL,
      subject: `❌ Build FAILED: ${job.analysis?.businessName || jobId}`,
      html: `<h3>Post-payment build failed!</h3>
        <p><strong>Job:</strong> ${jobId}</p>
        <p><strong>Customer:</strong> ${job.customerEmail || 'N/A'}</p>
        <p><strong>Error:</strong> ${err.message}</p>
        <p>Customer has paid — manual intervention needed.</p>`
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
   SERVE SCREENSHOTS FROM VOLUME
   ============================================ */
if (process.env.DATA_DIR) {
  app.use('/screenshots', express.static(SCREENSHOTS_DIR));
}

/* ============================================
   AUTO-CLEANUP
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
        fs.unlinkSync(fp);
        const jobId = job.id;
        const beforePath = path.join(SCREENSHOTS_DIR, `${jobId}-before.png`);
        const afterPath = path.join(SCREENSHOTS_DIR, `${jobId}-after.png`);
        if (fs.existsSync(beforePath)) fs.unlinkSync(beforePath);
        if (fs.existsSync(afterPath)) fs.unlinkSync(afterPath);
        const teaserScreenPath = path.join(SCREENSHOTS_DIR, `${jobId}-teaser.png`);
        if (fs.existsSync(teaserScreenPath)) fs.unlinkSync(teaserScreenPath);
        const teaserHtmlPath = path.join(JOBS_DIR, `${jobId}-teaser.html`);
        if (fs.existsSync(teaserHtmlPath)) fs.unlinkSync(teaserHtmlPath);
        const htmlPath = path.join(JOBS_DIR, `${jobId}.html`);
        if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
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

cleanupExpiredJobs();
setInterval(cleanupExpiredJobs, 24 * 60 * 60 * 1000);

/* ============================================
   SERVE AUDIT PAGE
   ============================================ */
app.get('/audit', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audit.html'));
});

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

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
// V28_CACHE_BUST_1772941367

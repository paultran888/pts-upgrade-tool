/**
 * Paul Tran Studio — Upgrade Tool Frontend
 * Analysis-first flow: free report → payment → build
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const form = $('#analyzeForm');
  const urlInput = $('#urlInput');
  const analyzeBtn = $('#analyzeBtn');

  const heroSection = $('#hero');
  const progressSection = $('#progressSection');
  const progressTitle = $('#progressTitle');
  const progressUrl = $('#progressUrl');
  const progressFill = $('#progressFill');
  const progressPercent = $('#progressPercent');
  const progressSteps = $('#progressSteps');
  const progressDetail = $('#progressDetail');

  const errorSection = $('#errorSection');
  const errorMessage = $('#errorMessage');
  const retryBtn = $('#retryBtn');

  const reportSection = $('#reportSection');
  const buildingSection = $('#buildingSection');

  const resultsSection = $('#resultsSection');
  const beforeImg = $('#beforeImg');
  const afterImg = $('#afterImg');
  const previewLink = $('#previewLink');

  const ctaSection = $('#ctaSection');
  const leadForm = $('#leadForm');
  const leadSubmitBtn = $('#leadSubmitBtn');
  const leadSuccess = $('#leadSuccess');

  const reportBuyBtn = $('#reportBuyBtn');
  const reportTalkBtn = $('#reportTalkBtn');

  let currentJobId = null;
  let pollInterval = null;
  const pageLoadTime = Date.now();

  /* ═══════════════════════════════════════════
     ON PAGE LOAD: Check for ?paid=1 or ?cancelled=1
     ═══════════════════════════════════════════ */
  (function checkReturnFromStripe() {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');

    if (params.get('paid') === '1' && jobId) {
      currentJobId = jobId;
      heroSection.classList.add('hidden');
      // Show building state and start polling — build may still be in progress
      showBuilding(jobId);
      startPolling();
      window.history.replaceState({}, '', '/');
    } else if (params.get('cancelled') === '1' && jobId) {
      currentJobId = jobId;
      // Show report again (they cancelled payment)
      fetchAndShowReport(jobId);
      window.history.replaceState({}, '', '/');
    }
  })();

  /* ═══════════════════════════════════════════
     FORM SUBMISSION
     ═══════════════════════════════════════════ */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    const hp = $('#_hp') ? $('#_hp').value : '';

    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn__text').textContent = 'Analyzing...';

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, _hp: hp, _t: String(pageLoadTime) })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start analysis');
      }

      currentJobId = data.jobId;

      if (data.reused) {
        // Already analyzed — show report or results based on status
        fetchAndShowReport(currentJobId);
      } else {
        showProgress(url);
        startPolling();
      }

    } catch (err) {
      showError(err.message);
    }
  });

  /* ═══════════════════════════════════════════
     PROGRESS POLLING
     ═══════════════════════════════════════════ */
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollStatus, 2000);
    pollStatus();
  }

  async function pollStatus() {
    if (!currentJobId) return;

    try {
      const res = await fetch(`/api/status/${currentJobId}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to get status');

      // Route to correct view based on status
      if (data.status === 'analyzed') {
        clearInterval(pollInterval);
        pollInterval = null;
        showReport(data);
      } else if (data.status === 'building') {
        updateBuilding(data);
      } else if (data.status === 'complete') {
        clearInterval(pollInterval);
        pollInterval = null;
        setTimeout(() => showResults(currentJobId), 500);
      } else if (data.status === 'error') {
        clearInterval(pollInterval);
        pollInterval = null;
        showError(data.progressMessage || 'Something went wrong. Please try again.');
      } else {
        // analyzing / queued
        updateProgress(data);
      }

    } catch (err) {
      console.error('Polling error:', err);
    }
  }

  function updateProgress(data) {
    const pct = data.progress || 0;
    progressTitle.textContent = data.progressMessage || 'Processing...';
    progressFill.style.width = `${pct}%`;
    progressPercent.textContent = `${pct}%`;

    if (data.progressDetail) {
      progressDetail.textContent = data.progressDetail;
      progressDetail.style.opacity = '1';
    }

    const steps = progressSteps.querySelectorAll('.progress-step');
    steps.forEach(step => {
      step.classList.remove('active', 'done');
      const stepName = step.dataset.step;

      if (stepName === 'scan') {
        if (pct >= 25) step.classList.add('done');
        else if (pct >= 5) step.classList.add('active');
      } else if (stepName === 'analyze') {
        if (pct >= 48) step.classList.add('done');
        else if (pct >= 25) step.classList.add('active');
      } else if (stepName === 'build') {
        if (pct >= 70) step.classList.add('done');
        else if (pct >= 48) step.classList.add('active');
      } else if (stepName === 'preview') {
        if (pct >= 75) step.classList.add('done');
        else if (pct >= 68) step.classList.add('active');
      }
    });
  }

  /* ═══════════════════════════════════════════
     BUILDING PROGRESS (post-payment)
     ═══════════════════════════════════════════ */
  function updateBuilding(data) {
    // Make sure building section is visible
    if (buildingSection.classList.contains('hidden')) {
      hideAll();
      buildingSection.classList.remove('hidden');
    }

    const pct = data.progress || 50;
    $('#buildingTitle').textContent = data.progressMessage || 'Building your upgraded website...';
    $('#buildingFill').style.width = `${pct}%`;
    $('#buildingPercent').textContent = `${pct}%`;
    if (data.progressDetail) {
      $('#buildingDetail').textContent = data.progressDetail;
    }

    // Update step dots
    const steps = $('#buildingSteps').querySelectorAll('.progress-step');
    steps.forEach(step => {
      const stepName = step.dataset.step;
      step.classList.remove('active', 'done');
      if (stepName === 'scan' || stepName === 'analyze') {
        step.classList.add('done');
      } else if (stepName === 'build') {
        if (pct >= 88) step.classList.add('done');
        else step.classList.add('active');
      } else if (stepName === 'preview') {
        if (pct >= 100) step.classList.add('done');
        else if (pct >= 88) step.classList.add('active');
      }
    });
  }

  /* ═══════════════════════════════════════════
     WHILE-YOU-WAIT TESTIMONIAL ROTATION
     ═══════════════════════════════════════════ */
  const testimonials = [
    { quote: '"Paul completely rebuilt my site — SEO, responsive design, the works. I\'d work with him again in a heartbeat."', author: '— James S., CookWithJames' },
    { quote: '"Went from an outdated site to a modern, fast site in one day. The before/after was night and day."', author: '— Stein\'s Beer Garden' },
    { quote: '"25 years of experience shows. Paul understood exactly what my business needed without me having to explain it."', author: '— Recent Client' },
    { quote: '"I thought a quality website would take weeks and cost thousands. Paul proved me wrong on both counts."', author: '— Small Business Owner' }
  ];
  let testimonialIndex = 0;
  let testimonialInterval = null;

  function startTestimonialRotation() {
    const el = $('#progressTestimonial');
    if (!el) return;
    testimonialInterval = setInterval(() => {
      testimonialIndex = (testimonialIndex + 1) % testimonials.length;
      el.style.opacity = '0';
      setTimeout(() => {
        el.querySelector('.progress-social__quote').textContent = testimonials[testimonialIndex].quote;
        el.querySelector('.progress-social__author').textContent = testimonials[testimonialIndex].author;
        el.style.opacity = '1';
      }, 400);
    }, 8000);
  }

  function stopTestimonialRotation() {
    if (testimonialInterval) {
      clearInterval(testimonialInterval);
      testimonialInterval = null;
    }
  }

  /* ═══════════════════════════════════════════
     REPORT DISPLAY
     ═══════════════════════════════════════════ */
  async function fetchAndShowReport(jobId) {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();
      if (data.status === 'complete') {
        showResults(jobId);
      } else if (data.status === 'building') {
        showBuilding(jobId);
        startPolling();
      } else {
        showReport(data);
      }
    } catch (err) {
      showError('Failed to load report.');
    }
  }

  function showReport(data) {
    hideAll();
    stopTestimonialRotation();
    reportSection.classList.remove('hidden');

    const analysis = data.analysis || {};
    const assessment = analysis.currentAssessment || {};
    const strategy = analysis.upgradeStrategy || {};
    const copy = analysis.copy || {};

    // Title
    const businessName = analysis.businessName || 'Your Website';
    $('#reportTitle').textContent = `${businessName} — Analysis Report`;
    $('#reportUrl').textContent = data.url || '';

    // Score
    const score = assessment.designScore || 5;
    const scoreBadge = $('#reportScoreBadge');
    $('#reportScoreNum').textContent = score;

    // Color-code score
    scoreBadge.className = 'report__score-badge';
    if (score <= 3) scoreBadge.classList.add('report__score--red');
    else if (score <= 6) scoreBadge.classList.add('report__score--orange');
    else if (score <= 8) scoreBadge.classList.add('report__score--blue');
    else scoreBadge.classList.add('report__score--green');

    // Score description
    const scoreDescs = {
      low: 'Your site needs significant improvements to compete in today\'s market.',
      mid: 'Your site has a solid foundation but is missing modern design elements and conversion optimization.',
      high: 'Your site is above average but could benefit from a modern refresh and conversion optimization.',
      top: 'Your site is strong! A few targeted upgrades could take it to the next level.'
    };
    if (score <= 3) $('#reportScoreDesc').textContent = scoreDescs.low;
    else if (score <= 6) $('#reportScoreDesc').textContent = scoreDescs.mid;
    else if (score <= 8) $('#reportScoreDesc').textContent = scoreDescs.high;
    else $('#reportScoreDesc').textContent = scoreDescs.top;

    // What's Working
    const workingList = $('#reportWorking');
    workingList.innerHTML = '';
    const strengths = assessment.strengths || assessment.positives || [];
    const workingItems = Array.isArray(strengths) ? strengths : [strengths];
    if (workingItems.length === 0 || (workingItems.length === 1 && !workingItems[0])) {
      workingList.innerHTML = '<li>Basic web presence established</li>';
    } else {
      workingItems.forEach(item => {
        if (item) workingList.innerHTML += `<li>${item}</li>`;
      });
    }

    // What Needs Fixing
    const fixingList = $('#reportFixing');
    fixingList.innerHTML = '';
    const weaknesses = assessment.weaknesses || assessment.issues || assessment.improvements || [];
    const fixItems = Array.isArray(weaknesses) ? weaknesses : [weaknesses];
    if (fixItems.length === 0 || (fixItems.length === 1 && !fixItems[0])) {
      fixingList.innerHTML = '<li>Design could be modernized</li><li>Conversion optimization needed</li>';
    } else {
      fixItems.forEach(item => {
        if (item) fixingList.innerHTML += `<li>${item}</li>`;
      });
    }

    // Upgrade Plan
    const planList = $('#reportPlan');
    planList.innerHTML = '';
    const sections = strategy.sections || strategy.sectionPlan || [];
    const planItems = Array.isArray(sections) ? sections : [];
    if (planItems.length > 0) {
      planItems.forEach(section => {
        const name = typeof section === 'string' ? section : (section.name || section.section || section.title || 'Section');
        const desc = typeof section === 'string' ? '' : (section.description || section.improvements || section.changes || '');
        planList.innerHTML += `<li><strong>${name}</strong>${desc ? ` — ${desc}` : ''}</li>`;
      });
    } else {
      // Fallback: generate from copy object
      const fallbackPlan = [];
      if (copy.heroHeadline) fallbackPlan.push({ name: 'Hero Section', desc: 'New compelling headline and call-to-action' });
      if (copy.aboutText) fallbackPlan.push({ name: 'About Section', desc: 'Rewritten for clarity and trust' });
      if (copy.services?.length) fallbackPlan.push({ name: 'Services/Features', desc: `${copy.services.length} services highlighted with modern cards` });
      if (copy.testimonials?.length) fallbackPlan.push({ name: 'Social Proof', desc: 'Testimonials showcased for trust' });
      if (copy.ctaHeading) fallbackPlan.push({ name: 'Call-to-Action', desc: 'Conversion-optimized contact section' });
      fallbackPlan.push({ name: 'Responsive Design', desc: 'Fully mobile-optimized layout' });
      fallbackPlan.push({ name: 'Modern Typography & Colors', desc: 'Professional font pairing and updated palette' });
      fallbackPlan.forEach(p => {
        planList.innerHTML += `<li><strong>${p.name}</strong> — ${p.desc}</li>`;
      });
    }

    // Colors
    const currentColors = strategy.currentColors || strategy.existingColors || ['#333333', '#666666', '#999999', '#CCCCCC'];
    const proposedRaw = strategy.proposedColors || strategy.newColors || strategy.colorPalette || ['#0A0E1A', '#3B82F6', '#10B981', '#F1F5F9'];
    // colorPalette may be an object like {background: "#hex", primary: "#hex"} — convert to array
    const proposedColors = Array.isArray(proposedRaw) ? proposedRaw : (typeof proposedRaw === 'object' ? Object.values(proposedRaw) : [proposedRaw]);
    const currentColorsArr = Array.isArray(currentColors) ? currentColors : (typeof currentColors === 'object' ? Object.values(currentColors) : [currentColors]);
    renderSwatches('#reportCurrentColors', currentColorsArr);
    renderSwatches('#reportProposedColors', proposedColors);

    // Fonts
    const displayFont = strategy.displayFont || strategy.headingFont || 'Space Grotesk';
    const bodyFont = strategy.bodyFont || strategy.paragraphFont || 'Inter';
    $('#reportDisplayFontName').textContent = displayFont;
    $('#reportBodyFontName').textContent = bodyFont;

    // Teaser preview
    const teaserSection = $('#reportTeaser');
    if (data.teaserScreenshot && data.beforeScreenshot) {
      teaserSection.classList.remove('hidden');
      $('#reportBeforeImg').src = data.beforeScreenshot;
      $('#reportTeaserImg').src = data.teaserScreenshot;
      $('#reportTeaserLink').href = `/api/teaser/${data.id}`;
    } else if (data.beforeScreenshot) {
      // Show at least the before screenshot with a "preview coming" placeholder
      teaserSection.classList.remove('hidden');
      $('#reportBeforeImg').src = data.beforeScreenshot;
      $('#reportTeaserImg').style.display = 'none';
      $('#reportTeaserLink').href = '#';
      $('#reportTeaserLink').style.display = 'none';
    } else {
      teaserSection.classList.add('hidden');
    }

    // Reset button states
    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn__text').textContent = 'See Your Upgrade';

    reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSwatches(selector, colors) {
    const container = $(selector);
    container.innerHTML = '';
    colors.slice(0, 5).forEach(color => {
      // Handle color that might be a name or hex
      const c = color.startsWith('#') ? color : color;
      container.innerHTML += `<div class="report__swatch" style="background:${c}" title="${c}"></div>`;
    });
  }

  /* ═══════════════════════════════════════════
     VIEW SWITCHING
     ═══════════════════════════════════════════ */
  function hideAll() {
    [heroSection, progressSection, errorSection, reportSection, buildingSection, resultsSection, ctaSection].forEach(s => {
      if (s) s.classList.add('hidden');
    });
  }

  function showProgress(url) {
    hideAll();
    progressSection.classList.remove('hidden');

    progressUrl.textContent = url;
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';

    progressSteps.querySelectorAll('.progress-step').forEach(s => {
      s.classList.remove('active', 'done');
    });

    startTestimonialRotation();
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showBuilding(jobId) {
    hideAll();
    buildingSection.classList.remove('hidden');
    const job = getJob;
    $('#buildingUrl').textContent = '';
    buildingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showResults(jobId) {
    hideAll();
    stopTestimonialRotation();
    resultsSection.classList.remove('hidden');

    beforeImg.src = `/screenshots/${jobId}-before.png`;
    afterImg.src = `/screenshots/${jobId}-after.png`;
    previewLink.href = `/api/preview/${jobId}`;

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showError(msg) {
    hideAll();
    stopTestimonialRotation();
    errorSection.classList.remove('hidden');

    errorMessage.textContent = msg || 'Something went wrong. Please try again.';

    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn__text').textContent = 'See Your Upgrade';

    errorSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetToHero() {
    hideAll();
    heroSection.classList.remove('hidden');

    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn__text').textContent = 'See Your Upgrade';
    urlInput.value = '';
    currentJobId = null;

    heroSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  retryBtn.addEventListener('click', resetToHero);

  /* ═══════════════════════════════════════════
     STRIPE CHECKOUT (from report page)
     ═══════════════════════════════════════════ */
  reportBuyBtn.addEventListener('click', async () => {
    if (!currentJobId) return;

    reportBuyBtn.disabled = true;
    reportBuyBtn.querySelector('.btn__text').textContent = 'Redirecting to checkout...';

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start checkout');
      }

      window.location.href = data.url;

    } catch (err) {
      alert(err.message || 'Something went wrong. Please try again or contact paul@paultranstudio.com.');
      reportBuyBtn.disabled = false;
      reportBuyBtn.querySelector('.btn__text').textContent = 'Get Your Upgrade — $500';
    }
  });

  /* "Talk to Paul First" scrolls to lead form */
  reportTalkBtn.addEventListener('click', () => {
    ctaSection.classList.remove('hidden');
    ctaSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ═══════════════════════════════════════════
     LEAD CAPTURE FORM
     ═══════════════════════════════════════════ */
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = $('#leadEmail').value.trim();
    if (!email) return;

    leadSubmitBtn.disabled = true;
    leadSubmitBtn.querySelector('.btn__text').textContent = 'Sending...';

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId, email })
      });

      if (!res.ok) throw new Error('Failed to submit');

      leadForm.classList.add('hidden');
      leadSuccess.classList.remove('hidden');

    } catch (err) {
      alert('Something went wrong. Please email paul@paultranstudio.com directly.');
      leadSubmitBtn.disabled = false;
      leadSubmitBtn.querySelector('.btn__text').textContent = 'Send Me the Details';
    }
  });

  /* ═══════════════════════════════════════════
     SMOOTH REVEAL ANIMATIONS
     ═══════════════════════════════════════════ */
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    $$('.how__step').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.6s var(--ease-out), transform 0.6s var(--ease-out)';
      observer.observe(el);
    });
  }

})();

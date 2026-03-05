/**
 * Paul Tran Studio — Upgrade Tool Frontend
 * Handles: URL submission, progress polling, results display, Stripe checkout, lead capture
 */

(function () {
  'use strict';

  /* ── DOM refs ── */
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

  const resultsSection = $('#resultsSection');
  const beforeImg = $('#beforeImg');
  const afterImg = $('#afterImg');
  const previewLink = $('#previewLink');

  const ctaSection = $('#ctaSection');
  const leadForm = $('#leadForm');
  const leadSubmitBtn = $('#leadSubmitBtn');
  const leadSuccess = $('#leadSuccess');

  const paidSection = $('#paidSection');
  const paidPreviewLink = $('#paidPreviewLink');

  const buyBtn = $('#buyBtn');
  const talkBtn = $('#talkBtn');

  /* ── State ── */
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
      // Returned from successful Stripe payment
      currentJobId = jobId;
      heroSection.classList.add('hidden');
      paidSection.classList.remove('hidden');
      paidPreviewLink.href = `/api/preview/${jobId}`;
      // Clean URL without reload
      window.history.replaceState({}, '', '/');
    } else if (params.get('cancelled') === '1' && jobId) {
      // Returned from cancelled Stripe checkout — show their results again
      currentJobId = jobId;
      showResults(jobId);
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
        showResults(currentJobId);
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

      updateProgress(data);

      if (data.status === 'complete') {
        clearInterval(pollInterval);
        pollInterval = null;
        setTimeout(() => showResults(currentJobId), 800);
      }

      if (data.status === 'error') {
        clearInterval(pollInterval);
        pollInterval = null;
        showError(data.error || 'Analysis failed. Please try again.');
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
        if (pct >= 30) step.classList.add('done');
        else if (pct >= 10) step.classList.add('active');
      } else if (stepName === 'analyze') {
        if (pct >= 60) step.classList.add('done');
        else if (pct >= 30) step.classList.add('active');
      } else if (stepName === 'build') {
        if (pct >= 85) step.classList.add('done');
        else if (pct >= 60) step.classList.add('active');
      } else if (stepName === 'preview') {
        if (pct >= 100) step.classList.add('done');
        else if (pct >= 85) step.classList.add('active');
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
     VIEW SWITCHING
     ═══════════════════════════════════════════ */
  function hideAll() {
    [heroSection, progressSection, errorSection, resultsSection, ctaSection, paidSection].forEach(s => {
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
     STRIPE CHECKOUT
     ═══════════════════════════════════════════ */
  buyBtn.addEventListener('click', async () => {
    if (!currentJobId) return;

    buyBtn.disabled = true;
    buyBtn.querySelector('.btn__text').textContent = 'Redirecting to checkout...';

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

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (err) {
      alert(err.message || 'Something went wrong. Please try again or contact paul@paultranstudio.com.');
      buyBtn.disabled = false;
      buyBtn.querySelector('.btn__text').textContent = 'Get This Site — $500';
    }
  });

  /* "Talk to Paul First" scrolls to simplified lead form */
  talkBtn.addEventListener('click', () => {
    ctaSection.classList.remove('hidden');
    ctaSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ═══════════════════════════════════════════
     LEAD CAPTURE FORM (email only)
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

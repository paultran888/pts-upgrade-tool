/**
 * Paul Tran Studio — Upgrade Tool Frontend
 * Handles: URL submission, progress polling, results display, lead capture
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

  /* ── State ── */
  let currentJobId = null;
  let pollInterval = null;

  /* ═══════════════════════════════════════════
     FORM SUBMISSION
     ═══════════════════════════════════════════ */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn__text').textContent = 'Analyzing...';

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start analysis');
      }

      currentJobId = data.jobId;
      showProgress(url);
      startPolling();

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
     VIEW SWITCHING
     ═══════════════════════════════════════════ */
  function showProgress(url) {
    heroSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    ctaSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    progressUrl.textContent = url;
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';

    progressSteps.querySelectorAll('.progress-step').forEach(s => {
      s.classList.remove('active', 'done');
    });

    progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showResults(jobId) {
    progressSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    ctaSection.classList.remove('hidden');

    beforeImg.src = `/screenshots/${jobId}-before.png`;
    afterImg.src = `/screenshots/${jobId}-after.png`;
    previewLink.href = `/api/preview/${jobId}`;

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showError(msg) {
    heroSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    ctaSection.classList.add('hidden');
    errorSection.classList.remove('hidden');

    errorMessage.textContent = msg || 'Something went wrong. Please try again.';

    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn__text').textContent = 'See Your Upgrade';

    errorSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetToHero() {
    progressSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    ctaSection.classList.add('hidden');
    heroSection.classList.remove('hidden');

    analyzeBtn.disabled = false;
    analyzeBtn.querySelector('.btn__text').textContent = 'See Your Upgrade';
    urlInput.value = '';
    currentJobId = null;

    heroSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  retryBtn.addEventListener('click', resetToHero);

  /* ═══════════════════════════════════════════
     LEAD CAPTURE FORM
     ═══════════════════════════════════════════ */
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = $('#leadName').value.trim();
    const email = $('#leadEmail').value.trim();
    const phone = $('#leadPhone').value.trim();
    const message = $('#leadMessage').value.trim();

    if (!email) return;

    leadSubmitBtn.disabled = true;
    leadSubmitBtn.querySelector('.btn__text').textContent = 'Sending...';

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: currentJobId,
          name,
          email,
          phone,
          message
        })
      });

      if (!res.ok) throw new Error('Failed to submit');

      // Show success, hide form
      leadForm.classList.add('hidden');
      leadSuccess.classList.remove('hidden');

    } catch (err) {
      alert('Something went wrong. Please email paul@paultranstudio.com directly.');
      leadSubmitBtn.disabled = false;
      leadSubmitBtn.querySelector('.btn__text').textContent = 'Book a Free Call with Paul';
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

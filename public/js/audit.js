/**
 * Audit Page — Frontend Logic
 */

const form = document.getElementById('audit-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoading = submitBtn.querySelector('.btn-loading');

const heroSection = document.getElementById('hero');
const loadingSection = document.getElementById('loading');
const errorSection = document.getElementById('error');
const resultsSection = document.getElementById('results');
const loadingUrl = document.getElementById('loading-url');
const loadingSteps = document.querySelectorAll('#loading .step');

const pageLoadTime = Date.now();
let currentAuditUrl = '';
let auditResult = null;

/* ── Form Submit ── */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const url = urlInput.value.trim();
  if (!url) return;

  currentAuditUrl = url;
  showLoading(url);

  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        _hp: form.querySelector('[name="_hp"]').value,
        _t: String(pageLoadTime)
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }

    auditResult = data;
    showResults(data);

  } catch (err) {
    showError('Network error — please check your connection and try again.');
  }
});

/* ── Loading animation ── */
function showLoading(url) {
  heroSection.style.display = 'none';
  errorSection.style.display = 'none';
  resultsSection.style.display = 'none';
  loadingSection.style.display = '';

  // Show the domain being scanned
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    loadingUrl.textContent = parsed.hostname;
  } catch {
    loadingUrl.textContent = url;
  }

  // Animate steps
  let stepIndex = 0;
  loadingSteps.forEach(s => s.classList.remove('active', 'done'));
  loadingSteps[0].classList.add('active');

  const stepTimer = setInterval(() => {
    if (stepIndex < loadingSteps.length - 1) {
      loadingSteps[stepIndex].classList.remove('active');
      loadingSteps[stepIndex].classList.add('done');
      stepIndex++;
      loadingSteps[stepIndex].classList.add('active');
    } else {
      clearInterval(stepTimer);
    }
  }, 1800);

  // Store timer so we can clear on results
  form._stepTimer = stepTimer;

  submitBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoading.style.display = '';
}

function showError(msg) {
  if (form._stepTimer) clearInterval(form._stepTimer);
  loadingSection.style.display = 'none';
  heroSection.style.display = 'none';
  errorSection.style.display = '';
  document.getElementById('error-msg').textContent = msg;
  submitBtn.disabled = false;
  btnText.style.display = '';
  btnLoading.style.display = 'none';
}

function resetForm() {
  errorSection.style.display = 'none';
  resultsSection.style.display = 'none';
  loadingSection.style.display = 'none';
  heroSection.style.display = '';
  urlInput.value = '';
  urlInput.focus();
  submitBtn.disabled = false;
  btnText.style.display = '';
  btnLoading.style.display = 'none';
}
window.resetForm = resetForm;

/* ── Results ── */
function showResults(data) {
  if (form._stepTimer) clearInterval(form._stepTimer);
  loadingSection.style.display = 'none';
  heroSection.style.display = 'none';
  resultsSection.style.display = '';

  submitBtn.disabled = false;
  btnText.style.display = '';
  btnLoading.style.display = 'none';

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Score ring animation
  const score = data.score;
  const arc = document.getElementById('score-arc');
  const circumference = 2 * Math.PI * 52; // r=52
  const scoreNum = document.getElementById('score-number');

  // Color based on score
  let color = '#EF4444'; // red
  if (score >= 80) color = '#10B981'; // green
  else if (score >= 60) color = '#F59E0B'; // amber
  else if (score >= 40) color = '#F97316'; // orange

  arc.style.stroke = color;
  scoreNum.style.color = color;

  // Animate the arc
  let current = 0;
  const target = (score / 100) * circumference;
  const duration = 1200;
  const startTime = performance.now();

  function animateScore(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic

    const currentArc = eased * target;
    arc.setAttribute('stroke-dasharray', `${currentArc} ${circumference}`);
    scoreNum.textContent = Math.round(eased * score);

    if (progress < 1) requestAnimationFrame(animateScore);
  }
  requestAnimationFrame(animateScore);

  // Score headline & summary
  document.getElementById('score-url').textContent = data.url;
  const headline = document.getElementById('score-headline');
  const summary = document.getElementById('score-summary');

  if (score >= 80) {
    headline.textContent = 'Looking good!';
    summary.textContent = `Your site scores ${score}/100. There are still a few things to improve, but you're ahead of most small business websites.`;
  } else if (score >= 60) {
    headline.textContent = 'Decent, but leaving money on the table';
    summary.textContent = `Your site scores ${score}/100. You're doing some things right, but the issues below are costing you visitors and customers.`;
  } else if (score >= 40) {
    headline.textContent = 'Your website needs work';
    summary.textContent = `Your site scores ${score}/100. Several critical issues are hurting your visibility and driving potential customers away.`;
  } else {
    headline.textContent = 'Your website is holding you back';
    summary.textContent = `Your site scores ${score}/100. Major issues across multiple categories are likely costing you significant business.`;
  }

  // Build findings grid
  const grid = document.getElementById('findings-grid');
  grid.innerHTML = '';

  // Group by category
  const categories = {};
  data.findings.forEach(f => {
    if (!categories[f.category]) categories[f.category] = [];
    categories[f.category].push(f);
  });

  // Category icons
  const catIcons = {
    'Performance': '&#9889;',
    'Security': '&#128274;',
    'Mobile': '&#128241;',
    'SEO': '&#128270;',
    'Accessibility': '&#9855;',
    'Conversion': '&#127919;'
  };

  // Difficulty & impact label mappings
  const difficultyLabels = {
    easy: { text: 'Easy Fix', class: 'badge--easy' },
    moderate: { text: 'Moderate', class: 'badge--moderate' },
    developer: { text: 'Needs a Developer', class: 'badge--developer' }
  };
  const impactLabels = {
    high: { text: 'High Impact', class: 'badge--high' },
    medium: { text: 'Medium Impact', class: 'badge--medium' },
    low: { text: 'Low Impact', class: 'badge--low' }
  };

  // Render each category as a card
  for (const [cat, items] of Object.entries(categories)) {
    const card = document.createElement('div');
    card.className = 'finding-card';

    const catPoints = items.reduce((sum, f) => sum + f.points, 0);
    const catMax = items.reduce((sum, f) => sum + f.maxPoints, 0);
    const catPercent = Math.round((catPoints / catMax) * 100);

    let catColor = '#EF4444';
    if (catPercent >= 80) catColor = '#10B981';
    else if (catPercent >= 50) catColor = '#F59E0B';

    card.innerHTML = `
      <div class="finding-header">
        <span class="finding-icon">${catIcons[cat] || '&#9889;'}</span>
        <h3>${cat}</h3>
        <span class="finding-score" style="color:${catColor}">${catPoints}/${catMax}</span>
      </div>
      <div class="finding-items">
        ${items.map(f => {
          const diffBadge = !f.pass && f.difficulty && difficultyLabels[f.difficulty]
            ? `<span class="finding-badge ${difficultyLabels[f.difficulty].class}">${difficultyLabels[f.difficulty].text}</span>`
            : '';
          const impactBadge = !f.pass && f.impact && impactLabels[f.impact]
            ? `<span class="finding-badge ${impactLabels[f.impact].class}">${impactLabels[f.impact].text}</span>`
            : '';
          const badges = (diffBadge || impactBadge)
            ? `<div class="finding-badges">${impactBadge}${diffBadge}</div>`
            : '';
          const fixTip = !f.pass && f.fix
            ? `<div class="finding-fix"><span class="finding-fix-icon">&#128736;</span><div class="finding-fix-text"><strong>How to fix:</strong> ${f.fix}</div></div>`
            : '';
          return `
            <div class="finding-item ${f.pass ? 'pass' : 'fail'}">
              <span class="finding-status">${f.pass ? '&#10003;' : '&#10007;'}</span>
              <div class="finding-content">
                <strong>${f.label}</strong>${badges}
                <p>${f.detail}</p>
                ${fixTip}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    grid.appendChild(card);
  }

  // Set upgrade CTA URL
  const upgradeCta = document.getElementById('upgrade-cta');
  upgradeCta.href = `/?url=${encodeURIComponent(currentAuditUrl)}`;
}

/* ── Email capture ── */
const emailForm = document.getElementById('email-form');
const emailSuccess = document.getElementById('email-success');

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email-input').value.trim();
  if (!email) return;

  const emailBtn = document.getElementById('email-btn');
  emailBtn.disabled = true;
  emailBtn.textContent = 'Sending...';

  try {
    await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        source: 'audit',
        auditUrl: currentAuditUrl,
        auditScore: auditResult?.score,
        auditData: auditResult || null
      })
    });

    emailForm.style.display = 'none';
    emailSuccess.style.display = '';
  } catch {
    emailBtn.disabled = false;
    emailBtn.textContent = 'Send My Results';
  }
});

/* ── Check for ?url= param to auto-run audit ── */
(function checkUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url');
  if (urlParam) {
    urlInput.value = urlParam;
    form.dispatchEvent(new Event('submit'));
  }
})();

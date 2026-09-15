const fixtureParams = new URLSearchParams(location.search);
if (fixtureParams.get('scroll') === 'panel') {
  document.documentElement.classList.add('scroll-panel');
}
const scrollPanel = document.getElementById('container');
function reportScroll() {
  document.getElementById('scroll-position').textContent =
    `window=${window.scrollY} panel=${scrollPanel.scrollTop}`;
}
scrollPanel.addEventListener('scroll', reportScroll);
window.addEventListener('scroll', reportScroll);

const target = document.getElementById('lazy-target');
const trigger = document.getElementById('lazy-trigger');
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    target.dataset.loadState = 'loading';
    console.log('Lazy trigger visible! Fetching GitHub button...');
    fetch('github_button.html')
      .then(r => r.text())
      .then(html => {
        const showContent = () => {
          target.innerHTML = html;
          if (fixtureParams.has('lazy')) {
            const extra = document.createElement('div');
            extra.id = 'lazy-extra';
            extra.style.height = '1200px';
            extra.textContent = 'Additional lazy-loaded content';
            target.appendChild(extra);
          }
          target.dataset.loadState = 'loaded';
          console.log('GitHub button loaded.');
        };
        if (fixtureParams.get('lazy') === 'delayed') setTimeout(showContent, 3500);
        else showContent();
      });
    observer.disconnect();
  }
}, { threshold: 0.1 });

const btnVisible = document.getElementById('btn-visible');
if (btnVisible) {
  btnVisible.addEventListener('click', () => {
    btnVisible.textContent = 'Clicked!';
    btnVisible.style.backgroundColor = '#dcfce7'; // Light green
    btnVisible.style.borderColor = '#22c55e'; // Green border
  });
}

if (trigger) observer.observe(trigger);

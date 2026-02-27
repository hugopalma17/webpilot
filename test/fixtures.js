const target = document.getElementById('lazy-target');
const trigger = document.getElementById('lazy-trigger');
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    console.log('Lazy trigger visible! Fetching GitHub button...');
    fetch('github_button.html')
      .then(r => r.text())
      .then(html => {
        document.getElementById('lazy-target').innerHTML = html;
        console.log('GitHub button loaded.');
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

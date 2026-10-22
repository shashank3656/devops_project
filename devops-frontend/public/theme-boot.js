try {
  var stored = localStorage.getItem('opstrellis-theme') || localStorage.getItem('setuops-theme');
  var theme = stored === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
} catch (e) {}

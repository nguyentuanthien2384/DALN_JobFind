// Preserve the template's theme controls and back-to-top button without loading
// jQuery, Bootstrap JS or plugins that compete with React for the same DOM.
(function () {
  'use strict';

  var navbarColors = ['danger', 'success', 'warning', 'dark', 'light', 'primary', 'info', 'pink'];

  // The admin shell is loaded asynchronously; delegation also works after SPA
  // navigation, when the controls did not exist at DOMContentLoaded.
  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#settings-trigger')) {
      var theme = document.getElementById('theme-settings');
      if (theme) theme.classList.toggle('open');
    } else if (target.closest('.settings-close')) {
      document.querySelectorAll('#right-sidebar, #theme-settings').forEach(function (panel) {
        panel.classList.remove('open');
      });
    } else if (target.closest('.nav-settings')) {
      var sidebar = document.getElementById('right-sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    } else {
      var sidebarChoice = target.closest('#sidebar-light-theme, #sidebar-dark-theme');
      var colorChoice = target.closest('#theme-settings .tiles');
      if (sidebarChoice) {
        document.body.classList.remove('sidebar-light', 'sidebar-dark');
        document.body.classList.add(sidebarChoice.id === 'sidebar-dark-theme' ? 'sidebar-dark' : 'sidebar-light');
        document.querySelectorAll('.sidebar-bg-options').forEach(function (option) {
          option.classList.toggle('selected', option === sidebarChoice);
        });
      } else if (colorChoice) {
        var color = navbarColors.find(function (name) { return colorChoice.classList.contains(name); });
        document.querySelectorAll('.navbar').forEach(function (navbar) {
          navbarColors.forEach(function (name) { navbar.classList.remove('navbar-' + name); });
          if (color) navbar.classList.add('navbar-' + color);
        });
        document.querySelectorAll('#theme-settings .tiles').forEach(function (tile) {
          tile.classList.toggle('selected', tile === colorChoice);
        });
      }
    }
  });

  var scrollUp = document.createElement('a');
  scrollUp.id = 'scrollUp';
  scrollUp.href = '#';
  scrollUp.setAttribute('role', 'button');
  scrollUp.setAttribute('aria-label', 'Lên đầu trang');
  scrollUp.style.position = 'fixed';
  scrollUp.style.zIndex = '2147483647';
  var icon = document.createElement('i');
  icon.className = 'ti-arrow-up';
  icon.setAttribute('aria-hidden', 'true');
  scrollUp.appendChild(icon);
  document.body.appendChild(scrollUp);

  function updateScrollUp() {
    scrollUp.style.display = window.scrollY > 300 ? 'block' : 'none';
  }
  scrollUp.addEventListener('click', function (event) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  scrollUp.addEventListener('keydown', function (event) {
    if (event.key === ' ') {
      event.preventDefault();
      scrollUp.click();
    }
  });
  window.addEventListener('scroll', updateScrollUp, { passive: true });
  updateScrollUp();
}());

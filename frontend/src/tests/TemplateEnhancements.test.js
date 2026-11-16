import { fireEvent } from '@testing-library/react';

describe('standalone template enhancements', () => {
  let fixture;
  let scrollUp;
  let originalScrollTo;

  beforeAll(() => {
    // This script runs before lazy React pages are mounted and needs no jQuery.
    require('../../public/template-enhancements.js');
    scrollUp = document.getElementById('scrollUp');
    originalScrollTo = window.scrollTo;
    window.scrollTo = jest.fn();
  });

  beforeEach(() => {
    fixture = document.createElement('div');
    document.body.appendChild(fixture);
    document.body.className = '';
    window.scrollTo.mockClear();
    window.matchMedia.mockReturnValue({ matches: false });
  });

  afterEach(() => fixture.remove());
  afterAll(() => {
    scrollUp.remove();
    window.scrollTo = originalScrollTo;
  });

  it('operates theme controls mounted after the script and after replacing the admin shell', () => {
    const mountAdmin = () => {
      fixture.innerHTML = `
        <nav class="navbar navbar-primary"></nav>
        <div id="settings-trigger"><i></i></div>
        <div id="theme-settings" class="settings-panel">
          <i class="settings-close"></i>
          <div id="sidebar-light-theme" class="sidebar-bg-options selected"></div>
          <div id="sidebar-dark-theme" class="sidebar-bg-options"></div>
          <div class="tiles success"></div><div class="tiles default"></div>
        </div><div id="right-sidebar" class="settings-panel open"></div>`;
    };
    mountAdmin();
    fireEvent.click(fixture.querySelector('#settings-trigger i'));
    expect(fixture.querySelector('#theme-settings')).toHaveClass('open');
    fireEvent.click(fixture.querySelector('#sidebar-dark-theme'));
    expect(document.body).toHaveClass('sidebar-dark');
    expect(fixture.querySelector('#sidebar-light-theme')).not.toHaveClass('selected');
    fireEvent.click(fixture.querySelector('.tiles.success'));
    expect(fixture.querySelector('.navbar')).toHaveClass('navbar-success');
    expect(fixture.querySelector('.navbar')).not.toHaveClass('navbar-primary');
    fireEvent.click(fixture.querySelector('.tiles.default'));
    expect(fixture.querySelector('.navbar').className).toBe('navbar');
    fireEvent.click(fixture.querySelector('.settings-close'));
    expect(fixture.querySelector('#theme-settings')).not.toHaveClass('open');
    expect(fixture.querySelector('#right-sidebar')).not.toHaveClass('open');

    mountAdmin();
    fireEvent.click(fixture.querySelector('#settings-trigger'));
    expect(fixture.querySelector('#theme-settings')).toHaveClass('open');
  });

  it('leaves React-owned select controls untouched', () => {
    fixture.innerHTML = '<select><option>Hà Nội</option></select>';
    const select = fixture.firstElementChild;
    fireEvent.focus(select);
    fireEvent.change(select, { target: { value: 'Hà Nội' } });
    expect(fixture.children).toHaveLength(1);
    expect(select.style.display).toBe('');
  });

  it('shows back-to-top only after scrolling and supports pointer and keyboard activation', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    fireEvent.scroll(window);
    expect(scrollUp).not.toBeVisible();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    fireEvent.scroll(window);
    expect(scrollUp).toBeVisible();
    expect(scrollUp).toHaveAccessibleName('Lên đầu trang');
    fireEvent.click(scrollUp);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    fireEvent.keyDown(scrollUp, { key: ' ' });
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    window.matchMedia.mockReturnValue({ matches: true });
    fireEvent.click(scrollUp);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
  });
});

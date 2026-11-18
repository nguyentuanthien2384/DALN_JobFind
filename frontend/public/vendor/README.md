# Locally served UI fonts

These files preserve the site's existing typefaces and icon version without
requiring an external stylesheet or font host during page startup.

- `fontawesome-6.0.0-beta3/`: exact Font Awesome Free 6.0.0-beta3 stylesheet and
  webfonts previously served by cdnjs. The stylesheet SHA-512 matches the prior
  HTML integrity attribute. `LICENSE.txt` comes from the exact official npm
  package `@fortawesome/fontawesome-free@6.0.0-beta3`.
- `fonts/`: Barlow and Muli WOFF2 files from the site's original Google Fonts
  request, including Vietnamese, Latin extended and Latin subsets. `fonts.css`
  retains the original faces, weights, Unicode ranges and `font-display: swap`;
  only the URLs point to local files. The corresponding SIL Open Font Licenses
  are included as `Barlow-OFL.txt` and `Muli-OFL.txt` (the Muli project is now
  distributed as Mulish).

Original stylesheet sources:

- https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css
- https://fonts.googleapis.com/css?family=Barlow:300,400,500,600,700,900|Muli:300,400,500,600,700,800,900&display=swap

Translation remains provided by GTranslate. `load-language-widget.js` loads its
widget asynchronously after the local page has loaded and is idle; the existing
React/translation guard continues to load first in the document head.
When a translated language is already selected, the widget starts asynchronously
without waiting for idle so the guard can reveal translated content promptly.

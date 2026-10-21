(function productTransitions() {
  const barba = window.barba;
  const wrapper = document.querySelector('[data-barba="wrapper"].product-transition-wrapper');

  if (!barba || !(wrapper instanceof HTMLElement) || window.Shopify?.designMode) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const metadataSelectors = [
    'link[rel="canonical"]',
    'meta[name="description"]',
    'meta[property="og:url"]',
    'meta[property="og:title"]',
    'meta[property="og:type"]',
    'meta[property="og:description"]',
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image:width"]',
    'meta[property="og:image:height"]',
    'meta[property="og:price:amount"]',
    'meta[property="og:price:currency"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
  ];

  function animate(element, keyframes) {
    if (prefersReducedMotion.matches) return Promise.resolve();

    return element.animate(keyframes, {
      duration: 260,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    }).finished;
  }

  function prepareTransition(current, next) {
    wrapper.style.setProperty('--product-transition-height', `${current.offsetHeight}px`);
    wrapper.classList.add('is-product-transitioning');
    current.setAttribute('data-product-transition-current', '');
    next.setAttribute('data-product-transition-next', '');
    next.style.opacity = prefersReducedMotion.matches ? '1' : '0';
  }

  function finishTransition(current, next) {
    current?.removeAttribute('data-product-transition-current');
    next?.removeAttribute('data-product-transition-next');
    next?.style.removeProperty('opacity');
    next?.style.removeProperty('transform');
    wrapper.classList.remove('is-product-transitioning');
    wrapper.style.removeProperty('--product-transition-height');
  }

  function updateDocumentHead(html) {
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    document.title = parsedDocument.title;

    for (const selector of metadataSelectors) {
      document.head.querySelectorAll(selector).forEach((element) => element.remove());
      parsedDocument.head.querySelectorAll(selector).forEach((element) => {
        document.head.append(element.cloneNode(true));
      });
    }

    document.documentElement.lang = parsedDocument.documentElement.lang || document.documentElement.lang;
    document.documentElement.dir = parsedDocument.documentElement.dir || document.documentElement.dir;
  }

  async function loadNewExternalScripts(container) {
    const scripts = [...container.querySelectorAll('script[src]')];
    const loadedSources = new Set(
      [...document.querySelectorAll('script[src]')]
        .filter((script) => !container.contains(script))
        .map((script) => new URL(script.src, document.baseURI).href)
    );

    await Promise.all(
      scripts.map((sourceScript) => {
        const source = new URL(sourceScript.src, document.baseURI).href;
        if (loadedSources.has(source)) return Promise.resolve();

        loadedSources.add(source);

        return new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = source;
          script.type = sourceScript.type || 'text/javascript';
          script.async = false;
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', resolve, { once: true });
          document.body.append(script);
        });
      })
    );
  }

  function isEligibleConnectedProductLink(element, href) {
    if (!(element instanceof Element) || !element.matches('[data-connected-product-link]')) return false;

    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin;
  }

  barba.init({
    cacheIgnore: true,
    prefetchIgnore: true,
    preventRunning: true,
    timeout: 10000,
    prevent: ({ el, event, href }) => {
      if (el instanceof Element && el.getAttribute('aria-current') === 'page') {
        event.preventDefault();
        return true;
      }

      return !isEligibleConnectedProductLink(el, href);
    },
    requestError(trigger, action, url) {
      if (action === 'click' && typeof url === 'string') {
        window.location.assign(url);
        return false;
      }
    },
    transitions: [
      {
        name: 'connected-product',
        sync: true,
        from: { namespace: ['product'] },
        to: { namespace: ['product'] },
        before({ current, next }) {
          if (!(current.container instanceof HTMLElement) || !(next.container instanceof HTMLElement)) return;
          prepareTransition(current.container, next.container);
        },
        async leave({ current }) {
          if (!(current.container instanceof HTMLElement)) return;
          await animate(current.container, [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0.18, transform: 'translateY(-6px)' },
          ]);
        },
        async enter({ next }) {
          if (!(next.container instanceof HTMLElement)) return;
          await loadNewExternalScripts(next.container);
          customElements.upgrade(next.container);
          await animate(next.container, [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ]);
        },
        after({ current, next }) {
          if (next.html) updateDocumentHead(next.html);
          finishTransition(current.container, next.container);
          window.scrollTo({ top: wrapper.offsetTop, behavior: 'auto' });
        },
      },
    ],
  });
})();

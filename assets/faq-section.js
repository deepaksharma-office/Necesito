import { Component } from '@theme/component';

class FaqSectionComponent extends Component {
  /** @type {WeakMap<HTMLDetailsElement, Animation>} */
  #animations = new WeakMap();

  /** @param {MouseEvent} event */
  handleSummaryClick(event) {
    const summary = event.currentTarget;
    if (!(summary instanceof HTMLElement)) return;

    const details = summary.closest('details');
    const answer = details?.querySelector('.faq-section__answer-wrap');
    if (!(details instanceof HTMLDetailsElement) || !(answer instanceof HTMLElement)) return;

    event.preventDefault();
    const wasClosing = details.dataset.closing === 'true';
    this.#animations.get(details)?.cancel();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      details.open = !details.open;
      return;
    }

    const startHeight = details.offsetHeight;
    const summaryHeight = summary.offsetHeight;
    const isOpening = !details.open || wasClosing;

    if (isOpening) {
      details.open = true;
      delete details.dataset.closing;
    } else {
      details.dataset.closing = 'true';
    }

    const endHeight = isOpening ? summaryHeight + answer.scrollHeight : summaryHeight;
    details.style.overflow = 'hidden';

    const animation = details.animate(
      { height: [`${startHeight}px`, `${endHeight}px`] },
      { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );

    this.#animations.set(details, animation);

    animation.addEventListener('finish', () => {
      if (!isOpening) details.open = false;
      delete details.dataset.closing;
      details.style.removeProperty('height');
      details.style.removeProperty('overflow');
      this.#animations.delete(details);
    }, { once: true });

    animation.addEventListener('cancel', () => {
      if (this.#animations.get(details) !== animation) return;
      details.style.removeProperty('height');
      details.style.removeProperty('overflow');
    }, { once: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const details of this.querySelectorAll('details')) {
      this.#animations.get(details)?.cancel();
    }
  }
}

if (!customElements.get('faq-section-component')) {
  customElements.define('faq-section-component', FaqSectionComponent);
}

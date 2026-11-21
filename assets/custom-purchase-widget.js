import { Component } from '@theme/component';
import { CartErrorEvent, CartLinesUpdateEvent, StandardEvents } from '@shopify/events';
import { fetchConfig } from '@theme/utilities';

class CustomPurchaseWidget extends Component {
  requiredRefs = [
    'productData',
    'sellingPlanInput',
    'submitButton',
    'summaryDescription',
    'summaryTotal',
    'buttonTotal',
  ];
  #abortController = new AbortController();
  #data;
  #variant;
  #mode = 'one-time';
  #quantity = 1;
  #sellingPlanId = '';
  #gift = { configured: false, from: '', to: '', message: '' };
  #giftLineToken = '';
  #awaitingMainAdd = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.#abortController.signal.aborted) this.#abortController = new AbortController();
    try {
      this.#data = JSON.parse(this.refs.productData.textContent || '{"variants":[]}');
    } catch (error) {
      console.error('[CustomPurchaseWidget] Main product JSON could not be parsed.', error);
      return;
    }

    const form = this.#form;
    const formProductId = form?.closest('product-form-component')?.dataset.productId;
    const productIds = [this.dataset.productId, this.#data.productId, formProductId].filter(Boolean).map(String);
    if (!form || new Set(productIds).size !== 1) {
      console.error('[CustomPurchaseWidget] Main product identity mismatch; initialization stopped.', {
        widgetProductId: this.dataset.productId || null,
        jsonProductId: this.#data.productId || null,
        formProductId: formProductId || null,
        productFormId: this.dataset.productFormId || null,
      });
      return;
    }

    this.#variant = this.#findVariant(this.dataset.initialVariantId);
    this.#mode = this.#variant?.allocations.length > 0 ? 'subscription' : 'one-time';

    const productForm = form.closest('product-form-component');
    productForm?.classList.add('custom-purchase-native-form');

    const { signal } = this.#abortController;
    this.addEventListener('change', this.#handleChange, { signal });
    this.refs.decreaseButton?.addEventListener('click', () => this.#changeOneTimeQuantity(-1), { signal });
    this.refs.increaseButton?.addEventListener('click', () => this.#changeOneTimeQuantity(1), { signal });
    this.refs.giftButton?.addEventListener('click', this.#openGiftDialog, { signal });
    this.refs.giftCloseButton?.addEventListener('click', this.#closeGiftDialog, { signal });
    this.refs.giftDialog?.addEventListener('click', this.#handleGiftDialogClick, { signal });
    this.refs.giftForm?.addEventListener('submit', this.#saveGift, { signal });
    this.refs.giftRemoveButton?.addEventListener('click', this.#removeGift, { signal });
    this.refs.giftRetryButton?.addEventListener('click', this.#retryGift, { signal });
    this.refs.giftMessage?.addEventListener('input', this.#updateGiftMessageCount, { signal });
    form?.addEventListener('submit', this.#handleSubmit, { signal });
    this.closest('.shopify-section')?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });
    productForm?.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartComplete, { signal });
    productForm?.addEventListener(StandardEvents.cartError, this.#handleCartError, { signal });
    this.addEventListener(StandardEvents.cartError, this.#handleCartError, { signal });

    this.#syncVariant();
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#form?.closest('product-form-component')?.classList.remove('custom-purchase-native-form');
    super.disconnectedCallback();
  }

  get #form() {
    return document.getElementById(this.dataset.productFormId || '');
  }

  #findVariant(id) {
    return this.#data.variants.find((variant) => String(variant.id) === String(id)) || this.#data.variants[0];
  }

  #handleProductSelect = (event) => {
    event.promise
      ?.then(({ variant, detail }) => {
        queueMicrotask(() => {
          const variantId = variant?.id || detail?.resource?.id || this.#form?.querySelector('input[name="id"]')?.value;
          this.#variant = this.#findVariant(variantId);
          this.#syncVariant();
        });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') this.#showError(error.message);
      });
  };

  #handleChange = (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;

    if (event.target.name.startsWith('custom-purchase-mode-')) {
      this.#mode = event.target.value;
      this.#syncMode();
    } else if (event.target.name.startsWith('custom-subscription-quantity-')) {
      this.#quantity = Number(event.target.value);
      this.#syncQuantity();
      this.#renderPricing();
    } else if (event.target.name.startsWith('custom-selling-plan-')) {
      this.#sellingPlanId = event.target.value;
      this.#syncSellingPlan();
      this.#renderPricing();
    }
  };

  #syncVariant() {
    if (!this.#variant) return;

    const subscriptionAvailable = this.#variant.allocations.length > 0;
    this.dataset.subscriptionAvailable = String(subscriptionAvailable);
    this.#quantity = Math.max(this.#variant.min || 1, this.#quantity);
    this.#renderFrequencies();

    if (!subscriptionAvailable && this.#mode === 'subscription') {
      this.#mode = 'one-time';
      const oneTimeInput = this.refs.modeInputs?.find((input) => input.value === 'one-time');
      if (oneTimeInput) oneTimeInput.checked = true;
    }

    for (const input of this.refs.modeInputs || []) {
      if (input.value === 'subscription') input.disabled = !this.#variant.allocations.length;
    }

    this.#syncMode();
    this.refs.submitButton.disabled = !this.#variant.available;
  }

  #syncMode() {
    const subscription = this.#mode === 'subscription' && this.#variant?.allocations.length > 0;
    if (this.refs.subscriptionPanel) this.refs.subscriptionPanel.hidden = !subscription;
    if (this.refs.oneTimePanel) this.refs.oneTimePanel.hidden = subscription;
    this.refs.sellingPlanInput.disabled = !subscription;

    if (subscription) {
      this.#quantity = this.#validSubscriptionQuantity();
      const selected = this.refs.subscriptionQuantityInputs?.find((input) => Number(input.value) === this.#quantity);
      if (selected) selected.checked = true;
    } else {
      this.refs.sellingPlanInput.value = '';
      this.#quantity = this.#nativeQuantity();
    }

    this.#syncQuantity();
    this.#syncSellingPlan();
    this.#renderPricing();
  }

  #validSubscriptionQuantity() {
    const values = (this.refs.subscriptionQuantityInputs || [])
      .map((input) => Number(input.value))
      .filter((value) => this.#isValidQuantity(value));

    for (const input of this.refs.subscriptionQuantityInputs || []) {
      input.disabled = !values.includes(Number(input.value));
    }

    return values.includes(this.#quantity) ? this.#quantity : values[0] || this.#variant.min || 1;
  }

  #isValidQuantity(value) {
    if (value < this.#variant.min) return false;
    if (this.#variant.max && value > this.#variant.max) return false;
    return (value - this.#variant.min) % this.#variant.step === 0;
  }

  #nativeQuantity() {
    const selector = this.#form?.closest('product-form-component')?.refs?.quantitySelector;
    const quantityInput = this.#form?.querySelector('input[name="quantity"]');
    return Number(selector?.getValue?.()) || Number(quantityInput?.value) || this.#variant?.min || 1;
  }

  #syncQuantity() {
    const selector = this.#form?.closest('product-form-component')?.refs?.quantitySelector;
    selector?.setValue?.(String(this.#quantity));
    const quantityInput = this.#form?.querySelector('input[name="quantity"]');
    if (quantityInput) quantityInput.value = String(this.#quantity);
    if (this.refs.oneTimeQuantity) this.refs.oneTimeQuantity.textContent = String(this.#quantity);
    if (this.refs.decreaseButton) this.refs.decreaseButton.disabled = this.#quantity <= this.#variant.min;
    if (this.refs.increaseButton) this.refs.increaseButton.disabled = Boolean(this.#variant.max && this.#quantity >= this.#variant.max);
  }

  #changeOneTimeQuantity(direction) {
    const next = this.#quantity + this.#variant.step * direction;
    if (!this.#isValidQuantity(next)) return;
    this.#quantity = next;
    this.#syncQuantity();
    this.#renderPricing();
  }

  #renderFrequencies() {
    const container = this.refs.frequencyOptions;
    if (!container) return;
    container.replaceChildren();

    for (const allocation of this.#variant.allocations) {
      const label = document.createElement('label');
      label.className = 'custom-purchase__frequency';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `custom-selling-plan-${this.dataset.initialVariantId}`;
      input.value = allocation.id;
      const content = document.createElement('span');
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      title.textContent = allocation.name;
      detail.textContent = `${this.#formatMoney(allocation.perDeliveryPrice)} / ${this.#eachLabel}`;
      content.append(title, detail);
      label.append(input, content);
      container.append(label);
    }

    if (!this.#variant.allocations.some((allocation) => String(allocation.id) === String(this.#sellingPlanId))) {
      this.#sellingPlanId = String(this.#variant.allocations[0]?.id || '');
    }

    const selected = Array.from(container.querySelectorAll('input')).find((input) => input.value === this.#sellingPlanId);
    if (selected) selected.checked = true;
    this.#syncSellingPlan();
    this.#renderSaveUpTo();
  }

  #syncSellingPlan() {
    const subscription = this.#mode === 'subscription' && this.#sellingPlanId;
    this.refs.sellingPlanInput.disabled = !subscription;
    this.refs.sellingPlanInput.value = subscription ? this.#sellingPlanId : '';
  }

  #renderSaveUpTo() {
    if (!this.refs.saveUpTo) return;
    const discounts = this.#variant.allocations.map((allocation) => this.#discountPercent(allocation));
    const maximum = Math.max(0, ...discounts);
    this.refs.saveUpTo.textContent = maximum > 0 ? `${this.#saveUpToLabel} ${maximum}%` : '';
  }

  #renderPricing() {
    if (!this.#variant) return;
    const allocation = this.#variant.allocations.find((item) => String(item.id) === String(this.#sellingPlanId));
    const subscription = this.#mode === 'subscription' && allocation;
    const unitPrice = subscription ? allocation.price : this.#variant.price;
    const total = unitPrice * this.#quantity;
    const originalTotal = this.#variant.price * this.#quantity;
    const savings = Math.max(0, originalTotal - total);

    this.refs.summaryDescription.textContent = subscription
      ? `${allocation.name} · ${this.#quantity} ${this.#quantity === 1 ? this.#bagLabel : this.#bagsLabel}`
      : `${this.#variant.title} · ${this.#quantity}`;
    this.refs.summaryTotal.textContent = this.#formatMoney(total);
    this.refs.buttonTotal.textContent = this.#formatMoney(total);

    if (this.refs.summarySavings) {
      this.refs.summarySavings.hidden = savings <= 0;
      this.refs.summarySavings.textContent = savings > 0 ? `${this.#savingsLabel} ${this.#formatMoney(savings)}` : '';
    }
  }

  #discountPercent(allocation) {
    const comparison = allocation.compareAtPrice || this.#variant.price;
    return comparison > allocation.price ? Math.round(((comparison - allocation.price) / comparison) * 100) : 0;
  }

  #handleSubmit = (event) => {
    if (this.#awaitingMainAdd) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      this.#gift.configured &&
      (!this.dataset.giftProductId || !this.dataset.giftVariantId || this.dataset.giftAvailable !== 'true')
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.#showError(this.#giftPartialErrorLabel);
      return;
    }

    this.#showError('');
    if (this.#gift.configured && !this.#giftLineToken) this.#giftLineToken = crypto.randomUUID();
    this.#awaitingMainAdd = true;
    this.refs.submitButton.disabled = true;
    this.refs.submitButton.setAttribute('aria-busy', 'true');

    if (this.#gift.configured) {
      event.preventDefault();
      event.stopPropagation();
      void this.#addMainAndGiftProducts();
    }
  };

  #handleCartComplete = (event) => {
    const productForm = this.#form?.closest('product-form-component');
    if (!this.#awaitingMainAdd || event.target !== productForm) return;

    if (!event.promise) {
      this.#awaitingMainAdd = false;
      this.#restoreButton();
      this.#showError(this.#cartErrorLabel);
      return;
    }

    event.promise
      .then(({ detail }) => {
        if (detail?.didError) this.#showError(this.#cartErrorLabel);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') this.#showError(error.message || this.#giftPartialErrorLabel);
      })
      .finally(() => {
        this.#awaitingMainAdd = false;
        this.#restoreButton();
      });
  };

  #handleCartError = (event) => {
    this.#showError(event.error || event.detail?.error || this.#cartErrorLabel);
    if (this.#awaitingMainAdd) {
      this.#awaitingMainAdd = false;
      this.#restoreButton();
    }
  };

  #restoreButton() {
    this.refs.submitButton.disabled = !this.#variant?.available;
    this.refs.submitButton.removeAttribute('aria-busy');
  }

  #retryGift = async () => {
    if (!this.#gift.configured || this.#awaitingMainAdd) return;
    this.#awaitingMainAdd = true;
    this.refs.submitButton.disabled = true;
    this.refs.giftRetryButton.hidden = true;
    try {
      await this.#addGiftProduct();
      this.#showError('');
    } catch (error) {
      this.#showError(error.message || this.#giftPartialErrorLabel);
    } finally {
      this.#awaitingMainAdd = false;
      this.#restoreButton();
    }
  };

  #openGiftDialog = () => {
    if (!(this.refs.giftDialog instanceof HTMLDialogElement) || this.dataset.giftAvailable !== 'true') return;
    if (this.refs.giftFrom) this.refs.giftFrom.value = this.#gift.from;
    if (this.refs.giftTo) this.refs.giftTo.value = this.#gift.to;
    if (this.refs.giftMessage) this.refs.giftMessage.value = this.#gift.message;
    this.#updateGiftMessageCount();
    this.refs.giftDialog.showModal();
  };

  #closeGiftDialog = () => {
    this.refs.giftDialog?.close();
  };

  #handleGiftDialogClick = (event) => {
    if (event.target === this.refs.giftDialog) this.#closeGiftDialog();
  };

  #saveGift = (event) => {
    event.preventDefault();
    if (!this.refs.giftForm?.reportValidity() || this.dataset.giftAvailable !== 'true') return;

    this.#gift = {
      configured: true,
      from: this.refs.giftFrom?.value.trim() || '',
      to: this.refs.giftTo?.value.trim() || '',
      message: this.refs.giftMessage?.value.trim() || '',
    };
    this.#renderGiftState();
    this.#closeGiftDialog();
  };

  #removeGift = () => {
    this.#gift = { configured: false, from: '', to: '', message: '' };
    this.#giftLineToken = '';
    if (this.refs.giftForm) this.refs.giftForm.reset();
    this.#updateGiftMessageCount();
    this.#renderGiftState();
    this.#closeGiftDialog();
  };

  #renderGiftState() {
    if (!this.refs.giftButton) return;
    this.refs.giftButton.dataset.configured = String(this.#gift.configured);
    if (this.refs.giftButtonTitle) {
      this.refs.giftButtonTitle.textContent = this.#gift.configured
        ? this.dataset.giftConfiguredLabel || ''
        : this.dataset.giftDefaultLabel || '';
    }
    if (this.refs.giftButtonDetail) {
      const names = [this.#gift.from, this.#gift.to].filter(Boolean).join(' · ');
      this.refs.giftButtonDetail.textContent = this.#gift.configured
        ? names || this.dataset.giftEditLabel || ''
        : this.dataset.giftSupportingText || '';
    }
    if (this.refs.giftRemoveButton) this.refs.giftRemoveButton.hidden = !this.#gift.configured;
  }

  #updateGiftMessageCount = () => {
    if (this.refs.giftMessageCount) this.refs.giftMessageCount.textContent = String(this.refs.giftMessage?.value.length || 0);
  };

  async #addMainAndGiftProducts() {
    const giftVariantId = this.dataset.giftVariantId;
    if (!this.#variant || !giftVariantId || this.dataset.giftAvailable !== 'true') {
      this.#showError(this.#giftPartialErrorLabel);
      this.#awaitingMainAdd = false;
      this.#restoreButton();
      return;
    }

    const mainItem = {
      id: Number(this.#variant.id),
      quantity: this.#quantity,
    };
    if (this.#mode === 'subscription' && this.#sellingPlanId) {
      mainItem.selling_plan = Number(this.#sellingPlanId);
    }

    const giftProperties = {};
    if (this.#gift.from) giftProperties.From = this.#gift.from;
    if (this.#gift.to) giftProperties.To = this.#gift.to;
    if (this.#gift.message) giftProperties['Gift Message'] = this.#gift.message;
    giftProperties['_Gift Reference'] = this.#giftLineToken || crypto.randomUUID();

    const items = [
      mainItem,
      {
        id: Number(giftVariantId),
        quantity: 1,
        properties: giftProperties,
      },
    ];
    const sectionIds = Array.from(document.querySelectorAll('cart-items-component'))
      .map((item) => item instanceof HTMLElement ? item.dataset.sectionId : '')
      .filter(Boolean);
    const deferredEventPromise = CartLinesUpdateEvent.createPromise();

    this.dispatchEvent(new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: items.map((item) => ({ merchandiseId: String(item.id), quantity: item.quantity })),
      promise: deferredEventPromise.promise,
    }));

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ items, sections: sectionIds.join(',') }),
      });
      const result = await response.json();
      if (!response.ok || result.status) {
        throw new Error(result.description || result.message || this.#cartErrorLabel);
      }

      const cartResponse = await fetch(`${Theme.routes.cart_url}.json`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!cartResponse.ok) throw new Error(this.#cartErrorLabel);
      const cart = await cartResponse.json();

      deferredEventPromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          itemCount: this.#quantity + 1,
          sections: result.sections,
          source: 'custom-purchase-widget',
          didError: false,
        },
      });
      this.#giftLineToken = '';
      this.#showError('');
    } catch (error) {
      deferredEventPromise.reject(error);
      this.#showError(error?.message || this.#cartErrorLabel);
      this.dispatchEvent(new CartErrorEvent({
        error: error?.message || this.#cartErrorLabel,
        code: 'INVALID',
      }));
    } finally {
      this.#awaitingMainAdd = false;
      this.#restoreButton();
    }
  }

  async #addGiftProduct() {
    const giftProductId = this.dataset.giftProductId;
    const giftVariantId = this.dataset.giftVariantId;
    if (!this.#gift.configured || !giftProductId || !giftVariantId || this.dataset.giftAvailable !== 'true') {
      throw new Error(this.#giftPartialErrorLabel);
    }

    const deferredEventPromise = CartLinesUpdateEvent.createPromise();
    const formData = new FormData();
    formData.set('id', giftVariantId);
    formData.set('quantity', '1');
    if (this.#gift.from) formData.set('properties[From]', this.#gift.from);
    if (this.#gift.to) formData.set('properties[To]', this.#gift.to);
    if (this.#gift.message) formData.set('properties[Gift Message]', this.#gift.message);
    formData.set('properties[_Gift Reference]', this.#giftLineToken || crypto.randomUUID());

    const sectionIds = Array.from(document.querySelectorAll('cart-items-component'))
      .map((item) => item instanceof HTMLElement ? item.dataset.sectionId : '')
      .filter(Boolean);
    if (sectionIds.length) formData.set('sections', sectionIds.join(','));

    this.dispatchEvent(new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: giftVariantId, quantity: 1 }],
      promise: deferredEventPromise.promise,
    }));

    try {
      const fetchCfg = fetchConfig('javascript', { body: formData });
      const response = await fetch(Theme.routes.cart_add_url, {
        ...fetchCfg,
        headers: { ...fetchCfg.headers, Accept: 'text/html' },
      });
      const result = await response.json();
      if (!response.ok || result.status) throw new Error(result.description || result.message || this.#giftPartialErrorLabel);

      const cartResponse = await fetch(`${Theme.routes.cart_url}.json`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!cartResponse.ok) throw new Error(this.#giftPartialErrorLabel);
      const cart = await cartResponse.json();
      deferredEventPromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          itemCount: 1,
          sections: result.sections,
          source: 'custom-gift-product',
          didError: false,
        },
      });
      this.#giftLineToken = '';
    } catch (error) {
      deferredEventPromise.reject(error);
      if (this.refs.giftRetryButton) this.refs.giftRetryButton.hidden = false;
      this.dispatchEvent(new CartErrorEvent({
        error: this.#giftPartialErrorLabel,
        code: 'INVALID',
        detail: { description: error?.message },
      }));
      throw new Error(this.#giftPartialErrorLabel);
    }
  }

  #showError(message) {
    if (!this.refs.error) return;
    this.refs.error.textContent = message;
    this.refs.error.hidden = !message;
  }

  #formatMoney(cents) {
    return new Intl.NumberFormat(document.documentElement.lang || 'en', {
      style: 'currency',
      currency: this.dataset.currency || 'USD',
    }).format(cents / 100);
  }

  get #bagLabel() { return this.dataset.bagLabel || ''; }
  get #bagsLabel() { return this.dataset.bagsLabel || ''; }
  get #eachLabel() { return this.dataset.bagLabel || ''; }
  get #saveUpToLabel() { return this.dataset.saveUpToLabel || ''; }
  get #savingsLabel() { return this.dataset.savingsLabel || ''; }
  get #cartErrorLabel() { return this.dataset.cartErrorLabel || ''; }
  get #giftPartialErrorLabel() { return this.dataset.giftPartialErrorLabel || this.#cartErrorLabel; }
}

if (!customElements.get('custom-purchase-widget')) {
  customElements.define('custom-purchase-widget', CustomPurchaseWidget);
}

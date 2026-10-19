import { Component } from '@theme/component';

/**
 * Synchronizes native video playback and fullscreen state with the custom controls.
 *
 * @typedef {object} Refs
 * @property {HTMLVideoElement} [video]
 * @property {HTMLButtonElement} [centerToggle]
 * @property {HTMLButtonElement} [barToggle]
 * @property {HTMLElement[]} [playIcon]
 * @property {HTMLElement[]} [pauseIcon]
 * @property {HTMLButtonElement} [fullscreenToggle]
 * @property {HTMLElement} [enterFullscreenIcon]
 * @property {HTMLElement} [exitFullscreenIcon]
 *
 * @extends {Component<Refs>}
 */
class VideoShowcase extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.#initialize();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#initialize();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    super.disconnectedCallback();
  }

  #abortController;

  #initialize() {
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    const { video } = this.refs;

    if (!video) return;

    for (const eventName of ['play', 'playing', 'pause', 'ended', 'emptied']) {
      video.addEventListener(eventName, () => this.#syncPlayback(), { signal });
    }

    document.addEventListener('fullscreenchange', () => this.#syncFullscreen(), { signal });
    document.addEventListener('webkitfullscreenchange', () => this.#syncFullscreen(), { signal });
    this.#syncPlayback();
    this.#syncFullscreen();
  }

  async togglePlayback() {
    const { video } = this.refs;
    if (!video) return;

    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;

      try {
        await video.play();
      } catch (_error) {
        this.#syncPlayback();
      }
    } else {
      video.pause();
    }
  }

  async toggleFullscreen() {
    const activeElement = document.fullscreenElement || document.webkitFullscreenElement;

    try {
      if (activeElement === this) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (this.requestFullscreen) {
        await this.requestFullscreen();
      } else if (this.webkitRequestFullscreen) {
        this.webkitRequestFullscreen();
      } else if (this.refs.video?.webkitEnterFullscreen) {
        this.refs.video.webkitEnterFullscreen();
      }
    } catch (_error) {
      this.#syncFullscreen();
    }
  }

  #syncPlayback() {
    const { video, centerToggle, barToggle, playIcon = [], pauseIcon = [] } = this.refs;
    if (!video) return;

    const isPlaying = !video.paused && !video.ended;
    this.toggleAttribute('data-playing', isPlaying);

    for (const icon of playIcon) icon.hidden = isPlaying;
    for (const icon of pauseIcon) icon.hidden = !isPlaying;

    const label = isPlaying ? this.dataset.pauseLabel : this.dataset.playLabel;
    centerToggle?.setAttribute('aria-label', label || '');
    barToggle?.setAttribute('aria-label', label || '');
  }

  #syncFullscreen() {
    const { fullscreenToggle, enterFullscreenIcon, exitFullscreenIcon } = this.refs;
    if (!fullscreenToggle) return;

    const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
    const isFullscreen = activeElement === this;
    this.toggleAttribute('data-fullscreen', isFullscreen);
    enterFullscreenIcon.hidden = isFullscreen;
    exitFullscreenIcon.hidden = !isFullscreen;
    fullscreenToggle.setAttribute(
      'aria-label',
      isFullscreen ? this.dataset.exitFullscreenLabel || '' : this.dataset.enterFullscreenLabel || ''
    );
  }
}

if (!customElements.get('video-showcase-component')) {
  customElements.define('video-showcase-component', VideoShowcase);
}

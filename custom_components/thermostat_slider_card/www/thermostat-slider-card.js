/**
 * Thermostat Slider Card
 * A custom Home Assistant card for climate/thermostat control.
 *
 * Features:
 * - Large current temperature display (accent color when heating)
 * - Slider for setpoint adjustment with tap and drag
 * - Configurable alert banners (freeze risk, heating struggling)
 * - Theme-compatible with CSS custom property overrides
 */

export class ThermostatSliderCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isDragging = false;
    this._debounceTimer = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }
    // Layout: 'full' (default) or 'one-line'. An unknown value falls back to
    // 'full' (so a typo never breaks the dashboard) and warns to the console.
    let layout = config.layout || 'full';
    if (layout !== 'full' && layout !== 'one-line') {
      console.warn(
        `thermostat-slider-card: unknown layout "${layout}", falling back ` +
          `to "full". Valid values: "full", "one-line".`
      );
      layout = 'full';
    }

    // slider_width: percentage of the row the slider occupies in one-line
    // layout (so stacked cards' sliders align). Number only; clamped 20–80.
    // Non-numeric → default; out-of-range → clamp; both warn.
    const SLIDER_WIDTH_DEFAULT = 55;
    const SLIDER_WIDTH_MIN = 20;
    const SLIDER_WIDTH_MAX = 80;
    let sliderWidth = SLIDER_WIDTH_DEFAULT;
    if (config.slider_width != null) {
      const raw = Number(config.slider_width);
      if (!Number.isFinite(raw)) {
        console.warn(
          `thermostat-slider-card: slider_width "${config.slider_width}" is ` +
            `not a number, using default ${SLIDER_WIDTH_DEFAULT}.`
        );
      } else if (raw < SLIDER_WIDTH_MIN || raw > SLIDER_WIDTH_MAX) {
        sliderWidth = Math.max(SLIDER_WIDTH_MIN, Math.min(SLIDER_WIDTH_MAX, raw));
        console.warn(
          `thermostat-slider-card: slider_width ${raw} out of range, clamped ` +
            `to ${sliderWidth} (valid ${SLIDER_WIDTH_MIN}–${SLIDER_WIDTH_MAX}).`
        );
      } else {
        sliderWidth = raw;
      }
    }

    this._config = {
      entity: config.entity,
      name: config.name || '',
      min: config.min || 14,
      max: config.max || 21,
      step: config.step || 0.5,
      timer: config.timer || '',
      threshold: config.threshold || '',
      freeze_threshold: config.freeze_threshold ?? 5,
      ...config,
      layout,
      slider_width: sliderWidth
    };
    this._rendered = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) return;
    this._updateDisplay();
  }

  getCardSize() {
    return 3;
  }

  _render() {
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
        }
        .card {
          background: var(--tsc-card-bg, var(--ha-card-background, rgba(255, 255, 255, 0.04)));
          border: 1px solid var(--tsc-card-border, rgba(255, 255, 255, 0.08));
          border-radius: var(--tsc-card-radius, 16px);
          padding: 20px;
          box-sizing: border-box;
          cursor: pointer;
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .card.unavailable {
          opacity: 0.5;
          filter: grayscale(100%);
        }
        .alert-banner {
          background: var(--tsc-alert-bg, #EF4444);
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 500;
          color: var(--tsc-alert-text, #FFF);
        }
        .alert-icon {
          font-size: 14px;
          line-height: 1;
        }
        .name {
          font-size: 14px;
          font-weight: 400;
          color: var(--tsc-name-color, var(--secondary-text-color, rgba(255, 255, 255, 0.6)));
          text-align: center;
          margin-bottom: 8px;
        }
        .temperature {
          font-size: 32px;
          font-weight: 700;
          text-align: center;
          color: var(--tsc-temp-color, var(--primary-text-color, #FFFFFF));
          padding: 16px 0;
          transition: color 0.3s ease;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .temperature.heating {
          color: var(--tsc-heating-color, #F59E0B);
        }
        .temperature.cooling {
          color: var(--tsc-cooling-color, #06B6D4);
        }
        .slider-container {
          width: 100%;
          padding: 8px 0;
          margin-top: auto;
        }
        .slider-track {
          position: relative;
          width: 100%;
          height: 40px;
          background: var(--tsc-slider-track, rgba(255, 255, 255, 0.08));
          border-radius: 8px;
          cursor: pointer;
          touch-action: none;
          overflow: hidden;
        }
        .slider-fill {
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          background: var(--tsc-slider-fill, linear-gradient(90deg, #F59E0B, #FBBF24));
          border-radius: 8px;
          pointer-events: none;
          transition: width 0.1s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .slider-fill.cooling {
          background: var(--tsc-slider-fill-cool, linear-gradient(90deg, #06B6D4, #22D3EE));
        }
        .slider-thumb {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 4px;
          height: 22px;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 2px;
          margin-right: 8px;
          cursor: grab;
          transition: height 0.15s ease, width 0.15s ease;
          touch-action: none;
        }
        .slider-setpoint {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          pointer-events: none;
          transition: left 0.1s ease, color 0.1s ease;
        }
        .slider-setpoint.inside {
          color: rgba(0, 0, 0, 0.7);
        }
        .slider-setpoint.outside {
          color: var(--tsc-setpoint-color, var(--primary-text-color, rgba(255, 255, 255, 0.7)));
        }
        .slider-thumb:hover {
          height: 26px;
          width: 5px;
        }
        .slider-track:active .slider-thumb,
        .slider-thumb.dragging {
          cursor: grabbing;
          height: 28px;
          width: 5px;
        }
        .offline-text {
          font-size: 32px;
          font-weight: 700;
          text-align: center;
          color: var(--tsc-offline-color, var(--disabled-text-color, rgba(255, 255, 255, 0.4)));
          padding: 16px 0;
        }
        .hidden {
          display: none !important;
        }

        /* ── One-line layout ──────────────────────────────────────────
           Single row: [alert-icon?] name · temp · slider. The slider has a
           fixed width (slider_width %, set inline) so stacked cards align.
           Temp + icon never shrink; the NAME is the only flexible element,
           so it is what clips with an ellipsis when space is tight. */
        .card.layout-one-line {
          flex-direction: row;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          position: relative;
        }
        .card.layout-one-line .name {
          text-align: left;
          margin-bottom: 0;
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card.layout-one-line .name.alert-name {
          color: var(--tsc-alert-name-color, #EF4444);
        }
        .card.layout-one-line .temperature {
          font-size: 18px;
          padding: 0;
          flex: 0 0 auto;
        }
        .card.layout-one-line .slider-container {
          /* flex-basis set inline from slider_width; never grow/shrink. */
          flex-grow: 0;
          flex-shrink: 0;
          padding: 0;
          margin-top: 0;
          min-width: 0;
        }
        .card.layout-one-line .slider-track {
          height: 32px;
        }
        .card.layout-one-line .alert-inline {
          flex: 0 0 auto;
        }
        .card.layout-one-line .offline-text {
          font-size: 18px;
          padding: 0;
          flex: 1;
          text-align: left;
        }
        /* The full-width text banner is never shown in one-line mode; the
           inline icon + popover replace it. */
        .card.layout-one-line #alert-banner {
          display: none !important;
        }

        /* Inline alert icon (one-line only) + tap-to-reveal popover. */
        .alert-inline {
          position: relative;
          flex: 0 0 auto;
          display: flex;
          align-items: center;
        }
        .alert-icon-inline {
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 2px;
        }
        .alert-popover {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--tsc-alert-bg, #EF4444);
          color: var(--tsc-alert-text, #FFF);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: 6px;
          white-space: nowrap;
          z-index: 2;
          pointer-events: none;
        }
        /* Little pointer triangle under the bubble. */
        .alert-popover::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 4px solid transparent;
          border-top-color: var(--tsc-alert-bg, #EF4444);
        }
      </style>
      <div class="card ${this._config.layout === 'one-line' ? 'layout-one-line' : ''}" id="card">
        <div class="alert-banner hidden" id="alert-banner">
          <span class="alert-icon" id="alert-icon"></span>
          <span class="alert-text" id="alert-text"></span>
        </div>
        <div class="alert-inline hidden" id="alert-inline">
          <span class="alert-icon-inline" id="alert-icon-inline"></span>
          <span class="alert-popover hidden" id="alert-popover"></span>
        </div>
        <div class="name" id="name"></div>
        <div class="temperature" id="temperature"></div>
        <div class="offline-text hidden" id="offline">Offline</div>
        <div class="slider-container" id="slider-container">
          <div class="slider-track" id="slider-track">
            <div class="slider-fill" id="slider-fill">
              <div class="slider-thumb" id="slider-thumb"></div>
            </div>
            <span class="slider-setpoint" id="slider-setpoint"></span>
          </div>
        </div>
      </div>
    `;

    // Fix the slider's width in one-line layout so stacked cards align.
    if (this._config.layout === 'one-line') {
      const sliderContainer = this.shadowRoot.getElementById('slider-container');
      sliderContainer.style.flexBasis = `${this._config.slider_width}%`;
    }

    this._setupEventListeners();
    if (this._hass) this._updateDisplay();
  }

  _setupEventListeners() {
    const card = this.shadowRoot.getElementById('card');
    const track = this.shadowRoot.getElementById('slider-track');
    const thumb = this.shadowRoot.getElementById('slider-thumb');

    card.addEventListener('click', (e) => {
      if (this._isDragging) return;
      if (e.target.closest('.slider-track') || e.target.closest('.slider-thumb')) return;
      if (e.target.closest('.alert-inline')) return;
      this._openMoreInfo();
    });

    // One-line alert icon: tap to reveal the alert text in a popover bubble.
    // stopPropagation so it doesn't also trigger the card's more-info click.
    const alertIcon = this.shadowRoot.getElementById('alert-icon-inline');
    alertIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleAlertPopover();
    });

    track.addEventListener('mousedown', (e) => this._startDrag(e));
    track.addEventListener('touchstart', (e) => this._startDrag(e), { passive: false });
    thumb.addEventListener('mousedown', (e) => this._startDrag(e));
    thumb.addEventListener('touchstart', (e) => this._startDrag(e), { passive: false });

    document.addEventListener('mousemove', (e) => this._onDrag(e));
    document.addEventListener('touchmove', (e) => this._onDrag(e), { passive: false });
    document.addEventListener('mouseup', () => this._endDrag());
    document.addEventListener('touchend', () => this._endDrag());
  }

  _startDrag(e) {
    if (!this._hass || !this._config) return;
    const entity = this._hass.states[this._config.entity];
    if (!entity || entity.state === 'unavailable') return;

    e.preventDefault();
    e.stopPropagation();

    this._isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    this._dragStartX = clientX;
    this._dragMoved = false;

    this.shadowRoot.getElementById('slider-thumb').classList.add('dragging');
  }

  _onDrag(e) {
    if (!this._isDragging) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    if (!this._dragMoved && Math.abs(clientX - this._dragStartX) > 5) {
      this._dragMoved = true;
    }
    if (this._dragMoved) this._updateSliderFromEvent(e);
  }

  _endDrag() {
    if (!this._isDragging) return;

    this._isDragging = false;
    this.shadowRoot.getElementById('slider-thumb').classList.remove('dragging');

    if (!this._dragMoved) {
      this._handleSliderTap();
      return;
    }

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._setTemperature(this._pendingValue);
    }, 500);
  }

  _handleSliderTap() {
    const entity = this._hass.states[this._config.entity];
    if (!entity) return;

    const currentSetpoint = this._debounceTimer
      ? this._pendingValue
      : (entity.attributes.temperature || this._config.min);
    const { min, max, step } = this._config;
    const track = this.shadowRoot.getElementById('slider-track');
    const rect = track.getBoundingClientRect();

    const currentPercent = (currentSetpoint - min) / (max - min);
    const clickPercent = (this._dragStartX - rect.left) / rect.width;

    let newValue = clickPercent < currentPercent
      ? currentSetpoint - step
      : currentSetpoint + step;

    newValue = Math.round(newValue / step) * step;
    newValue = Math.max(min, Math.min(max, newValue));

    this._pendingValue = newValue;
    this._updateSliderVisual(newValue);

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._setTemperature(this._pendingValue);
    }, 500);
  }

  _updateSliderFromEvent(e) {
    const track = this.shadowRoot.getElementById('slider-track');
    const rect = track.getBoundingClientRect();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    const { min, max, step } = this._config;
    let value = min + percent * (max - min);
    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));

    this._pendingValue = value;
    this._updateSliderVisual(value);
  }

  _updateSliderVisual(value) {
    const { min, max } = this._config;
    const percent = ((value - min) / (max - min)) * 100;

    const fill = this.shadowRoot.getElementById('slider-fill');
    const setpointEl = this.shadowRoot.getElementById('slider-setpoint');

    fill.style.width = `${percent}%`;
    setpointEl.textContent = `${value.toFixed(1)}°`;

    const threshold = 12;
    if (percent >= threshold) {
      setpointEl.style.left = `${percent / 2}%`;
      setpointEl.style.transform = 'translate(-50%, -50%)';
      setpointEl.classList.remove('outside');
      setpointEl.classList.add('inside');
    } else {
      setpointEl.style.left = `${percent + 2}%`;
      setpointEl.style.transform = 'translateY(-50%)';
      setpointEl.classList.remove('inside');
      setpointEl.classList.add('outside');
    }
  }

  _setTemperature(temperature) {
    if (!this._hass || !this._config) return;
    this._hass.callService('climate', 'set_temperature', {
      entity_id: this._config.entity,
      temperature: temperature
    });
  }

  _openMoreInfo() {
    if (!this._hass || !this._config) return;
    const event = new CustomEvent('hass-more-info', {
      bubbles: true, composed: true,
      detail: { entityId: this._config.entity }
    });
    this.dispatchEvent(event);
  }

  /** Toggle the one-line alert popover bubble (auto-hides after a few s). */
  _toggleAlertPopover() {
    const pop = this.shadowRoot.getElementById('alert-popover');
    if (!pop) return;
    const showing = !pop.classList.contains('hidden');
    if (this._popoverTimer) {
      clearTimeout(this._popoverTimer);
      this._popoverTimer = null;
    }
    if (showing) {
      pop.classList.add('hidden');
      return;
    }
    pop.classList.remove('hidden');
    this._popoverTimer = setTimeout(() => {
      pop.classList.add('hidden');
      this._popoverTimer = null;
    }, 3000);
  }

  /** Resolve freeze_threshold: static number or entity ID. */
  _getFreezeThreshold() {
    const val = this._config.freeze_threshold;
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && val.includes('.')) {
      const entity = this._hass.states[val];
      if (entity && entity.state !== 'unavailable' && entity.state !== 'unknown') {
        const n = parseFloat(entity.state);
        if (!isNaN(n)) return n;
      }
    }
    return 5; // fallback default
  }

  _updateDisplay() {
    if (!this._hass || !this._config) return;

    const entity = this._hass.states[this._config.entity];
    const card = this.shadowRoot.getElementById('card');
    const nameEl = this.shadowRoot.getElementById('name');
    const tempEl = this.shadowRoot.getElementById('temperature');
    const offlineEl = this.shadowRoot.getElementById('offline');
    const sliderContainer = this.shadowRoot.getElementById('slider-container');
    const alertBanner = this.shadowRoot.getElementById('alert-banner');
    const alertIcon = this.shadowRoot.getElementById('alert-icon');
    const alertText = this.shadowRoot.getElementById('alert-text');
    const alertInline = this.shadowRoot.getElementById('alert-inline');
    const alertIconInline = this.shadowRoot.getElementById('alert-icon-inline');
    const alertPopover = this.shadowRoot.getElementById('alert-popover');
    const fill = this.shadowRoot.getElementById('slider-fill');
    const oneLine = this._config.layout === 'one-line';

    // Set name
    const name = this._config.name
      || (entity ? entity.attributes.friendly_name : 'Unknown');
    nameEl.textContent = name;

    // Handle unavailable state
    if (!entity || entity.state === 'unavailable') {
      card.classList.add('unavailable');
      tempEl.classList.add('hidden');
      offlineEl.classList.remove('hidden');
      sliderContainer.classList.add('hidden');
      alertBanner.classList.add('hidden');
      alertInline.classList.add('hidden');
      return;
    }

    card.classList.remove('unavailable');
    tempEl.classList.remove('hidden');
    offlineEl.classList.add('hidden');
    sliderContainer.classList.remove('hidden');

    // Current temperature
    const currentTemp = entity.attributes.current_temperature;
    if (currentTemp !== null && currentTemp !== undefined) {
      tempEl.textContent = `${parseFloat(currentTemp).toFixed(1)}°`;
    } else {
      tempEl.textContent = '\u2014';
    }

    // HVAC action — heating or cooling accent
    const hvacAction = entity.attributes.hvac_action;
    tempEl.classList.toggle('heating', hvacAction === 'heating');
    tempEl.classList.toggle('cooling', hvacAction === 'cooling');
    fill.classList.toggle('cooling', hvacAction === 'cooling');

    // Alert logic \u2014 compute the MDI icon + text once, then route to the full
    // banner (full layout) or the inline icon + popover (one-line layout).
    // Icons use <ha-icon> to match the ec_weather card's approach.
    let showAlert = false;
    let alertMdi = '';
    let alertLabel = '';
    const freezeThreshold = this._getFreezeThreshold();

    if (currentTemp !== null && currentTemp !== undefined && currentTemp < freezeThreshold) {
      alertMdi = 'mdi:snowflake';
      alertLabel = 'Freeze risk';
      showAlert = true;
    } else if (this._config.timer) {
      const timerEntity = this._hass.states[this._config.timer];
      const thresholdEntity = this._config.threshold
        ? this._hass.states[this._config.threshold] : null;
      const thresholdVal = thresholdEntity
        ? parseFloat(thresholdEntity.state) : 10;

      if (timerEntity && timerEntity.state === 'idle'
          && currentTemp !== null && currentTemp !== undefined
          && currentTemp <= thresholdVal) {
        alertMdi = 'mdi:thermometer-alert';
        alertLabel = 'Struggling to heat';
        showAlert = true;
      }
    }

    const iconHtml = alertMdi ? `<ha-icon icon="${alertMdi}"></ha-icon>` : '';
    alertIcon.innerHTML = iconHtml;
    alertText.textContent = alertLabel;
    alertIconInline.innerHTML = iconHtml;
    alertPopover.textContent = alertLabel;

    // Red name when alerting in one-line mode (the icon carries the "what").
    nameEl.classList.toggle('alert-name', showAlert && oneLine);

    // The two layouts are mutually exclusive: full uses the text banner,
    // one-line uses the inline icon + popover. Drive visibility explicitly
    // (not via CSS) so the active indicator is unambiguous.
    alertBanner.classList.toggle('hidden', !showAlert || oneLine);
    alertInline.classList.toggle('hidden', !showAlert || !oneLine);
    if (!showAlert) {
      // Reset the popover if the alert cleared while it was open.
      alertPopover.classList.add('hidden');
    }

    // Setpoint / slider position (only update if not dragging)
    if (!this._isDragging && !this._debounceTimer) {
      const setpoint = entity.attributes.temperature || this._config.min;
      this._updateSliderVisual(setpoint);
    }
  }

  static getConfigElement() {
    return document.createElement('thermostat-slider-card-editor');
  }

  static getStubConfig() {
    return {
      entity: 'climate.thermostat',
      name: 'Zone',
      min: 14,
      max: 21,
      step: 0.5,
    };
  }
}

// Define the custom element. Safe under test too — jsdom requires the element
// to be registered before it can be constructed. Guard only the catalog
// registration + load log so importing in unit tests stays quiet.
if (!customElements.get('thermostat-slider-card')) {
  customElements.define('thermostat-slider-card', ThermostatSliderCard);
}

if (typeof window === 'undefined' || !window.__TSC_TEST__) {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'thermostat-slider-card',
    name: 'Thermostat Slider Card',
    description: 'A thermostat card with slider control and alert banners',
    preview: true
  });

  console.info('%c THERMOSTAT-SLIDER-CARD %c loaded ',
    'color: white; background: #F59E0B; font-weight: bold;',
    'color: #F59E0B; background: white; font-weight: bold;'
  );
}

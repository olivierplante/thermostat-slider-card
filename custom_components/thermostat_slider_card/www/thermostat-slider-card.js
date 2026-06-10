/**
 * Thermostat Slider Card
 * A custom Home Assistant card for setpoint control of climate, humidifier,
 * fan and water_heater entities.
 *
 * Features:
 * - Large current reading (°/%) with action accent colors
 * - Slider for setpoint adjustment with tap and drag
 * - Mode-aware fill palette (raise=amber, lower=cyan, neutral=grey)
 * - Long-press the slider to toggle the device on/off
 * - Generalized alert banners (extreme low/high + direction-aware stuck)
 * - Theme-compatible with CSS custom property overrides
 */

// ─── Domain adapters ─────────────────────────────────────────────────────
// Each supported domain maps onto the same UI: a current reading, a target
// the slider sets, a service to write it, and a unit. Range defaults come
// from the entity's own attributes; config min/max/step always override.
const DOMAIN_ADAPTERS = {
  climate: {
    currentAttr: 'current_temperature',
    targetAttr: 'temperature',
    service: ['climate', 'set_temperature'],
    param: 'temperature',
    unit: '°',
    precision: 1,
    actionAttr: 'hvac_action',
    entityMin: 'min_temp',
    entityMax: 'max_temp',
    entityStep: 'target_temp_step',
    fallback: { min: 7, max: 35, step: 0.5 },
    alerts: true,
  },
  humidifier: {
    currentAttr: 'current_humidity',
    targetAttr: 'humidity',
    service: ['humidifier', 'set_humidity'],
    param: 'humidity',
    unit: '%',
    precision: 0,
    actionAttr: 'action',
    entityMin: 'min_humidity',
    entityMax: 'max_humidity',
    entityStep: 'target_humidity_step',
    fallback: { min: 0, max: 100, step: 1 },
    alerts: true,
  },
  fan: {
    // A fan's "setpoint" is its speed — there is no separate measured value,
    // so the big number and the slider both show the percentage.
    currentAttr: 'percentage',
    targetAttr: 'percentage',
    service: ['fan', 'set_percentage'],
    param: 'percentage',
    unit: '%',
    precision: 0,
    actionAttr: null,
    entityMin: null,
    entityMax: null,
    entityStep: 'percentage_step',
    fallback: { min: 0, max: 100, step: 1 },
    alerts: false,
  },
  water_heater: {
    currentAttr: 'current_temperature',
    targetAttr: 'temperature',
    service: ['water_heater', 'set_temperature'],
    param: 'temperature',
    unit: '°',
    precision: 1,
    actionAttr: null,
    entityMin: 'min_temp',
    entityMax: 'max_temp',
    entityStep: 'target_temp_step',
    fallback: { min: 30, max: 70, step: 1 },
    alerts: false,
  },
};

// Supported-features bits needed for on/off (homeassistant.toggle).
// Climate: TURN_OFF=128 | TURN_ON=256. Water heater: ON_OFF=8.
// Humidifier and fan are toggleable by domain design.
const TOGGLE_FEATURE_BITS = { climate: 384, water_heater: 8 };

function asNumber(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== ''
    && typeof value !== 'boolean' && Number.isFinite(n) ? n : null;
}

export class ThermostatSliderCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isDragging = false;
    this._debounceTimer = null;
    this._longPressTimer = null;
    this._toggleFired = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }

    // Resolve the entity's domain adapter. Unknown domains warn and fall
    // back to climate behavior (so a misconfigured card still renders).
    const domain = String(config.entity).split('.')[0];
    if (!DOMAIN_ADAPTERS[domain]) {
      console.warn(
        `thermostat-slider-card: unsupported domain "${domain}", treating ` +
          `it like climate. Supported: ${Object.keys(DOMAIN_ADAPTERS).join(', ')}.`
      );
    }
    this._domain = DOMAIN_ADAPTERS[domain] ? domain : 'climate';
    this._adapter = DOMAIN_ADAPTERS[this._domain];

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

    // Alert thresholds. alert_low / alert_high accept number | entity-id |
    // false (disable). freeze_threshold is a deprecated alias for alert_low.
    let alertLow = config.alert_low;
    if (config.freeze_threshold !== undefined) {
      if (config.alert_low !== undefined) {
        console.warn(
          'thermostat-slider-card: both freeze_threshold and alert_low are ' +
            'set — alert_low wins. Remove freeze_threshold.'
        );
      } else {
        console.warn(
          'thermostat-slider-card: freeze_threshold is deprecated, use ' +
            'alert_low instead.'
        );
        alertLow = config.freeze_threshold;
      }
    }

    this._config = {
      name: config.name || '',
      timer: config.timer || '',
      threshold: config.threshold || '',
      ...config,
      entity: config.entity,
      layout,
      slider_width: sliderWidth,
      alert_low: alertLow,
      alert_high: config.alert_high,
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

  /**
   * Resolve the slider range: config min/max/step win, then the entity's
   * own attributes (min_temp/max_temp, min/max_humidity, percentage_step…),
   * then per-domain fallbacks.
   */
  _getRange() {
    const adapter = this._adapter;
    const entity = this._hass ? this._hass.states[this._config.entity] : null;
    const attrs = entity ? entity.attributes : {};
    const min = asNumber(this._config.min)
      ?? (adapter.entityMin ? asNumber(attrs[adapter.entityMin]) : null)
      ?? adapter.fallback.min;
    const max = asNumber(this._config.max)
      ?? (adapter.entityMax ? asNumber(attrs[adapter.entityMax]) : null)
      ?? adapter.fallback.max;
    const step = asNumber(this._config.step)
      ?? (adapter.entityStep ? asNumber(attrs[adapter.entityStep]) : null)
      ?? adapter.fallback.step;
    return { min, max, step };
  }

  /**
   * Mode info from the entity: which color family the fill belongs to
   * (raise → amber, lower → cyan, neutral → grey), a mode key for per-mode
   * CSS variables, and whether the device is off.
   */
  _getModeInfo(entity) {
    const state = entity.state;
    if (state === 'off') return { family: null, modeKey: null, isOff: true };

    if (this._domain === 'climate') {
      if (state === 'heat') return { family: 'raise', modeKey: 'heat', isOff: false };
      if (state === 'cool') return { family: 'lower', modeKey: 'cool', isOff: false };
      if (state === 'dry') return { family: 'lower', modeKey: 'dry', isOff: false };
      if (state === 'fan_only') return { family: 'neutral', modeKey: 'fan_only', isOff: false };
      // heat_cool / auto: stable mode is ambiguous — follow the live action
      // when the integration reports one, default to raise otherwise.
      const action = entity.attributes.hvac_action;
      const family = action === 'cooling' ? 'lower' : 'raise';
      return { family, modeKey: state, isOff: false };
    }
    if (this._domain === 'humidifier') {
      // device_class is optional; absent → assume humidifier (raising).
      const lowering = entity.attributes.device_class === 'dehumidifier';
      return {
        family: lowering ? 'lower' : 'raise',
        modeKey: lowering ? 'dehumidify' : 'humidify',
        isOff: false,
      };
    }
    if (this._domain === 'fan') {
      return { family: 'neutral', modeKey: 'fan', isOff: false };
    }
    // water_heater
    return { family: 'raise', modeKey: 'water-heater', isOff: false };
  }

  /** Whether the entity can be toggled on/off (drives the long-press). */
  _supportsToggle(entity) {
    const bits = TOGGLE_FEATURE_BITS[this._domain];
    if (bits === undefined) return true; // humidifier, fan
    const sf = entity.attributes.supported_features;
    if (sf === null || sf === undefined) return true; // legacy integrations
    return (sf & bits) !== 0;
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
        /* Device is off: dim the reading and the fill, keep it interactive. */
        .card.is-off .temperature,
        .card.is-off .slider-fill {
          opacity: 0.45;
        }
        /* Brief confirmation flash when a long-press toggle fires. */
        .card.toggle-flash {
          animation: tsc-toggle-flash 0.4s ease;
        }
        @keyframes tsc-toggle-flash {
          0% { opacity: 1; }
          40% { opacity: 0.4; }
          100% { opacity: 1; }
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
          /* Long-press support: suppress iOS callout / text selection. */
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
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
        /* ── Mode palette ─────────────────────────────────────────────
           The fill's color family follows the entity's MODE (stable
           identity): raise=amber (default above), lower=cyan, neutral=grey.
           Per-mode variables let themes restyle any single mode. */
        .slider-fill.family-lower {
          background: var(--tsc-slider-fill-cool, linear-gradient(90deg, #06B6D4, #22D3EE));
        }
        .slider-fill.family-neutral {
          background: var(--tsc-slider-fill-neutral, linear-gradient(90deg, #6B7280, #9CA3AF));
        }
        .slider-fill.mode-heat {
          background: var(--tsc-fill-heat, var(--tsc-slider-fill, linear-gradient(90deg, #F59E0B, #FBBF24)));
        }
        .slider-fill.mode-cool {
          background: var(--tsc-fill-cool, var(--tsc-slider-fill-cool, linear-gradient(90deg, #06B6D4, #22D3EE)));
        }
        .slider-fill.mode-dry {
          background: var(--tsc-fill-dry, var(--tsc-slider-fill-cool, linear-gradient(90deg, #06B6D4, #22D3EE)));
        }
        .slider-fill.mode-dehumidify {
          background: var(--tsc-fill-dehumidify, var(--tsc-slider-fill-cool, linear-gradient(90deg, #06B6D4, #22D3EE)));
        }
        .slider-fill.mode-humidify {
          background: var(--tsc-fill-humidify, var(--tsc-slider-fill, linear-gradient(90deg, #F59E0B, #FBBF24)));
        }
        .slider-fill.mode-fan,
        .slider-fill.mode-fan_only {
          background: var(--tsc-fill-fan, var(--tsc-slider-fill-neutral, linear-gradient(90deg, #6B7280, #9CA3AF)));
        }
        .slider-fill.mode-water-heater {
          background: var(--tsc-fill-water-heater, var(--tsc-slider-fill, linear-gradient(90deg, #F59E0B, #FBBF24)));
        }
        .slider-thumb {
          /* JS sets --tsc-thumb-pos to the raw percent. The thumb's center
             sits 10px inside the fill's edge (the original look), and the
             clamp keeps it inside the track so it survives 0%/100%. */
          position: absolute;
          left: clamp(8px, calc(var(--tsc-thumb-pos, 0%) - 10px), calc(100% - 8px));
          top: 50%;
          transform: translate(-50%, -50%);
          width: 4px;
          height: 22px;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 2px;
          cursor: grab;
          transition: height 0.15s ease, width 0.15s ease, left 0.1s ease;
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
            <div class="slider-fill" id="slider-fill"></div>
            <div class="slider-thumb" id="slider-thumb"></div>
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
    // Android long-press fires contextmenu — swallow it so the 1s hold
    // reaches our toggle timer instead of a browser menu.
    track.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => this._onDrag(e));
    document.addEventListener('touchmove', (e) => this._onDrag(e), { passive: false });
    document.addEventListener('mouseup', () => this._endDrag());
    document.addEventListener('touchend', () => this._endDrag());
    document.addEventListener('touchcancel', () => this._cancelDrag());
  }

  _startDrag(e) {
    if (!this._hass || !this._config) return;
    const entity = this._hass.states[this._config.entity];
    if (!entity || entity.state === 'unavailable') return;

    e.preventDefault();
    e.stopPropagation();

    this._isDragging = true;
    const point = e.touches ? e.touches[0] : e;
    this._dragStartX = point.clientX;
    this._dragStartY = point.clientY;
    this._dragMoved = false;
    this._toggleFired = false;

    // Long-press toggle: a 1s motionless hold on the slider toggles the
    // device. Movement cancels (becomes a drag); firing consumes the
    // gesture (no tap-step, no drag on release).
    if (this._longPressTimer) clearTimeout(this._longPressTimer);
    if (this._config.allow_toggle !== false && this._supportsToggle(entity)) {
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        if (this._isDragging && !this._dragMoved) this._fireToggle();
      }, 1000);
    }

    this.shadowRoot.getElementById('slider-thumb').classList.add('dragging');
  }

  _onDrag(e) {
    if (!this._isDragging || this._toggleFired) return;
    e.preventDefault();

    // A fingertip held on glass always drifts a little — measure 2D
    // displacement with a 10px slop radius (native long-press behavior)
    // so the hold survives micro-movement but a real drag cancels it.
    const point = e.touches ? e.touches[0] : e;
    if (!this._dragMoved) {
      const deltaX = point.clientX - this._dragStartX;
      const deltaY = (point.clientY ?? this._dragStartY) - this._dragStartY;
      const displacement = Math.hypot(deltaX, deltaY);
      if (displacement > 10) {
        this._dragMoved = true;
        if (this._longPressTimer) {
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }
      }
    }
    if (this._dragMoved) this._updateSliderFromEvent(e);
  }

  /**
   * The system interrupted the touch (iOS touchcancel): abandon the gesture
   * with no tap, no commit and no toggle, leaving state clean.
   */
  _cancelDrag() {
    if (!this._isDragging) return;
    this._isDragging = false;
    this._dragMoved = false;
    this._toggleFired = false;
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    this.shadowRoot.getElementById('slider-thumb').classList.remove('dragging');
  }

  _endDrag() {
    if (!this._isDragging) return;

    this._isDragging = false;
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    this.shadowRoot.getElementById('slider-thumb').classList.remove('dragging');

    // A fired toggle consumed the gesture — no tap-step, no drag commit.
    if (this._toggleFired) {
      this._toggleFired = false;
      return;
    }

    if (!this._dragMoved) {
      this._handleSliderTap();
      return;
    }

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._setTarget(this._pendingValue);
    }, 500);
  }

  /** Long-press fired: toggle the device with a visible confirmation. */
  _fireToggle() {
    this._toggleFired = true;
    this.shadowRoot.getElementById('slider-thumb').classList.remove('dragging');

    this._hass.callService('homeassistant', 'toggle', {
      entity_id: this._config.entity,
    });

    // Visible cause-and-effect: flash the card when the toggle fires.
    const card = this.shadowRoot.getElementById('card');
    card.classList.add('toggle-flash');
    setTimeout(() => card.classList.remove('toggle-flash'), 400);
  }

  _handleSliderTap() {
    const entity = this._hass.states[this._config.entity];
    if (!entity) return;

    const { min, max, step } = this._getRange();
    const target = asNumber(entity.attributes[this._adapter.targetAttr]);
    const currentSetpoint = this._debounceTimer
      ? this._pendingValue
      : (target ?? min);
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
      this._setTarget(this._pendingValue);
    }, 500);
  }

  _updateSliderFromEvent(e) {
    const track = this.shadowRoot.getElementById('slider-track');
    const rect = track.getBoundingClientRect();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    const { min, max, step } = this._getRange();
    let value = min + percent * (max - min);
    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));

    this._pendingValue = value;
    this._updateSliderVisual(value);
  }

  /**
   * Render the fill + setpoint pill for a value. The fill clamps to 0–100%
   * and the pill always stays inside the track, even when the entity's
   * setpoint is outside the slider range (issue #7). A null value (missing
   * or non-numeric target attribute) hides the pill entirely.
   */
  _updateSliderVisual(value) {
    const fill = this.shadowRoot.getElementById('slider-fill');
    const thumb = this.shadowRoot.getElementById('slider-thumb');
    const setpointEl = this.shadowRoot.getElementById('slider-setpoint');

    const numeric = asNumber(value);
    if (numeric === null) {
      fill.style.width = '0%';
      thumb.classList.add('hidden');
      setpointEl.classList.add('hidden');
      return;
    }
    setpointEl.classList.remove('hidden');
    thumb.classList.remove('hidden');

    const { min, max } = this._getRange();
    const rawPercent = ((numeric - min) / (max - min)) * 100;
    const percent = Math.max(0, Math.min(100, rawPercent));

    fill.style.width = `${percent}%`;
    // The thumb tracks the same percent; CSS clamps it into the track.
    thumb.style.setProperty('--tsc-thumb-pos', `${percent}%`);
    setpointEl.textContent =
      `${numeric.toFixed(this._adapter.precision)}${this._adapter.unit}`;

    const threshold = 12;
    if (percent >= threshold) {
      setpointEl.style.left = `${percent / 2}%`;
      setpointEl.style.transform = 'translate(-50%, -50%)';
      setpointEl.classList.remove('outside');
      setpointEl.classList.add('inside');
    } else {
      // Start the outside pill past the thumb's clamped position (8px +
      // half the thumb) so the handle never covers the first digit.
      setpointEl.style.left = `calc(${percent}% + 16px)`;
      setpointEl.style.transform = 'translateY(-50%)';
      setpointEl.classList.remove('inside');
      setpointEl.classList.add('outside');
    }
  }

  /** Write the slider value through the domain's service. */
  _setTarget(value) {
    if (!this._hass || !this._config) return;
    const [serviceDomain, service] = this._adapter.service;
    this._hass.callService(serviceDomain, service, {
      entity_id: this._config.entity,
      [this._adapter.param]: value,
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

  /** Resolve a threshold: static number, entity ID, or null. */
  _resolveThreshold(val) {
    const n = asNumber(val);
    if (n !== null) return n;
    if (typeof val === 'string' && val.includes('.')) {
      const entity = this._hass.states[val];
      if (entity && entity.state !== 'unavailable' && entity.state !== 'unknown') {
        const parsed = parseFloat(entity.state);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return null;
  }

  /**
   * Per-domain alert defaults. The alert matching the device's failure
   * mode defaults ON; everything else is opt-in. `false` in config disables.
   */
  _getAlertDefaults(entity) {
    if (this._domain === 'climate') return { low: 5, high: null };
    if (this._domain === 'humidifier') {
      const dehumidifier = entity.attributes.device_class === 'dehumidifier';
      return dehumidifier ? { low: null, high: 65 } : { low: 25, high: 65 };
    }
    return { low: null, high: null }; // fan, water_heater: opt-in only
  }

  /** Resolve one alert threshold from config + defaults. */
  _getAlertThreshold(configValue, defaultValue) {
    if (configValue === false) return null;
    if (configValue === undefined) return defaultValue;
    return this._resolveThreshold(configValue);
  }

  _getAlertLabels(entity) {
    if (this._domain === 'humidifier') {
      return {
        low: { label: 'Too dry', icon: 'mdi:water-minus' },
        high: { label: 'Too humid', icon: 'mdi:water-alert' },
        stuckIcon: 'mdi:water-alert',
      };
    }
    if (this._domain === 'climate' || this._domain === 'water_heater') {
      return {
        low: { label: 'Freeze risk', icon: 'mdi:snowflake' },
        high: { label: 'Overheating', icon: 'mdi:thermometer-high' },
        stuckIcon: 'mdi:thermometer-alert',
      };
    }
    return {
      low: { label: 'Too low', icon: 'mdi:alert-circle-outline' },
      high: { label: 'Too high', icon: 'mdi:alert-circle-outline' },
      stuckIcon: 'mdi:alert-circle-outline',
    };
  }

  /** The verb in "Struggling to <verb>", from the active mode. */
  _getStuckVerb(modeInfo) {
    const byMode = {
      heat: 'heat', cool: 'cool', dry: 'dry',
      dehumidify: 'dry', humidify: 'humidify', 'water-heater': 'heat',
    };
    if (modeInfo.modeKey && byMode[modeInfo.modeKey]) return byMode[modeInfo.modeKey];
    return modeInfo.family === 'lower' ? 'cool' : 'heat';
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
    const adapter = this._adapter;

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

    // Current reading (per-domain attribute, unit and precision)
    const currentValue = asNumber(entity.attributes[adapter.currentAttr]);
    tempEl.textContent = currentValue !== null
      ? `${currentValue.toFixed(adapter.precision)}${adapter.unit}`
      : '—';

    // Action accent (transient "working right now" signal on the number):
    // heating/humidifying → amber class, cooling/drying → cyan class.
    const action = adapter.actionAttr
      ? entity.attributes[adapter.actionAttr] : null;
    tempEl.classList.toggle('heating', action === 'heating' || action === 'humidifying');
    tempEl.classList.toggle('cooling', action === 'cooling' || action === 'drying');

    // Mode palette (stable identity on the fill) + off-state dim.
    const modeInfo = this._getModeInfo(entity);
    card.classList.toggle('is-off', modeInfo.isOff);
    const keep = fill.className.split(' ').filter(
      (c) => c && !c.startsWith('family-') && !c.startsWith('mode-')
    );
    if (modeInfo.family) keep.push(`family-${modeInfo.family}`);
    if (modeInfo.modeKey) keep.push(`mode-${modeInfo.modeKey}`);
    fill.className = keep.join(' ');

    // ── Alerts: extreme low / high, then direction-aware stuck ──────────
    let showAlert = false;
    let alertMdi = '';
    let alertLabel = '';

    if (adapter.alerts || this._config.alert_low !== undefined
        || this._config.alert_high !== undefined || this._config.timer) {
      const defaults = adapter.alerts
        ? this._getAlertDefaults(entity) : { low: null, high: null };
      const labels = this._getAlertLabels(entity);
      const low = this._getAlertThreshold(this._config.alert_low, defaults.low);
      const high = this._getAlertThreshold(this._config.alert_high, defaults.high);

      if (currentValue !== null && low !== null && currentValue < low) {
        alertMdi = labels.low.icon;
        alertLabel = labels.low.label;
        showAlert = true;
      } else if (currentValue !== null && high !== null && currentValue > high) {
        alertMdi = labels.high.icon;
        alertLabel = labels.high.label;
        showAlert = true;
      } else if (this._config.timer) {
        const timerEntity = this._hass.states[this._config.timer];
        const thresholdVal = this._config.threshold
          ? this._resolveThreshold(this._config.threshold) : 10;

        if (timerEntity && timerEntity.state === 'idle'
            && currentValue !== null && thresholdVal !== null) {
          const stuck = modeInfo.family === 'lower'
            ? currentValue >= thresholdVal
            : currentValue <= thresholdVal;
          if (stuck && modeInfo.family && modeInfo.family !== 'neutral') {
            alertMdi = labels.stuckIcon;
            alertLabel = `Struggling to ${this._getStuckVerb(modeInfo)}`;
            showAlert = true;
          }
        }
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

    // Setpoint / slider position (only update if not dragging). A missing
    // or non-numeric target hides the pill instead of faking a value.
    if (!this._isDragging && !this._debounceTimer) {
      const setpoint = asNumber(entity.attributes[adapter.targetAttr]);
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
    description: 'A slider card for climate, humidifier, fan and water heater entities',
    preview: true
  });

  console.info('%c THERMOSTAT-SLIDER-CARD %c loaded ',
    'color: white; background: #F59E0B; font-weight: bold;',
    'color: #F59E0B; background: white; font-weight: bold;'
  );
}

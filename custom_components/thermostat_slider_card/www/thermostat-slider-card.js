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

// debounce window duration between a drag/tap update and the write it
// eventually commits, for both single-setpoint mode and
// range-setpoint mode.
const RANGE_DEBOUNCE_MS = 500;

function asNumber(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== ''
    && typeof value !== 'boolean' && Number.isFinite(n) ? n : null;
}

/**
 * Resolve whether a climate entity's current attributes should render as
 * single-setpoint mode or range-setpoint mode.
 *
 * Pure function: depends only on the given attributes, never on any prior
 * call's input or output.
 */
export function resolveSetpointMode(attrs) {
  const temperature = asNumber(attrs.temperature);
  const low = asNumber(attrs.target_temp_low);
  const high = asNumber(attrs.target_temp_high);
  const isRange = temperature === null && (low !== null || high !== null);
  return isRange ? 'range' : 'single';
}

/**
 * Resolve the current handle set: how many handles exist for this render
 * and what each is bound to (entity attribute, write parameter, DOM
 * element ids).
 *
 * `domain === 'climate' && mode === 'range'` yields the two-handle case
 * (low handle/high handle bound to `target_temp_low`/`target_temp_high`,
 * each with its own thumb and pill; the two share the single
 * `#slider-fill-between` band, which is not per-handle). Every other
 * combination yields the one-handle case, bound to `adapter.targetAttr`/
 * `adapter.param`, rendered through today's `#slider-fill`/`#slider-thumb`/
 * `#slider-setpoint` element ids unchanged.
 *
 * The value-to-percent formula and rendering logic are shared across
 * Handle counts; this function is what fixes what "the current handle
 * set" means for a given render.
 */
export function resolveHandleSpecs(domain, adapter, mode) {
  if (domain === 'climate' && mode === 'range') {
    return [
      {
        id: 'low',
        attr: 'target_temp_low',
        writeParam: 'target_temp_low',
        elementIds: {
          thumb: 'slider-thumb-low',
          pill: 'slider-setpoint-low',
        },
      },
      {
        id: 'high',
        attr: 'target_temp_high',
        writeParam: 'target_temp_high',
        elementIds: {
          thumb: 'slider-thumb-high',
          pill: 'slider-setpoint-high',
        },
      },
    ];
  }

  return [
    {
      id: 'value',
      attr: adapter.targetAttr,
      writeParam: adapter.param,
      elementIds: {
        fill: 'slider-fill',
        thumb: 'slider-thumb',
        pill: 'slider-setpoint',
      },
    },
  ];
}

/**
 * Resolve which of the low handle/high handle should render in the disabled
 * visual state and be excluded from interaction: exactly the handle(s) whose
 * corresponding attribute is not numeric.
 *
 * Pure function: depends only on the given attributes, never on any prior
 * call's input or output.
 *
 * Takes the current `handleSpecs` (per `resolveHandleSpecs`'s output
 * shape) instead of hardcoding `target_temp_low`/`target_temp_high`
 * reads, so it works for an arbitrary handle set, not just the
 * two-handle climate/range case.
 */
export function resolveDisabledHandles(attrs, handleSpecs) {
  const result = {};
  for (const handle of handleSpecs) {
    result[handle.id] = asNumber(attrs[handle.attr]) === null;
  }
  return result;
}

/**
 * Resolve the render-active mode, pinning it to the previous active mode
 * while a drag is in progress and re-evaluating against the latest
 * attributes on the first render after the drag ends.
 */
export function resolveActiveMode({ currentMode, previousActiveMode, isDragging }) {
  return isDragging ? previousActiveMode : currentMode;
}

/**
 * Clamp an attempted active handle value so it never crosses the other
 * handle by less than `gap`. Shared by drag and tap-step interactions.
 *
 * Pure function: for the low handle (`isLow === true`) the result never
 * exceeds `otherHandleValue - gap`; for the high handle it never falls
 * below `otherHandleValue + gap`. Values that already satisfy the gap are
 * returned unchanged.
 */
export function clampToMinGap(attemptedValue, otherHandleValue, isLow, gap) {
  if (isLow) {
    const maxAllowed = otherHandleValue - gap;
    return attemptedValue <= maxAllowed ? attemptedValue : maxAllowed;
  }
  const minAllowed = otherHandleValue + gap;
  return attemptedValue >= minAllowed ? attemptedValue : minAllowed;
}

/**
 * min gap configuration: derive the effective minimum gap between
 * The low handle and the high handle from the (optional) `min_gap` card config key
 * and the entity's currently resolved step value.
 *
 * Pure function with no side effects: if `configuredGap` is
 * `null`/`undefined`, the resolved step is used as-is. If `configuredGap`
 * is at or above the resolved step, it's used unchanged. If it's below the
 * resolved step, it's ignored and the resolved step is used instead, since
 * `min_gap` may only ever raise the floor above one resolved step, never
 * lower it. The Card's `_resolveMinGap` wraps this and owns the console
 * warning, so it fires once per configuration rather than once per call
 * (this runs on every drag move).
 */
export function _resolveEffectiveMinGap(configuredGap, resolvedStep) {
  if (configuredGap === null || configuredGap === undefined) {
    return resolvedStep;
  }
  if (configuredGap >= resolvedStep) {
    return configuredGap;
  }
  return resolvedStep;
}

/**
 * Resolve whether a new pointer-down/touch-start event, identified by the
 * origin it targets (`'low' | 'high' | 'track'`), is allowed to begin a new
 * interaction (a drag or a long-press timer), given whichever origin (or
 * `null` if none) currently owns the single active interaction slot.
 *
 * Pure function. Once an interaction is active (`activeOrigin !== null`),
 * every competing pointer-down/touch-start event — regardless of its own
 * origin, and regardless of whether it would have started a drag or a
 * long-press timer — is ignored: the returned active origin is unchanged.
 * When no interaction is active (`activeOrigin === null`), the event's own
 * origin becomes the new active origin (this event starts the
 * interaction). Callers are responsible for resetting the active origin to
 * `null` when an interaction ends (drag end/cancel, or long-press
 * fire/release) — this function only decides what happens to a *start*
 * event, it has no concept of "ending" one.
 */
export function resolveInteractionStart(activeOrigin, eventOrigin) {
  return activeOrigin !== null ? activeOrigin : eventOrigin;
}

/**
 * Resolve the new render state produced by a drag/tap update event on the
 * The active handle, given the render state as of the prior render.
 *
 * `renderState` is a handle-id-keyed map, e.g. `{ value: { value, percent
 * } }` at one handle or `{ low: {...}, high: {...} }` at two — the minimal
 * per-handle fields `_updateHandlesVisual` derives fill width, thumb
 * position, and pill text from. `handleId` identifies which entry to
 * overwrite; `value`/`percent` are that handle's new value and its
 * already-clamped position percent for this update. Every other key in
 * `renderState` (zero other keys at one handle, one other key at two) is
 * carried over unchanged.
 *
 * Pure function. Returns a new render state — a shallow copy of
 * `renderState` with `handleId`'s entry overwritten by `{ value, percent
 * }`. Every other key is carried over unchanged (same reference, not
 * recomputed). At one handle there is nothing else to carry over, so the
 * spread is a no-op beyond the one overwritten key.
 */
export function applyHandleUpdate(renderState, handleId, value, percent) {
  return {
    ...renderState,
    [handleId]: { value, percent },
  };
}

/**
 * Resolve the new render state produced by abandoning a drag interaction
 * on the active handle via pointer-cancel.
 *
 * `renderState` is the same handle-id-keyed map `applyHandleUpdate`
 * operates on. `handleId` is the active handle whose in-progress drag is
 * being abandoned. `lastConfirmed` is `{ value, percent }` — the entity's
 * last confirmed state value (and its corresponding track-position
 * percent) for that handle's attribute, i.e. what the handle looked like
 * before the now-abandoned drag started.
 *
 * Pure function. Returns a new render state where `handleId`'s entry
 * equals `lastConfirmed` exactly and every other handle's entry in
 * `renderState` is carried over unchanged (same reference, not
 * recomputed) — never reassigned or mutated as a side effect of the
 * abandonment. At exactly one handle there is no "other handle" to carry
 * over, so the result is simply `{ [handleId]: lastConfirmed }`.
 *
 * This function's return shape deliberately contains only handles'
 * `{ value, percent }` render fields — no write/service-call/pending-write
 * field of any kind. That absence is the mechanism by which no further
 * write is issued as a result of the abandonment: a pure function whose
 * entire output is renderable display state cannot itself carry a write.
 * The caller is expected to apply the returned render state and stop —
 * no debounce window, no commit call — for the pointer-cancel case.
 *
 * Covers only the drag-cancel half of the abandoned-interaction-revert
 * guarantee; the `hass.callService`-rejection half is covered separately,
 * against `_commitHandleValue`'s rejection path, not this function.
 */
export function resolveHandleRevert(renderState, handleId, lastConfirmed) {
  return {
    ...renderState,
    [handleId]: lastConfirmed,
  };
}

/**
 * Resolve which handle id a tap event on the current handle set's track
 * should target, given the tap's position along the track's primary axis
 * (`tapX`) and every handle's own current rendered position (`positions`),
 * all in the same pixel-position space.
 *
 * `positions` and `enabledMask` are both `{ [handleId]: number|boolean }`
 * maps keyed by whatever handle ids `resolveHandleSpecs` produced for the
 * current render — `{ value: ... }` at one handle, `{ low: ..., high: ... }`
 * at two. `enabledMask[id] === true` means that handle IS enabled/
 * interactive; this is the logical inverse of `resolveDisabledHandles`'s
 * output, so a caller feeding that function's result in here must negate
 * each field first.
 *
 * Pure function over an arbitrary handle set (not just two):
 * - The candidate set is every enabled handle id, in `Object.keys(positions)`
 *   order. If no handle is enabled (a state the interaction pipeline
 *   shouldn't normally reach, since a fully-disabled handle set means every
 *   attribute is missing), every handle id becomes a candidate instead, so
 *   the function still has well-defined behavior rather than an
 *   unspecified crash.
 * - Among the candidates, the one with the smaller `Math.abs(tapX - pos)`
 *   distance to the tap wins. If there is exactly one candidate — because
 *   only one handle is enabled, or because there is only one handle at all
 *   (single-setpoint mode) — the loop below never finds a smaller distance
 *   to replace it with, so that sole candidate is what gets returned; this
 *   is the general loop collapsing to the one-handle rule by construction,
 *   not a dedicated early return for that case.
 * - If the distances are exactly equal, the first candidate in iteration
 *   order wins — `low` at two handles, matching `resolveHandleSpecs`'s
 *   declared low-then-high order.
 */
export function resolveTapHandle(tapX, positions, enabledMask) {
  const ids = Object.keys(positions);
  const enabledIds = ids.filter((id) => enabledMask[id]);
  const candidateIds = enabledIds.length > 0 ? enabledIds : ids;

  // Exact-tie check first, ahead of the distance comparison below, and only
  // when there are exactly two candidates to tie between. A tap built as
  // the literal midpoint of two positions (`(posA + posB) / 2`) can, at
  // extreme magnitudes, land one float-rounding step off from being an
  // exact `Math.abs` distance tie in either direction — recomputing the
  // same midpoint expression here and comparing for bit-exact equality
  // catches that case deterministically, since it's the same operation on
  // the same inputs. It applies to whichever two ids are currently the
  // candidates.
  if (
    candidateIds.length === 2 &&
    tapX === (positions[candidateIds[0]] + positions[candidateIds[1]]) / 2
  ) {
    return candidateIds[0];
  }

  let bestId = candidateIds[0];
  let bestDist = Math.abs(tapX - positions[bestId]);
  for (let i = 1; i < candidateIds.length; i++) {
    const id = candidateIds[i];
    const dist = Math.abs(tapX - positions[id]);
    if (dist < bestDist) {
      bestId = id;
      bestDist = dist;
    }
  }
  return bestId;
}

/**
 * Resolve the value a batched write should use for the handle that was
 * *not* the subject of the current drag/tap interaction (the other
 * handle's most recent value).
 *
 * `handle` is `'low' | 'high'` — the active handle whose interaction is
 * driving this write. It identifies which attribute is being resolved for
 * the *other* handle, but the resolution logic itself doesn't branch on it
 * (both `lastConfirmed` and `lastSelfWritten` are already scoped to a
 * single attribute by the caller); it's kept in the signature to match
 * the call sites' shape.
 *
 * `lastConfirmed` and `lastSelfWritten` are each either `null` (nothing of
 * that kind has happened yet) or `{ value: number, seq: number }`, where
 * `seq` is a caller-assigned monotonically increasing sequence number
 * standing in for "which happened later" in real event order — this
 * function never generates `seq` values, only compares the ones it's
 * given, since wall-clock time isn't a reliable ordering signal (tests run
 * synchronously and multiple events can share a timestamp).
 *
 * Pure function:
 * - If only one of `lastConfirmed`/`lastSelfWritten` is non-`null`, returns
 *   that one's `value`.
 * - If both are non-`null`, returns whichever has the higher `seq` —
 *   i.e. unless the entity has reported a different value in a state
 *   update received after the last self-written value, in which case use
 *   the entity-reported value.
 * - Never returns an in-flight pending (not-yet-confirmed/not-yet-written)
 *   value — the function has no access to one, by construction of its
 *   parameters.
 */
export function resolveOtherHandleValue(handle, lastConfirmed, lastSelfWritten) {
  if (lastConfirmed === null) return lastSelfWritten.value;
  if (lastSelfWritten === null) return lastConfirmed.value;
  return lastSelfWritten.seq >= lastConfirmed.seq ? lastSelfWritten.value : lastConfirmed.value;
}

/**
 * Build the write payload for the current handle set from a resolved
 * `values` map (`{ [handleId]: value }`).
 *
 * Pure function: at one handle, always returns `{ [writeParam]: value }`
 * (no missing-value suppression case, matching the single-setpoint write
 * path's pre-existing implicit contract). At two handles, returns `null`
 * if either value is not a confirmed number — e.g. immediately after Card
 * initialization, before a state update has established both
 * `target_temp_low` and `target_temp_high` — otherwise returns both
 * `writeParam` keys together, never a payload containing only one, which
 * satisfies HA core's `vol.Inclusive` schema requirement for those two
 * parameters.
 */
export function buildWritePayload(handleSpecs, values) {
  if (handleSpecs.length === 1) {
    const handle = handleSpecs[0];
    return { [handle.writeParam]: values[handle.id] };
  }

  if (handleSpecs.some((handle) => asNumber(values[handle.id]) === null)) {
    return null;
  }

  const payload = {};
  for (const handle of handleSpecs) {
    payload[handle.writeParam] = values[handle.id];
  }
  return payload;
}

export class ThermostatSliderCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isDragging = false;
    this._debounceTimer = null;
    this._longPressTimer = null;
    this._toggleFired = false;
    // Handle set for the current render, recomputed every
    // `_updateDisplay()` call via `resolveHandleSpecs`. Initialized empty
    // here only so the field exists before the first render; always
    // overwritten before use.
    this._handles = [];
    // The handle id ('low' | 'high' | 'value') currently being dragged or
    // tapped, or null if no interaction is active.
    this._activeHandle = null;
    // Single-active-interaction origin shared across every thumb and the
    // track, so a competing pointer-down/touch-start event never starts a
    // second concurrent interaction (see `resolveInteractionStart`).
    this._activeOrigin = null;
    // Per-handle render/confirmed state, `{ [handleId]: { value, percent
    // } }`, keyed by whatever handle ids the current render's
    // `this._handles` uses (`'value'` at one handle, `'low'`/`'high'` at
    // two).
    this._confirmedState = {};
    this._renderState = {};
    // Event-order tracking for `resolveOtherHandleValue`. `_eventSeq` is a
    // monotonically increasing counter, incremented once per
    // `_updateDisplay()` state update (via `_nextEventSeq()`) and once per
    // completed write (in `_commitHandleValue()`), that stands in for
    // "which happened later in the real event sequence" without relying
    // on wall-clock time (tests run synchronously and multiple events can
    // share a timestamp). `_lastConfirmed`/`_lastSelfWritten` are
    // `{ [handleId]: { value, seq } | null }`, keyed the same way as
    // `_confirmedState`/`_renderState` above.
    this._lastConfirmed = {};
    this._lastSelfWritten = {};
    this._eventSeq = 0;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }

    // Resolve the entity's domain adapter. Unknown domains warn AND render
    // a visible in-card message — a console warning alone is invisible on a
    // dashboard, and limping along as a pseudo-climate reads as a card bug
    // (learned from issue #7: a humidity sensor configured by mistake).
    const domain = String(config.entity).split('.')[0];
    this._unsupportedDomain = DOMAIN_ADAPTERS[domain] ? null : domain;
    if (this._unsupportedDomain) {
      console.warn(
        `thermostat-slider-card: unsupported domain "${domain}". ` +
          `Supported: ${Object.keys(DOMAIN_ADAPTERS).join(', ')}.`
      );
    }
    this._domain = DOMAIN_ADAPTERS[domain] ? domain : 'climate';
    this._adapter = DOMAIN_ADAPTERS[this._domain];

    // Config-time issues feed the on-card warning chip (visible, tappable)
    // in addition to console warnings — the console is invisible to most
    // dashboard users, especially in the Companion app.
    this._configIssues = [];
    this._minGapWarned = false;

    // Layout: 'full' (default) or 'one-line'. An unknown value falls back to
    // 'full' (so a typo never breaks the dashboard) and warns to the console.
    let layout = config.layout || 'full';
    if (layout !== 'full' && layout !== 'one-line') {
      console.warn(
        `thermostat-slider-card: unknown layout "${layout}", falling back ` +
          `to "full". Valid values: "full", "one-line".`
      );
      layout = 'full';
      this._configIssues.push(`unknown layout "${config.layout}"; using "full"`);
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

    // Invalid range/step config: warn and ignore the bad values so the
    // entity's own limits take over (never NaN math).
    let min = config.min;
    let max = config.max;
    const cfgMin = asNumber(config.min);
    const cfgMax = asNumber(config.max);
    if (cfgMin !== null && cfgMax !== null && cfgMin >= cfgMax) {
      console.warn(
        `thermostat-slider-card: min (${cfgMin}) must be below max ` +
          `(${cfgMax}); ignoring both.`
      );
      min = undefined;
      max = undefined;
      this._configIssues.push(
        `min (${cfgMin}) is not below max (${cfgMax}); both ignored`);
    }
    let step = config.step;
    const cfgStep = asNumber(config.step);
    if (cfgStep !== null && cfgStep <= 0) {
      console.warn(
        `thermostat-slider-card: step (${cfgStep}) must be positive; ignoring.`
      );
      step = undefined;
      this._configIssues.push(`step (${cfgStep}) is not positive; ignored`);
    }

    // min_gap: optional minimum gap enforced between target_temp_low and
    // target_temp_high in range-setpoint mode. Not resolved against the
    // entity's resolved step here — that happens per-call via
    // _resolveMinGap, since the resolved step isn't known until
    // _getRange() runs against live entity attributes.
    let minGap = config.min_gap;
    const cfgMinGap = asNumber(config.min_gap);
    if (config.min_gap !== undefined && (cfgMinGap === null || cfgMinGap <= 0)) {
      console.warn(
        `thermostat-slider-card: min_gap (${config.min_gap}) must be a ` +
          `positive number; ignoring.`
      );
      minGap = undefined;
      this._configIssues.push(
        `min_gap (${config.min_gap}) is not a positive number; ignored`);
    }

    // device_class override: humidifier-domain only (the only supported
    // domain that has device classes in HA), values humidifier|dehumidifier.
    let deviceClass = config.device_class;
    if (config.device_class !== undefined) {
      if (this._domain !== 'humidifier') {
        console.warn(
          `thermostat-slider-card: device_class has no effect on ` +
            `${this._domain} entities; remove it.`
        );
        this._configIssues.push(
          `device_class has no effect on ${this._domain} entities`);
        deviceClass = undefined;
      } else if (config.device_class !== 'humidifier'
          && config.device_class !== 'dehumidifier') {
        console.warn(
          `thermostat-slider-card: invalid device_class ` +
            `"${config.device_class}"; use "humidifier" or "dehumidifier".`
        );
        this._configIssues.push(
          `invalid device_class "${config.device_class}"; ` +
            `use "humidifier" or "dehumidifier"`);
        deviceClass = undefined;
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
        this._configIssues.push(
          'both freeze_threshold and alert_low set; remove freeze_threshold');
      } else {
        console.warn(
          'thermostat-slider-card: freeze_threshold is deprecated, use ' +
            'alert_low instead.'
        );
        this._configIssues.push(
          'freeze_threshold is deprecated; rename it to alert_low');
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
      min,
      max,
      step,
      min_gap: minGap,
      device_class: deviceClass,
      alert_low: alertLow,
      alert_high: config.alert_high,
    };
    this._rendered = false;
    this._lastActionFamily = null; // sticky auto-mode memory, per entity
    this._warned = new Set(); // warn-once registry, per config
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
  /**
   * Effective minimum Low/High gap for the given resolved step. Called on
   * every two-handle drag move and tap-step, so the "min_gap below one
   * step" console warning is emitted at most once per setConfig rather
   * than on every call.
   */
  _resolveMinGap(step) {
    const configured = this._config.min_gap;
    const gap = _resolveEffectiveMinGap(configured, step);
    if (configured != null && gap !== configured && !this._minGapWarned) {
      this._minGapWarned = true;
      console.warn(
        `thermostat-slider-card: min_gap (${configured}) is below the ` +
          `resolved step (${step}); using ${step} instead. ` +
          `min_gap can only raise the minimum gap, never lower it below one step.`
      );
    }
    return gap;
  }

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
    let step = asNumber(this._config.step)
      ?? (adapter.entityStep ? asNumber(attrs[adapter.entityStep]) : null)
      ?? adapter.fallback.step;
    if (!(step > 0)) step = adapter.fallback.step;
    // Final sanity: a config/entity mix can still invert the range
    // (e.g. config min 40 with entity max 30). Never produce NaN math.
    this._rangeInvalid = !(min < max);
    if (!(min < max)) {
      this._warnOnce('range',
        `resolved slider range ${min}–${max} is invalid; using the ` +
          `${adapter.fallback.min}–${adapter.fallback.max} fallback`);
      return { min: adapter.fallback.min, max: adapter.fallback.max, step };
    }
    return { min, max, step };
  }

  /** Warn once per key per config (avoids per-state-update console spam). */
  _warnOnce(key, message) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`thermostat-slider-card: ${message}`);
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
      // Remember the last ACTIVE action so ambiguous modes (auto/heat_cool)
      // can keep their color through idle compressor cycles.
      const action = entity.attributes.hvac_action;
      if (action === 'heating') this._lastActionFamily = 'raise';
      if (action === 'cooling') this._lastActionFamily = 'lower';

      if (state === 'heat') return { family: 'raise', modeKey: 'heat', isOff: false };
      if (state === 'cool') return { family: 'lower', modeKey: 'cool', isOff: false };
      if (state === 'dry') return { family: 'lower', modeKey: 'dry', isOff: false };
      if (state === 'fan_only') return { family: 'neutral', modeKey: 'fan_only', isOff: false };

      // heat_cool / auto — resolution ladder: live action, then what the
      // device CAN do (hvac_modes), then the last action seen (sticky),
      // then neutral: no claim until the device shows its hand.
      if (action === 'heating' || action === 'cooling') {
        return { family: this._lastActionFamily, modeKey: state, isOff: false };
      }
      const modes = entity.attributes.hvac_modes || [];
      const canHeat = modes.includes('heat') || modes.includes('heat_cool');
      const canCool = modes.includes('cool') || modes.includes('heat_cool');
      if (canHeat && !canCool) return { family: 'raise', modeKey: state, isOff: false };
      if (canCool && !canHeat) return { family: 'lower', modeKey: state, isOff: false };
      if (this._lastActionFamily) {
        return { family: this._lastActionFamily, modeKey: state, isOff: false };
      }
      return { family: 'neutral', modeKey: state, isOff: false };
    }
    if (this._domain === 'humidifier') {
      const lowering = this._getHumidifierClass(entity) === 'dehumidifier';
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

  /**
   * Humidifier direction: card config `device_class` overrides the entity
   * attribute; absent everywhere → assume humidifier (raising) with a
   * one-time warning, since the wrong direction flips palette and alerts.
   */
  _getHumidifierClass(entity) {
    const cls = this._config.device_class || entity.attributes.device_class;
    if (!cls) {
      this._warnOnce('device_class',
        `${this._config.entity} has no device_class; assuming "humidifier". ` +
          `Set "device_class: dehumidifier" in the card config if it is one.`);
    }
    return cls || 'humidifier';
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
          position: relative;
        }
        /* Config-warning chip: a quiet, tappable hint that some config on
           this card is being ignored or can never work. Hidden when clean. */
        .config-warning {
          position: absolute;
          top: 4px;
          right: 6px;
          z-index: 3;
          cursor: pointer;
          color: var(--tsc-warning-color, #FBBF24);
          opacity: 0.65;
          line-height: 1;
        }
        .config-warning ha-icon {
          --mdc-icon-size: 14px;
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
          position: relative;
        }
        /* Transient informational bubble over the slider (e.g. interacting
           with a range-setpoint thermostat the slider can't control). */
        .slider-popover.below {
          bottom: auto;
          top: calc(100% + 6px);
        }
        .slider-popover {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.95);
          color: var(--primary-text-color, #FFF);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: 6px;
          white-space: normal;
          max-width: calc(100% - 8px);
          width: max-content;
          text-align: center;
          z-index: 2;
          pointer-events: none;
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
        .slider-fill.family-raise {
          background: var(--tsc-slider-fill, linear-gradient(90deg, #F59E0B, #FBBF24));
        }
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
             clamp keeps it inside the track so it survives 0%/100%. This
             -10px (leftward) shift is correct for the single-handle thumb
             and for the high handle thumb below, because in both cases
             the colored fill is to the thumb's LEFT (single-handle: fill
             spans 0 to the thumb; high handle: the shared between-handles
             band spans Low to High, so High's own edge is the band's
             right edge) -- shifting left pulls the thumb INTO that fill.
             It is NOT correct for the low handle, which gets its own
             override just below: the between-handles band is to Low's
             RIGHT, so the same leftward shift pulls Low's thumb AWAY from
             the fill instead of into it. */
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
        /* Low/High each shift TOWARD the between-handles fill they sit
           next to (Low rightward, High leftward -- the mirror image of
           each other), rather than both sharing .slider-thumb's plain
           -10px above. Each written as its own compound selector (two
           classes) so it wins on SPECIFICITY over the shared
           .slider-thumb rule, not source order -- the markup always
           carries both classes together (e.g. class="slider-thumb
           slider-thumb-low"), so each always matches whenever its
           single-class form would, and neither rule can be shadowed by
           the other since they target disjoint elements.

           The MAGNITUDE of that shift is --tsc-thumb-shift-mag, a
           JS-computed, per-render custom property shared by both thumbs
           (same value, opposite sign baked into each rule below) -- not
           a hardcoded 10px. When Low and High are close enough together
           in real pixels that a full 10px shift from each would cross or
           collide, JS caps the shared magnitude to at most half the
           actual gap between them, so the two thumbs can approach each
           other but never swap past one another. Falls back to the
           original fixed 10px whenever JS hasn't set the property (e.g.
           real pixel layout isn't available yet). */
        .slider-thumb.slider-thumb-low {
          left: clamp(8px, calc(var(--tsc-thumb-pos, 0%)
            + var(--tsc-thumb-shift-mag, 10px)), calc(100% - 8px));
        }
        .slider-thumb.slider-thumb-high {
          left: clamp(8px, calc(var(--tsc-thumb-pos, 0%)
            - var(--tsc-thumb-shift-mag, 10px)), calc(100% - 8px));
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
        /* ── Range-setpoint elements ──────────────────────────────────
           A second, parallel set of elements used only when mode ===
           'range'. Hidden by default; #slider-track.range-active flips
           which set (single vs. range) is visible so both are never
           shown at once. */
        .slider-fill-between {
          position: absolute;
          top: 0;
          height: 100%;
          pointer-events: none;
        }
        .slider-fill-between,
        .slider-thumb-low,
        .slider-thumb-high,
        .slider-setpoint-low,
        .slider-setpoint-high {
          display: none;
        }
        .slider-track.range-active > .slider-fill,
        .slider-track.range-active > .slider-thumb,
        .slider-track.range-active > #slider-setpoint {
          display: none;
        }
        /* The one fill in range mode, spanning low to high. It also
           carries the base .slider-fill class in markup, so the family-
           and mode- color rules on .slider-fill apply to it. */
        .slider-track.range-active .slider-fill-between {
          display: block;
        }
        .slider-track.range-active .slider-thumb-low,
        .slider-track.range-active .slider-thumb-high {
          display: block;
        }
        /* Low/High pills are siblings of #slider-track (not descendants --
           see the markup comment above #slider-setpoint-low), so their
           active-mode visibility keys off .range-active on
           #slider-container instead, toggled alongside #slider-track's
           own copy of that class. */
        .slider-container.range-active > .slider-setpoint-low,
        .slider-container.range-active > .slider-setpoint-high {
          display: inline;
        }
        /* Disabled handle: the backing attribute is non-numeric, so the
           handle stays visible but dimmed and non-interactive, rather
           than fully hidden — distinguishable from an enabled handle at
           a glance. Mirrors the dimming already used for the whole
           slider in the off-state above. */
        .slider-thumb.disabled {
          opacity: 0.35;
          cursor: default;
        }
        .slider-fill.disabled {
          opacity: 0.35;
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
        /* Unsupported entity domain: message rendered in the normal card
           shell (both layouts), replacing the reading + slider. */
        .unsupported {
          font-size: 13px;
          color: var(--tsc-name-color, var(--secondary-text-color, rgba(255, 255, 255, 0.6)));
          line-height: 1.5;
          flex: 1 1 auto;
          min-width: 0;
        }
        .unsupported code {
          color: var(--primary-text-color, #FFF);
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
        <span class="config-warning hidden" id="config-warning"><ha-icon icon="mdi:alert-circle-outline"></ha-icon></span>
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
        <div class="unsupported hidden" id="unsupported"></div>
        <div class="slider-container" id="slider-container">
          <span class="slider-popover hidden" id="slider-popover"></span>
          <div class="slider-track" id="slider-track">
            <div class="slider-fill" id="slider-fill"></div>
            <div class="slider-thumb" id="slider-thumb"></div>
            <span class="slider-setpoint" id="slider-setpoint"></span>

            <div class="slider-fill slider-fill-between" id="slider-fill-between"></div>
            <div class="slider-thumb slider-thumb-low" id="slider-thumb-low"></div>
            <div class="slider-thumb slider-thumb-high" id="slider-thumb-high"></div>
          </div>
          <!-- Low/High pills are siblings of #slider-track, not children
               of it: #slider-track has overflow: hidden (so the thumb
               and fill visually clip at the track's own edges), which
               clipped these pills' text whenever a handle sat near 0%/
               100% (e.g. both handles pinned to min/max). #slider-setpoint
               (single-handle) is intentionally left inside #slider-track,
               unchanged -- this only affects range-setpoint mode's pills.
               #slider-container has no overflow clipping and shares the
               track's exact width/vertical-center (equal top/bottom
               padding), so pixel-based left/top: 50% positioning still
               lines up correctly here. -->
          <span class="slider-setpoint slider-setpoint-low" id="slider-setpoint-low"></span>
          <span class="slider-setpoint slider-setpoint-high" id="slider-setpoint-high"></span>
        </div>
      </div>
    `;

    // Fix the slider's width in one-line layout so stacked cards align.
    if (this._config.layout === 'one-line') {
      const sliderContainer = this.shadowRoot.getElementById('slider-container');
      sliderContainer.style.flexBasis = `${this._config.slider_width}%`;
    }

    // Unsupported entity domain: show the message in place of the reading
    // and slider, keep the name, attach no gesture listeners.
    if (this._unsupportedDomain) {
      this.shadowRoot.getElementById('name').textContent =
        this._config.name || this._config.entity;
      this.shadowRoot.getElementById('temperature').classList.add('hidden');
      this.shadowRoot.getElementById('slider-container').classList.add('hidden');
      const message = this.shadowRoot.getElementById('unsupported');
      message.innerHTML =
        `Unsupported entity type "<code>${this._unsupportedDomain}</code>"` +
        ` for <code>${this._config.entity}</code>. Use a <code>climate</code>,` +
        ` <code>humidifier</code>, <code>fan</code> or` +
        ` <code>water_heater</code> entity.`;
      message.classList.remove('hidden');
      return;
    }

    this._setupEventListeners();
    if (this._hass) this._updateDisplay();
  }

  _setupEventListeners() {
    const card = this.shadowRoot.getElementById('card');
    const track = this.shadowRoot.getElementById('slider-track');

    card.addEventListener('click', (e) => {
      if (this._isDragging) return;
      if (e.target.closest('.slider-track') || e.target.closest('.slider-thumb')) return;
      if (e.target.closest('.alert-inline')) return;
      if (e.target.closest('.config-warning')) return;
      this._openMoreInfo();
    });

    // One-line alert icon: tap to reveal the alert text in a popover bubble.
    // stopPropagation so it doesn't also trigger the card's more-info click.
    const alertIcon = this.shadowRoot.getElementById('alert-icon-inline');
    alertIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleAlertPopover();
    });

    // Config-warning chip: tap to list the card's current config issues.
    const chip = this.shadowRoot.getElementById('config-warning');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showSliderPopover((this._currentIssues || []).join(' • '));
    });

    // Handle-count-parameterized gesture pipeline: every thumb (both the
    // one-handle `#slider-thumb` and the two-handle
    // `#slider-thumb-low`/`#slider-thumb-high`) is wired unconditionally,
    // since both element sets always exist in the DOM simultaneously
    // (only CSS's `range-active` class decides which is visible) and this
    // Card's handle count can change across a `hass` update for the same
    // entity (`resolveSetpointMode` flips with the attributes it reads).
    // Each thumb's own fixed handle id is baked into its closure via
    // `resolveHandleSpecs`'s two branches, so which id is passed never
    // depends on the handle set active at wiring time.
    const oneHandleSpecs = resolveHandleSpecs(this._domain, this._adapter, 'single');
    const rangeHandleSpecs = resolveHandleSpecs('climate', this._adapter, 'range');
    for (const handleSpec of [...oneHandleSpecs, ...rangeHandleSpecs]) {
      const thumbEl = this.shadowRoot.getElementById(handleSpec.elementIds.thumb);
      if (!thumbEl) continue;
      thumbEl.addEventListener('mousedown', (e) =>
        this._startHandleGesture(e, handleSpec.id, `thumb:${handleSpec.id}`));
      thumbEl.addEventListener('touchstart', (e) =>
        this._startHandleGesture(e, handleSpec.id, `thumb:${handleSpec.id}`), { passive: false });
    }

    // Track: with exactly one handle, a track press always resolves to
    // that handle immediately (there's no ambiguity — driving the single
    // setpoint directly from a track press). With more than one handle,
    // `handle` is passed as `null`; `_startHandleGesture` resolves it to
    // the nearest handle via `resolveTapHandle`. Read `this._handles` at
    // event time (not at listener-attach time), since it's recomputed on
    // every render.
    const trackHandleId = () => (this._handles.length === 1 ? this._handles[0].id : null);
    track.addEventListener('mousedown', (e) => this._startHandleGesture(e, trackHandleId(), 'track'));
    track.addEventListener('touchstart', (e) => this._startHandleGesture(e, trackHandleId(), 'track'), { passive: false });
    // Android long-press fires contextmenu — swallow it so the 1s hold
    // reaches our toggle timer instead of a browser menu.
    track.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => this._onHandleGesture(e));
    document.addEventListener('touchmove', (e) => this._onHandleGesture(e), { passive: false });
    document.addEventListener('mouseup', () => this._endHandleGesture());
    document.addEventListener('touchend', () => this._endHandleGesture());
    document.addEventListener('touchcancel', () => this._cancelHandleGesture());
  }

  /**
   * Handle-count-parameterized gesture-start handler, wired to every
   * thumb and the track by `_setupEventListeners()`.
   *
   * `handle` is the resolved handle id if known immediately (always known
   * for a thumb press — the caller passes its own handle id). For a track
   * press (`origin === 'track'`) with more than one handle, `handle` is
   * always passed as `null` by the caller, but is immediately resolved
   * here via `resolveTapHandle` against each handle's current rendered
   * position — the same nearest-handle distance comparison tap-to-step
   * already uses — so a track press near the low handle grabs and drags Low,
   * and a press near the high handle grabs and drags High, from anywhere on
   * the track rather than only from each handle's own narrow thumb.
   * `origin` is `'thumb:<id>' | 'track'`, used only for
   * `resolveInteractionStart` scoping.
   *
   * Every gesture is drag-eligible: a track press resolves the nearest handle up front, so it can drag that
   * handle just like a thumb press.
   *
   * The shared long-press timer is armed on every successful call.
   */
  _startHandleGesture(e, handle, origin) {
    if (!this._hass || !this._config) return;
    if (this._inertSlider) return; // message state: nothing to control
    const entity = this._hass.states[this._config.entity];
    if (!entity || entity.state === 'unavailable') return;

    // A track press with an unresolved handle resolves its target handle
    // immediately, via `resolveTapHandle`'s nearest-distance comparison —
    // the same one tap-to-step already uses. At exactly one handle this
    // always collapses to that sole handle, so this branch is safe to run
    // unconditionally rather than only when there are two or more. The
    // pointer's own start position (not yet available as
    // `this._dragStartX` — that field isn't set until below) has to be
    // read directly off the event.
    if (handle === null && origin === 'track') {
      const point = e.touches ? e.touches[0] : e;
      const { min, max } = this._getRange();
      const toPercent = (numeric) => Math.max(0, Math.min(100, ((numeric - min) / (max - min)) * 100));
      const positions = {};
      const enabledMask = {};
      for (const h of this._handles) {
        const numeric = asNumber(entity.attributes[h.attr]);
        positions[h.id] = numeric !== null ? toPercent(numeric) : 0;
        enabledMask[h.id] = !(this._disabledHandles && this._disabledHandles[h.id]);
      }
      const track = this.shadowRoot.getElementById('slider-track');
      const rect = track.getBoundingClientRect();
      const tapX = ((point.clientX - rect.left) / rect.width) * 100;
      handle = resolveTapHandle(tapX, positions, enabledMask);
    }

    // A resolved handle that's currently disabled (non-numeric attribute)
    // is excluded from interaction. `_disabledHandles` is handle-id-keyed
    // for both one and two handles.
    if (handle !== null && this._disabledHandles && this._disabledHandles[handle]) return;

    e.preventDefault();
    e.stopPropagation();

    // Single-active-interaction scoping: a competing pointer-down while
    // another origin's drag or long-press timer is active is ignored
    // outright.
    const resolvedOrigin = resolveInteractionStart(this._activeOrigin, origin);
    if (resolvedOrigin !== origin) return;

    this._activeOrigin = origin;
    this._activeHandle = handle;
    this._isDragging = true;
    const point = e.touches ? e.touches[0] : e;
    this._dragStartX = point.clientX;
    this._dragStartY = point.clientY;
    this._dragMoved = false;
    this._toggleFired = false;

    // Long-press toggle: armed unconditionally, 1000ms hold, regardless of
    // origin.
    if (this._longPressTimer) clearTimeout(this._longPressTimer);
    if (this._config.allow_toggle !== false) {
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        if (this._isDragging && !this._dragMoved) this._fireToggle();
      }, 1000);
    }

    // Snapshot the entity's last confirmed values, for every handle in
    // the current handle set, as the render state to drag/tap from and
    // as the revert target for `_cancelHandleGesture`.
    const { min, max } = this._getRange();
    const toPercent = (numeric) => Math.max(0, Math.min(100, ((numeric - min) / (max - min)) * 100));
    const confirmedState = {};
    for (const h of this._handles) {
      const numeric = asNumber(entity.attributes[h.attr]);
      confirmedState[h.id] = {
        value: numeric,
        percent: numeric !== null ? toPercent(numeric) : 0,
      };
    }
    this._confirmedState = confirmedState;
    this._renderState = confirmedState;

    const handleSpec = this._handles.find((h) => h.id === handle);
    const thumbEl = handleSpec
      ? this.shadowRoot.getElementById(handleSpec.elementIds.thumb)
      : null;
    if (thumbEl) thumbEl.classList.add('dragging');
  }

  /**
   * Handle-count-parameterized drag-move handler, wired to every
   * `mousemove`/`touchmove` event by `_setupEventListeners()`.
   *
   * A 10px 2D-displacement slop check gates whether the gesture counts as
   * a drag at all — movement beyond that threshold clears the long-press
   * timer armed by `_startHandleGesture` so a real drag never also fires
   * the toggle. No value is computed/applied until the gesture has
   * actually moved.
   *
   * Once movement is confirmed, computes the new value via the
   * pointer-position-to-value formula (percent of track width -> value in
   * `[min,max]` -> rounded to step -> clamped to `[min,max]`), clamps it
   * via `clampToMinGap` (gap fixed at one resolved step) only when the
   * current handle set has two members, then updates `this._renderState`
   * via `applyHandleUpdate` and re-renders through `_updateHandlesVisual`.
   */
  _onHandleGesture(e) {
    if (!this._isDragging || this._toggleFired) return;
    e.preventDefault();

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
    if (!this._dragMoved) return;

    const track = this.shadowRoot.getElementById('slider-track');
    const rect = track.getBoundingClientRect();
    const rawPercent = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));

    const { min, max, step } = this._getRange();
    let value = min + rawPercent * (max - min);
    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));

    const handle = this._activeHandle;

    if (this._handles.length > 1) {
      const otherHandle = this._handles.find((h) => h.id !== handle);
      const otherValue = this._renderState[otherHandle.id].value;
      const gap = this._resolveMinGap(step);
      value = clampToMinGap(value, otherValue, handle === 'low', gap);
    }

    const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

    this._renderState = applyHandleUpdate(this._renderState, handle, value, percent);

    const values = {};
    for (const h of this._handles) {
      values[h.id] = this._renderState[h.id].value;
    }
    this._updateHandlesVisual(values);
  }

  /**
   * Handle-count-parameterized pointer-cancel handler, wired to every
   * `touchcancel` listener by `_setupEventListeners()`.
   *
   * Abandons the interaction with no write and no debounce window,
   * reverting the active handle's render state to its last confirmed
   * value via `resolveHandleRevert` and re-rendering through
   * `_updateHandlesVisual`. `this._activeHandle` is always resolved by
   * the time this runs — `_startHandleGesture` resolves a track press's
   * nearest handle up front.
   *
   * Covers the drag-cancel half of the abandoned-interaction-revert
   * guarantee: abandoned interactions always revert to the last
   * confirmed value.
   */
  _cancelHandleGesture() {
    if (!this._isDragging) return;
    const handle = this._activeHandle;

    this._isDragging = false;
    this._activeHandle = null;
    this._activeOrigin = null;
    this._dragMoved = false;
    this._toggleFired = false;
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }

    this._renderState = resolveHandleRevert(this._renderState, handle, this._confirmedState[handle]);

    const values = {};
    for (const h of this._handles) {
      values[h.id] = this._renderState[h.id].value;
    }
    this._updateHandlesVisual(values);

    const handleSpec = this._handles.find((h) => h.id === handle);
    const thumbEl = handleSpec
      ? this.shadowRoot.getElementById(handleSpec.elementIds.thumb)
      : null;
    if (thumbEl) thumbEl.classList.remove('dragging');
  }

  /**
   * Handle-count-parameterized pointer-up/touch-end handler, wired to
   * every `mouseup`/`touchend` listener by `_setupEventListeners()`.
   *
   * `this._activeHandle` is always resolved by the time this runs —
   * `_startHandleGesture` resolves a track press's nearest handle up
   * front — so there is no remaining "resolve the handle at release"
   * case here.
   *
   * Behavior:
   *   IF toggle fired THEN consume, RETURN
   *   IF NOT moved THEN _handleTap(handle), RETURN
   *   start debounce window, then _commitHandleValue(handle, value)
   */
  _endHandleGesture() {
    if (!this._isDragging) return;

    this._isDragging = false;
    this._activeOrigin = null;
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    const activeHandleSpec = this._handles.find((h) => h.id === this._activeHandle);
    const activeThumbEl = activeHandleSpec
      ? this.shadowRoot.getElementById(activeHandleSpec.elementIds.thumb)
      : null;
    if (activeThumbEl) activeThumbEl.classList.remove('dragging');

    // A fired toggle consumed the gesture — no tap-step, no drag commit.
    if (this._toggleFired) {
      this._toggleFired = false;
      this._dragMoved = false;
      this._activeHandle = null;
      return;
    }

    if (!this._dragMoved) {
      const handle = this._activeHandle;
      this._activeHandle = null;
      this._handleTap(handle);
      return;
    }

    const handle = this._activeHandle;
    const value = this._renderState[handle].value;
    this._dragMoved = false;
    this._activeHandle = null;

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._commitHandleValue(handle, value);
    }, RANGE_DEBOUNCE_MS);
  }

  /**
   * Handle-count-parameterized tap-to-step handler. Called from
   * `_endHandleGesture` when a gesture ends without moving.
   *
   * Resolves step direction via a `clickPercent < activeCurrentPercent`
   * comparison, using `this._dragStartX` (still set from the gesture's
   * start, not yet cleared by `_endHandleGesture`) and the track's
   * current `getBoundingClientRect()`, expressed as a 0-100 percent to
   * match `this._renderState[handleId].percent`'s own scale.
   *
   * Clamps via `clampToMinGap` (gap fixed at one resolved step) only when
   * the current handle set has two members. Starts the debounce window
   * (reusing the shared `this._debounceTimer` field `_endHandleGesture`
   * also uses) leading into `_commitHandleValue`.
   *
   * Behavior:
   *   activeCurrentValue, activeCurrentPercent ← current value/percent for handleId
   *   newValue ← clickPercent < activeCurrentPercent ? activeCurrentValue - step : activeCurrentValue + step
   *   newValue ← roundToStep(clamp(newValue, min, max))
   *   IF this._handles.length > 1 THEN
   *     newValue ← clampToMinGap(newValue, otherHandleValue, handleId = 'low', step)
   *   END IF
   *   this._renderState ← applyHandleUpdate(this._renderState, handleId, newValue, toPercent(newValue))
   *   _updateHandlesVisual(valuesFrom(this._renderState))
   *   start debounce window, then _commitHandleValue(handleId, newValue)
   */
  _handleTap(handleId) {
    const activeCurrentValue = this._renderState[handleId].value;
    const activeCurrentPercent = this._renderState[handleId].percent;

    const track = this.shadowRoot.getElementById('slider-track');
    const rect = track.getBoundingClientRect();
    const clickPercent = ((this._dragStartX - rect.left) / rect.width) * 100;

    const { min, max, step } = this._getRange();
    let newValue = clickPercent < activeCurrentPercent
      ? activeCurrentValue - step
      : activeCurrentValue + step;
    newValue = Math.round(newValue / step) * step;
    newValue = Math.max(min, Math.min(max, newValue));

    if (this._handles.length > 1) {
      const otherHandle = this._handles.find((h) => h.id !== handleId);
      const otherValue = this._renderState[otherHandle.id].value;
      const gap = this._resolveMinGap(step);
      newValue = clampToMinGap(newValue, otherValue, handleId === 'low', gap);
    }

    const newPercent = Math.max(0, Math.min(100, ((newValue - min) / (max - min)) * 100));

    this._renderState = applyHandleUpdate(this._renderState, handleId, newValue, newPercent);

    const values = {};
    for (const h of this._handles) {
      values[h.id] = this._renderState[h.id].value;
    }
    this._updateHandlesVisual(values);

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._commitHandleValue(handleId, newValue);
    }, RANGE_DEBOUNCE_MS);
  }

  /**
   * Handle-count-parameterized write-commit handler. Called from both
   * `_endHandleGesture` and `_handleTap`.
   *
   * Builds the write payload via `buildWritePayload`. At two handles,
   * resolves the other handle's value via `resolveOtherHandleValue`
   * against `this._lastConfirmed`/`this._lastSelfWritten`. At one handle,
   * there is no other handle to resolve, so the payload is built directly
   * from `handleId`'s own value.
   *
   * On rejection, reverts via `resolveHandleRevert` at any handle count —
   * single-setpoint entities revert on a rejected write too, the same as
   * range-setpoint entities always have.
   *
   * Returns the `hass.callService` promise (implicitly, via `async`), so
   * callers/tests can `await` completion.
   */
  async _commitHandleValue(handleId, value) {
    if (!this._hass || !this._config) return;

    let payload;
    if (this._handles.length === 1) {
      payload = buildWritePayload(this._handles, { [handleId]: value });
    } else {
      const otherHandle = this._handles.find((h) => h.id !== handleId);
      // `this._lastConfirmed`/`this._lastSelfWritten` are plain objects,
      // not pre-populated per handle id, so an as-yet-unset handle id
      // reads back as `undefined` rather than `null` — normalize to
      // `null` here to match `resolveOtherHandleValue`'s contract.
      const otherConfirmed = this._lastConfirmed[otherHandle.id] ?? null;
      const otherSelfWritten = this._lastSelfWritten[otherHandle.id] ?? null;

      // If neither a confirmed nor a self-written value is known yet for
      // the other handle, there is no known value to batch alongside
      // `value` — suppress the write entirely.
      if (otherConfirmed === null && otherSelfWritten === null) return;

      const otherValue = resolveOtherHandleValue(otherHandle.id, otherConfirmed, otherSelfWritten);
      const values = { [handleId]: value, [otherHandle.id]: otherValue };
      payload = buildWritePayload(this._handles, values);
    }

    if (payload === null) return;

    const [serviceDomain, service] = this._adapter.service;

    try {
      await this._hass.callService(serviceDomain, service, {
        entity_id: this._config.entity,
        ...payload,
      });
      // Record this handle's newly-written value as the Card's own "last
      // self-written" value, tagged with the next event-sequence number,
      // so a later `_commitHandleValue` call for the other handle can
      // resolve most-recent-event-wins against it.
      this._lastSelfWritten = {
        ...this._lastSelfWritten,
        [handleId]: { value, seq: this._nextEventSeq() },
      };
    } catch {
      const lastConfirmed = this._lastConfirmed[handleId];
      if (lastConfirmed === null) return;

      const { min, max } = this._getRange();
      const toPercent = (numeric) => Math.max(0, Math.min(100, ((numeric - min) / (max - min)) * 100));

      // Base the revert on the current render state if one exists (e.g.
      // an in-progress or just-finished drag/tap), else reconstruct one
      // from `this._lastConfirmed` for every handle in the current handle
      // set.
      let baseState = this._renderState;
      if (!baseState || Object.keys(baseState).length === 0) {
        baseState = {};
        for (const handle of this._handles) {
          const confirmed = this._lastConfirmed[handle.id];
          baseState[handle.id] = confirmed
            ? { value: confirmed.value, percent: toPercent(confirmed.value) }
            : { value: null, percent: 0 };
        }
      }

      const revertState = resolveHandleRevert(
        baseState, handleId, { value: lastConfirmed.value, percent: toPercent(lastConfirmed.value) },
      );
      this._renderState = revertState;

      const values = {};
      for (const handle of this._handles) {
        values[handle.id] = this._renderState[handle.id].value;
      }
      this._updateHandlesVisual(values);
    }
  }

  /**
   * Return the next value in the shared `_eventSeq` counter, backing
   * `_lastConfirmed`/`_lastSelfWritten`. Called once per `_updateDisplay()`
   * state update and once per completed write, so `resolveOtherHandleValue`
   * can later compare a handle's confirmed value against its own
   * last-self-written value to resolve most-recent-event-wins.
   */
  _nextEventSeq() {
    this._eventSeq += 1;
    return this._eventSeq;
  }

  /** Long-press fired: toggle the device with a visible confirmation. */
  _fireToggle() {
    this._toggleFired = true; // consume the gesture either way
    this.shadowRoot.getElementById('slider-thumb').classList.remove('dragging');

    // Held on a device that can't turn on/off: explain right here instead
    // of silently doing nothing (the console is invisible on dashboards).
    const entity = this._hass.states[this._config.entity];
    if (!entity || !this._supportsToggle(entity)) {
      this._showSliderPopover("This device can't be turned on/off");
      return;
    }

    this._hass.callService('homeassistant', 'toggle', {
      entity_id: this._config.entity,
    });

    // Visible cause-and-effect: flash the card when the toggle fires.
    const card = this.shadowRoot.getElementById('card');
    card.classList.add('toggle-flash');
    setTimeout(() => card.classList.remove('toggle-flash'), 400);
  }

  /**
   * Render the fill + thumb + pill for every handle in the current handle
   * set, plus the between-handles fill segment when there are two.
   *
   * `values` is keyed by whatever handle ids the current render's
   * `resolveHandleSpecs(domain, adapter, mode)` call produces:
   * `{ value: numeric|null }` at one handle, or
   * `{ low: numeric|null, high: numeric|null }` at two handles. The handle
   * set is derived fresh from `this._domain`/`this._adapter`/
   * `this._activeMode` on every call, rather than depending on
   * `this._handles`, so it stays correct even before that field is set.
   *
   * Single per-handle loop: the value-to-percent formula, `[0,100]` clamp,
   * and inside/outside pill threshold are the same for every handle
   * regardless of count. The one deliberate branch is handle count itself:
   * at one handle a non-numeric value hides the fill/thumb/pill entirely;
   * at two handles a non-numeric handle instead renders dimmed-but-present
   * (via a `disabled` class), so a disabled handle reads as visibly
   * distinct from "temporarily not rendered" rather than simply absent.
   * The between-handles fill segment is only rendered when there are
   * exactly two handles, and only when both are numeric — otherwise
   * there's no well-defined "current range" to shade.
   */
  _updateHandlesVisual(values) {
    const handles = resolveHandleSpecs(this._domain, this._adapter, this._activeMode);
    // `resolveDisabledHandles` reads `attrs[handle.attr]` (e.g.
    // `target_temp_low`), but `values` is keyed by `handle.id` (e.g.
    // `low`). Re-key onto `handle.attr` so the existing, untouched
    // function is called with the shape it actually expects.
    const attrsByAttrName = {};
    for (const handle of handles) {
      attrsByAttrName[handle.attr] = values[handle.id];
    }
    const disabled = resolveDisabledHandles(attrsByAttrName, handles);

    const { min, max } = this._getRange();
    const toPercent = (numeric) => {
      const rawPercent = ((numeric - min) / (max - min)) * 100;
      return Math.max(0, Math.min(100, rawPercent));
    };

    const numerics = {};
    const percents = {};
    for (const handle of handles) {
      const numeric = asNumber(values[handle.id]);
      numerics[handle.id] = numeric;
      percents[handle.id] = numeric !== null ? toPercent(numeric) : null;
    }

    // `insideLeft` is where the pill sits once it's "inside" (threshold
    // met): at one handle, that's the midpoint of the filled region (0 to
    // `percent`), since the fill spans the track's left edge to the
    // thumb. At two handles there is no per-handle fill to center within,
    // so the pill instead offsets a fixed amount from its own thumb, toward the
    // *other* Handle (into the colored between-handles band): Low shifts
    // right, High shifts left. That keeps the pill inside the track and
    // clear of the thumb marker it would otherwise sit directly on top
    // of, without needing real DOM measurement of rendered widths.
    //
    // `outsideSide` picks which direction the fallback "outside" position
    // pushes the pill when there isn't room for the offset-inside
    // position: `'right'` (the original, single-handle behavior — push
    // right of the thumb, since the only "outside" case there is a low
    // value near the track's left edge) or `'left'` (push left of the
    // thumb instead, away from the other handle, for the Low handle's
    // side of a two-handle "too crowded" fallback).
    const renderPill = (setpointEl, numeric, percent, insideLeft, forceOutside, outsideSide) => {
      setpointEl.textContent =
        `${numeric.toFixed(this._adapter.precision)}${this._adapter.unit}`;

      const threshold = 12;
      if (percent >= threshold && !forceOutside) {
        setpointEl.style.left = `${insideLeft}%`;
        setpointEl.style.transform = 'translate(-50%, -50%)';
        setpointEl.classList.remove('outside');
        setpointEl.classList.add('inside');
      } else if (outsideSide === 'left') {
        setpointEl.style.left = `calc(${percent}% - 16px)`;
        setpointEl.style.transform = 'translate(-100%, -50%)';
        setpointEl.classList.remove('inside');
        setpointEl.classList.add('outside');
      } else {
        setpointEl.style.left = `calc(${percent}% + 16px)`;
        setpointEl.style.transform = 'translateY(-50%)';
        setpointEl.classList.remove('inside');
        setpointEl.classList.add('outside');
      }
    };

    // At two handles, `renderPill`'s fixed percent-of-track-width
    // constants (the `pillOffsetPercent`/`crowdMarginPercent` block below)
    // are a FALLBACK only, used when real layout measurement isn't
    // available. The primary two-handle path is `renderPillMeasured`
    // (below), which places each Low/High pill using actual measured
    // pixel widths from `getBoundingClientRect()` — a fixed percent can't
    // correctly decide "does this specific number's text fit here" across
    // every combination of track width (`slider_width`, `layout:
    // one-line`), precision/unit, and Low/High spacing; only a real
    // measurement of the rendered text can. Centering on the thumb, or a
    // fixed offset toward the other handle, both overlap or clip in some
    // of those combinations. The fixed offset below is only the fallback
    // when no layout is available.
    const pillOffsetPercent = 8;
    const crowdMarginPercent = pillOffsetPercent * 2;
    let crowded = false;
    // Default to each handle's own percent (no offset) — the right
    // fallback when the other handle is disabled/non-numeric, since
    // there's no real sibling position to offset toward in that case.
    let lowInsidePercent = percents[handles[0] ? handles[0].id : 'low'];
    let highInsidePercent = percents[handles[1] ? handles[1].id : 'high'];
    if (handles.length === 2) {
      const [lowHandle, highHandle] = handles;
      const lowPercent = percents[lowHandle.id];
      const highPercent = percents[highHandle.id];
      if (lowPercent !== null && highPercent !== null) {
        crowded = (highPercent - lowPercent) < crowdMarginPercent;
        lowInsidePercent = lowPercent + pillOffsetPercent;
        highInsidePercent = highPercent - pillOffsetPercent;
      }
    }

    // ── Measured two-handle pill placement ─────────────────────────────
    // Real layout measurement of the track and each pill's actual
    // rendered width, so the inside/outside decision (and the "outside"
    // fallback's position) is based on genuinely available room rather
    // than a guessed percent. Falls back to the percent-based logic above
    // whenever real layout isn't available (`trackWidthPx` is 0 — e.g. an
    // unmounted/hidden card, or a test that hasn't stubbed
    // `getBoundingClientRect`), so every existing test/environment that
    // doesn't explicitly opt into layout measurement keeps its prior
    // (percent-based) behavior unchanged.
    const track = this.shadowRoot.getElementById('slider-track');
    const trackWidthPx = handles.length === 2 ? track.getBoundingClientRect().width : 0;
    const [lowHandleSpec, highHandleSpec] = handles;
    const useMeasuredLayout = handles.length === 2 && trackWidthPx > 0
      && percents[lowHandleSpec.id] !== null && percents[highHandleSpec.id] !== null;

    // Shared magnitude for both `.slider-thumb-low`/`.slider-thumb-high`'s
    // CSS shift-toward-their-own-fill (see those rules' comments): Low
    // shifts right, High shifts left, by this same distance — so as the
    // gap between them shrinks, a full, uncapped 10px from each could
    // cross or collide (Low's shifted position passing High's, or vice
    // versa). Capping the shared magnitude to at most half the real
    // pixel gap between the two handles means each thumb can move at
    // most halfway toward the other, so they can visually approach but
    // never swap past one another. Written into a CSS custom property
    // (rather than computed independently by each thumb's own CSS) so
    // both thumbs always use the exact same magnitude — computing it
    // twice from `--tsc-thumb-pos` alone in pure CSS isn't possible
    // (each thumb's CSS only has access to its OWN `--tsc-thumb-pos`,
    // not its sibling's), so JS resolves it once per render, from real
    // measured pixels, same as `renderPillMeasured`'s reference points.
    let thumbShiftMagPx = 10;
    if (useMeasuredLayout) {
      const rawGapPx = ((percents[highHandleSpec.id] - percents[lowHandleSpec.id]) / 100)
        * trackWidthPx;
      thumbShiftMagPx = Math.max(0, Math.min(10, rawGapPx / 2));
    }

    // Small fixed gap (px) kept between a pill's edge and whichever
    // reference point (the colored fill's own edge, or the thumb bar) is
    // more restrictive in a given direction — purely cosmetic breathing
    // room, not a room-availability threshold (that's what the real
    // pill-width measurement below is for).
    const handleClearancePx = 6;
    // Half of `.slider-thumb`'s own 4px width, so pill regions can be
    // checked against the thumb's actual left/right visual edges, not
    // just its center point.
    const thumbHalfWidthPx = 2;
    let lowBoundaryPx = null;
    let highBoundaryPx = null;
    let lowThumbVisualPx = null;
    let highThumbVisualPx = null;
    let midPx = null;
    // `boundaryPx` is the raw value-to-percent pixel position — exactly
    // what `#slider-fill-between`'s own `left`/`width` use, i.e. where
    // the colored band visually begins/ends. `thumbVisualPx` is the
    // THUMB's actual rendered position: `.slider-thumb`'s CSS shifts it
    // 10px TOWARD the fill it belongs next to (clamped to stay 8px
    // inside either track edge) so its narrow 4px marker centers against
    // that fill's edge. For High (and the one-handle thumb) the fill is
    // to the LEFT, so the shift is `- 10px`; for Low the between-handles
    // fill is to the RIGHT, so `.slider-thumb-low`'s own CSS override
    // shifts it `+ 10px` instead (see that rule's comment above) --
    // `isLow` picks the matching sign here so this JS measurement always
    // mirrors whichever CSS rule actually rendered that specific thumb.
    // These are two different reference points from `boundaryPx`, and
    // pill placement needs BOTH: text must stay clear of the thumb bar
    // itself (measured from `thumbVisualPx`), AND must not bleed past
    // where the colored fill actually starts/ends (measured from
    // `boundaryPx`) -- using only the shifted thumb position for both
    // would let pills start up to 10px before
    // the fill's real edge, landing dark "inside" text over the dark
    // unfilled track, or an "outside" pill overlapping the tail of the
    // colored band it was supposed to sit beyond.
    const thumbVisualPx = (rawPx, isLow) => {
      const shifted = isLow ? rawPx + thumbShiftMagPx : rawPx - thumbShiftMagPx;
      return Math.max(8, Math.min(shifted, trackWidthPx - 8));
    };
    if (useMeasuredLayout) {
      lowBoundaryPx = (percents[lowHandleSpec.id] / 100) * trackWidthPx;
      highBoundaryPx = (percents[highHandleSpec.id] / 100) * trackWidthPx;
      lowThumbVisualPx = thumbVisualPx(lowBoundaryPx, true);
      highThumbVisualPx = thumbVisualPx(highBoundaryPx, false);
      // The shared between-handles band splits at its horizontal
      // midpoint (of the actual colored band, i.e. the raw boundary
      // positions): the low handle's number is only ever placed "inside"
      // within the half nearest Low, the high handle's within the half
      // nearest High — never sharing the same half, so the two numbers
      // can't collide with each other even when both fit individually.
      midPx = (lowBoundaryPx + highBoundaryPx) / 2;
    }

    // Positions one two-handle pill using real measured pixel widths.
    // `isLow` selects which half of the band this pill owns and which
    // direction it relocates toward if "outside".
    const renderPillMeasured = (setpointEl, numeric, isLow) => {
      setpointEl.textContent =
        `${numeric.toFixed(this._adapter.precision)}${this._adapter.unit}`;
      const pillWidthPx = setpointEl.getBoundingClientRect().width;

      // Each region bound picks whichever of "the fill's own edge" or
      // "the thumb's visual edge" is more restrictive (further from the
      // band's open interior) — the two references only diverge by the
      // thumb's 10px shift, and which one ends up more restrictive
      // depends on the direction: for the low handle, its own thumb sits
      // LEFT of the fill's start (further from the band), so it's the
      // binding constraint for "outside" (left of Low) but the fill edge
      // binds for "inside" (right of Low); for the high handle it's the
      // mirror image. `Math.max`/`Math.min` picks correctly either way
      // without hardcoding which case applies.
      const regionStart = isLow
        ? Math.max(lowBoundaryPx, lowThumbVisualPx + thumbHalfWidthPx) + handleClearancePx
        : midPx;
      const regionEnd = isLow
        ? midPx
        : Math.min(highBoundaryPx, highThumbVisualPx - thumbHalfWidthPx) - handleClearancePx;
      const availableWidthPx = Math.max(0, regionEnd - regionStart);

      if (pillWidthPx > 0 && pillWidthPx <= availableWidthPx) {
        // Fits inside this handle's half of the band: anchor it close to
        // this handle's OWN thumb/fill-edge (with `handleClearancePx`
        // breathing room), not centered across the whole available half.
        // Centering reads fine when the half is narrow (little slack
        // either way), but when the two handles are far apart -- e.g.
        // both pinned to the track's own min/max -- "center of the whole
        // half" pushes the number a quarter of the entire track away
        // from the thumb it actually belongs to, for no reason.
        // Anchoring keeps the number next to its own handle regardless
        // of how much open room the band happens to have.
        if (isLow) {
          setpointEl.style.left = `${regionStart}px`;
        } else {
          setpointEl.style.left = `${regionEnd - pillWidthPx}px`;
        }
        setpointEl.style.transform = 'translateY(-50%)';
        setpointEl.classList.remove('outside');
        setpointEl.classList.add('inside');
        return;
      }

      // Doesn't fit: relocate fully outside the shared band, away from
      // the other handle — Low pushes left of its own thumb/fill-edge,
      // High pushes right of its own thumb/fill-edge (same
      // more-restrictive-of-the-two-references logic as above, mirrored:
      // Low's binding edge here is its thumb, High's is the fill).
      // Clamped to the track's own pixel bounds: unlike the one-handle
      // pill (which stays inside #slider-track and relies on its
      // `overflow: hidden` to truncate cleanly at the edge), these pills
      // are now siblings of #slider-track precisely so they're NOT
      // clipped there — so this clamp is what keeps a pill near the
      // track's own 0%/100% edge from instead spilling past
      // #slider-container's bounds with nothing to stop it.
      if (isLow) {
        const rightEdgePx = Math.min(lowBoundaryPx, lowThumbVisualPx - thumbHalfWidthPx)
          - handleClearancePx;
        let leftEdgePx = rightEdgePx - pillWidthPx;
        if (leftEdgePx < 0) leftEdgePx = 0;
        setpointEl.style.left = `${leftEdgePx}px`;
        setpointEl.style.transform = 'translateY(-50%)';
      } else {
        let leftEdgePx = Math.max(highBoundaryPx, highThumbVisualPx + thumbHalfWidthPx)
          + handleClearancePx;
        if (leftEdgePx + pillWidthPx > trackWidthPx) {
          leftEdgePx = Math.max(0, trackWidthPx - pillWidthPx);
        }
        setpointEl.style.left = `${leftEdgePx}px`;
        setpointEl.style.transform = 'translateY(-50%)';
      }
      setpointEl.classList.remove('inside');
      setpointEl.classList.add('outside');
    };

    for (const handle of handles) {
      const thumb = this.shadowRoot.getElementById(handle.elementIds.thumb);
      const setpointEl = this.shadowRoot.getElementById(handle.elementIds.pill);
      const numeric = numerics[handle.id];
      const percent = percents[handle.id];

      if (handles.length === 1) {
        // One-handle case: the handle owns `#slider-fill`, and a null
        // value hides the fill/thumb/pill entirely.
        const fill = this.shadowRoot.getElementById(handle.elementIds.fill);
        if (numeric === null) {
          fill.style.width = '0%';
          thumb.classList.add('hidden');
          setpointEl.classList.add('hidden');
          continue;
        }
        setpointEl.classList.remove('hidden');
        thumb.classList.remove('hidden');
        fill.style.width = `${percent}%`;
        thumb.style.setProperty('--tsc-thumb-pos', `${percent}%`);
        // One-handle "inside" position: centered within the filled
        // region (0 to `percent`), matching the fill this handle owns.
        renderPill(setpointEl, numeric, percent, percent / 2);
        continue;
      }

      // Two-handle case: a non-numeric handle renders dimmed-but-present
      // rather than hidden (via a `disabled` class), positioned at the
      // other handle's percent (or the track start if that's also
      // non-numeric).
      const isDisabled = disabled[handle.id];
      thumb.classList.toggle('disabled', isDisabled);
      setpointEl.classList.toggle('disabled', isDisabled);

      if (isDisabled) {
        const other = handles.find((h) => h.id !== handle.id);
        const fallbackPercent = other ? percents[other.id] : null;
        const pos = fallbackPercent !== null ? fallbackPercent : 0;
        thumb.classList.remove('hidden');
        setpointEl.classList.add('hidden');
        thumb.style.setProperty('--tsc-thumb-pos', `${pos}%`);
        continue;
      }

      thumb.classList.remove('hidden');
      setpointEl.classList.remove('hidden');
      thumb.style.setProperty('--tsc-thumb-pos', `${percent}%`);
      if (useMeasuredLayout) {
        // Shared shift magnitude (see its own comment above) — same
        // value on both thumbs, direction baked into each thumb's own
        // CSS rule (`.slider-thumb-low`/`.slider-thumb-high`).
        thumb.style.setProperty('--tsc-thumb-shift-mag', `${thumbShiftMagPx}px`);
        // Primary path: place this handle's pill using real measured
        // pixel widths (see `renderPillMeasured` above).
        renderPillMeasured(setpointEl, numeric, handle.id === 'low');
      } else {
        // Fallback: no real layout available (e.g. unmounted/hidden
        // card, or a test without a stubbed `getBoundingClientRect`) —
        // offset from this handle's own thumb toward the other handle by
        // a fixed percent.
        const insideLeft = handle.id === 'low' ? lowInsidePercent : highInsidePercent;
        renderPill(
          setpointEl, numeric, percent, insideLeft,
          crowded, handle.id === 'low' ? 'left' : 'right',
        );
      }
    }

    if (handles.length === 2) {
      // Between-handles segment: only meaningful with exactly two
      // Handles, and only when both are numeric (otherwise there's no
      // well-defined "current range" to shade).
      const fillBetween = this.shadowRoot.getElementById('slider-fill-between');
      // Color for this element is NOT set here. The card resolves one fill
      // color per render, and this band (a single fill spanning low to
      // high) is the ONE thing that gets colored in range-setpoint mode. It
      // gets that color through the exact same `_getModeInfo` resolution
      // `#slider-fill` already uses at one handle — computed once per
      // `_updateDisplay()` call, not per-gesture. This method only owns
      // geometry (width/left/hidden), mirroring how `_updateHandlesVisual`
      // never touches `#slider-fill`'s color either, at one handle.
      const [lowHandle, highHandle] = handles;
      const lowPercent = percents[lowHandle.id];
      const highPercent = percents[highHandle.id];
      if (lowPercent !== null && highPercent !== null) {
        fillBetween.classList.remove('hidden');
        fillBetween.style.left = `${lowPercent}%`;
        fillBetween.style.width = `${Math.max(0, highPercent - lowPercent)}%`;
      } else {
        fillBetween.classList.add('hidden');
        fillBetween.style.width = '0%';
      }
    }
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

  /**
   * Collect a chip issue for an entity-reference config value that can't
   * currently resolve (missing, unavailable, or non-numeric). Re-evaluated
   * on every state update, so transient startup races self-clear.
   */
  _collectRefIssue(val, label, issues) {
    if (typeof val !== 'string' || !val.includes('.')) return;
    const refEntity = this._hass.states[val];
    if (!refEntity) {
      issues.push(`${label}: entity "${val}" not found`);
      return;
    }
    if (refEntity.state === 'unavailable' || refEntity.state === 'unknown'
        || isNaN(parseFloat(refEntity.state))) {
      issues.push(`${label}: "${val}" has no numeric value`);
    }
  }

  /** Resolve a threshold: static number, entity ID, or null. */
  _resolveThreshold(val, label) {
    const n = asNumber(val);
    if (n !== null) return n;
    if (typeof val === 'string' && val.includes('.')) {
      const entity = this._hass.states[val];
      if (!entity) {
        if (label) {
          this._warnOnce(`ref:${label}`,
            `${label} references missing entity "${val}"; the alert will ` +
              `never fire`);
        }
        return null;
      }
      if (entity.state !== 'unavailable' && entity.state !== 'unknown') {
        const parsed = parseFloat(entity.state);
        if (!isNaN(parsed)) return parsed;
      }
      if (label) {
        this._warnOnce(`refval:${label}`,
          `${label} entity "${val}" has no numeric value ` +
            `(state: "${entity.state}"); the alert can't fire`);
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
      const dehumidifier = this._getHumidifierClass(entity) === 'dehumidifier';
      return dehumidifier ? { low: null, high: 65 } : { low: 25, high: 65 };
    }
    return { low: null, high: null }; // fan, water_heater: opt-in only
  }

  /** Resolve one alert threshold from config + defaults. */
  _getAlertThreshold(configValue, defaultValue, label) {
    if (configValue === false) return null;
    if (configValue === undefined) return defaultValue;
    return this._resolveThreshold(configValue, label);
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
    if (this._unsupportedDomain) return; // static message card, nothing to update

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
    const fillBetween = this.shadowRoot.getElementById('slider-fill-between');
    const oneLine = this._config.layout === 'one-line';
    const adapter = this._adapter;

    const messageEl = this.shadowRoot.getElementById('unsupported');
    const chipEl = this.shadowRoot.getElementById('config-warning');

    // Set name
    const name = this._config.name
      || (entity ? entity.attributes.friendly_name : this._config.entity);
    nameEl.textContent = name;

    // Entity not found (typo, or not registered yet): say so instead of
    // pretending the device is offline. Heals on a later hass update.
    if (!entity) {
      card.classList.add('unavailable');
      tempEl.classList.add('hidden');
      offlineEl.classList.add('hidden');
      sliderContainer.classList.add('hidden');
      alertBanner.classList.add('hidden');
      alertInline.classList.add('hidden');
      messageEl.innerHTML =
        `Entity not found: <code>${this._config.entity}</code>`;
      messageEl.classList.remove('hidden');
      chipEl.classList.add('hidden');
      this._inertSlider = true;
      return;
    }

    // Handle unavailable state
    if (entity.state === 'unavailable') {
      card.classList.add('unavailable');
      tempEl.classList.add('hidden');
      offlineEl.classList.remove('hidden');
      sliderContainer.classList.add('hidden');
      alertBanner.classList.add('hidden');
      alertInline.classList.add('hidden');
      messageEl.classList.add('hidden');
      chipEl.classList.add('hidden');
      return;
    }

    // Preset-only fan (no SET_SPEED feature): the slider has nothing to
    // control, so say so instead of issuing service calls that fail.
    if (this._domain === 'fan') {
      const features = entity.attributes.supported_features;
      if (features !== null && features !== undefined && (features & 1) === 0) {
        card.classList.remove('unavailable');
        tempEl.classList.add('hidden');
        offlineEl.classList.add('hidden');
        sliderContainer.classList.add('hidden');
        alertBanner.classList.add('hidden');
        alertInline.classList.add('hidden');
        messageEl.innerHTML =
          `<code>${this._config.entity}</code> doesn't support speed ` +
          `control (preset-only fan).`;
        messageEl.classList.remove('hidden');
        chipEl.classList.add('hidden');
        this._inertSlider = true;
        return;
      }
    }

    card.classList.remove('unavailable');
    tempEl.classList.remove('hidden');
    offlineEl.classList.add('hidden');
    sliderContainer.classList.remove('hidden');
    messageEl.classList.add('hidden');
    this._inertSlider = false;

    // Config-warning chip: static config issues + state-dependent ones,
    // re-evaluated fresh so resolved problems clear the chip by themselves.
    const issues = [...this._configIssues];
    if (typeof this._config.alert_low !== 'undefined' && this._config.alert_low !== false) {
      this._collectRefIssue(this._config.alert_low, 'alert_low', issues);
    }
    if (typeof this._config.alert_high !== 'undefined' && this._config.alert_high !== false) {
      this._collectRefIssue(this._config.alert_high, 'alert_high', issues);
    }
    if (this._config.threshold) {
      this._collectRefIssue(this._config.threshold, 'threshold', issues);
    }
    if (this._config.timer && !this._hass.states[this._config.timer]) {
      issues.push(`timer: entity "${this._config.timer}" not found`);
    }
    this._getRange();
    if (this._rangeInvalid) {
      issues.push('slider range resolves inverted; using the fallback range');
    }
    this._currentIssues = issues;
    chipEl.classList.toggle('hidden', issues.length === 0);

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

    // range-setpoint mode's between-handles band gets the exact same
    // color decision as `#slider-fill` above — one `_getModeInfo` call
    // per render, applied to whichever fill element(s) are relevant for
    // the current handle count. This runs unconditionally on every
    // `_updateDisplay()` call (not gated behind `!this._isDragging`),
    // matching `#slider-fill`'s own behavior: color can change mid-drag
    // if `hvac_action` changes, even though width/position stay frozen
    // during the drag. One band, low to high, one color: there is no
    // separate per-handle color scheme.
    const keepBetween = fillBetween.className.split(' ').filter(
      (c) => c && !c.startsWith('family-') && !c.startsWith('mode-')
    );
    if (modeInfo.family) keepBetween.push(`family-${modeInfo.family}`);
    if (modeInfo.modeKey) keepBetween.push(`mode-${modeInfo.modeKey}`);
    fillBetween.className = keepBetween.join(' ');

    // ── Alerts: extreme low / high, then direction-aware stuck ──────────
    let showAlert = false;
    let alertMdi = '';
    let alertLabel = '';

    if (adapter.alerts || this._config.alert_low !== undefined
        || this._config.alert_high !== undefined || this._config.timer) {
      const defaults = adapter.alerts
        ? this._getAlertDefaults(entity) : { low: null, high: null };
      const labels = this._getAlertLabels(entity);
      const low = this._getAlertThreshold(this._config.alert_low, defaults.low, 'alert_low');
      const high = this._getAlertThreshold(this._config.alert_high, defaults.high, 'alert_high');

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
        if (!timerEntity) {
          this._warnOnce('ref:timer',
            `timer references missing entity "${this._config.timer}"; the ` +
              `stuck alert will never fire`);
        }
        const thresholdVal = this._config.threshold
          ? this._resolveThreshold(this._config.threshold, 'threshold') : 10;

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

    // Range-setpoint thermostats (target_temp_low/high, no single target)
    // get two handles; everything else gets one.
    this._mode = this._domain === 'climate'
      ? resolveSetpointMode(entity.attributes)
      : 'single';
    this._disabledHandles = resolveDisabledHandles(
      entity.attributes,
      resolveHandleSpecs(this._domain, adapter, this._mode),
    );

    this._activeMode = resolveActiveMode({
      currentMode: this._mode,
      previousActiveMode: this._activeMode,
      isDragging: this._isDragging,
    });
    this._handles = resolveHandleSpecs(this._domain, adapter, this._activeMode);

    // Record this state update as the new "last confirmed" value for each
    // Handle in the current handle set, tagged with the next
    // event-sequence number, so `resolveOtherHandleValue` can later
    // compare it against the Card's own last self-written value to
    // resolve most-recent-event-wins. Recorded on every state update
    // regardless of mode, mirroring `_disabledHandles`/`_mode` above.
    const eventSeq = this._nextEventSeq();
    for (const handle of this._handles) {
      const numeric = asNumber(entity.attributes[handle.attr]);
      this._lastConfirmed[handle.id] = numeric !== null ? { value: numeric, seq: eventSeq } : null;
    }

    // Range-active gating class: toggled unconditionally on every render
    // (not gated behind the drag/debounce check below), so the CSS that
    // hides whichever element set isn't active stays correct even while
    // a drag or debounce is suppressing the visual VALUE refresh. Applied
    // to both #slider-track (fill/thumb visibility) and #slider-container
    // (pill visibility — the pills are siblings of #slider-track, not
    // descendants, so they need their own copy of the class to key off).
    const isRangeActive = this._activeMode === 'range';
    this.shadowRoot.getElementById('slider-track')
      .classList.toggle('range-active', isRangeActive);
    this.shadowRoot.getElementById('slider-container')
      .classList.toggle('range-active', isRangeActive);

    // Setpoint / slider position (only update if not dragging). A missing
    // or non-numeric target hides the pill instead of faking a value.
    // `_updateHandlesVisual` already handles the one-handle-hides-on-null
    // vs. two-handle-dims-on-null distinction internally, so this call
    // site doesn't need to branch on `this._activeMode` itself.
    if (!this._isDragging && !this._debounceTimer) {
      const values = {};
      for (const handle of this._handles) {
        values[handle.id] = asNumber(entity.attributes[handle.attr]);
      }
      this._updateHandlesVisual(values);
      if (this._handles.length > 1) {
        // Keep the legacy single-setpoint elements (`#slider-fill`/
        // `#slider-thumb`/`#slider-setpoint`) in the same hidden/zeroed
        // state a null target already produces, which is how range
        // entities rendered them before this change. `_updateHandlesVisual`
        // only touches the elements bound to `this._handles`, so at two
        // Handles it never reaches these legacy ids on its own — the CSS
        // `range-active` gating alone isn't observable via classList in
        // tests/environments without real CSS cascade resolution (e.g.
        // jsdom), so this mirrors it explicitly in JS too.
        this.shadowRoot.getElementById('slider-fill').style.width = '0%';
        this.shadowRoot.getElementById('slider-thumb').classList.add('hidden');
        this.shadowRoot.getElementById('slider-setpoint').classList.add('hidden');
      }
    }
  }

  /** Show a transient informational bubble over the slider. */
  _showSliderPopover(message) {
    const pop = this.shadowRoot.getElementById('slider-popover');
    pop.textContent = message;
    pop.classList.remove('hidden', 'below');
    // Near the viewport top (or under HA's toolbar) the bubble would clip —
    // flip it below the slider instead.
    if (pop.getBoundingClientRect().top < 60) pop.classList.add('below');
    if (this._sliderPopTimer) clearTimeout(this._sliderPopTimer);
    this._sliderPopTimer = setTimeout(() => {
      pop.classList.add('hidden');
      this._sliderPopTimer = null;
    }, 3000);
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

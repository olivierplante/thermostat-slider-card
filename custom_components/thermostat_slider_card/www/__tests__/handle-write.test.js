/**
 * Write-payload construction for the unified handle model:
 * `buildWritePayload(handleSpecs, values)`.
 *
 * `handleSpecs` is an array of `{ id, attr, writeParam, elementIds }`
 * objects. Only `id` and `writeParam` matter to `buildWritePayload`
 * itself; `attr`/`elementIds` are included in the fixtures below to match
 * the real shape `resolveHandleSpecs` produces, but the function under
 * test has no reason to read them.
 *
 * `values` is a `{ [id]: number }` map keyed by each HandleSpec's `id`.
 */

import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildWritePayload } from "../thermostat-slider-card.js";
import { byId, makeHassEntity, mountEntity } from "./helpers.js";

// A single-handle spec, matching resolveHandleSpecs's one-handle branch
// shape for a climate entity's plain `temperature` target.
const ONE_HANDLE_SPECS = [
  {
    id: "value",
    attr: "temperature",
    writeParam: "temperature",
    elementIds: { fill: "slider-fill", thumb: "slider-thumb", pill: "slider-setpoint" },
  },
];

// The two-handle spec pair, matching resolveHandleSpecs's range branch.
const TWO_HANDLE_SPECS = [
  {
    id: "low",
    attr: "target_temp_low",
    writeParam: "target_temp_low",
    elementIds: {
      thumb: "slider-thumb-low",
      pill: "slider-setpoint-low",
    },
  },
  {
    id: "high",
    attr: "target_temp_high",
    writeParam: "target_temp_high",
    elementIds: {
      thumb: "slider-thumb-high",
      pill: "slider-setpoint-high",
    },
  },
];

// Numeric generator for a "confirmed" handle value.
const numericArb = fc.double({ noNaN: true, min: -100, max: 200 });

// Non-numeric values a caller could plausibly pass for an unconfirmed
// attribute: `null`/`undefined` (no state received yet) and `NaN` (the
// same "not a confirmed number" bucket `asNumber` already collapses these
// into elsewhere in this codebase).
const nonNumericArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(NaN),
);

describe("buildWritePayload — one handle", () => {
  it("test_one_handle_payload_always_contains_exactly_the_writeParam_key", () => {
    fc.assert(
      fc.property(numericArb, (value) => {
        const result = buildWritePayload(ONE_HANDLE_SPECS, { value });

        expect(result).not.toBeNull();
        expect(result).toEqual({ temperature: value });
      }),
      { numRuns: 100 },
    );
  });
});

describe("buildWritePayload — two handles", () => {
  it("test_when_both_are_confirmed_numbers_the_payload_always_contains_both_keys", () => {
    fc.assert(
      fc.property(numericArb, numericArb, (low, high) => {
        const result = buildWritePayload(TWO_HANDLE_SPECS, { low, high });

        expect(result).not.toBeNull();
        expect(Object.keys(result).sort()).toEqual(
          ["target_temp_high", "target_temp_low"].sort(),
        );
        expect(result.target_temp_low).toBe(low);
        expect(result.target_temp_high).toBe(high);
      }),
      { numRuns: 100 },
    );
  });

  it("test_returns_null_when_low_is_not_a_confirmed_number", () => {
    fc.assert(
      fc.property(nonNumericArb, numericArb, (low, high) => {
        expect(buildWritePayload(TWO_HANDLE_SPECS, { low, high })).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("test_returns_null_when_high_is_not_a_confirmed_number", () => {
    fc.assert(
      fc.property(numericArb, nonNumericArb, (low, high) => {
        expect(buildWritePayload(TWO_HANDLE_SPECS, { low, high })).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("test_returns_null_when_neither_is_a_confirmed_number", () => {
    fc.assert(
      fc.property(nonNumericArb, nonNumericArb, (low, high) => {
        expect(buildWritePayload(TWO_HANDLE_SPECS, { low, high })).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

describe("buildWritePayload — never a partial subset, across both handle counts", () => {
  it("test_one_handle_non_null_payload_always_has_exactly_one_key_matching_writeParam", () => {
    fc.assert(
      fc.property(numericArb, (value) => {
        const result = buildWritePayload(ONE_HANDLE_SPECS, { value });

        expect(result).not.toBeNull();
        const keys = Object.keys(result);
        expect(keys).toHaveLength(ONE_HANDLE_SPECS.length);
        expect(keys).toEqual(ONE_HANDLE_SPECS.map((h) => h.writeParam));
      }),
      { numRuns: 100 },
    );
  });

  it("test_two_handle_non_null_payload_never_has_only_one_of_the_two_keys", () => {
    // A payload with exactly one key is the specific failure mode this
    // property forbids (HA core's `vol.Inclusive` schema rejects it). This
    // asserts the returned shape is always either `null` or has exactly
    // both keys — never a partial `{ target_temp_low }` or
    // `{ target_temp_high }` object — across every combination of
    // confirmed/non-confirmed low/high.
    const eitherArb = fc.oneof(numericArb, nonNumericArb);
    fc.assert(
      fc.property(eitherArb, eitherArb, (low, high) => {
        const result = buildWritePayload(TWO_HANDLE_SPECS, { low, high });

        if (result === null) {
          return;
        }
        const keys = Object.keys(result);
        expect(keys).toHaveLength(TWO_HANDLE_SPECS.length);
        expect(keys.sort()).toEqual(
          TWO_HANDLE_SPECS.map((h) => h.writeParam).sort(),
        );
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * One-handle revert-on-rejection.
 *
 * Single-setpoint entities share the write-commit method
 * (`_commitHandleValue`) with range-setpoint entities, so they get the
 * same revert-on-rejection behavior. This is a behavior change from the
 * current release, where a rejected single-setpoint write was not
 * reverted.
 *
 * This covers the rejection half of the abandoned-interaction-revert
 * guarantee: abandoned interactions always revert to the last confirmed
 * value, at both one handle and two.
 */

// A one-handle (single-setpoint mode) climate entity fixture. `heat` mode
// with no range attributes resolves to a single handle bound to
// `temperature` (resolveHandleSpecs's default branch); `supported_features:
// 385` matches the equivalent one-handle fixture used elsewhere in this
// suite (handle-gesture.test.js's `SINGLE_ATTRS`).
const SINGLE_ATTRS = {
  current_temperature: 20,
  temperature: 18,
  min_temp: 7,
  max_temp: 30,
  target_temp_step: 1,
  supported_features: 385,
};

/**
 * A hass stub whose `callService` records the call and returns a rejected
 * Promise, modeling a write rejected by `hass.callService`.
 */
function makeRejectingHass(entityId, attrs, state) {
  const hass = makeHassEntity(entityId, attrs, state);
  hass.callService = (domain, service, data) => {
    hass.calls.push({ domain, service, data });
    return Promise.reject(
      new Error("ServiceValidationError: rejected by hass.callService"),
    );
  };
  return hass;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("_commitHandleValue — one-handle revert-on-rejection", () => {
  it("test_a_rejected_write_reverts_the_sole_handles_displayed_value_and_pill", async () => {
    const hass = makeRejectingHass("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);

    // Simulate the pending value a completed drag-end or tap-step would
    // have already produced (one step above the confirmed 18) before the
    // resulting write is dispatched and rejected. The sole handle's id is
    // 'value'.
    await card._commitHandleValue("value", 19);

    // Reverted to the entity's last confirmed `temperature` (18), not left
    // at the rejected pending value (19).
    expect(byId(card, "slider-setpoint").textContent).toBe("18.0°");
  });

  it("test_reverting_after_rejection_does_not_issue_a_second_write", async () => {
    const hass = makeRejectingHass("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);

    await card._commitHandleValue("value", 19);

    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(1);
  });
});

/**
 * Card-level integration coverage for most-recent-event-wins, against the
 * unified `_commitHandleValue(handleId, value)`.
 *
 * `resolveOtherHandleValue` (the pure function the comparison logic
 * actually lives in) keeps its own dedicated pure-function tests in
 * `range-batched-write.test.js` — those aren't duplicated here. What's
 * covered here is proof that `_commitHandleValue` itself correctly *wires*
 * a real sequence of confirmed-state renders and self-writes into that
 * comparison, end to end, against the real `hass.callService` payload.
 *
 * Fixture note: `_updateDisplay()` tags BOTH handles' confirmed value with
 * a fresh event-sequence number on every single render, even for a handle
 * whose numeric value didn't change since the last render. That is what
 * makes "most recent real EVENT, not most recent WRITE" the correct
 * framing here, and it's why the second test below expects a later
 * confirmed render to beat an earlier self-write on the same handle, even
 * though that render only reports a changed value for the *other* handle.
 */

const RANGE_ATTRS_FOR_COMMIT = {
  current_temperature: 22.7,
  target_temp_low: 19,
  target_temp_high: 24,
  min_temp: 7,
  max_temp: 30,
  target_temp_step: 1,
  supported_features: 386,
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("_commitHandleValue — most-recent-event-wins", () => {
  it("test_a_later_self_write_on_the_other_handle_beats_an_earlier_confirmed_value", async () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS_FOR_COMMIT, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    // `mountEntity`'s `card.hass = hass` assignment already ran one
    // `_updateDisplay()` pass, establishing a confirmed event for both
    // The low handle (19) and the high handle (24).

    await card._commitHandleValue("low", 18);
    // The low handle's self-write (18) is now the most recent event recorded
    // for `low` — no further confirmed render has happened since.

    await card._commitHandleValue("high", 27);

    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[1].data).toEqual({
      entity_id: "climate.range",
      target_temp_low: 18,
      target_temp_high: 27,
    });
  });

  it("test_a_newer_confirmed_render_beats_an_earlier_self_write_on_the_untouched_handle", async () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS_FOR_COMMIT, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);

    await card._commitHandleValue("low", 18);
    // The low handle is now self-written at 18, more recent than the initial
    // confirmed 19 from mount.

    // The entity reports a new state from outside (e.g. another
    // integration, or the physical thermostat itself), changing only
    // `target_temp_high`. `target_temp_low` is unchanged (still 19) in
    // this update, but per the fixture note above, this render still
    // retags the low handle's confirmed value with a fresh, later event
    // sequence number than the self-write above — so the confirmed 19 is
    // now the most recent EVENT for `low`, even though it isn't the most
    // recent WRITE.
    hass.states["climate.range"] = {
      entity_id: "climate.range",
      state: "heat_cool",
      attributes: { ...RANGE_ATTRS_FOR_COMMIT, target_temp_high: 26 },
    };
    card.hass = hass;

    await card._commitHandleValue("high", 27);

    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[1].data).toEqual({
      entity_id: "climate.range",
      target_temp_low: 19,
      target_temp_high: 27,
    });
  });
});

/**
 * Two-handle revert-on-rejection coverage, against the unified
 * `_commitHandleValue(handleId, value)`. Reuses this file's own
 * `makeRejectingHass` helper from the one-handle block above, which is
 * already fully generic over entity id/attrs/state.
 */

const RANGE_ATTRS = {
  current_temperature: 22.7,
  target_temp_low: 19,
  target_temp_high: 24,
  min_temp: 7,
  max_temp: 30,
  target_temp_step: 1,
  supported_features: 386,
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("_commitHandleValue — two-handle revert-on-rejection", () => {
  it("test_a_rejected_write_reverts_the_affected_handles_displayed_value_and_pill", async () => {
    const hass = makeRejectingHass("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);

    // Simulate the value a completed drag-end or tap-step on the low handle
    // would have already produced (one step below the confirmed 19)
    // before the resulting write is dispatched and rejected.
    await card._commitHandleValue("low", 18);

    // Reverted to the entity's last confirmed target_temp_low (19), not
    // left at the rejected pending value (18).
    expect(byId(card, "slider-setpoint-low").textContent).toBe("19.0°");
    // The high handle was never the interacted handle and must be unaffected.
    expect(byId(card, "slider-setpoint-high").textContent).toBe("24.0°");
  });

  it("test_a_rejected_write_on_high_handle_reverts_only_high", async () => {
    const hass = makeRejectingHass("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);

    await card._commitHandleValue("high", 25);

    expect(byId(card, "slider-setpoint-high").textContent).toBe("24.0°");
    expect(byId(card, "slider-setpoint-low").textContent).toBe("19.0°");
  });

  it("test_reverting_after_rejection_does_not_issue_a_second_write", async () => {
    const hass = makeRejectingHass("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);

    await card._commitHandleValue("low", 18);

    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(1);
  });

  // Integration-style example test for the actual `hass.callService` call
  // shape: asserts the full three-argument `callService(domain, service,
  // data)` invocation `_commitHandleValue` makes for a two-handle entity,
  // including `entity_id`, not just the two-key payload shape.
  it("test_calls_hass_callService_with_the_full_climate_set_temperature_shape", async () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);

    await card._commitHandleValue("low", 18);

    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toEqual({
      domain: "climate",
      service: "set_temperature",
      data: {
        entity_id: "climate.range",
        target_temp_low: 18,
        target_temp_high: 24,
      },
    });
  });
});

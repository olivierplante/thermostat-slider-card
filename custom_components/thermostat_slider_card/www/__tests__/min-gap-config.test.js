/**
 * min gap configuration: deriving the effective minimum gap between
 * The low handle and the high handle from the (optional) `min_gap` card config key
 * and the entity's currently resolved step value.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { _resolveEffectiveMinGap } from "../thermostat-slider-card.js";
import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const resolvedStepArb = fc.double({ noNaN: true, min: 0.01, max: 50 });

describe("_resolveEffectiveMinGap", () => {
  it("test_min_gap_absent_falls_back_to_resolved_step", () => {
    fc.assert(
      fc.property(resolvedStepArb, (resolvedStep) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const resultUndefined = _resolveEffectiveMinGap(undefined, resolvedStep);
        expect(resultUndefined).toBe(resolvedStep);

        const resultNull = _resolveEffectiveMinGap(null, resolvedStep);
        expect(resultNull).toBe(resolvedStep);

        expect(warn).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("test_configured_gap_at_or_above_resolved_step_is_used_as_is", () => {
    fc.assert(
      fc.property(
        resolvedStepArb,
        fc.double({ noNaN: true, min: 0, max: 1000 }),
        (resolvedStep, extra) => {
          const configuredGap = resolvedStep + extra; // always >= resolvedStep
          const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = _resolveEffectiveMinGap(configuredGap, resolvedStep);

          expect(result).toBe(configuredGap);
          expect(warn).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  // The pure function never warns; the Card's `_resolveMinGap` owns the
  // warning so it isn't repeated on every drag move (see the Card-level
  // block below).
  it("test_configured_gap_below_resolved_step_falls_back_without_warning", () => {
    fc.assert(
      fc.property(
        resolvedStepArb,
        fc.double({ noNaN: true, min: 0, max: 0.999999 }),
        (resolvedStep, fraction) => {
          const configuredGap = resolvedStep * fraction; // always < resolvedStep
          const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

          const result = _resolveEffectiveMinGap(configuredGap, resolvedStep);

          expect(result).toBe(resolvedStep);
          expect(warn).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_configured_gap_equal_to_resolved_step_is_the_boundary_used_as_is", () => {
    fc.assert(
      fc.property(resolvedStepArb, (resolvedStep) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = _resolveEffectiveMinGap(resolvedStep, resolvedStep);

        expect(result).toBe(resolvedStep);
        expect(warn).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

describe("min_gap on a mounted range-setpoint Card", () => {
  // Low 18 / High 21 in [7, 30], step 1. The low handle renders at
  // (18-7)/23 ≈ 47.8% of a 200px track, so a press at x=150 is right of it.
  const RANGE_ATTRS = {
    current_temperature: 19.5,
    target_temp_low: 18,
    target_temp_high: 21,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  function mountRange(config) {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", config, hass);
    byId(card, "slider-track").getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    card._commitHandleValue = vi.fn();
    return card;
  }

  function fakeEvent(clientX) {
    return {
      clientX,
      clientY: 0,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  function tapStepLowUp(card) {
    card._startHandleGesture(fakeEvent(150), "low", "thumb:low");
    card._handleTap("low");
    card._cancelHandleGesture();
  }

  function minGapWarnings(warn) {
    return warn.mock.calls.filter((args) => String(args[0]).includes("min_gap")).length;
  }

  it("test_a_min_gap_below_one_step_warns_once_across_repeated_gestures", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountRange({ min_gap: 0.5 });

    for (let i = 0; i < 5; i++) tapStepLowUp(card);

    expect(minGapWarnings(warn)).toBe(1);
  });

  it("test_setConfig_rearms_the_min_gap_warning", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountRange({ min_gap: 0.5 });
    tapStepLowUp(card);

    card.setConfig({ entity: "climate.range", min_gap: 0.5 });
    tapStepLowUp(card);

    expect(minGapWarnings(warn)).toBe(2);
  });

  it("test_a_min_gap_at_or_above_one_step_never_warns", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountRange({ min_gap: 1 });

    for (let i = 0; i < 3; i++) tapStepLowUp(card);

    expect(minGapWarnings(warn)).toBe(0);
  });

  it("test_a_raised_min_gap_widens_the_clamp_against_the_other_handle", () => {
    vi.useFakeTimers();
    // With min_gap 3 and High at 21, Low may not exceed 18, so stepping
    // Low up from 18 is clamped back to 18. Without min_gap it would be 19.
    const raised = mountRange({ min_gap: 3 });
    raised._startHandleGesture(fakeEvent(150), "low", "thumb:low");
    raised._handleTap("low");
    expect(raised._renderState.low.value).toBe(18);

    document.body.innerHTML = "";
    const stock = mountRange({});
    stock._startHandleGesture(fakeEvent(150), "low", "thumb:low");
    stock._handleTap("low");
    expect(stock._renderState.low.value).toBe(19);
  });
});

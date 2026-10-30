/**
 * Handle-set resolution: deciding, for a given render, how many handles
 * exist and what each is bound to (entity attribute, write parameter, DOM
 * element ids).
 *
 * `resolveHandleSpecs(domain, adapter, mode)` is a pure resolver.
 *
 * This file also covers `resolveDisabledHandles(attrs, handleSpecs)`,
 * which takes the current `handleSpecs` instead of hardcoding
 * `target_temp_low`/`target_temp_high` reads, so it works for an
 * arbitrary handle set.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { resolveDisabledHandles, resolveHandleSpecs } from "../thermostat-slider-card.js";

// A generator for "numeric or non-numeric" attribute values: mixes real
// numbers (including negatives/decimals) with the two non-numeric shapes
// the render path actually sees (`null`, `undefined`).
const attrValue = fc.oneof(
  fc.double({ noNaN: true, min: -100, max: 200 }),
  fc.constant(null),
  fc.constant(undefined),
);

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const SINGLE_ELEMENT_IDS = {
  fill: "slider-fill",
  thumb: "slider-thumb",
  pill: "slider-setpoint",
};

const LOW_ELEMENT_IDS = {
  thumb: "slider-thumb-low",
  pill: "slider-setpoint-low",
};

const HIGH_ELEMENT_IDS = {
  thumb: "slider-thumb-high",
  pill: "slider-setpoint-high",
};

// Adapter shape mirrors DOMAIN_ADAPTERS entries (only the two fields
// resolveHandleSpecs actually reads: targetAttr, param).
const adapterArb = fc.record({
  targetAttr: fc.constantFrom("temperature", "humidity", "percentage"),
  param: fc.constantFrom("temperature", "humidity", "percentage"),
});

const nonClimateDomain = fc.constantFrom("humidifier", "fan", "water_heater");
const anyDomain = fc.constantFrom("climate", "humidifier", "fan", "water_heater");
const anyMode = fc.constantFrom("single", "range");

describe("resolveHandleSpecs", () => {
  it("test_non_climate_domain_always_yields_a_single_todays_element_ids_spec", () => {
    fc.assert(
      fc.property(nonClimateDomain, adapterArb, anyMode, (domain, adapter, mode) => {
        const result = resolveHandleSpecs(domain, adapter, mode);

        expect(result).toHaveLength(1);
        expect(result[0].elementIds).toEqual(SINGLE_ELEMENT_IDS);
        expect(result[0].attr).toBe(adapter.targetAttr);
        expect(result[0].writeParam).toBe(adapter.param);
      }),
      { numRuns: 100 },
    );
  });

  it("test_climate_in_single_mode_yields_a_single_todays_element_ids_spec", () => {
    fc.assert(
      fc.property(adapterArb, (adapter) => {
        const result = resolveHandleSpecs("climate", adapter, "single");

        expect(result).toHaveLength(1);
        expect(result[0].elementIds).toEqual(SINGLE_ELEMENT_IDS);
        expect(result[0].attr).toBe(adapter.targetAttr);
        expect(result[0].writeParam).toBe(adapter.param);
      }),
      { numRuns: 100 },
    );
  });

  it("test_any_domain_or_mode_combination_other_than_climate_range_yields_one_spec", () => {
    fc.assert(
      fc.property(anyDomain, adapterArb, anyMode, (domain, adapter, mode) => {
        // Skip the one combination this test is deliberately NOT covering
        // (domain === 'climate' && mode === 'range' is the two-handle case,
        // asserted separately below).
        fc.pre(!(domain === "climate" && mode === "range"));

        const result = resolveHandleSpecs(domain, adapter, mode);

        expect(result).toHaveLength(1);
        expect(result[0].elementIds).toEqual(SINGLE_ELEMENT_IDS);
        expect(result[0].attr).toBe(adapter.targetAttr);
        expect(result[0].writeParam).toBe(adapter.param);
      }),
      { numRuns: 100 },
    );
  });

  it("test_climate_in_range_mode_always_yields_exactly_two_specs_bound_to_low_and_high", () => {
    fc.assert(
      fc.property(adapterArb, (adapter) => {
        const result = resolveHandleSpecs("climate", adapter, "range");

        expect(result).toHaveLength(2);

        const [low, high] = result;

        expect(low.id).toBe("low");
        expect(low.attr).toBe("target_temp_low");
        expect(low.writeParam).toBe("target_temp_low");
        expect(low.elementIds).toEqual(LOW_ELEMENT_IDS);

        expect(high.id).toBe("high");
        expect(high.attr).toBe("target_temp_high");
        expect(high.writeParam).toBe("target_temp_high");
        expect(high.elementIds).toEqual(HIGH_ELEMENT_IDS);
      }),
      { numRuns: 100 },
    );
  });

  it("test_result_only_depends_on_the_given_arguments_not_prior_calls", () => {
    fc.assert(
      fc.property(
        anyDomain, adapterArb, anyMode,
        anyDomain, adapterArb, anyMode,
        (domainA, adapterA, modeA, domainB, adapterB, modeB) => {
          const firstA = resolveHandleSpecs(domainA, adapterA, modeA);
          resolveHandleSpecs(domainB, adapterB, modeB);
          const secondA = resolveHandleSpecs(domainA, adapterA, modeA);

          expect(secondA).toEqual(firstA);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("resolveDisabledHandles", () => {
  // Two-handle handleSpecs matching resolveHandleSpecs's climate/range
  // branch shape, built directly (per the task's "construct this literal
  // directly" option) rather than via resolveHandleSpecs, so this test
  // stays decoupled from that function's own correctness.
  const twoHandleSpecs = [
    {
      id: "low",
      attr: "target_temp_low",
      writeParam: "target_temp_low",
      elementIds: { thumb: "slider-thumb-low", pill: "slider-setpoint-low" },
    },
    {
      id: "high",
      attr: "target_temp_high",
      writeParam: "target_temp_high",
      elementIds: { thumb: "slider-thumb-high", pill: "slider-setpoint-high" },
    },
  ];

  // One-handle handleSpecs matching resolveHandleSpecs's non-range branch
  // shape, bound to a domain/attribute pair distinct from
  // target_temp_low/target_temp_high (e.g. a humidifier's `humidity`), so
  // that a widened implementation which genuinely reads from handleSpecs
  // (rather than staying hardcoded to target_temp_low/high) is required to
  // pass this case.
  const oneHandleSpecs = [
    {
      id: "value",
      attr: "humidity",
      writeParam: "humidity",
      elementIds: { fill: "slider-fill", thumb: "slider-thumb", pill: "slider-setpoint" },
    },
  ];

  it("test_disabled_set_equals_exactly_the_non_numeric_attributes", () => {
    fc.assert(
      fc.property(attrValue, attrValue, (low, high) => {
        const attrs = { target_temp_low: low, target_temp_high: high };
        const result = resolveDisabledHandles(attrs, twoHandleSpecs);

        expect(result.low).toBe(!isNumeric(low));
        expect(result.high).toBe(!isNumeric(high));
      }),
      { numRuns: 100 },
    );
  });

  it("test_result_only_depends_on_the_given_attributes_not_prior_calls", () => {
    fc.assert(
      fc.property(
        attrValue, attrValue, attrValue, attrValue,
        (low1, high1, low2, high2) => {
          const attrsA = { target_temp_low: low1, target_temp_high: high1 };
          const attrsB = { target_temp_low: low2, target_temp_high: high2 };

          const firstA = resolveDisabledHandles(attrsA, twoHandleSpecs);
          resolveDisabledHandles(attrsB, twoHandleSpecs);
          const secondA = resolveDisabledHandles(attrsA, twoHandleSpecs);

          expect(secondA).toEqual(firstA);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_both_numeric_means_neither_handle_disabled", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: -100, max: 200 }),
        fc.double({ noNaN: true, min: -100, max: 200 }),
        (low, high) => {
          const result = resolveDisabledHandles(
            { target_temp_low: low, target_temp_high: high },
            twoHandleSpecs,
          );
          expect(result).toEqual({ low: false, high: false });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_both_non_numeric_means_both_handles_disabled", () => {
    const nonNumeric = fc.oneof(fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(nonNumeric, nonNumeric, (low, high) => {
        const result = resolveDisabledHandles(
          { target_temp_low: low, target_temp_high: high },
          twoHandleSpecs,
        );
        expect(result).toEqual({ low: true, high: true });
      }),
      { numRuns: 100 },
    );
  });

  // One-handle case: the widened function must also be callable at one
  // Handle without erroring, even though its result isn't consulted for
  // visual purposes at one handle (a one-handle null value hides the
  // element entirely rather than rendering a disabled state).
  //
  it("test_one_handle_numeric_target_is_not_disabled", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: -100, max: 200 }),
        (humidity) => {
          const result = resolveDisabledHandles({ humidity }, oneHandleSpecs);
          expect(result).toEqual({ value: false });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_one_handle_non_numeric_target_is_disabled", () => {
    const nonNumeric = fc.oneof(fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(nonNumeric, (humidity) => {
        const result = resolveDisabledHandles({ humidity }, oneHandleSpecs);
        expect(result).toEqual({ value: true });
      }),
      { numRuns: 100 },
    );
  });
});

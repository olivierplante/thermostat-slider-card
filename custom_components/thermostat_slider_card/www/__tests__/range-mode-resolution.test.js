/**
 * Range-setpoint mode resolution: deciding whether a climate entity's
 * current attributes should render as single-setpoint mode or
 * range-setpoint mode.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { resolveActiveMode, resolveSetpointMode } from "../thermostat-slider-card.js";

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

describe("resolveSetpointMode", () => {
  it("test_range_iff_temperature_non_numeric_and_a_low_or_high_is_numeric", () => {
    fc.assert(
      fc.property(attrValue, attrValue, attrValue, (temperature, low, high) => {
        const attrs = {
          temperature,
          target_temp_low: low,
          target_temp_high: high,
        };
        const result = resolveSetpointMode(attrs);

        const expectedRange = !isNumeric(temperature)
          && (isNumeric(low) || isNumeric(high));

        expect(result).toBe(expectedRange ? "range" : "single");
      }),
      { numRuns: 100 },
    );
  });

  it("test_result_only_depends_on_the_given_attributes_not_prior_calls", () => {
    fc.assert(
      fc.property(
        attrValue, attrValue, attrValue,
        attrValue, attrValue, attrValue,
        (temperature1, low1, high1, temperature2, low2, high2) => {
          const attrsA = {
            temperature: temperature1,
            target_temp_low: low1,
            target_temp_high: high1,
          };
          const attrsB = {
            temperature: temperature2,
            target_temp_low: low2,
            target_temp_high: high2,
          };

          // Calling with A, then B, then A again must give the same result
          // for A both times — a prior call (including a different input)
          // must not influence a later call's output.
          const firstA = resolveSetpointMode(attrsA);
          resolveSetpointMode(attrsB);
          const secondA = resolveSetpointMode(attrsA);

          expect(secondA).toBe(firstA);

          // And calling repeatedly with the exact same input is idempotent.
          expect(resolveSetpointMode(attrsA)).toBe(firstA);
          expect(resolveSetpointMode(attrsB)).toBe(resolveSetpointMode(attrsB));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_temperature_numeric_is_always_single_regardless_of_low_high", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: -100, max: 200 }),
        attrValue,
        attrValue,
        (temperature, low, high) => {
          const result = resolveSetpointMode({
            temperature,
            target_temp_low: low,
            target_temp_high: high,
          });
          expect(result).toBe("single");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_temperature_non_numeric_and_both_low_high_non_numeric_is_single", () => {
    const nonNumeric = fc.oneof(fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(nonNumeric, nonNumeric, nonNumeric, (temperature, low, high) => {
        const result = resolveSetpointMode({
          temperature,
          target_temp_low: low,
          target_temp_high: high,
        });
        expect(result).toBe("single");
      }),
      { numRuns: 100 },
    );
  });
});

describe("resolveActiveMode", () => {
  // Minimal harness modeling drag-active/drag-ended states — pure-function
  // tests, no DOM needed.
  const mode = fc.constantFrom("single", "range");

  it("test_while_dragging_result_always_stays_pinned_to_previous_active_mode", () => {
    fc.assert(
      fc.property(mode, mode, (currentMode, previousActiveMode) => {
        const result = resolveActiveMode({
          currentMode,
          previousActiveMode,
          isDragging: true,
        });

        expect(result).toBe(previousActiveMode);
      }),
      { numRuns: 100 },
    );
  });

  it("test_while_not_dragging_result_always_matches_current_mode", () => {
    fc.assert(
      fc.property(mode, mode, (currentMode, previousActiveMode) => {
        const result = resolveActiveMode({
          currentMode,
          previousActiveMode,
          isDragging: false,
        });

        expect(result).toBe(currentMode);
      }),
      { numRuns: 100 },
    );
  });

  it("test_sequence_pins_mode_through_drag_and_updates_on_first_render_after_drag_ends", () => {
    // Render 1: not dragging, mode A ("single") — establishes the baseline
    // active mode.
    let activeMode = resolveActiveMode({
      currentMode: "single",
      previousActiveMode: undefined,
      isDragging: false,
    });
    expect(activeMode).toBe("single");

    // Drag starts. Render 2 during the drag: underlying attributes now
    // resolve to mode B ("range"), but isDragging is true, so the active
    // mode must stay pinned to the mode in effect when the drag started.
    activeMode = resolveActiveMode({
      currentMode: "range",
      previousActiveMode: activeMode,
      isDragging: true,
    });
    expect(activeMode).toBe("single");

    // Render 3, still mid-drag: attributes resolve to yet another mode C
    // ("single" again, i.e. flipped back) — still pinned regardless.
    activeMode = resolveActiveMode({
      currentMode: "single",
      previousActiveMode: activeMode,
      isDragging: true,
    });
    expect(activeMode).toBe("single");

    // Drag ends. Render 4: not dragging, latest attributes resolve to mode D
    // ("range") — the pinned mode now updates to reflect the latest attrs on
    // this first post-drag render.
    activeMode = resolveActiveMode({
      currentMode: "range",
      previousActiveMode: activeMode,
      isDragging: false,
    });
    expect(activeMode).toBe("range");
  });
});

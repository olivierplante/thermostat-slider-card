/**
 * Out-of-bounds rendering (issue #7 screenshots): setpoints outside the
 * slider range must clamp visually — fill 0–100%, pill pinned inside the
 * track — and missing/non-numeric targets must render gracefully.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("out-of-bounds setpoint", () => {
  it("test_setpoint_above_max_clamps_fill_and_pins_pill", () => {
    // The "HP: Hot Water at 40° with max 21" bug.
    const hass = makeHassEntity("climate.hw", {
      current_temperature: 20.5, temperature: 40,
    }, "heat");
    const card = mountEntity("climate.hw", { min: 14, max: 21 }, hass);
    const fill = byId(card, "slider-fill");
    const pill = byId(card, "slider-setpoint");
    expect(parseFloat(fill.style.width)).toBe(100);
    // Pill shows the REAL value, positioned inside the track.
    expect(pill.textContent).toBe("40.0°");
    expect(pill.classList.contains("inside")).toBe(true);
    const leftPct = parseFloat(pill.style.left);
    expect(leftPct).toBeGreaterThanOrEqual(0);
    expect(leftPct).toBeLessThanOrEqual(100);
  });

  it("test_setpoint_below_min_clamps_to_zero", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 5,
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBe(0);
    const pill = byId(card, "slider-setpoint");
    expect(pill.textContent).toBe("5.0°");
    expect(pill.classList.contains("outside")).toBe(true);
  });
});

describe("thumb stays visible at the extremes", () => {
  it("test_thumb_pinned_at_left_when_fill_empty", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 5,
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    const thumb = byId(card, "slider-thumb");
    // Positioned in the track (clamped), not collapsed inside a 0% fill.
    expect(thumb.style.getPropertyValue("--tsc-thumb-pos")).toBe("0%");
  });

  it("test_thumb_pinned_at_right_when_fill_full", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 40,
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-thumb").style.getPropertyValue("--tsc-thumb-pos"))
      .toBe("100%");
  });

  it("test_thumb_tracks_percent_in_range", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 17.5, // (17.5-14)/7 = 50%
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-thumb").style.getPropertyValue("--tsc-thumb-pos"))
      .toBe("50%");
  });

  it("test_outside_pill_clears_the_thumb", () => {
    // At 0% the thumb is clamped to 8px; the outside pill text must start
    // past it (16px clearance) or the first digit hides behind the handle.
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 5,
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-setpoint").style.left).toBe("calc(0% + 16px)");
  });

  it("test_thumb_hidden_when_target_missing", () => {
    const hass = makeHassEntity("climate.x", { current_temperature: 20 }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-thumb").classList.contains("hidden")).toBe(true);
  });
});

describe("missing or invalid target", () => {
  it("test_missing_target_hides_pill_and_empties_fill", () => {
    // The "HP: Central Heating empty row" hypothesis: no temperature attr.
    const hass = makeHassEntity("climate.ch", { current_temperature: 21.8 }, "heat");
    const card = mountEntity("climate.ch", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(true);
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBe(0);
    // Current temp still shows.
    expect(byId(card, "temperature").textContent).toBe("21.8°");
  });

  it("test_non_numeric_target_treated_as_missing", () => {
    const hass = makeHassEntity("climate.ch", {
      current_temperature: 21, temperature: "none",
    }, "heat");
    const card = mountEntity("climate.ch", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(true);
  });

  it("test_pill_reappears_when_target_returns", () => {
    const hass = makeHassEntity("climate.ch", { current_temperature: 21 }, "heat");
    const card = mountEntity("climate.ch", { min: 14, max: 21 }, hass);
    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(true);
    card.hass = makeHassEntity("climate.ch", {
      current_temperature: 21, temperature: 18,
    }, "heat");
    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(false);
    expect(byId(card, "slider-setpoint").textContent).toBe("18.0°");
  });
});

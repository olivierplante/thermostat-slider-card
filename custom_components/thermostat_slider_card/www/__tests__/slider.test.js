/**
 * Slider interaction: tap to step, drag to set, debounced service call,
 * setpoint pill positioning, and the visual fill.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { byId, makeHass, mount } from "./helpers.js";

let track;

function stubTrackRect(card, left = 0, width = 200) {
  track = byId(card, "slider-track");
  track.getBoundingClientRect = () => ({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 40,
    height: 40,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("slider visual", () => {
  it("test_setpoint_pill_text_and_fill_width", () => {
    // min 14, max 21, setpoint 16 → (16-14)/(21-14) = 28.57%
    const card = mount({ min: 14, max: 21 }, makeHass({ temperature: 16 }));
    const fill = byId(card, "slider-fill");
    const setpoint = byId(card, "slider-setpoint");
    expect(setpoint.textContent).toBe("16.0°");
    expect(parseFloat(fill.style.width)).toBeCloseTo(28.57, 1);
  });

  it("test_setpoint_outside_when_fill_small", () => {
    // setpoint at min → 0% fill → pill rendered outside the fill
    const card = mount({ min: 14, max: 21 }, makeHass({ temperature: 14 }));
    expect(byId(card, "slider-setpoint").classList.contains("outside")).toBe(
      true,
    );
  });

  it("test_setpoint_inside_when_fill_large", () => {
    const card = mount({ min: 14, max: 21 }, makeHass({ temperature: 21 }));
    expect(byId(card, "slider-setpoint").classList.contains("inside")).toBe(
      true,
    );
  });
});

describe("slider drag", () => {
  it("test_drag_sets_temperature_after_debounce", () => {
    const hass = makeHass({ temperature: 16 });
    const calls = [];
    hass.callService = (domain, service, data) =>
      calls.push({ domain, service, data });
    const card = mount({ min: 14, max: 21, step: 0.5 }, hass);
    stubTrackRect(card);

    // Drag to the far right → max (21).
    track.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 0, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 200, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Debounced 500ms before the service call fires.
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      domain: "climate",
      service: "set_temperature",
      data: { entity_id: "climate.test", temperature: 21 },
    });
  });

  it("test_tap_right_of_setpoint_steps_up", () => {
    const hass = makeHass({ temperature: 16 });
    const calls = [];
    hass.callService = (d, s, data) => calls.push(data);
    const card = mount({ min: 14, max: 21, step: 0.5 }, hass);
    stubTrackRect(card);

    // setpoint 16 → currentPercent ~28.6% → x=57px. Tap at x=150 (well right).
    track.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 150, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(calls[0].temperature).toBe(16.5);
  });

  it("test_unavailable_blocks_drag", () => {
    const card = mount({}, makeHass({}, "unavailable"));
    stubTrackRect(card);
    track.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 0, bubbles: true }),
    );
    // _isDragging should never have been set.
    expect(card._isDragging).toBe(false);
  });
});

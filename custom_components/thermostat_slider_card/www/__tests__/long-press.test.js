/**
 * Long-press toggle: a 1s motionless hold on the slider toggles the device
 * (homeassistant.toggle). Movement cancels; firing consumes the gesture
 * (no tap-step, no drag, no more-info); opt-out via allow_toggle: false;
 * no-op on entities that can't turn on/off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const CLIMATE_ATTRS = {
  current_temperature: 21, temperature: 19,
  min_temp: 7, max_temp: 35,
  // ClimateEntityFeature: TURN_OFF=128 | TURN_ON=256
  supported_features: 384,
};

function press(card, clientX = 50) {
  const track = byId(card, "slider-track");
  track.getBoundingClientRect = () => ({
    left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
  });
  track.dispatchEvent(new MouseEvent("mousedown", { clientX, bubbles: true }));
  return track;
}

function release() {
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function move(clientX) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX, bubbles: true }));
}

function toggleCalls(hass) {
  return hass.calls.filter((c) => c.service === "toggle");
}

describe("long-press fires toggle", () => {
  it("test_motionless_1s_hold_toggles", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", {}, hass);
    press(card);
    vi.advanceTimersByTime(1000);
    expect(toggleCalls(hass)).toEqual([
      { domain: "homeassistant", service: "toggle", data: { entity_id: "climate.x" } },
    ]);
  });

  it("test_fire_flashes_card", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", {}, hass);
    press(card);
    vi.advanceTimersByTime(1000);
    expect(byId(card, "card").classList.contains("toggle-flash")).toBe(true);
  });

  it("test_release_before_1s_is_a_normal_tap_step", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21, step: 0.5 }, hass);
    press(card, 190); // right of setpoint → step up
    vi.advanceTimersByTime(400);
    release();
    vi.advanceTimersByTime(500); // debounce
    expect(toggleCalls(hass)).toHaveLength(0);
    expect(hass.calls.at(-1).service).toBe("set_temperature");
  });

  it("test_movement_cancels_long_press", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    press(card, 50);
    move(120); // > 5px → drag
    vi.advanceTimersByTime(1500);
    expect(toggleCalls(hass)).toHaveLength(0);
  });
});

describe("gesture consumption after fire", () => {
  it("test_release_after_fire_does_not_step", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    press(card, 190);
    vi.advanceTimersByTime(1000); // toggle fires
    release();
    vi.advanceTimersByTime(500);
    // Only the toggle — no set_temperature from the release.
    expect(hass.calls).toHaveLength(1);
    expect(hass.calls[0].service).toBe("toggle");
  });

  it("test_movement_after_fire_does_not_drag", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    press(card, 50);
    vi.advanceTimersByTime(1000);
    move(150);
    release();
    vi.advanceTimersByTime(500);
    expect(hass.calls).toHaveLength(1);
  });
});

describe("touch reality (iOS)", () => {
  function touch(type, clientX, clientY = 20) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    event.touches = type === "touchend" || type === "touchcancel"
      ? [] : [{ clientX, clientY }];
    return event;
  }

  function touchPress(card, clientX = 50) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    track.dispatchEvent(touch("touchstart", clientX));
    return track;
  }

  it("test_finger_drift_under_slop_still_toggles", () => {
    // A fingertip held on glass drifts a few px — that must NOT cancel the
    // hold. Slop radius is 10px (2D), mirroring native long-press behavior.
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", {}, hass);
    touchPress(card, 50);
    document.dispatchEvent(touch("touchmove", 56, 24)); // ~7.2px drift
    vi.advanceTimersByTime(1000);
    expect(toggleCalls(hass)).toHaveLength(1);
  });

  it("test_drift_beyond_slop_becomes_drag", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    touchPress(card, 50);
    document.dispatchEvent(touch("touchmove", 65, 20)); // 15px → drag
    vi.advanceTimersByTime(1500);
    expect(toggleCalls(hass)).toHaveLength(0);
  });

  it("test_touchcancel_aborts_without_tap_or_toggle", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    touchPress(card, 190);
    document.dispatchEvent(touch("touchcancel", 190));
    vi.advanceTimersByTime(1500);
    // No toggle (timer cleared), no tap-step (cancel ≠ release).
    expect(hass.calls).toHaveLength(0);
    // State is clean: a fresh hold afterwards works normally.
    touchPress(card, 50);
    vi.advanceTimersByTime(1000);
    expect(toggleCalls(hass)).toHaveLength(1);
  });
});

describe("opt-out and capability guard", () => {
  it("test_allow_toggle_false_disables", () => {
    const hass = makeHassEntity("climate.x", CLIMATE_ATTRS, "heat");
    const card = mountEntity("climate.x", { allow_toggle: false }, hass);
    press(card);
    vi.advanceTimersByTime(1500);
    expect(toggleCalls(hass)).toHaveLength(0);
  });

  it("test_climate_without_onoff_feature_no_ops", () => {
    const hass = makeHassEntity("climate.x",
      { ...CLIMATE_ATTRS, supported_features: 1 }, "heat");
    const card = mountEntity("climate.x", {}, hass);
    press(card);
    vi.advanceTimersByTime(1500);
    expect(toggleCalls(hass)).toHaveLength(0);
  });

  it("test_climate_without_features_attr_assumed_supported", () => {
    const attrs = { ...CLIMATE_ATTRS };
    delete attrs.supported_features;
    const hass = makeHassEntity("climate.x", attrs, "heat");
    const card = mountEntity("climate.x", {}, hass);
    press(card);
    vi.advanceTimersByTime(1000);
    expect(toggleCalls(hass)).toHaveLength(1);
  });

  it("test_water_heater_requires_onoff_bit", () => {
    const hass = makeHassEntity("water_heater.w", {
      current_temperature: 40, temperature: 50, min_temp: 30, max_temp: 60,
      supported_features: 1, // TARGET_TEMPERATURE only, no ON_OFF (8)
    }, "heat_pump");
    const card = mountEntity("water_heater.w", {}, hass);
    press(card);
    vi.advanceTimersByTime(1500);
    expect(toggleCalls(hass)).toHaveLength(0);
  });

  it("test_humidifier_always_toggleable", () => {
    const hass = makeHassEntity("humidifier.h", {
      current_humidity: 40, humidity: 50, device_class: "humidifier",
    }, "on");
    const card = mountEntity("humidifier.h", {}, hass);
    press(card);
    vi.advanceTimersByTime(1000);
    expect(toggleCalls(hass)).toHaveLength(1);
  });
});

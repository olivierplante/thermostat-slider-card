/**
 * Remaining silent-fallback fixes: device_class override + warning,
 * range-setpoint thermostats (interactive popover, no failing writes),
 * non-toggleable long-press warning, broken threshold-entity warning.
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

const HUM = { current_humidity: 60, humidity: 50, min_humidity: 0, max_humidity: 100 };

describe("A: humidifier device_class", () => {
  it("test_config_device_class_overrides_missing_attribute", () => {
    const hass = makeHassEntity("humidifier.x", { ...HUM, current_humidity: 70 }, "on");
    const card = mountEntity("humidifier.x", { device_class: "dehumidifier" }, hass);
    expect(byId(card, "slider-fill").classList.contains("family-lower")).toBe(true);
    // Dehumidifier alert defaults apply: 70 > 65 → Too humid.
    expect(byId(card, "alert-text").textContent).toBe("Too humid");
  });

  it("test_classless_humidifier_warns_once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("humidifier.x", HUM, "on");
    const card = mountEntity("humidifier.x", {}, hass);
    card.hass = makeHassEntity("humidifier.x", HUM, "on");
    const mentions = warn.mock.calls
      .map((c) => c.join(" "))
      .filter((m) => m.includes("device_class"));
    expect(mentions).toHaveLength(1);
  });

  it("test_invalid_device_class_value_warns_and_chips", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("humidifier.x", HUM, "on");
    const card = mountEntity("humidifier.x", { device_class: "dehumidifierr" }, hass);
    expect(warn).toHaveBeenCalled();
    expect(byId(card, "config-warning").classList.contains("hidden")).toBe(false);
    byId(card, "config-warning").click();
    expect(byId(card, "slider-popover").textContent).toContain("device_class");
  });

  it("test_device_class_on_non_humidifier_chips_as_dead_config", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { device_class: "dehumidifier" }, hass);
    const chip = byId(card, "config-warning");
    expect(chip.classList.contains("hidden")).toBe(false);
    chip.click();
    expect(byId(card, "slider-popover").textContent).toContain("no effect");
  });

  it("test_no_warning_when_attribute_present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountEntity("humidifier.x", {},
      makeHassEntity("humidifier.x", { ...HUM, device_class: "dehumidifier" }, "on"));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("B: range-setpoint thermostats", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19, target_temp_high: 24,
    min_temp: 7, max_temp: 30, supported_features: 386,
  };

  function pressTrack(card, clientX = 100) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    track.dispatchEvent(new MouseEvent("mousedown", { clientX, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  it("test_card_still_displays_reading_and_palette", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    expect(byId(card, "temperature").textContent).toBe("22.7°");
    expect(byId(card, "slider-container").classList.contains("hidden")).toBe(false);
    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(true);
  });

  // Range-setpoint interaction goes through the single
  // `_startHandleGesture`/`_endHandleGesture` pipeline shared with
  // single-setpoint mode — there is no "not supported" popover code path
  // for range entities, so a track press just goes straight into the real
  // gesture pipeline. This test asserts that tap-to-step-then-write
  // behavior directly, with no popover assertion at all.
  //
  // A `pressTrack` press with no movement in between is a tap
  // (`_startHandleGesture(e, null, 'track')` → `_endHandleGesture()`
  // resolves a handle via `resolveTapHandle` and calls `_handleTap`).
  // At clientX 100 on a 0-200px track (tapX 50%), the nearest handle to
  // RANGE_ATTRS's low (19 → 52.17%) and high (24 → 73.91%) rendered
  // positions is low, and the tap lands left of low's own rendered
  // percent, so it steps low down by one resolved step (0.5, the climate
  // adapter's fallback step since RANGE_ATTRS has no target_temp_step):
  // 19 - 0.5 = 18.5. Once the 500ms debounce window (`RANGE_DEBOUNCE_MS`)
  // elapses, `_commitHandleValue` batches that new low value with high's
  // last confirmed value (24) into one write.
  it("test_interacting_issues_a_batched_write", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    pressTrack(card);
    vi.advanceTimersByTime(2000); // range debounce window: write should fire
    const writeCalls = hass.calls.filter((c) => c.service === "set_temperature");
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].data).toEqual({
      entity_id: "climate.range",
      target_temp_low: 18.5,
      target_temp_high: 24,
    });
  });

  // In 1.3.x this test checked that the range-setpoint "not supported"
  // popover didn't fire for a plain single-setpoint thermostat. That
  // popover is gone, so it now checks that a normal thermostat's
  // tap-to-step write is unaffected by range setpoints sharing its code
  // path.
  it("test_normal_thermostat_unaffected", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { step: 1 }, hass);
    pressTrack(card, 190);
    vi.advanceTimersByTime(500);
    expect(byId(card, "slider-popover").classList.contains("hidden")).toBe(true);
    expect(hass.calls.at(-1).service).toBe("set_temperature");
  });
});

describe("C: non-toggleable long-press explains at interaction", () => {
  const NO_TOGGLE_ATTRS = {
    current_temperature: 20, temperature: 18,
    min_temp: 7, max_temp: 30, supported_features: 1,
  };

  function hold(card, ms) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    track.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, bubbles: true }));
    vi.advanceTimersByTime(ms);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  it("test_hold_shows_popover_instead_of_toggling", () => {
    const hass = makeHassEntity("climate.x", NO_TOGGLE_ATTRS, "heat");
    const card = mountEntity("climate.x", {}, hass);
    hold(card, 1000);
    const pop = byId(card, "slider-popover");
    expect(pop.classList.contains("hidden")).toBe(false);
    expect(pop.textContent).toContain("turned on/off");
    vi.advanceTimersByTime(2000);
    expect(hass.calls).toHaveLength(0); // no toggle, no tap-step
  });

  it("test_quick_tap_still_steps_without_popover", () => {
    const hass = makeHassEntity("climate.x", NO_TOGGLE_ATTRS, "heat");
    const card = mountEntity("climate.x", { step: 1 }, hass);
    hold(card, 200); // released before the long-press window
    vi.advanceTimersByTime(500);
    expect(byId(card, "slider-popover").classList.contains("hidden")).toBe(true);
    expect(hass.calls.at(-1).service).toBe("set_temperature");
  });

  it("test_no_popover_when_toggle_opted_out", () => {
    const hass = makeHassEntity("climate.x", NO_TOGGLE_ATTRS, "heat");
    const card = mountEntity("climate.x", { allow_toggle: false }, hass);
    hold(card, 1500);
    expect(byId(card, "slider-popover").classList.contains("hidden")).toBe(true);
  });
});

describe("config-warning chip", () => {
  it("test_clean_config_shows_no_chip", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { min: 14, max: 21 }, hass);
    expect(byId(card, "config-warning").classList.contains("hidden")).toBe(true);
  });

  it("test_ignored_range_shows_chip_with_fix", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { min: 25, max: 10 }, hass);
    const chip = byId(card, "config-warning");
    expect(chip.classList.contains("hidden")).toBe(false);
    chip.click();
    const pop = byId(card, "slider-popover");
    expect(pop.classList.contains("hidden")).toBe(false);
    expect(pop.textContent).toContain("min");
  });

  it("test_deprecated_key_shows_chip", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { freeze_threshold: 5 }, hass);
    const chip = byId(card, "config-warning");
    expect(chip.classList.contains("hidden")).toBe(false);
    chip.click();
    expect(byId(card, "slider-popover").textContent).toContain("alert_low");
  });

  it("test_missing_alert_ref_chip_heals_when_entity_appears", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const attrs = {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    };
    const card = mountEntity("climate.x", { alert_low: "input_number.late" },
      makeHassEntity("climate.x", attrs, "heat"));
    expect(byId(card, "config-warning").classList.contains("hidden")).toBe(false);
    // The referenced entity registers later → chip clears by itself.
    card.hass = makeHassEntity("climate.x", attrs, "heat", {
      "input_number.late": { state: "8", attributes: {} },
    });
    expect(byId(card, "config-warning").classList.contains("hidden")).toBe(true);
  });

  it("test_classless_humidifier_does_not_chip", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountEntity("humidifier.x", {},
      makeHassEntity("humidifier.x", HUM, "on"));
    expect(byId(card, "config-warning").classList.contains("hidden")).toBe(true);
  });

  it("test_chip_click_does_not_open_more_info", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.x", { min: 25, max: 10 }, hass);
    let fired = false;
    card.addEventListener("hass-more-info", () => { fired = true; });
    byId(card, "config-warning").click();
    expect(fired).toBe(false);
  });
});

describe("D: broken threshold entities", () => {
  it("test_unavailable_threshold_entity_warns_once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const extra = {
      "input_number.thr": { state: "unavailable", attributes: {} },
    };
    const hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat", extra);
    const card = mountEntity("climate.x", { alert_low: "input_number.thr" }, hass);
    card.hass = makeHassEntity("climate.x", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 30,
    }, "heat", extra);
    const mentions = warn.mock.calls
      .map((c) => c.join(" "))
      .filter((m) => m.includes("input_number.thr"));
    expect(mentions).toHaveLength(1);
  });
});

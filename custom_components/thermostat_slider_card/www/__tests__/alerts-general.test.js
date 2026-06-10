/**
 * Generalized alert system: alert_low / alert_high (number | entity | false)
 * with device_class-aware defaults, freeze_threshold as a deprecated alias,
 * and a direction-aware "stuck" (struggling) alert.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function alertText(card) {
  const banner = byId(card, "alert-banner");
  return banner.classList.contains("hidden")
    ? null
    : byId(card, "alert-text").textContent;
}

const HUM = { current_humidity: 50, humidity: 50, min_humidity: 0, max_humidity: 100 };

describe("device_class-aware defaults", () => {
  it("test_climate_low_default_5_unchanged", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", {
      current_temperature: 3, temperature: 19, min_temp: 7, max_temp: 35,
    }, "heat"));
    expect(alertText(card)).toBe("Freeze risk");
  });

  it("test_climate_high_disabled_by_default", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", {
      current_temperature: 45, temperature: 19, min_temp: 7, max_temp: 35,
    }, "heat"));
    expect(alertText(card)).toBe(null);
  });

  it("test_dehumidifier_high_default_65_too_humid", () => {
    const card = mountEntity("humidifier.d", {}, makeHassEntity("humidifier.d",
      { ...HUM, current_humidity: 70, device_class: "dehumidifier" }, "on"));
    expect(alertText(card)).toBe("Too humid");
  });

  it("test_dehumidifier_low_opt_in_only", () => {
    const card = mountEntity("humidifier.d", {}, makeHassEntity("humidifier.d",
      { ...HUM, current_humidity: 10, device_class: "dehumidifier" }, "on"));
    expect(alertText(card)).toBe(null);
  });

  it("test_humidifier_low_default_25_too_dry", () => {
    const card = mountEntity("humidifier.h", {}, makeHassEntity("humidifier.h",
      { ...HUM, current_humidity: 20, device_class: "humidifier" }, "on"));
    expect(alertText(card)).toBe("Too dry");
  });

  it("test_humidifier_high_default_65", () => {
    const card = mountEntity("humidifier.h", {}, makeHassEntity("humidifier.h",
      { ...HUM, current_humidity: 70, device_class: "humidifier" }, "on"));
    expect(alertText(card)).toBe("Too humid");
  });

  it("test_fan_no_alerts", () => {
    const card = mountEntity("fan.f", {}, makeHassEntity("fan.f", { percentage: 50 }, "on"));
    expect(alertText(card)).toBe(null);
  });
});

describe("config values", () => {
  it("test_false_disables_climate_low", () => {
    const card = mountEntity("climate.x", { alert_low: false },
      makeHassEntity("climate.x", {
        current_temperature: 3, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat"));
    expect(alertText(card)).toBe(null);
  });

  it("test_zero_is_a_valid_threshold", () => {
    const hass = makeHassEntity("climate.x", {
      current_temperature: 2, temperature: 19, min_temp: 7, max_temp: 35,
    }, "heat");
    const card = mountEntity("climate.x", { alert_low: 0 }, hass);
    // 2 > 0 → no alert (default 5 would have fired — proves 0 was honored).
    expect(alertText(card)).toBe(null);
    card.hass = makeHassEntity("climate.x", {
      current_temperature: -1, temperature: 19, min_temp: 7, max_temp: 35,
    }, "heat");
    expect(alertText(card)).toBe("Freeze risk");
  });

  it("test_alert_high_opt_in_on_climate", () => {
    const card = mountEntity("climate.x", { alert_high: 28 },
      makeHassEntity("climate.x", {
        current_temperature: 30, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat"));
    expect(alertText(card)).toBe("Overheating");
  });

  it("test_threshold_from_entity", () => {
    const extra = { "input_number.limit": { state: "60", attributes: {} } };
    const card = mountEntity("humidifier.d",
      { alert_high: "input_number.limit" },
      makeHassEntity("humidifier.d",
        { ...HUM, current_humidity: 62, device_class: "dehumidifier" }, "on", extra));
    expect(alertText(card)).toBe("Too humid");
  });
});

describe("freeze_threshold deprecation", () => {
  it("test_alias_still_works_and_warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountEntity("climate.x", { freeze_threshold: 8 },
      makeHassEntity("climate.x", {
        current_temperature: 7, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat"));
    expect(alertText(card)).toBe("Freeze risk");
    const msg = warn.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(msg).toContain("freeze_threshold");
    expect(msg).toContain("alert_low");
  });

  it("test_alert_low_wins_when_both_set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mountEntity("climate.x", { freeze_threshold: 10, alert_low: 4 },
      makeHassEntity("climate.x", {
        current_temperature: 7, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat"));
    // 7 < 10 would fire via alias, but alert_low 4 wins → 7 > 4 → no alert.
    expect(alertText(card)).toBe(null);
    expect(warn).toHaveBeenCalled();
  });
});

describe("direction-aware stuck alert", () => {
  const timerStates = {
    "timer.t": { state: "idle", attributes: {} },
    "input_number.thr": { state: "10", attributes: {} },
  };

  it("test_raising_stuck_when_current_below_threshold", () => {
    const card = mountEntity("climate.x",
      { timer: "timer.t", threshold: "input_number.thr" },
      makeHassEntity("climate.x", {
        current_temperature: 9, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat", timerStates));
    expect(alertText(card)).toBe("Struggling to heat");
  });

  it("test_cooling_stuck_when_current_above_threshold", () => {
    const states = {
      "timer.t": { state: "idle", attributes: {} },
      "input_number.thr": { state: "28", attributes: {} },
    };
    const card = mountEntity("climate.x",
      { timer: "timer.t", threshold: "input_number.thr" },
      makeHassEntity("climate.x", {
        current_temperature: 30, temperature: 22, min_temp: 7, max_temp: 35,
      }, "cool", states));
    expect(alertText(card)).toBe("Struggling to cool");
  });

  it("test_dehumidifier_stuck_label", () => {
    const states = {
      "timer.t": { state: "idle", attributes: {} },
      "input_number.thr": { state: "60", attributes: {} },
    };
    const card = mountEntity("humidifier.d",
      { timer: "timer.t", threshold: "input_number.thr", alert_high: false },
      makeHassEntity("humidifier.d",
        { ...HUM, current_humidity: 64, device_class: "dehumidifier" }, "on", states));
    expect(alertText(card)).toBe("Struggling to dry");
  });

  it("test_no_stuck_when_timer_active", () => {
    const states = {
      "timer.t": { state: "active", attributes: {} },
      "input_number.thr": { state: "10", attributes: {} },
    };
    const card = mountEntity("climate.x",
      { timer: "timer.t", threshold: "input_number.thr" },
      makeHassEntity("climate.x", {
        current_temperature: 9, temperature: 19, min_temp: 7, max_temp: 35,
      }, "heat", states));
    expect(alertText(card)).toBe(null);
  });
});

/**
 * Range-mode slider visual rendering. Covers two concerns with no other
 * home:
 *
 *   (a) single-mode DOM isolation under the range-aware `_updateDisplay()`
 *       code paths (non-regression) — asserts the original three
 *       single-setpoint elements (#slider-fill, #slider-thumb,
 *       #slider-setpoint) are unaffected by range-mode code paths.
 *   (b) `layout: one-line` / `slider_width` behavior with dual handles —
 *       the same range DOM elements must render regardless of layout.
 *
 * Handle-position-formula coverage (both handles routing through the same
 * value-to-percent formula via `_updateHandlesVisual`) lives in
 * `handle-visual.test.js` instead.
 */

import { afterEach, describe, expect, it } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

// Non-regression guard: the original three single-setpoint elements
// (#slider-fill, #slider-thumb, #slider-setpoint) must be byte-identical
// before and after range-aware code paths run, for a single-setpoint
// fixture. This is a snapshot/DOM-diff example test asserting "nothing
// changed," which doesn't benefit from randomized inputs.
//
// A single-setpoint entity resolves to the one-handle case, so
// `_updateDisplay()`'s mode-computation lines (resolveSetpointMode/
// resolveDisabledHandles/resolveActiveMode) only affect `this._mode`/
// `this._activeMode`/`this._disabledHandles`, never the single-setpoint
// DOM writes themselves.
describe("single-mode DOM isolation (non-regression)", () => {
  function snapshotSingleModeElements(card) {
    return ["slider-fill", "slider-thumb", "slider-setpoint"].map((id) => {
      const el = byId(card, id);
      return {
        id,
        className: el.className,
        style: el.getAttribute("style"),
        textContent: el.textContent,
      };
    });
  }

  it("test_single_setpoint_elements_are_byte_identical_across_range_code_paths", () => {
    // Single-setpoint fixture: `temperature` is numeric, no
    // target_temp_low/high, so resolveSetpointMode resolves 'single'.
    const attrs = {
      current_temperature: 20,
      temperature: 18,
      min_temp: 7,
      max_temp: 30,
    };
    const hass = makeHassEntity("climate.single", attrs, "heat");
    const card = mountEntity("climate.single", {}, hass);

    const before = snapshotSingleModeElements(card);

    // Trigger another render pass — the same `_updateDisplay()` entry
    // point that now also runs resolveSetpointMode/resolveDisabledHandles/
    // resolveActiveMode before falling through to the unchanged single-
    // setpoint branch. Same attributes, so nothing should differ.
    card.hass = makeHassEntity("climate.single", attrs, "heat");

    const after = snapshotSingleModeElements(card);

    expect(after).toEqual(before);

    // The new range-mode gating class must not be present for a
    // single-setpoint entity: this is the actual mechanism (not computed
    // style, which jsdom doesn't resolve from the CSS cascade) that keeps
    // the original elements visible and the range elements hidden.
    expect(byId(card, "slider-track").classList.contains("range-active"))
      .toBe(false);
  });
});

// `layout: one-line` example test: range-setpoint mode reuses the full
// dual-handle track unchanged, just rendered at the reduced
// `slider_width` the existing one-line layout already computes. No
// stacked mini-sliders, no switchable-active-handle mode, and no new DOM
// elements — the same range elements render regardless of
// `layout`. The value-to-percent formula and existing drag/tap
// hit-testing already generalize to any track width, so this is an
// example-level integration test confirming that generalization holds
// end to end.
describe("range-mode under layout: one-line", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  function dragHandle(card, handleId, fromX, toX) {
    const handle = byId(card, handleId);
    handle.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    stubTrackRect(card);
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: fromX, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: toX, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  function tapTrack(card, clientX) {
    const track = stubTrackRect(card);
    track.dispatchEvent(new MouseEvent("mousedown", { clientX, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  // The one-line layout's supported `slider_width` range is 20-80%;
  // exercise both boundaries plus the default (55) rather than
  // fast-check, since the container's own CSS width is what's under test
  // here (an example/DOM-snapshot concern), not the value-to-percent
  // formula itself (covered separately, independent of `slider_width`).
  describe.each([20, 55, 80])("slider_width: %i", (sliderWidth) => {
    it(`test_both_handles_render_and_the_container_width_is_applied_at_slider_width_${sliderWidth}`, () => {
      const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
      const card = mountEntity(
        "climate.range",
        { layout: "one-line", slider_width: sliderWidth },
        hass,
      );

      // No new/different DOM elements are used for one-line range mode:
      // the same range elements must all be present.
      const rangeElementIds = [
        "slider-fill-between",
        "slider-thumb-low",
        "slider-thumb-high",
        "slider-setpoint-low",
        "slider-setpoint-high",
      ];
      for (const id of rangeElementIds) {
        expect(byId(card, id)).not.toBeNull();
      }

      // Both handles render (not hidden), positioned according to their
      // values — identical mechanism to the default layout.
      const thumbLow = byId(card, "slider-thumb-low");
      const thumbHigh = byId(card, "slider-thumb-high");
      expect(thumbLow.classList.contains("hidden")).toBe(false);
      expect(thumbHigh.classList.contains("hidden")).toBe(false);

      const { min, max } = { min: 7, max: 30 };
      const expectedLowPercent = ((19 - min) / (max - min)) * 100;
      const expectedHighPercent = ((24 - min) / (max - min)) * 100;
      expect(thumbLow.style.getPropertyValue("--tsc-thumb-pos"))
        .toBe(`${expectedLowPercent}%`);
      expect(thumbHigh.style.getPropertyValue("--tsc-thumb-pos"))
        .toBe(`${expectedHighPercent}%`);

      // The container's own width mechanism (flex-basis from
      // slider_width) is applied regardless of range vs single mode —
      // `_render()`'s one-line branch sets this unconditionally.
      const sliderContainer = byId(card, "slider-container");
      expect(sliderContainer.style.flexBasis).toBe(`${sliderWidth}%`);

      // No stacked/switchable presentation: both the single-mode and
      // range-mode element sets exist in the DOM at once (CSS, not JS,
      // decides which is visible), gated by the same `range-active` class
      // the default layout uses — nothing new introduced for one-line.
      expect(byId(card, "slider-track").classList.contains("range-active"))
        .toBe(true);

      document.body.innerHTML = "";
    });
  });

  it("test_low_handle_remains_independently_draggable_under_one_line_layout", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity(
      "climate.range",
      { layout: "one-line", slider_width: 20 },
      hass,
    );

    // The low handle at 19 -> (19-7)/23*100 ≈ 52.2%, x≈104 on a 200px track.
    // Drag it left to x=20 -> should move down; high handle must stay put.
    dragHandle(card, "slider-thumb-low", 104, 20);

    const lowSetpoint = Number(
      byId(card, "slider-setpoint-low").textContent.replace("°", ""),
    );
    expect(lowSetpoint).toBeLessThan(19);
    expect(byId(card, "slider-setpoint-high").textContent).toBe("24.0°");
  });

  it("test_high_handle_remains_independently_draggable_under_one_line_layout", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity(
      "climate.range",
      { layout: "one-line", slider_width: 80 },
      hass,
    );

    // The high handle at 24 -> (24-7)/23*100 ≈ 73.9%, x≈148. Drag it right to
    // x=190 -> should move up; low handle must stay put.
    dragHandle(card, "slider-thumb-high", 148, 190);

    const highSetpoint = Number(
      byId(card, "slider-setpoint-high").textContent.replace("°", ""),
    );
    expect(highSetpoint).toBeGreaterThan(24);
    expect(byId(card, "slider-setpoint-low").textContent).toBe("19.0°");
  });

  it("test_tapping_the_track_still_resolves_to_the_nearest_enabled_handle_under_one_line_layout", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity(
      "climate.range",
      { layout: "one-line", slider_width: 55 },
      hass,
    );

    // Tap left of the low handle (x≈104) -> nearest to the low handle, and to its
    // left -> step it down. The high handle stays untouched, same tap
    // resolution/hit-testing as the default layout.
    tapTrack(card, 90);

    expect(byId(card, "slider-setpoint-low").textContent).toBe("18.0°");
    expect(byId(card, "slider-setpoint-high").textContent).toBe("24.0°");
  });

  it("test_no_new_stacked_or_switchable_elements_are_introduced_for_one_line_range_mode", () => {
    // Comparative check: the shadow DOM's set of range-related element ids
    // is identical between default and one-line layout for the same
    // entity — confirms no additional one-line-specific range markup
    // exists.
    const hass1 = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const cardDefault = mountEntity("climate.range", {}, hass1);
    const defaultIds = Array.from(
      cardDefault.shadowRoot.querySelectorAll("[id]"),
    ).map((el) => el.id);
    document.body.innerHTML = "";

    const hass2 = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const cardOneLine = mountEntity(
      "climate.range",
      { layout: "one-line", slider_width: 55 },
      hass2,
    );
    const oneLineIds = Array.from(
      cardOneLine.shadowRoot.querySelectorAll("[id]"),
    ).map((el) => el.id);

    expect(oneLineIds.sort()).toEqual(defaultIds.sort());
  });
});

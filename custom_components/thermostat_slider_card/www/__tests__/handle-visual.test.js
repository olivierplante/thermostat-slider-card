/**
 * `_updateHandlesVisual(values)` is the unified, handle-count-parameterized
 * renderer for fill/thumb/pill across any handle count. This file covers
 * its shared value-to-percent formula and the one-handle hidden-on-null
 * regression case.
 */

import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

// Handle position mirrors the same value-to-percent formula regardless of
// Handle count.
//
// This calls `_updateHandlesVisual` directly (rather than driving it
// indirectly through `_updateDisplay()`'s render pass) specifically to
// assert *implementation sharing*: the identical formula and clamp
// exercised via the SAME code path for a handle in a one-handle render and
// a handle in a two-handle render, not just "same answer" from two
// independently-written expectations.
describe("_updateHandlesVisual shared value-to-percent formula", () => {
  it("test_one_handle_and_two_handle_calls_compute_percent_via_the_identical_shared_formula", () => {
    fc.assert(
      fc.property(
        // Range bounds: min and a strictly-positive span so min < max
        // always holds, regardless of what the entity itself reports.
        fc.double({ noNaN: true, min: -100, max: 100 }),
        fc.double({ noNaN: true, min: 0.1, max: 200 }),
        // Two raw fractions inside [0, 1] of the span; sorted below so
        // low <= high without relying on fc.pre() to discard the
        // unordered half.
        fc.double({ noNaN: true, min: 0, max: 1 }),
        fc.double({ noNaN: true, min: 0, max: 1 }),
        (min, span, lowFrac, highFrac) => {
          const max = min + span;
          const lowRaw = min + lowFrac * span;
          const highRaw = min + highFrac * span;
          const low = Math.min(lowRaw, highRaw);
          const high = Math.max(lowRaw, highRaw);

          const expectedPercent = (numeric) => Math.max(0, Math.min(100,
            ((numeric - min) / (max - min)) * 100));

          // --- One-handle render: a single-setpoint climate entity. ---
          const singleHass = makeHassEntity("climate.single", {
            current_temperature: (min + max) / 2,
            temperature: low,
            min_temp: min,
            max_temp: max,
          }, "heat");
          const singleCard = mountEntity("climate.single", { min, max }, singleHass);

          // Calls the shared method directly, bypassing `_updateDisplay()`,
          // for a one-handle values map: `{ value: <numeric> }`, matching
          // how `_updateDisplay()` itself keys the map it passes in
          // (`values[handle.id] = asNumber(attrs[handle.attr])` for each
          // handle in `this._handles`).
          singleCard._updateHandlesVisual({ value: low });

          const singleFill = byId(singleCard, "slider-fill");
          const singleThumb = byId(singleCard, "slider-thumb");
          expect(singleFill.style.width).toBe(`${expectedPercent(low)}%`);
          expect(singleThumb.style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(`${expectedPercent(low)}%`);

          document.body.innerHTML = "";

          // --- Two-handle render: a climate range entity, same min/max, ---
          // --- same shared method, same `low` value plus a `high`. ---
          const rangeHass = makeHassEntity("climate.range", {
            current_temperature: (min + max) / 2,
            target_temp_low: low,
            target_temp_high: high,
            min_temp: min,
            max_temp: max,
            supported_features: 386,
          }, "heat_cool");
          const rangeCard = mountEntity("climate.range", { min, max }, rangeHass);

          rangeCard._updateHandlesVisual({ low, high });

          const thumbLow = byId(rangeCard, "slider-thumb-low");
          const thumbHigh = byId(rangeCard, "slider-thumb-high");

          expect(thumbLow.style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(`${expectedPercent(low)}%`);
          expect(thumbHigh.style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(`${expectedPercent(high)}%`);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("_updateHandlesVisual: one-handle null regression", () => {
  it("test_missing_target_hides_pill_and_empties_fill_via_updateHandlesVisual", () => {
    // Same fixture/assertions as clamping.test.js's
    // `test_missing_target_hides_pill_and_empties_fill`, against
    // `_updateHandlesVisual` directly. This "missing target hides the
    // pill/thumb" behavior at one handle must stay preserved exactly — one
    // Handle hides everything on a null value, while two handles instead
    // dims-but-shows a disabled handle.
    //
    // Same fixture as clamping.test.js: no `temperature` attribute.
    const hass = makeHassEntity("climate.ch", { current_temperature: 21.8 }, "heat");
    const card = mountEntity("climate.ch", { min: 14, max: 21 }, hass);

    // Call the new unified method directly (not via `_updateDisplay()`), to
    // isolate this method specifically, per resolveHandleSpecs's one-handle
    // branch which uses `id: 'value'`.
    card._updateHandlesVisual({ value: null });

    expect(byId(card, "slider-setpoint").classList.contains("hidden")).toBe(true);
    expect(byId(card, "slider-thumb").classList.contains("hidden")).toBe(true);
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBe(0);
  });
});

describe("_updateHandlesVisual: inside-pill position tracks its own thumb", () => {
  // One-handle case: the fill spans [0, percent], so the "inside" pill
  // centers within that filled region — at half the thumb's own percent.
  // This is the pre-existing single-setpoint behavior; it must be
  // preserved exactly by the unification.
  it("test_one_handle_inside_pill_centers_on_half_its_own_percent", () => {
    const hass = makeHassEntity("climate.single", {
      current_temperature: 20, temperature: 25,
    }, "heat");
    const card = mountEntity("climate.single", { min: 10, max: 30 }, hass);

    // (25-10)/(30-10)*100 = 75%, well above the 12% inside/outside
    // threshold.
    card._updateHandlesVisual({ value: 25 });

    const pill = byId(card, "slider-setpoint");
    expect(pill.classList.contains("inside")).toBe(true);
    expect(parseFloat(pill.style.left)).toBeCloseTo(37.5, 5); // 75 / 2
  });

  // Two-handle case: there is no per-handle fill to center within, so
  // the "inside" pill must
  // instead sit near its own thumb's percent — not at half that percent
  // (which would put a high handle near the max end's pill near the
  // middle of the track instead of near its own thumb) — offset a fixed
  // amount toward the other handle
  // so the pill doesn't draw directly on top of the thumb marker either.
  it("test_two_handle_inside_pill_sits_near_its_own_thumb_not_the_track_midpoint", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 22, target_temp_low: 12, target_temp_high: 28,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    // low: (12-10)/(30-10)*100 = 10% -> outside threshold (below 12%).
    // high: (28-10)/(30-10)*100 = 90% -> well inside.
    card._updateHandlesVisual({ low: 12, high: 28 });

    const highPill = byId(card, "slider-setpoint-high");
    expect(highPill.classList.contains("inside")).toBe(true);
    // Offset from the high handle's own thumb (90%) toward Low by the
    // fixed pill offset — near its own thumb, not the track midpoint
    // (45%, which `percent / 2` would have produced), and not sitting
    // exactly on the thumb either.
    expect(parseFloat(highPill.style.left)).toBeCloseTo(82, 5);
  });

  // Two handles close enough together that offsetting each pill toward
  // the other would make them collide: both relocate fully outside the
  // track instead — Low pushed left of its own thumb, High pushed right
  // of its own thumb — rather than drawing on top of each other or the
  // sibling's thumb marker.
  it("test_crowded_handles_relocate_both_pills_fully_outside_the_track", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 20, target_temp_low: 19, target_temp_high: 21,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    // low: (19-10)/(30-10)*100 = 45%. high: (21-10)/(30-10)*100 = 55%.
    // Gap is 10%, well under the 16%-of-track crowding threshold.
    card._updateHandlesVisual({ low: 19, high: 21 });

    const lowPill = byId(card, "slider-setpoint-low");
    const highPill = byId(card, "slider-setpoint-high");

    expect(lowPill.classList.contains("outside")).toBe(true);
    expect(lowPill.classList.contains("inside")).toBe(false);
    expect(highPill.classList.contains("outside")).toBe(true);
    expect(highPill.classList.contains("inside")).toBe(false);

    // Low pushed left of its own thumb (45% - 16px), High pushed right
    // of its own thumb (55% + 16px) — spread apart rather than both
    // sitting inside the narrow band between the two thumbs.
    expect(lowPill.style.left).toBe("calc(45% - 16px)");
    expect(highPill.style.left).toBe("calc(55% + 16px)");
  });
});

/**
 * Measured two-handle pill placement (`renderPillMeasured`, inside
 * `_updateHandlesVisual`). Real DOM layout numbers (`getBoundingClientRect`)
 * decide whether each Low/High pill fits within its own half of the
 * shared between-handles band, since jsdom returns 0 for all layout by
 * default (no real text metrics), these tests stub
 * `getBoundingClientRect` on `#slider-track` and each pill element to
 * simulate specific pixel dimensions -- that's what opts a test INTO the
 * measured path at all; without a stub, `_updateHandlesVisual` falls back
 * to the pre-existing percent-based placement (covered separately below).
 */
describe("_updateHandlesVisual: measured two-handle pill placement", () => {
  function stubWidth(el, width) {
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: width, bottom: 40, width, height: 40,
    });
  }

  it("test_a_pill_that_fits_its_half_of_the_band_centers_inside_it", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 20, target_temp_low: 12, target_temp_high: 28,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    stubWidth(byId(card, "slider-track"), 300);
    // low: 10%->30px raw fill-boundary (what #slider-fill-between's own
    // `left` uses). Low/High are far apart (240px raw gap), so the
    // shared thumb-shift magnitude is uncapped at its normal 10px (see
    // .slider-thumb-low's own comment: Low's thumb shifts TOWARD the
    // fill, i.e. rightward, so its visual position is 30+10=40px here --
    // the opposite direction from the single-handle/High-handle case).
    // Low's "inside" edge is the more restrictive of the two references:
    // max(30 [fill boundary], 40+2 [thumb right edge]) = 42, plus 6px
    // clearance = 48px.
    // high: 90%->270px raw boundary -> thumb visual 270-10=260px. High's
    // "inside" edge is min(270, 260-2)=258, minus 6px clearance = 252px.
    // mid (of the raw boundaries): (30+270)/2 = 150px.
    // Low's half: [48, 150] = 102px available -- a 40px pill fits
    // comfortably, landing at the region start (48px).
    stubWidth(byId(card, "slider-setpoint-low"), 40);
    stubWidth(byId(card, "slider-setpoint-high"), 40);

    card._updateHandlesVisual({ low: 12, high: 28 });

    const lowPill = byId(card, "slider-setpoint-low");
    expect(lowPill.classList.contains("inside")).toBe(true);
    expect(lowPill.classList.contains("outside")).toBe(false);
    // Anchored to the left edge of its own region (48px) -- which is
    // bound by the thumb's own (rightward-shifted) visual position here,
    // not the fill boundary -- so the number stays clear of the visible
    // thumb bar, not centered across the whole available half.
    expect(lowPill.style.left).toBe("48px");
    expect(lowPill.style.transform).toBe("translateY(-50%)");
  });

  it("test_a_pill_too_wide_for_its_half_of_the_band_relocates_outside_the_track", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 20, target_temp_low: 19, target_temp_high: 21,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    stubWidth(byId(card, "slider-track"), 200);
    // low: 45%->90px raw boundary. high: 55%->110px raw boundary. Raw
    // gap is 20px, so the shared thumb-shift magnitude is capped to
    // min(10, 20/2)=10 -- exactly at the uncapped default here, so this
    // fixture doesn't exercise the cap itself (see the dedicated
    // crowded-thumb-shift test below for that). Low's thumb shifts
    // rightward (toward the fill) to 90+10=100px; High's shifts
    // leftward to 110-10=100px. mid (of raw boundaries): 100px.
    // Low's "inside" region: [max(90,102)+6, 100] = [108, 100] --
    // already inverted (0px available). High's "inside" region: [100,
    // min(110,98)-6] = [100, 92] -- also inverted (0px available). A
    // 40px pill fits neither, so both relocate outside.
    stubWidth(byId(card, "slider-setpoint-low"), 40);
    stubWidth(byId(card, "slider-setpoint-high"), 40);

    card._updateHandlesVisual({ low: 19, high: 21 });

    const lowPill = byId(card, "slider-setpoint-low");
    const highPill = byId(card, "slider-setpoint-high");

    expect(lowPill.classList.contains("outside")).toBe(true);
    expect(lowPill.classList.contains("inside")).toBe(false);
    expect(highPill.classList.contains("outside")).toBe(true);
    expect(highPill.classList.contains("inside")).toBe(false);

    // Low's "outside" edge is the more restrictive of its own fill
    // boundary/thumb-visual pair: min(90, 98) - 6px clearance = 84px,
    // minus the 40px pill width = 44px. High's "outside" edge is
    // max(110, 102) + 6px clearance = 116px. Well clear of the track's
    // own [0, 200] bounds so neither edge clamp kicks in here.
    expect(lowPill.style.left).toBe("44px");
    expect(parseFloat(highPill.style.left)).toBeCloseTo(116, 5);
    expect(lowPill.style.transform).toBe("translateY(-50%)");
    expect(highPill.style.transform).toBe("translateY(-50%)");
  });

  it("test_a_thumb_shift_that_would_cross_the_other_handle_is_capped_to_half_the_real_gap", () => {
    // Regression case for the crossed-thumbs bug: Low and High close
    // enough together (raw gap 8px) that a full, uncapped 10px shift
    // from each toward the other would push Low's thumb PAST High's
    // (and vice versa). The shared shift magnitude must cap to at most
    // half the real gap (4px here), so the two thumbs can approach each
    // other but never swap positions.
    const hass = makeHassEntity("climate.range", {
      current_temperature: 20, target_temp_low: 19.6, target_temp_high: 20.4,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    stubWidth(byId(card, "slider-track"), 200);
    // low: 48%->96px raw boundary. high: 52%->104px raw boundary. Raw
    // gap is 8px, so shift magnitude caps to min(10, 8/2)=4px (not the
    // uncapped 10px, which would put Low's thumb at 106px -- past
    // High's raw boundary of 104px).
    stubWidth(byId(card, "slider-setpoint-low"), 10);
    stubWidth(byId(card, "slider-setpoint-high"), 10);

    card._updateHandlesVisual({ low: 19.6, high: 20.4 });

    const lowThumb = byId(card, "slider-thumb-low");
    const highThumb = byId(card, "slider-thumb-high");

    // Capped magnitude (4px), not the uncapped default (10px).
    expect(parseFloat(lowThumb.style.getPropertyValue("--tsc-thumb-shift-mag")))
      .toBeCloseTo(4, 5);
    expect(parseFloat(highThumb.style.getPropertyValue("--tsc-thumb-shift-mag")))
      .toBeCloseTo(4, 5);
  });

  it("test_an_outside_low_pill_near_the_tracks_own_left_edge_clamps_to_zero_instead_of_spilling_past_the_container", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 10, target_temp_low: 1, target_temp_high: 50,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 0, max: 100 }, hass);

    stubWidth(byId(card, "slider-track"), 100);
    // low: 1%->1px raw boundary -> thumb visual clamps to 8px. high:
    // 50%->50px raw -> thumb visual 40px. mid (of raw boundaries): 25.5.
    // Low's "inside" region: [max(1,10)+6, 25.5] = [16, 25.5] = 9.5px
    // available -- a 40px pill doesn't fit, so Low relocates outside.
    // Its natural position (min(1,6)-6-40 = -45px) would spill past the
    // container's left edge without a clamp.
    stubWidth(byId(card, "slider-setpoint-low"), 40);
    stubWidth(byId(card, "slider-setpoint-high"), 10);

    card._updateHandlesVisual({ low: 1, high: 50 });

    const lowPill = byId(card, "slider-setpoint-low");
    expect(lowPill.classList.contains("outside")).toBe(true);
    expect(lowPill.style.left).toBe("0px");
  });

  it("test_an_outside_high_pill_near_the_tracks_own_right_edge_clamps_to_the_track_width_instead_of_spilling_past_the_container", () => {
    const hass = makeHassEntity("climate.range", {
      current_temperature: 90, target_temp_low: 50, target_temp_high: 99,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 0, max: 100 }, hass);

    stubWidth(byId(card, "slider-track"), 100);
    // low: 50%->50px raw -> thumb visual 40px. high: 99%->99px raw
    // boundary -> thumb visual clamps to 89px. mid (of raw boundaries):
    // 74.5. High's "inside" region: [74.5, min(99,87)-6] = [74.5, 81] =
    // 6.5px available -- a 40px pill doesn't fit, so High relocates
    // outside. Its natural position (max(99,91)+6 = 105px) plus its own
    // 40px width would spill past the container's right edge (100px)
    // without a clamp.
    stubWidth(byId(card, "slider-setpoint-low"), 10);
    stubWidth(byId(card, "slider-setpoint-high"), 40);

    card._updateHandlesVisual({ low: 50, high: 99 });

    const highPill = byId(card, "slider-setpoint-high");
    expect(highPill.classList.contains("outside")).toBe(true);
    // Clamped so the pill's own width still fits within the track:
    // 100px (track) - 40px (pill) = 60px.
    expect(highPill.style.left).toBe("60px");
  });

  it("test_a_wide_open_band_still_anchors_each_pill_near_its_own_thumb_not_the_bands_center", () => {
    // Regression case: both handles pinned to the track's own min/max
    // (e.g. Living Room at 18-27 on an 18-27 range), so the shared band
    // spans the entire track and each handle's "half" is enormous. A
    // pill that fits easily must still sit right next to its own thumb,
    // not drift toward the band's overall center just because there's
    // plenty of room in that direction too.
    const hass = makeHassEntity("climate.range", {
      current_temperature: 24, target_temp_low: 18, target_temp_high: 27,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 18, max: 27 }, hass);

    stubWidth(byId(card, "slider-track"), 300);
    // low: 0%->0px raw fill boundary. Raw gap between Low/High is a full
    // 300px, so the shared thumb-shift magnitude is uncapped at its
    // normal 10px. Low's thumb shifts rightward (toward the fill) to
    // 0+10=10px, clamped to the 8px track-edge floor -> stays 10px
    // (above the floor already). Low's "inside" edge is the more
    // restrictive of the two references: max(0 [fill boundary], 10+2
    // [thumb right edge]) = 12, plus 6px clearance = 18px.
    // high: 100%->300px raw boundary -> thumb visual 300-10=290px,
    // clamped to the 292px track-edge ceiling -> stays 290px. High's
    // "inside" edge is min(300, 290-2)=288, minus 6px clearance = 282px.
    // mid (of raw boundaries): 150px.
    // Low's "inside" region: [18, 150] = 132px available; a 40px pill
    // fits easily, landing at the region start.
    stubWidth(byId(card, "slider-setpoint-low"), 40);
    stubWidth(byId(card, "slider-setpoint-high"), 40);

    card._updateHandlesVisual({ low: 18, high: 27 });

    const lowPill = byId(card, "slider-setpoint-low");
    const highPill = byId(card, "slider-setpoint-high");

    expect(lowPill.classList.contains("inside")).toBe(true);
    expect(highPill.classList.contains("inside")).toBe(true);

    // Anchored right next to each handle's own (shifted) thumb position
    // (18px for Low; 242px = 282px region end - 40px pill width for
    // High), nowhere near the band's midpoint (150px) despite the huge
    // amount of open room in that direction.
    expect(lowPill.style.left).toBe("18px");
    expect(highPill.style.left).toBe("242px");
  });

  it("test_falls_back_to_percent_based_placement_when_the_track_has_no_measured_width", () => {
    // No `getBoundingClientRect` stub at all -- jsdom's default returns
    // a 0-width rect, which must NOT be mistaken for "the track is
    // actually 0px wide" and produce nonsensical measured placement.
    // `_updateHandlesVisual` must recognize this and fall back to the
    // pre-existing percent-based `renderPill` path instead, matching
    // this file's other percent-based-placement tests above.
    const hass = makeHassEntity("climate.range", {
      current_temperature: 22, target_temp_low: 12, target_temp_high: 28,
    }, "heat_cool");
    const card = mountEntity("climate.range", { min: 10, max: 30 }, hass);

    card._updateHandlesVisual({ low: 12, high: 28 });

    const highPill = byId(card, "slider-setpoint-high");
    expect(highPill.classList.contains("inside")).toBe(true);
    // Percent-based left (a bare "%" value), not a measured "px" value --
    // confirms the fallback path ran, not the measured one.
    expect(highPill.style.left).toBe("82%");
  });
});

/**
 * One band, low to high, one color: the colored region is the selected
 * range, and the card resolves one fill color per render.
 *
 * Only `slider-fill-between` (Low%-to-High%) is filled, colored through
 * the exact same `_getModeInfo` resolution the one-handle `#slider-fill`
 * already uses, computed once per `_updateDisplay()` call. Below low and
 * above high stay unfilled, matching the one-handle case's convention
 * that the region beyond the single thumb has no fill.
 *
 * These tests render through `mountEntity`/`card.hass = ...` (not direct
 * `_updateHandlesVisual` calls), since color is now resolved in
 * `_updateDisplay()`, not in `_updateHandlesVisual`.
 */
describe("range-setpoint mode: one band, low to high, one resolved color", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    supported_features: 386,
  };

  it("test_heating_action_resolves_family_raise_on_the_between_band", () => {
    const hass = makeHassEntity(
      "climate.range",
      { ...RANGE_ATTRS, hvac_action: "heating" },
      "heat_cool",
    );
    const card = mountEntity("climate.range", { min: 7, max: 30 }, hass);

    const fillBetween = byId(card, "slider-fill-between");
    expect(fillBetween.classList.contains("family-raise")).toBe(true);

    // The color CSS rules are all compound selectors requiring the base
    // `.slider-fill` class together with the family/mode class (e.g.
    // `.slider-fill.family-raise`). jsdom doesn't compute real CSS
    // cascade, so `classList.contains("family-raise")` alone can pass
    // even if the base class is missing and the color rule would never
    // actually match in a real browser — assert the base class
    // explicitly so this can't regress silently.
    expect(fillBetween.classList.contains("slider-fill")).toBe(true);
  });

  it("test_switching_to_a_cooling_action_resolves_family_lower_instead", () => {
    const hass = makeHassEntity(
      "climate.range",
      { ...RANGE_ATTRS, hvac_action: "heating" },
      "heat_cool",
    );
    const card = mountEntity("climate.range", { min: 7, max: 30 }, hass);
    expect(byId(card, "slider-fill-between").classList.contains("family-raise")).toBe(true);

    card.hass = makeHassEntity(
      "climate.range",
      { ...RANGE_ATTRS, hvac_action: "cooling" },
      "heat_cool",
    );

    const fillBetween = byId(card, "slider-fill-between");
    expect(fillBetween.classList.contains("family-lower")).toBe(true);
    expect(fillBetween.classList.contains("family-raise")).toBe(false);
  });
});

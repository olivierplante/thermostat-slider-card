/**
 * Unified handle-model gesture/render-state coverage: active-handle
 * isolation, drag-cancel revert, and single-active-interaction scoping
 * across any handle set, the track, and long-press.
 *
 * `applyHandleUpdate(renderState, handleId, value, percent)` operates on
 * an arbitrary handle-keyed map — `{ [handleId]: { value, percent } }` —
 * for any number of handle ids, including exactly one (the
 * single-setpoint mode case, where there is no "other handle" at all).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

import {
  applyHandleUpdate,
  resolveHandleRevert,
  resolveInteractionStart,
  resolveTapHandle,
} from "../thermostat-slider-card.js";

// Pixel-position-like generator: tap/handle positions along the track's
// primary axis. Real rendered positions are non-negative, but the resolver
// itself only ever compares distances, so a wider range (including values
// past a track's typical bounds) still exercises the same logic.
const posArb = fc.double({ noNaN: true, min: -1000, max: 1000 });

const handlePoint = fc.record({
  value: fc.double({ noNaN: true, min: -200, max: 200 }),
  percent: fc.double({ noNaN: true, min: 0, max: 100 }),
});

// Handle ids are arbitrary strings, not hardcoded 'low'/'high': the
// function doesn't know or care what the ids are, only that they're keys
// in a map.
const handleIdArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,7}$/);

// A "scenario" is a handle set of size 1-4 (covering both the one-handle
// case and multi-handle cases beyond just two, since the function must
// not special-case exactly two), a render state with one
// entry per handle id, and a designated active handle drawn from that set.
const scenarioArb = fc
  .uniqueArray(handleIdArb, { minLength: 1, maxLength: 4 })
  .chain((ids) => {
    const stateShape = {};
    for (const id of ids) {
      stateShape[id] = handlePoint;
    }
    return fc.record({
      ids: fc.constant(ids),
      renderState: fc.record(stateShape),
      activeIndex: fc.nat({ max: ids.length - 1 }),
    });
  });

const newValueArb = fc.double({ noNaN: true, min: -200, max: 200 });
const newPercentArb = fc.double({ noNaN: true, min: 0, max: 100 });

/**
 * `resolveInteractionStart(activeOrigin, eventOrigin)` — single-active-
 * interaction scoping across any handle set, the track, and long-press.
 * Already fully generic (origin is just a string id) and needs no
 * signature or behavior change to support any handle count.
 */

// Origin tokens used by the existing two-handle/track scenarios.
const rangeOrigin = fc.constantFrom("low", "high", "track");
const rangeOriginOrNull = fc.oneof(rangeOrigin, fc.constant(null));

// One-handle scenario: the sole thumb's origin is `'value'` (matching
// resolveHandleSpecs's one-handle id), competing against a `'track'`
// press — the same two candidate origins `_startHandleGesture` would see
// for a single-setpoint mode entity.
const oneHandleOrigin = fc.constantFrom("value", "track");

describe("resolveInteractionStart", () => {
  it("test_no_active_interaction_lets_the_new_events_origin_become_active", () => {
    fc.assert(
      fc.property(rangeOrigin, (eventOrigin) => {
        const result = resolveInteractionStart(null, eventOrigin);
        expect(result).toBe(eventOrigin);
      }),
      { numRuns: 100 },
    );
  });

  it("test_an_active_interaction_ignores_every_competing_start_event", () => {
    fc.assert(
      fc.property(rangeOrigin, rangeOrigin, (activeOrigin, eventOrigin) => {
        // Regardless of whether the competing event targets the same
        // origin, a different handle, or the track, the active
        // interaction's target never changes mid-interaction.
        const result = resolveInteractionStart(activeOrigin, eventOrigin);
        expect(result).toBe(activeOrigin);
      }),
      { numRuns: 100 },
    );
  });

  it("test_result_is_always_either_the_active_origin_or_the_events_own_origin", () => {
    // A weaker, input-shape-agnostic sanity property: whatever the inputs,
    // the resolver never invents a third origin out of thin air.
    fc.assert(
      fc.property(rangeOriginOrNull, rangeOrigin, (activeOrigin, eventOrigin) => {
        const result = resolveInteractionStart(activeOrigin, eventOrigin);
        expect([activeOrigin, eventOrigin]).toContain(result);
      }),
      { numRuns: 100 },
    );
  });

  it("test_a_sequence_of_competing_events_never_moves_the_active_origin_until_it_ends", () => {
    // Models a full interaction session as a reducer over a sequence of
    // start events, with the caller (not this function) resetting to
    // `null` between sessions when an interaction ends.
    fc.assert(
      fc.property(
        rangeOrigin,
        fc.array(rangeOrigin, { minLength: 0, maxLength: 10 }),
        rangeOrigin,
        (firstOrigin, competingEvents, secondSessionOrigin) => {
          // Session 1: the first event starts the interaction.
          let active = resolveInteractionStart(null, firstOrigin);
          expect(active).toBe(firstOrigin);

          // Every subsequent event, whatever its own origin, is a no-op
          // while this interaction is still active.
          for (const eventOrigin of competingEvents) {
            active = resolveInteractionStart(active, eventOrigin);
            expect(active).toBe(firstOrigin);
          }

          // The interaction ends (caller-driven reset, e.g. drag-end,
          // drag-cancel, or long-press fire/release).
          active = null;

          // Session 2: a fresh event, on any origin, is now free to start
          // a brand-new interaction.
          active = resolveInteractionStart(active, secondSessionOrigin);
          expect(active).toBe(secondSessionOrigin);
        },
      ),
      { numRuns: 100 },
    );
  });

  // One-handle case: a thumb-press at the sole handle followed by a
  // competing track-press is a no-op for the second event, and vice
  // versa — mirroring the existing two-handle assertion above, but with
  // the single-setpoint mode origin pair (`'value'`/`'track'`) instead of
  // `'low'`/`'high'`/`'track'`.
  it("test_a_thumb_press_at_the_sole_handle_and_a_competing_track_press_are_mutually_exclusive", () => {
    fc.assert(
      fc.property(oneHandleOrigin, oneHandleOrigin, (activeOrigin, eventOrigin) => {
        const result = resolveInteractionStart(activeOrigin, eventOrigin);
        expect(result).toBe(activeOrigin);
      }),
      { numRuns: 100 },
    );
  });

  // Concrete examples: a thumb-press at the sole handle, then a competing
  // track-press, is a no-op for the second event — and the reverse.
  it("test_a_thumb_press_at_the_sole_handle_then_a_competing_track_press_is_a_no_op", () => {
    const result = resolveInteractionStart("value", "track");
    expect(result).toBe("value");
  });

  it("test_a_track_press_then_a_competing_thumb_press_at_the_sole_handle_is_a_no_op", () => {
    const result = resolveInteractionStart("track", "value");
    expect(result).toBe("track");
  });
});

describe("applyHandleUpdate", () => {
  // Every key in the render state other than the active handle (zero such
  // keys at one handle, up to three at the largest generated set) must be
  // carried over exactly as it was.
  it("test_every_other_handles_value_and_percent_are_unchanged", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        newValueArb,
        newPercentArb,
        (scenario, newValue, newPercent) => {
          const { ids, renderState, activeIndex } = scenario;
          const activeHandle = ids[activeIndex];
          const otherIds = ids.filter((id) => id !== activeHandle);

          const result = applyHandleUpdate(
            renderState,
            activeHandle,
            newValue,
            newPercent,
          );

          for (const otherId of otherIds) {
            expect(result[otherId]).toEqual(renderState[otherId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_the_active_handles_value_and_percent_reflect_the_update", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        newValueArb,
        newPercentArb,
        (scenario, newValue, newPercent) => {
          const { ids, renderState, activeIndex } = scenario;
          const activeHandle = ids[activeIndex];

          const result = applyHandleUpdate(
            renderState,
            activeHandle,
            newValue,
            newPercent,
          );

          expect(result[activeHandle]).toEqual({
            value: newValue,
            percent: newPercent,
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  // The returned render state has exactly the same set of handle ids as
  // the input, and only the active handle's entry may differ from it.
  it("test_the_resulting_state_has_the_same_handle_ids_and_differs_only_in_the_active_handles_fields", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        newValueArb,
        newPercentArb,
        (scenario, newValue, newPercent) => {
          const { ids, renderState, activeIndex } = scenario;
          const activeHandle = ids[activeIndex];

          const result = applyHandleUpdate(
            renderState,
            activeHandle,
            newValue,
            newPercent,
          );

          expect(Object.keys(result).sort()).toEqual(
            Object.keys(renderState).sort(),
          );

          for (const id of ids) {
            if (id === activeHandle) {
              expect(result[id]).toEqual({ value: newValue, percent: newPercent });
            } else {
              expect(result[id]).toEqual(renderState[id]);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // One-handle case (single-setpoint mode): with a handle set of size one
  // there is no "other handle" to check at all. The function must not
  // throw when the spread has nothing else to carry over, and the result
  // must contain exactly the one updated entry and nothing more.
  it("test_a_single_handle_render_state_updates_that_handle_and_carries_over_nothing_else", () => {
    fc.assert(
      fc.property(
        handleIdArb,
        handlePoint,
        newValueArb,
        newPercentArb,
        (handleId, priorPoint, newValue, newPercent) => {
          const renderState = { [handleId]: priorPoint };

          const result = applyHandleUpdate(
            renderState,
            handleId,
            newValue,
            newPercent,
          );

          expect(result).toEqual({
            [handleId]: { value: newValue, percent: newPercent },
          });
          expect(Object.keys(result)).toEqual([handleId]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * `resolveHandleRevert(renderState, handleId, lastConfirmed)` operates on
 * an arbitrary handle-keyed map — the same spread-based generalization
 * `applyHandleUpdate` applies above. Covers the drag-cancel half of the
 * abandoned-interaction-revert guarantee (the `hass.callService`-rejection
 * half is covered separately, against `_commitHandleValue`'s rejection
 * path, not this function).
 */
describe("resolveHandleRevert", () => {
  it("test_the_reverted_handles_value_and_percent_equal_the_last_confirmed_value", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        handlePoint,
        (scenario, lastConfirmed) => {
          const { ids, renderState, activeIndex } = scenario;
          const revertedHandle = ids[activeIndex];

          const result = resolveHandleRevert(
            renderState,
            revertedHandle,
            lastConfirmed,
          );

          expect(result[revertedHandle]).toEqual(lastConfirmed);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Every key in the render state other than the reverted handle (zero
  // such keys at one handle, up to three at the largest generated set)
  // must be carried over exactly as it was.
  it("test_every_other_handles_value_and_percent_are_unchanged", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        handlePoint,
        (scenario, lastConfirmed) => {
          const { ids, renderState, activeIndex } = scenario;
          const revertedHandle = ids[activeIndex];
          const otherIds = ids.filter((id) => id !== revertedHandle);

          const result = resolveHandleRevert(
            renderState,
            revertedHandle,
            lastConfirmed,
          );

          for (const otherId of otherIds) {
            expect(result[otherId]).toEqual(renderState[otherId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // The returned render state has exactly the same set of handle ids as
  // the input (no added/removed keys of any kind, e.g. no `write`/
  // `pendingWrite`/`serviceCall` field), and each entry has exactly the
  // `{ value, percent }` render fields — nothing a caller could act on
  // except re-rendering.
  it("test_the_resulting_state_has_the_same_handle_ids_and_no_write_related_field", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        handlePoint,
        (scenario, lastConfirmed) => {
          const { ids, renderState, activeIndex } = scenario;
          const revertedHandle = ids[activeIndex];

          const result = resolveHandleRevert(
            renderState,
            revertedHandle,
            lastConfirmed,
          );

          expect(Object.keys(result).sort()).toEqual(
            Object.keys(renderState).sort(),
          );

          for (const id of ids) {
            expect(Object.keys(result[id]).sort()).toEqual(["percent", "value"]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // If the last confirmed value happens to equal the handle's current
  // render-state entry, the revert is still well-defined and idempotent.
  it("test_reverting_to_the_handles_own_prior_value_is_a_no_op", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { ids, renderState, activeIndex } = scenario;
        const revertedHandle = ids[activeIndex];

        const result = resolveHandleRevert(
          renderState,
          revertedHandle,
          renderState[revertedHandle],
        );

        expect(result).toEqual(renderState);
      }),
      { numRuns: 100 },
    );
  });

  // One-handle case (single-setpoint mode): with a handle set of size one
  // there is no "other handle" to check at all. Calling
  // `resolveHandleRevert(renderState, 'value', lastConfirmed)` must not
  // throw and must return exactly `{ value: lastConfirmed }`, with no other
  // key present.
  it("test_a_single_handle_render_state_reverts_that_handle_and_carries_over_nothing_else", () => {
    fc.assert(
      fc.property(handlePoint, handlePoint, (priorPoint, lastConfirmed) => {
        const renderState = { value: priorPoint };

        const result = resolveHandleRevert(renderState, "value", lastConfirmed);

        expect(result).toEqual({ value: lastConfirmed });
        expect(Object.keys(result)).toEqual(["value"]);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * `resolveTapHandle(tapX, positions, enabledMask)` — `positions`/
 * `enabledMask` are handle-id-keyed maps, so the resolver iterates the
 * current handle set instead of branching on two hardcoded `low`/`high`
 * ids.
 *
 * This describe block covers the one-handle collapse; the two-handle
 * coverage follows below.
 */
describe("resolveTapHandle (one-handle collapse)", () => {
  // For any tap position and a handle set of size one, the resolver
  // always returns that sole handle's id, regardless of how far the tap
  // lands from it. Handle id is generated arbitrarily (not hardcoded to
  // 'value') since the function must not special-case any particular id
  // string — see `handleIdArb`'s comment above.
  it("test_a_single_handle_positions_map_always_resolves_to_that_handle_regardless_of_distance", () => {
    fc.assert(
      fc.property(
        handleIdArb,
        posArb,
        posArb,
        fc.boolean(),
        (handleId, tapX, handlePos, enabled) => {
          const positions = { [handleId]: handlePos };
          const enabledMask = { [handleId]: enabled };

          const result = resolveTapHandle(tapX, positions, enabledMask);

          expect(result).toBe(handleId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Concrete example using the single-setpoint mode handle id ('value')
  // that `resolveHandleSpecs` assigns to every non-range render.
  it("test_the_sole_value_handle_always_resolves_regardless_of_tap_position", () => {
    fc.assert(
      fc.property(posArb, posArb, (tapX, handlePos) => {
        const result = resolveTapHandle(
          tapX,
          { value: handlePos },
          { value: true },
        );

        expect(result).toBe("value");
      }),
      { numRuns: 100 },
    );
  });

  //
  // Explicit far-distance example: even when the tap lands nowhere near
  // the sole handle's rendered position, that handle is still the result —
  // there is no "nearest" comparison possible or meaningful with only one
  // candidate, and the resolver must not, for example, fall through to an
  // `undefined`/`null` result or throw when there's no second handle to
  // compare against.
  it("test_a_tap_far_from_the_sole_handle_still_resolves_to_it", () => {
    const result = resolveTapHandle(100000, { value: 0 }, { value: true });
    expect(result).toBe("value");
  });
});

/**
 * Two-handle `resolveTapHandle` coverage, against the map-based signature:
 *   resolveTapHandle(tapX, positions, enabledMask)
 * where `positions`/`enabledMask` are `{ [id]: number|boolean }` maps
 * keyed by handle id (`'low'`/`'high'` for the two-handle case, matching
 * `resolveHandleSpecs`'s two-handle branch and iteration order).
 */

const enabledBoth = { low: true, high: true };
const enabledOnlyLow = { low: true, high: false };
const enabledOnlyHigh = { low: false, high: true };
const enabledNeither = { low: false, high: false };

describe("resolveTapHandle (two-handle, map-based signature)", () => {
  it("test_both_enabled_returns_the_handle_with_the_smaller_distance", () => {
    fc.assert(
      fc.property(posArb, posArb, posArb, (tapX, lowPos, highPos) => {
        // Skip exact ties here — that's its own property below with its
        // own deterministic (not distance-based) expectation.
        fc.pre(Math.abs(tapX - lowPos) !== Math.abs(tapX - highPos));

        const positions = { low: lowPos, high: highPos };
        const result = resolveTapHandle(tapX, positions, enabledBoth);

        const lowDist = Math.abs(tapX - lowPos);
        const highDist = Math.abs(tapX - highPos);
        const expected = lowDist < highDist ? "low" : "high";

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("test_exact_tie_always_resolves_to_low_handle", () => {
    fc.assert(
      fc.property(posArb, posArb, (lowPos, highPos) => {
        const tapX = (lowPos + highPos) / 2; // exactly equidistant from both
        const positions = { low: lowPos, high: highPos };

        const result = resolveTapHandle(tapX, positions, enabledBoth);

        expect(result).toBe("low");
      }),
      { numRuns: 100 },
    );
  });

  it("test_only_low_enabled_always_returns_low_regardless_of_distance", () => {
    fc.assert(
      fc.property(posArb, posArb, posArb, (tapX, lowPos, highPos) => {
        const positions = { low: lowPos, high: highPos };
        const result = resolveTapHandle(tapX, positions, enabledOnlyLow);
        expect(result).toBe("low");
      }),
      { numRuns: 100 },
    );
  });

  // Concrete example reinforcing the property above — tap lands right on
  // top of the (disabled) high handle, yet the low handle — the only enabled
  // one — must still be returned.
  it("test_only_low_enabled_wins_even_when_tap_is_much_closer_to_high", () => {
    const result = resolveTapHandle(100, { low: 0, high: 100 }, enabledOnlyLow);
    expect(result).toBe("low");
  });

  it("test_only_high_enabled_always_returns_high_regardless_of_distance", () => {
    fc.assert(
      fc.property(posArb, posArb, posArb, (tapX, lowPos, highPos) => {
        const positions = { low: lowPos, high: highPos };
        const result = resolveTapHandle(tapX, positions, enabledOnlyHigh);
        expect(result).toBe("high");
      }),
      { numRuns: 100 },
    );
  });

  it("test_only_high_enabled_wins_even_when_tap_is_much_closer_to_low", () => {
    const result = resolveTapHandle(0, { low: 0, high: 100 }, enabledOnlyHigh);
    expect(result).toBe("high");
  });

  // Neither handle enabled shouldn't normally reach the resolver at all
  // (both attribute values missing means both would already be excluded
  // from interaction), but `resolveTapHandle` still needs *some* defined
  // behavior here rather than an unspecified crash if a caller ever
  // invokes it in that state: fall back to plain nearest-by-distance, tie
  // still resolving to the low handle.
  it("test_neither_enabled_falls_back_to_nearest_by_distance", () => {
    fc.assert(
      fc.property(posArb, posArb, posArb, (tapX, lowPos, highPos) => {
        fc.pre(Math.abs(tapX - lowPos) !== Math.abs(tapX - highPos));

        const positions = { low: lowPos, high: highPos };
        const result = resolveTapHandle(tapX, positions, enabledNeither);

        const lowDist = Math.abs(tapX - lowPos);
        const highDist = Math.abs(tapX - highPos);
        const expected = lowDist < highDist ? "low" : "high";

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("test_neither_enabled_and_tied_distance_still_resolves_to_low", () => {
    fc.assert(
      fc.property(posArb, posArb, (lowPos, highPos) => {
        const tapX = (lowPos + highPos) / 2;
        const positions = { low: lowPos, high: highPos };
        const result = resolveTapHandle(tapX, positions, enabledNeither);
        expect(result).toBe("low");
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * `_onHandleGesture(e)` — Card-level integration coverage for active-handle
 * isolation, through the unified gesture pipeline.
 *
 * This complements the pure-function-level `applyHandleUpdate` coverage
 * above: that coverage proves the *pure resolver* never mutates another
 * Handle's entry in a render-state map. This describe block proves the
 * same isolation guarantee holds one level up, through the real Card
 * method that calls `applyHandleUpdate` as part of a real DOM-mounted
 * drag-move event — i.e. that `_onHandleGesture` wires the pure function in
 * correctly, rather than, say, accidentally recomputing or touching the
 * other handle's DOM elements directly.
 *
 * Each test first calls `card._startHandleGesture(e, handle, origin)` to
 * put the card into a real dragging state — `_activeOrigin`/
 * `_activeHandle`/`_confirmedState`/`_renderState`/`_isDragging`/
 * `_dragStartX`/`_dragStartY`/`_dragMoved` are all populated exactly as a
 * real thumb press would leave them — before
 * simulating a drag-move and calling `_onHandleGesture` on it. This mirrors
 * how a real pointer-down followed by pointer-move would drive the pair of
 * methods in production.
 *
 * Events are plain objects shaped like a MouseEvent (`{ clientX, clientY,
 * touches: undefined, preventDefault, stopPropagation }`) rather than real
 * dispatched DOM events, calling the Card's gesture methods directly.
 */
describe("_onHandleGesture (Card-level integration): active-handle isolation", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  const SINGLE_ATTRS = {
    current_temperature: 20,
    temperature: 18,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 385,
  };

  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  // A plain-object stand-in for a MouseEvent, carrying exactly what
  // `_startHandleGesture`/`_onHandleGesture`'s eventual implementation
  // needs: `clientX`/`clientY` for position/2D-displacement math,
  // `touches: undefined` so the `e.touches ? e.touches[0] : e` branch both
  // methods use takes the mouse-event path, and no-op
  // `preventDefault`/`stopPropagation` since `_startHandleGesture` already
  // calls both unconditionally.
  function fakeEvent(clientX, clientY = 0) {
    return {
      clientX,
      clientY,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The low handle's starting rendered position on the 200px/[7,30] fixture
  // above: (19-7)/23*100 ≈ 52.17% -> x ≈ 104.35.
  const LOW_START_X = 104;

  // Two-handle case, up to the Card-integration level: drags the low handle
  // via the real `_startHandleGesture`/`_onHandleGesture` pair and asserts
  // The high handle's rendered pill text and thumb position are byte-identical
  // before and after, while the low handle's own rendered state is free to
  // change.
  it("test_dragging_low_handle_never_changes_high_handles_rendered_dom_state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          // Only exercise real drag-moves: the 10px 2D-displacement slop
          // check means anything closer than that to the gesture's start
          // position is not yet a "moved" drag and is expected to leave
          // the render state untouched — a separate concern from the
          // isolation guarantee, not what this test targets.
          fc.pre(Math.abs(moveClientX - LOW_START_X) > 10);

          const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
          const card = mountEntity("climate.range", {}, hass);
          stubTrackRect(card);

          const highPillBefore = byId(card, "slider-setpoint-high").textContent;
          const highThumbPosBefore = byId(card, "slider-thumb-high")
            .style.getPropertyValue("--tsc-thumb-pos");

          card._startHandleGesture(fakeEvent(LOW_START_X, 0), "low", "thumb:low");
          card._onHandleGesture(fakeEvent(moveClientX, 0));

          // The high handle's rendered pill and thumb position must remain
          // EXACTLY unchanged by a low handle gesture.
          expect(byId(card, "slider-setpoint-high").textContent).toBe(highPillBefore);
          expect(byId(card, "slider-thumb-high").style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(highThumbPosBefore);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });

  //
  // Companion assertion to the test above: the active handle (low handle)
  // itself IS expected to change as a result of its own drag-move — this
  // isn't tested by the isolation property alone, but confirms the test
  // fixture/gesture actually exercises a real drag-update rather than a
  // no-op, so the "High unchanged" assertion above is meaningful and not
  // vacuously true because nothing moved at all.
  it("test_dragging_low_handle_does_change_low_handles_own_rendered_dom_state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          fc.pre(Math.abs(moveClientX - LOW_START_X) > 10);

          const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
          const card = mountEntity("climate.range", {}, hass);
          stubTrackRect(card);

          const lowPillBefore = byId(card, "slider-setpoint-low").textContent;
          const lowThumbPosBefore = byId(card, "slider-thumb-low")
            .style.getPropertyValue("--tsc-thumb-pos");

          card._startHandleGesture(fakeEvent(LOW_START_X, 0), "low", "thumb:low");
          card._onHandleGesture(fakeEvent(moveClientX, 0));

          const lowPillAfter = byId(card, "slider-setpoint-low").textContent;
          const lowThumbPosAfter = byId(card, "slider-thumb-low")
            .style.getPropertyValue("--tsc-thumb-pos");

          const changed = lowPillAfter !== lowPillBefore
            || lowThumbPosAfter !== lowThumbPosBefore;
          expect(changed).toBe(true);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });

  // One-handle case (single-setpoint mode): with a handle set of size one
  // there is no "other handle" to check at all. This confirms
  // `_onHandleGesture` doesn't throw/misbehave when the isolation
  // guarantee's "other handle" concept is vacuous, and that the sole
  // Handle's own rendered state still changes in response to its own
  // drag-move.
  it("test_one_handle_drag_move_updates_the_sole_handle_and_does_not_throw", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          // single-setpoint mode's starting rendered position on this
          // fixture: temperature 18 in [7,30] -> (18-7)/23*100 ≈ 47.8% ->
          // x ≈ 95.65.
          const startX = 96;
          fc.pre(Math.abs(moveClientX - startX) > 10);

          const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
          const card = mountEntity("climate.single", {}, hass);
          stubTrackRect(card);

          const pillBefore = byId(card, "slider-setpoint").textContent;
          const thumbPosBefore = byId(card, "slider-thumb")
            .style.getPropertyValue("--tsc-thumb-pos");

          card._startHandleGesture(fakeEvent(startX, 0), "value", "thumb:value");
          card._onHandleGesture(fakeEvent(moveClientX, 0));

          const pillAfter = byId(card, "slider-setpoint").textContent;
          const thumbPosAfter = byId(card, "slider-thumb")
            .style.getPropertyValue("--tsc-thumb-pos");

          const changed = pillAfter !== pillBefore || thumbPosAfter !== thumbPosBefore;
          expect(changed).toBe(true);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * `_cancelHandleGesture()` — Card-level integration coverage for the
 * drag-cancel half of the abandoned-interaction-revert guarantee:
 * abandoned interactions always revert to the last confirmed value.
 *
 * This complements the pure-function-level `resolveHandleRevert` coverage
 * above: that coverage proves the *pure resolver* always returns
 * `{ [handleId]: lastConfirmed, ...rest unchanged }`. This describe block
 * proves the same guarantee holds one level up, through the real Card
 * method that calls `resolveHandleRevert` as part of a real DOM-mounted
 * pointer-cancel event — i.e. that `_cancelHandleGesture` wires the pure
 * function in correctly and actually re-renders the DOM to reflect the
 * revert.
 * `resolveHandleRevert` in `_cancelHandleGesture`: pointer-cancel shares
 * `resolveHandleRevert` with the rejection path in `_commitHandleValue`.
 *
 * Each test first calls `card._startHandleGesture(e, handle, origin)` and
 * then `card._onHandleGesture(e)` with a different `clientX` to actually
 * move the handle away from its last-confirmed rendered value, so the
 * eventual revert assertion is meaningful rather than vacuously true
 * because nothing changed.
 *
 * Events are plain objects shaped like a MouseEvent, matching this file's
 * existing `_onHandleGesture` describe block's `fakeEvent` helper.
 */
describe("_cancelHandleGesture (Card-level integration): drag-cancel revert", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  const SINGLE_ATTRS = {
    current_temperature: 20,
    temperature: 18,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 385,
  };

  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  // Same plain-object MouseEvent stand-in the `_onHandleGesture` describe
  // block above uses.
  function fakeEvent(clientX, clientY = 0) {
    return {
      clientX,
      clientY,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The low handle's starting rendered position on the 200px/[7,30] fixture
  // above: (19-7)/23*100 ≈ 52.17% -> x ≈ 104.35. Same fixture/position the
  // `_onHandleGesture` describe block above uses.
  const LOW_START_X = 104;

  // Two-handle case, up to the Card-integration level: drags the low handle
  // away from its last confirmed value (19), cancels, and asserts
  // The low handle's rendered pill reverts to exactly "19.0°" while
  // The high handle's rendered pill and thumb position stay completely
  // unaffected throughout — both during the drag and after the cancel.
  it("test_cancelling_a_low_handle_drag_reverts_low_handle_to_last_confirmed_value_and_leaves_high_handle_untouched", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          // Only exercise real drag-moves: anything within the 10px
          // 2D-displacement slop threshold never updates the render state
          // in the first place, which would make the eventual revert
          // assertion vacuously true rather than a genuine test of
          // reversion.
          fc.pre(Math.abs(moveClientX - LOW_START_X) > 10);

          const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
          const card = mountEntity("climate.range", {}, hass);
          stubTrackRect(card);

          const highPillBefore = byId(card, "slider-setpoint-high").textContent;
          const highThumbPosBefore = byId(card, "slider-thumb-high")
            .style.getPropertyValue("--tsc-thumb-pos");

          card._startHandleGesture(fakeEvent(LOW_START_X, 0), "low", "thumb:low");
          card._onHandleGesture(fakeEvent(moveClientX, 0));

          // Sanity: the drag-move must have actually changed the low handle's
          // rendered pill away from the last-confirmed "19.0°" — otherwise
          // the revert assertion below wouldn't prove anything.
          const lowPillDuringDrag = byId(card, "slider-setpoint-low").textContent;
          expect(lowPillDuringDrag).not.toBe("19.0°");

          // The high handle must already be untouched mid-drag, before the
          // cancel even happens.
          expect(byId(card, "slider-setpoint-high").textContent).toBe(highPillBefore);
          expect(byId(card, "slider-thumb-high").style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(highThumbPosBefore);

          card._cancelHandleGesture();

          // Drag-cancel half: the low handle's displayed pill equals the
          // entity's last confirmed target_temp_low (19), not the
          // abandoned moved-to value.
          expect(byId(card, "slider-setpoint-low").textContent).toBe("19.0°");

          // The high handle's rendered pill and thumb position remain EXACTLY
          // unchanged by a low handle gesture and its cancellation.
          expect(byId(card, "slider-setpoint-high").textContent).toBe(highPillBefore);
          expect(byId(card, "slider-thumb-high").style.getPropertyValue("--tsc-thumb-pos"))
            .toBe(highThumbPosBefore);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });

  // One-handle case (single-setpoint mode): `slider.test.js` covers a
  // completed drag-to-debounced-write and an unavailable-blocks-drag
  // case, but no test exercises pointer-cancel/abandonment for the
  // one-handle case anywhere else in the suite. That coverage is added
  // here, against the unified `_cancelHandleGesture`.
  it("test_cancelling_a_one_handle_drag_reverts_to_the_last_confirmed_value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          // single-setpoint mode's starting rendered position on this
          // fixture: temperature 18 in [7,30] -> (18-7)/23*100 ≈ 47.8% ->
          // x ≈ 95.65. Same fixture/position the `_onHandleGesture`
          // describe block above uses.
          const startX = 96;
          fc.pre(Math.abs(moveClientX - startX) > 10);

          const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
          const card = mountEntity("climate.single", {}, hass);
          stubTrackRect(card);

          card._startHandleGesture(fakeEvent(startX, 0), "value", "thumb:value");
          card._onHandleGesture(fakeEvent(moveClientX, 0));

          // Sanity: the drag-move must have actually changed the sole
          // Handle's rendered pill away from the last-confirmed "18.0°".
          const pillDuringDrag = byId(card, "slider-setpoint").textContent;
          expect(pillDuringDrag).not.toBe("18.0°");

          card._cancelHandleGesture();

          // Drag-cancel half, one-handle case: the sole handle's displayed
          // pill equals the entity's last confirmed temperature (18), not
          // the abandoned moved-to value.
          expect(byId(card, "slider-setpoint").textContent).toBe("18.0°");

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * `_endHandleGesture()` — Card-level integration coverage: toggle-consumes-
 * the-gesture behavior, the tap-vs-drag branch calling `_handleTap`, and
 * the debounce window start on a real drag-end leading into
 * `_commitHandleValue`.
 *
 * Tests that don't care about `_handleTap`/`_commitHandleValue`'s own
 * behavior stub them via `vi.fn()` before calling `_endHandleGesture`, to
 * isolate `_endHandleGesture`'s own dispatch logic from those methods'
 * internals.
 *
 * Uses fake timers (per the existing convention in `long-press.test.js`/
 * `slider.test.js`) to assert the debounce window's actual delay before
 * `_commitHandleValue` fires.
 */
describe("_endHandleGesture", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  const SINGLE_ATTRS = {
    current_temperature: 20,
    temperature: 18,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 385,
  };

  // Matches the 200px-wide track fixture this file's other Card-level
  // describe blocks already use.
  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  // Same plain-object MouseEvent stand-in this file's other Card-level
  // describe blocks already use.
  function fakeEvent(clientX, clientY = 0) {
    return {
      clientX,
      clientY,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // The low handle's starting rendered position on the 200px/[7,30] fixture
  // above: (19-7)/23*100 ≈ 52.17% -> x ≈ 104.35. Same fixture/position
  // this file's other Card-level describe blocks use.
  const LOW_START_X = 104;

  // single-setpoint mode's starting rendered position on the same fixture:
  // temperature 18 in [7,30] -> (18-7)/23*100 ≈ 47.8% -> x ≈ 95.65.
  const SINGLE_START_X = 96;

  //
  // Two-handle case: a real drag-end (moved past the 10px threshold) on
  // The low handle starts the debounce window and, once it elapses, calls a
  // stubbed `_commitHandleValue` with the resolved handle id and the
  // The active handle's current render-state value.
  it("test_a_real_two_handle_drag_end_starts_the_debounce_window_then_commits_the_dragged_handles_value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          fc.pre(Math.abs(moveClientX - LOW_START_X) > 10);

          const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
          const card = mountEntity("climate.range", {}, hass);
          stubTrackRect(card);
          card._commitHandleValue = vi.fn();

          card._startHandleGesture(fakeEvent(LOW_START_X, 0), "low", "thumb:low");
          card._onHandleGesture(fakeEvent(moveClientX, 0));
          const expectedValue = card._renderState.low.value;

          card._endHandleGesture();

          // No commit before the debounce window elapses.
          expect(card._commitHandleValue).not.toHaveBeenCalled();

          vi.advanceTimersByTime(500);

          expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
          expect(card._commitHandleValue).toHaveBeenCalledWith("low", expectedValue);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });

  //
  // Two-handle case: a tap (no movement) on the track resolves a handle
  // via `resolveTapHandle` and calls a stubbed `_handleTap` with that
  // handle id, with no debounce window/commit involved.
  it("test_a_two_handle_track_tap_with_no_movement_resolves_a_handle_and_calls_handle_tap", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();
    card._commitHandleValue = vi.fn();

    // A tap near the low handle's rendered position (x=104), never moved past
    // the 10px slop threshold.
    card._startHandleGesture(fakeEvent(LOW_START_X, 0), null, "track");
    card._onHandleGesture(fakeEvent(LOW_START_X + 2, 0));

    card._endHandleGesture();

    expect(card._handleTap).toHaveBeenCalledTimes(1);
    expect(card._handleTap).toHaveBeenCalledWith("low");
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(card._commitHandleValue).not.toHaveBeenCalled();
  });

  //
  // Two-handle case: a tap nearer the high handle's rendered position resolves
  // to the high handle instead, confirming the resolved handle passed to
  // `_handleTap` genuinely comes from `resolveTapHandle`'s distance
  // comparison rather than a hardcoded 'low'.
  it("test_a_two_handle_track_tap_nearer_high_handle_calls_handle_tap_with_high", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();

    // The high handle's rendered position: (24-7)/23*100 ≈ 73.9% -> x ≈ 147.8.
    const HIGH_START_X = 148;
    card._startHandleGesture(fakeEvent(HIGH_START_X, 0), null, "track");
    card._onHandleGesture(fakeEvent(HIGH_START_X + 2, 0));

    card._endHandleGesture();

    expect(card._handleTap).toHaveBeenCalledTimes(1);
    expect(card._handleTap).toHaveBeenCalledWith("high");
  });

  //
  // One-handle case (single-setpoint mode): a real drag-end on the sole
  // Handle starts the debounce window and commits with the sole handle's
  // id ('value').
  it("test_a_real_one_handle_drag_end_starts_the_debounce_window_then_commits_the_sole_handles_value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        (moveClientX) => {
          fc.pre(Math.abs(moveClientX - SINGLE_START_X) > 10);

          const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
          const card = mountEntity("climate.single", {}, hass);
          stubTrackRect(card);
          card._commitHandleValue = vi.fn();

          card._startHandleGesture(fakeEvent(SINGLE_START_X, 0), "value", "thumb:value");
          card._onHandleGesture(fakeEvent(moveClientX, 0));
          const expectedValue = card._renderState.value.value;

          card._endHandleGesture();
          vi.advanceTimersByTime(500);

          expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
          expect(card._commitHandleValue).toHaveBeenCalledWith("value", expectedValue);

          document.body.innerHTML = "";
        },
      ),
      { numRuns: 100 },
    );
  });

  //
  // One-handle case (single-setpoint mode): a tap (no movement) on the
  // sole handle's thumb calls the stubbed `_handleTap` with 'value', the
  // sole handle's id.
  it("test_a_one_handle_tap_with_no_movement_calls_handle_tap_with_value", () => {
    const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();
    card._commitHandleValue = vi.fn();

    card._startHandleGesture(fakeEvent(SINGLE_START_X, 0), "value", "thumb:value");
    card._onHandleGesture(fakeEvent(SINGLE_START_X + 2, 0));

    card._endHandleGesture();

    expect(card._handleTap).toHaveBeenCalledTimes(1);
    expect(card._handleTap).toHaveBeenCalledWith("value");
    expect(card._commitHandleValue).not.toHaveBeenCalled();
  });

  //
  // Toggle-fired case: when the long-press already fired (consuming the
  // gesture), neither `_handleTap` nor `_commitHandleValue` is called on
  // release, and no debounce window is started.
  it("test_a_toggle_fired_gesture_calls_neither_handle_tap_nor_commit_handle_value", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();
    card._commitHandleValue = vi.fn();
    // Prevent the real toggle service call from mattering to this test;
    // `_fireToggle` itself is untouched and still does its own thing, but
    // we only care that `_endHandleGesture` doesn't also fire a tap/commit
    // on top of it.
    hass.callService = vi.fn();

    card._startHandleGesture(fakeEvent(LOW_START_X, 0), "low", "thumb:low");
    // Motionless hold for the full long-press window: fires the toggle,
    // which sets `_toggleFired = true` and consumes the gesture.
    vi.advanceTimersByTime(1000);

    card._endHandleGesture();
    vi.advanceTimersByTime(1000);

    expect(card._handleTap).not.toHaveBeenCalled();
    expect(card._commitHandleValue).not.toHaveBeenCalled();
  });

  // A moved two-handle track press resolves its nearest handle at press
  // time and drags it like a thumb press would — a track press is no
  // longer tap-only. Pressing near the low handle and dragging commits a
  // drag on Low, not an abandoned gesture.
  it("test_a_moved_two_handle_track_press_drags_the_nearest_resolved_handle", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();
    card._commitHandleValue = vi.fn();

    card._startHandleGesture(fakeEvent(LOW_START_X, 0), null, "track");
    expect(card._activeHandle).toBe("low");

    // Move well past the 10px slop threshold.
    card._onHandleGesture(fakeEvent(LOW_START_X + 50, 0));
    const expectedValue = card._renderState.low.value;

    card._endHandleGesture();
    expect(card._handleTap).not.toHaveBeenCalled();
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("low", expectedValue);
  });

  // Companion to the test above: a track press nearer the high handle's
  // rendered position resolves and drags High instead, confirming the
  // resolved-at-press-time handle genuinely comes from `resolveTapHandle`'s
  // distance comparison rather than always defaulting to Low.
  it("test_a_moved_two_handle_track_press_near_high_drags_high", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._commitHandleValue = vi.fn();

    // The high handle's rendered position: (24-7)/23*100 ≈ 73.9% -> x ≈ 147.8.
    const HIGH_START_X = 148;
    card._startHandleGesture(fakeEvent(HIGH_START_X, 0), null, "track");
    expect(card._activeHandle).toBe("high");

    card._onHandleGesture(fakeEvent(HIGH_START_X - 50, 0));
    const expectedValue = card._renderState.high.value;

    card._endHandleGesture();
    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("high", expectedValue);
  });

  // A track press near a currently-disabled handle (non-numeric
  // attribute) resolves to the other, enabled handle instead — per
  // `resolveTapHandle`'s disabled-handle fallback — rather than starting
  // a drag on the disabled one.
  it("test_a_track_press_near_a_disabled_handle_resolves_to_the_enabled_one_instead", () => {
    const hass = makeHassEntity("climate.range", {
      ...RANGE_ATTRS, target_temp_high: null,
    }, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);

    // Press near where High would have rendered (disabled handles render
    // at Low's percent as a fallback position, so this is also near
    // Low's own rendered position on this fixture).
    card._startHandleGesture(fakeEvent(LOW_START_X, 0), null, "track");

    expect(card._isDragging).toBe(true);
    expect(card._activeHandle).toBe("low");
  });

  // A track press when every handle is disabled (both attributes
  // non-numeric) never starts an interaction — there is no enabled
  // Handle for it to resolve to and drag.
  it("test_a_track_press_with_every_handle_disabled_never_starts_dragging", () => {
    const hass = makeHassEntity("climate.range", {
      ...RANGE_ATTRS, target_temp_low: null, target_temp_high: null,
    }, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);

    card._startHandleGesture(fakeEvent(LOW_START_X, 0), null, "track");

    expect(card._isDragging).toBe(false);
    expect(card._activeHandle).toBe(null);
  });

  // Calling `_endHandleGesture` when no gesture is in progress
  // (`_isDragging` false) is a no-op.
  it("test_calling_end_handle_gesture_with_no_active_gesture_is_a_no_op", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._handleTap = vi.fn();
    card._commitHandleValue = vi.fn();

    expect(() => card._endHandleGesture()).not.toThrow();
    expect(card._handleTap).not.toHaveBeenCalled();
    expect(card._commitHandleValue).not.toHaveBeenCalled();
  });
});

/**
 * `_handleTap(handleId)` — Card-integration re-proof of `slider.test.js`'s
 * `test_tap_right_of_setpoint_steps_up`, driven through the unified
 * `_startHandleGesture`/`_endHandleGesture` pair (calling the methods
 * directly rather than dispatching real DOM events, per this file's
 * established Card-level integration pattern) instead of the original
 * DOM-dispatch test. Same fixture (min 14, max 21, step 0.5, temperature
 * 16, tap at x=150 on a 200px track — well right of the setpoint's ~28.6%
 * rendered position) and same expected outcome (a debounced write of
 * 16.5), proving the unified pipeline reproduces the pre-existing
 * tap-to-step behavior exactly.
 */
describe("_handleTap (Card-level integration, one-handle collapse)", () => {
  const SINGLE_ATTRS = {
    current_temperature: 18.8,
    temperature: 16,
    min_temp: 14,
    max_temp: 21,
    target_temp_step: 0.5,
  };

  // Same 200px-wide track fixture convention this file's other Card-level
  // describe blocks use.
  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  // Same plain-object MouseEvent stand-in this file's other Card-level
  // describe blocks use.
  function fakeEvent(clientX, clientY = 0) {
    return {
      clientX,
      clientY,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // Setpoint 16 -> currentPercent ~28.6% -> x=57px, tap at x=150, well
  // right -> steps up to 16.5 after the 500ms debounce, through the
  // unified `_startHandleGesture`/`_endHandleGesture` pipeline (which
  // internally calls `_handleTap`).
  it("test_tap_right_of_setpoint_steps_up", () => {
    const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);
    stubTrackRect(card);

    // A motionless tap at x=150 on the sole handle's track: never moves
    // past the 10px slop threshold, so `_endHandleGesture` takes the tap
    // branch and calls `_handleTap('value')`.
    card._startHandleGesture(fakeEvent(150, 0), null, "track");
    card._endHandleGesture();

    // `_handleTap` starts the debounce window.
    expect(card._debounceTimer).toBeTruthy();

    vi.advanceTimersByTime(500);

    expect(hass.calls).toHaveLength(1);
    expect(hass.calls[0].data.temperature).toBe(16.5);
  });
});

/**
 * `_handleTap(handleId)` — direct coverage, exercised end to end (step
 * direction, min-gap clamping at two handles, render-state update, and
 * debounce window -> `_commitHandleValue`). Every test here stubs
 * `card._commitHandleValue = vi.fn()` before calling `_handleTap`
 * (directly, or via a `_startHandleGesture` setup step that only
 * snapshots state and sets `_dragStartX`, mirroring how
 * `_endHandleGesture` would have driven it), to isolate `_handleTap`'s own
 * logic from `_commitHandleValue`'s internals.
 */
describe("_handleTap (direct, stubbed _commitHandleValue)", () => {
  const RANGE_ATTRS = {
    current_temperature: 22.7,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  // A narrower low/high gap so stepping the low handle up actually collides
  // with the one-resolved-step minimum gap against the high handle.
  const TIGHT_GAP_RANGE_ATTRS = {
    current_temperature: 19.5,
    target_temp_low: 19,
    target_temp_high: 20,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 386,
  };

  const SINGLE_ATTRS = {
    current_temperature: 20,
    temperature: 18,
    min_temp: 7,
    max_temp: 30,
    target_temp_step: 1,
    supported_features: 385,
  };

  // Same 200px-wide track fixture convention this file's other Card-level
  // describe blocks use.
  function stubTrackRect(card) {
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    return track;
  }

  // Same plain-object MouseEvent stand-in this file's other Card-level
  // describe blocks use.
  function fakeEvent(clientX, clientY = 0) {
    return {
      clientX,
      clientY,
      touches: undefined,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  //
  // Two-handle case: a tap left of the low handle's rendered position (~52.17%
  // on this fixture) steps it down by one resolved step. The low handle moving
  // down moves further away from the high handle, so `clampToMinGap` is
  // exercised on this call path but does not need to alter the result
  // here (18 already satisfies the >=1 gap against the high handle's 24) —
  // the tight-gap test below exercises the case where it does.
  it("test_tap_left_of_low_handle_steps_it_down_and_commits_after_debounce", () => {
    const hass = makeHassEntity("climate.range", RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._commitHandleValue = vi.fn();

    // Snapshot render state / handle set / _dragStartX via the real
    // gesture-start path, at a tap position left of the low handle's ~104px
    // rendered position (x=50 -> 25%, well left of ~52.17%).
    card._startHandleGesture(fakeEvent(50, 0), "low", "thumb:low");

    card._handleTap("low");

    expect(card._renderState.low.value).toBe(18);
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("low", 18);
  });

  //
  // Two-handle case: a tap right of the low handle's rendered position steps
  // it up, and on this tight-gap fixture (low 19, high 20, step 1) the
  // naive step-up (19 + 1 = 20) would collide with the high handle, so
  // `clampToMinGap` pulls the result back to 19 (the largest value that
  // still keeps the one-step gap against the high handle's 20) — confirming
  // the clamp is genuinely engaged on this path, not just called
  // pass-through.
  it("test_tap_right_of_low_handle_steps_it_up_clamped_by_min_gap", () => {
    const hass = makeHassEntity("climate.range", TIGHT_GAP_RANGE_ATTRS, "heat_cool");
    const card = mountEntity("climate.range", {}, hass);
    stubTrackRect(card);
    card._commitHandleValue = vi.fn();

    // The low handle's rendered position on this fixture: (19-7)/23*100 ≈
    // 52.17%. Tap at x=150 -> 75%, well right of it.
    card._startHandleGesture(fakeEvent(150, 0), "low", "thumb:low");

    card._handleTap("low");

    // Without the min-gap clamp this would be 20 (19 + step); the clamp
    // pulls it back to 19.
    expect(card._renderState.low.value).toBe(19);
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("low", 19);
  });

  //
  // One-handle case: a tap right of the sole handle's rendered position
  // (temperature 18 in [7,30] -> ~47.8%) steps it up by one step, with no
  // min-gap clamp involved (handle set of size one).
  it("test_one_handle_tap_right_of_setpoint_steps_it_up", () => {
    const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);
    stubTrackRect(card);
    card._commitHandleValue = vi.fn();

    // Sole handle's rendered position ≈ 47.8% -> x ≈ 96. Tap at x=150 ->
    // 75%, well right of it.
    card._startHandleGesture(fakeEvent(150, 0), "value", "thumb:value");

    card._handleTap("value");

    expect(card._renderState.value.value).toBe(19);
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("value", 19);
  });

  //
  // One-handle case: a tap left of the sole handle's rendered position
  // steps it down by one step.
  it("test_one_handle_tap_left_of_setpoint_steps_it_down", () => {
    const hass = makeHassEntity("climate.single", SINGLE_ATTRS, "heat");
    const card = mountEntity("climate.single", {}, hass);
    stubTrackRect(card);
    card._commitHandleValue = vi.fn();

    // Sole handle's rendered position ≈ 47.8% -> x ≈ 96. Tap at x=20 ->
    // 10%, well left of it.
    card._startHandleGesture(fakeEvent(20, 0), "value", "thumb:value");

    card._handleTap("value");

    expect(card._renderState.value.value).toBe(17);
    expect(card._commitHandleValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(card._commitHandleValue).toHaveBeenCalledTimes(1);
    expect(card._commitHandleValue).toHaveBeenCalledWith("value", 17);
  });
});

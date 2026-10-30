/**
 * `resolveOtherHandleValue(handle, lastConfirmed, lastSelfWritten)` needs a
 * way to know which of the entity's last-confirmed state and the Card's own
 * last self-written value happened more recently in real event order,
 * without relying on wall-clock time (tests run synchronously and multiple
 * events can share a timestamp). Both `lastConfirmed` and `lastSelfWritten`
 * are therefore modeled as either `null` (nothing of that kind has happened
 * yet) or `{ value: number, seq: number }`, where `seq` is a
 * caller-assigned monotonically increasing sequence number standing in for
 * "which happened later" — a higher `seq` means a later real-world event.
 * The function itself never generates `seq` values; it only compares the
 * ones it's given.
 *
 * `handle` (`'low' | 'high'`) identifies which attribute is being resolved.
 * The most-recent-event-wins rule is symmetric between low/high — nothing
 * in the comparison logic branches on which handle it is, since both
 * `lastConfirmed` and `lastSelfWritten` are already scoped to a single
 * attribute by the caller. The parameter is kept in the signature to match
 * the call sites' shape, but this test does not assert any
 * handle-dependent branching.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { resolveOtherHandleValue } from "../thermostat-slider-card.js";

const handle = fc.constantFrom("low", "high");

// A "sequenced value": either absent (null, nothing has happened yet of
// this kind) or a numeric value tagged with a seq number.
function sequencedValue(seqArb) {
  return fc.option(
    fc.record({
      value: fc.double({ noNaN: true, min: -100, max: 200 }),
      seq: seqArb,
    }),
    { nil: null },
  );
}

describe("resolveOtherHandleValue", () => {
  it("test_returns_whichever_of_confirmed_or_self_written_has_the_higher_seq", () => {
    fc.assert(
      fc.property(
        handle,
        sequencedValue(fc.integer({ min: 0, max: 1000 })),
        sequencedValue(fc.integer({ min: 0, max: 1000 })),
        (h, lastConfirmed, lastSelfWritten) => {
          // Skip the case where both are null: there is no event to resolve
          // to, so the property (about picking the more recent of two
          // real events) doesn't apply here — that's a separate
          // precondition covered by `buildWritePayload`'s null-suppression
          // behavior, not this function.
          fc.pre(lastConfirmed !== null || lastSelfWritten !== null);

          const result = resolveOtherHandleValue(h, lastConfirmed, lastSelfWritten);

          if (lastConfirmed === null) {
            expect(result).toBe(lastSelfWritten.value);
          } else if (lastSelfWritten === null) {
            expect(result).toBe(lastConfirmed.value);
          } else if (lastSelfWritten.seq > lastConfirmed.seq) {
            expect(result).toBe(lastSelfWritten.value);
          } else if (lastConfirmed.seq > lastSelfWritten.seq) {
            expect(result).toBe(lastConfirmed.value);
          } else {
            // Equal seq: either event could be considered "the later one" —
            // both values are valid, deterministically-resolvable outcomes
            // (a genuine tie shouldn't happen with real event sequencing,
            // but the function must still return one of the two rather than
            // something else, e.g. a stale/mixed value).
            expect([lastConfirmed.value, lastSelfWritten.value]).toContain(result);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_falls_back_to_last_confirmed_before_any_self_write_has_happened", () => {
    fc.assert(
      fc.property(
        handle,
        fc.double({ noNaN: true, min: -100, max: 200 }),
        fc.integer({ min: 0, max: 1000 }),
        (h, value, seq) => {
          const lastConfirmed = { value, seq };
          const result = resolveOtherHandleValue(h, lastConfirmed, null);
          expect(result).toBe(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_result_never_depends_on_which_handle_is_asked_about", () => {
    fc.assert(
      fc.property(
        sequencedValue(fc.integer({ min: 0, max: 1000 })),
        sequencedValue(fc.integer({ min: 0, max: 1000 })),
        (lastConfirmed, lastSelfWritten) => {
          fc.pre(lastConfirmed !== null || lastSelfWritten !== null);

          const resultLow = resolveOtherHandleValue("low", lastConfirmed, lastSelfWritten);
          const resultHigh = resolveOtherHandleValue("high", lastConfirmed, lastSelfWritten);

          expect(resultLow).toBe(resultHigh);
        },
      ),
      { numRuns: 100 },
    );
  });
});

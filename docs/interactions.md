# Interactions

[← Back to README](../README.md)

- **Tap the card (outside the slider)**: opens the entity's more-info dialog.
- **Drag the slider (or a handle, on range-setpoint entities)**: smoothly adjusts the setpoint with a 500ms debounce on the service call. Range-setpoint entities (climate entities reporting `target_temp_low`/`target_temp_high`, typically in `heat_cool` or `auto` mode) render two handles, **Low** and **High**, instead of one thumb; each drags independently using this same behavior — see below for what's different when there are two handles to coordinate.
- **Tap the slider left or right of the thumb**: steps the setpoint up or down by one increment. On a range-setpoint entity, a tap targets whichever handle (Low or High) is nearest the tap location, then steps that handle the same way.
- **Press and hold the slider for 1 second** (without moving): toggles the device on/off — the card flashes to confirm. Moving within the first second cancels the toggle and becomes a normal drag. Disable with `allow_toggle: false`. On a range-setpoint entity, holding either handle or the empty track all trigger this same toggle — there's no separate per-handle meaning.
- **Tap the alert icon (one-line layout)**: when a zone is alerting, an icon appears next to the name; tapping it reveals a popover with the alert text (auto-hides after a few seconds). This tap does not open the more-info dialog.

## Range setpoints (two-handle entities)

Range-setpoint entities don't have a separate interaction mode — they're the same drag/tap-step/long-press model described above, generalized to two handles (Low and High) instead of one thumb. The points below cover what's specific to coordinating two handles; everything else (debounce timing, toggle gating, etc.) is identical to the single-handle case.

- **Independent dragging**: Low and High drag independently — dragging one never moves the other, and only one handle can be actively dragged at a time.
- **Nearest-handle resolution, from anywhere on the track**: pressing anywhere on the track (not just directly on a handle) resolves to whichever handle is closest to the press location, then drags that handle from there — same as dragging its own thumb directly. If only one handle currently has a value, presses always target that one regardless of distance. Tapping (a press with no movement) steps the resolved handle the same way single-setpoint mode already steps on a tap.
- **Minimum gap**: a handle can never be dragged or tap-stepped past the other, or closer than the minimum allowed gap. That gap defaults to one slider step (the same increment used for tap-stepping) and can be raised with the `min_gap` config option — see [Configuration](configuration.md).
- **Batched writes**: releasing a drag, or completing a tap-step, debounces the same 500ms as single-setpoint mode, then writes both setpoints together in one service call, since Home Assistant requires `target_temp_low` and `target_temp_high` to be sent together.

While a drag is in progress on either handle, the card won't switch between single-setpoint and range-setpoint display even if the entity's mode changes underneath it — the switch is applied on the next render after the drag ends.

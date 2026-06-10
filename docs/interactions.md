# Interactions

[← Back to README](../README.md)

- **Tap the card (outside the slider)**: opens the entity's more-info dialog.
- **Drag the slider**: smoothly adjusts the setpoint with a 500ms debounce on the service call.
- **Tap the slider left or right of the thumb**: steps the setpoint up or down by one increment.
- **Press and hold the slider for 1 second** (without moving): toggles the device on/off — the card flashes to confirm. Moving within the first second cancels the toggle and becomes a normal drag. Disable with `allow_toggle: false`.
- **Tap the alert icon (one-line layout)**: when a zone is alerting, an icon appears next to the name; tapping it reveals a popover with the alert text (auto-hides after a few seconds). This tap does not open the more-info dialog.

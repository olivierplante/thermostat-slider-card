# Configuration

[← Back to README](../README.md)

## Minimum

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
```

## Supported entity types

The card works with any entity from these domains — it detects the domain automatically:

| Domain | Big number | Slider sets | Unit |
|---|---|---|---|
| `climate` | current temperature | target temperature | `°` |
| `humidifier` | current humidity | target humidity | `%` |
| `fan` | speed | speed | `%` |
| `water_heater` | current temperature | target temperature | `°` |

A fan has no separate measured value — its speed is both the reading and the setpoint.

Misconfigurations announce themselves instead of failing silently: any other entity type (e.g. a humidity `sensor` instead of the `humidifier` entity) renders an "unsupported entity type" message, a nonexistent entity_id shows "Entity not found", and a preset-only fan (no speed support) says so. Invalid `min`/`max`/`step` values are ignored with a console warning, as are alert thresholds or timers that point at missing or non-numeric entities.

Thermostats using **range setpoints** (`target_temp_low`/`target_temp_high` instead of a single target) still display their reading, colors and alerts; the slider shows a "range setpoints aren't supported yet" bubble when touched instead of issuing a write the device would reject.

## Full options

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
name: Living Room                       # Optional: override display name
layout: full                            # Optional: 'full' (default) or 'one-line'
slider_width: 55                        # Optional: one-line slider width % (default: 55)
min: 14                                 # Optional: slider minimum (default: from the entity)
max: 21                                 # Optional: slider maximum (default: from the entity)
step: 0.5                               # Optional: slider increment (default: from the entity)
allow_toggle: true                      # Optional: long-press the slider to toggle on/off (default: true)
alert_low: 5                            # Optional: low alert threshold (number, entity, or false)
alert_high: false                       # Optional: high alert threshold (number, entity, or false)
timer: timer.living_room_heat           # Optional: stuck-alert timer entity
threshold: input_number.heat_threshold  # Optional: stuck-alert threshold (number or entity)
```

| Key | Default | Description |
|---|---|---|
| `entity` | required | A `climate`, `humidifier`, `fan` or `water_heater` entity |
| `name` | entity name | Display name shown on the card |
| `layout` | `full` | Card layout: `full` (stacked) or `one-line` (compact row) |
| `slider_width` | `55` | One-line only: slider width as a % of the card (number, clamped 20–80) |
| `min` / `max` / `step` | from the entity | Slider range and increment — see [Slider range](#slider-range) |
| `allow_toggle` | `true` | Long-press the slider (1s) to toggle the device — `false` disables |
| `device_class` | from the entity | Humidifier only: `humidifier` or `dehumidifier`, for integrations that omit the attribute (drives color, alert defaults and stuck direction) |
| `alert_low` | per device | Low alert threshold — see [Alerts](#alerts) |
| `alert_high` | per device | High alert threshold — see [Alerts](#alerts) |
| `timer` | none | Timer entity for the stuck alert |
| `threshold` | none | Threshold (number or entity) for the stuck alert |

## Slider range

By default the slider range and step come from the **entity itself** (`min_temp`/`max_temp`/`target_temp_step` for climate and water heaters, `min_humidity`/`max_humidity` for humidifiers, 0–100/`percentage_step` for fans). Setting `min`, `max` or `step` in the config always overrides.

> **Upgrading from 1.2.x:** earlier versions defaulted climate sliders to 14–21 with step 0.5. If you relied on those defaults and prefer the tighter range, set `min: 14` and `max: 21` explicitly.

If a setpoint is outside the slider's range, the fill clamps and the setpoint pill stays pinned at the edge of the track showing the real value.

## Layout

By default the card uses the `full` layout: name, large current reading, and a full-width slider stacked vertically.

Set `layout: one-line` for a compact single-row layout — name on the left, current reading in the middle, slider on the right:

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
name: Living Room
layout: one-line
```

This is ideal for stacking several devices in a small space (e.g. a `vertical-stack`).

The slider has a fixed width set by `slider_width` (a percentage of the card, default `55`), so the sliders in a stack of cards line up neatly:

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
layout: one-line
slider_width: 60   # wider slider, less room for the name
```

`slider_width` is a number, clamped to 20–80; out-of-range or non-numeric values are corrected and logged to the console. The current reading and alert icon are always fully visible — if the row is tight, the **room name** is what truncates with an ellipsis. Lower `slider_width` to give long names more room.

In `one-line` mode, alerts appear as a small icon next to the name and the name turns red, instead of a full-width banner. **Tap the icon** to reveal a popover with the alert text.

An unknown `layout` value falls back to `full` and logs a warning to the browser console.

## Mode colors

The slider fill's color follows the device's **mode** — what it is set to do — so a cooler reads as a cooler even while idle:

- **Amber** — raising the value: heating, humidifying, water heating
- **Cyan** — lowering the value: cooling, drying, dehumidifying
- **Grey** — neutral: fans (and climate `fan_only` mode)

For climate `heat_cool`/`auto` modes the color is resolved in order: the live `hvac_action` while actively heating or cooling, then the device's capabilities (a heat-only device in auto is amber, a cool-only one cyan, per `hvac_modes`), then the last active action seen (so a dual system keeps its color through idle compressor cycles), and finally neutral grey when the card has no information yet.

The big number's accent still follows the **live action** (lights up amber/cyan while the device is actively working). Every mode color can be overridden — see [Theming](theming.md).

## On/off toggle (long-press)

**Press and hold the slider for 1 second** (without moving) to toggle the device on or off. The card flashes briefly to confirm. Moving your finger within the first second cancels the toggle and becomes a normal drag.

- Disable with `allow_toggle: false`.
- When the device is off, the card dims; the slider still works.
- The gesture is automatically disabled on entities that don't support turning on/off (checked via `supported_features`).

## Alerts

Two threshold alerts plus a "stuck" alert. Each threshold accepts a **number**, an **entity ID** (read dynamically), or **`false`** to disable.

### Extreme values (`alert_low` / `alert_high`)

Defaults are device-aware — the alert matching the device's failure mode is on by default:

| Device | `alert_low` default | `alert_high` default |
|---|---|---|
| `climate` | `5` → "Freeze risk" | off — opt-in shows "Overheating" |
| `humidifier` (humidifier) | `25` → "Too dry" | `65` → "Too humid" |
| `humidifier` (dehumidifier) | off | `65` → "Too humid" |
| `fan` / `water_heater` | off | off |

The 65% default follows the [EPA's mold-growth guidance](https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home) (keep indoor humidity below 60%) with a margin against transient spikes.

```yaml
# Dehumidifier that should also warn when the basement gets too dry
type: custom:thermostat-slider-card
entity: humidifier.basement_dehumidifier
alert_low: 30

# Disable the default freeze alert
type: custom:thermostat-slider-card
entity: climate.garage
alert_low: false
```

> **Deprecated:** `freeze_threshold` still works as an alias for `alert_low` but logs a deprecation warning. If both are set, `alert_low` wins.

### Stuck alert (`timer` + `threshold`)

When both `timer` and `threshold` are configured and the timer is `idle`, the card checks whether the device is failing to move the value in its direction:

- Raising devices (heating, humidifying): alert when the current value is **at or below** the threshold → "Struggling to heat" / "Struggling to humidify"
- Lowering devices (cooling, drying): alert when the current value is **at or above** the threshold → "Struggling to cool" / "Struggling to dry"

Useful for detecting zones where the system can't reach the setpoint.

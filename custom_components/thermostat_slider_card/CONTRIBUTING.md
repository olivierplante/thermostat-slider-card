# Contributing

Thanks for wanting to improve the card! Contributions are welcome — a few
ground rules keep the project coherent and your effort well spent.

## Discuss before you build

**Open an issue describing what you want to change and why, before writing
code.** This is the most important rule: it lets us agree the change fits the
card's scope and design before you invest time in it.

You *can* open a PR without discussing first — but you're taking the risk
that it doesn't fit the project's direction and gets declined. A short issue
conversation first avoids that.

## What fits the project

The card's identity: a **setpoint slider** for climate-style devices
(climate, humidifier, fan, water_heater) with honest, glanceable state.
Simple beats clever; the card has **zero runtime dependencies** and that
stays true. Features that serve one exotic setup usually fit better as a
config option with a sensible default than as new UI.

## Dev setup

The card is a single plain-JS module — no build step. Tests run on
[vitest](https://vitest.dev/) + jsdom:

```bash
cd custom_components/thermostat_slider_card/www   # (www/ in this repo's layout)
corepack enable
pnpm install
pnpm test            # run the suite
pnpm test:watch      # watch mode
pnpm test -- --coverage
```

## Expectations for PRs

- **Tests first (TDD).** Write failing tests for the new behavior, then make
  them pass. Every bugfix needs a test that would have caught the bug.
- **Coverage gate:** CI enforces minimum coverage (80% lines/functions,
  70% branches). The `test` job in GitHub Actions must be green.
- **Don't break existing config.** Released options keep working; deprecate
  with a console warning rather than removing.
- **Match the existing style** — naming, comment density, no frameworks.
- **Update the docs** (`docs/`, README) in the same PR as the behavior change.

## Reporting bugs

Include your card YAML, the entity's domain and attributes (Developer Tools →
States), and a screenshot if it's visual. The entity attributes matter — most
display bugs come from attribute shapes the card didn't expect.

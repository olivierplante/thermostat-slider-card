// Mark the environment as a test run BEFORE the card module is imported, so
// its registration/log block is skipped. Tests instantiate the exported
// ThermostatSliderCard class directly.
globalThis.window = globalThis.window || globalThis;
window.__TSC_TEST__ = true;

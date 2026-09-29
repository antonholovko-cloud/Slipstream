// Realistic model state from the demo race, for tests that need a full `state` object.
const { MockSource } = require('../../src/main/mock');
const { RaceModel } = require('../../src/main/model');

const DEFAULT_GLOBAL = { units: 'metric', speedUnit: 'auto', focusCamCar: true, classSplits: [] };

// Runs the demo race forward `seconds` of sim time and returns { mock, model, state, global, step }.
// step(sec) advances further and returns the new state.
function demoRace({ seconds = 240, global = {}, setup } = {}) {
  const mock = new MockSource();
  if (setup) setup(mock);
  const model = new RaceModel({});
  const g = { ...DEFAULT_GLOBAL, ...global };
  let state = null;
  const step = (sec) => {
    mock.fastForward(sec, (f) => { const st = model.update(f, g); if (st) state = st; });
    return state;
  };
  step(seconds);
  return { mock, model, get state() { return state; }, global: g, step };
}

// Same slice of state the main process sends to one overlay window (main.js pickState).
function pickState(state, needs, source = 'demo') {
  const out = { connected: state.connected, source };
  for (const k of needs) out[k] = state[k];
  return out;
}

module.exports = { demoRace, pickState, DEFAULT_GLOBAL };

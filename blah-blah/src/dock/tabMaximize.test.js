import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleMaximizeForTab,
  attachTabDoubleClickMaximize,
} from './tabMaximize.js';

/** A group double whose location type and maximize state are observable. */
function fakeGroup(locationType = 'grid', id = 'group-1') {
  const state = { maximized: false };
  const calls = { maximize: 0, exitMaximized: 0 };
  return {
    calls,
    state,
    group: {
      id,
      api: {
        location: { type: locationType },
        isMaximized: () => state.maximized,
        maximize: () => {
          calls.maximize += 1;
          state.maximized = true;
        },
        exitMaximized: () => {
          calls.exitMaximized += 1;
          state.maximized = false;
        },
      },
    },
  };
}

function fakeTab(panelId) {
  return { dataset: { tabPanelId: panelId } };
}

/** `getPanel` resolves the group the tab's panel lives in. */
function fakeApi(panelId, group) {
  return {
    getPanel: (id) => (id === panelId ? { id, group } : undefined),
  };
}

/** The subset of `Element`/`Window` the delegated listener uses. */
function fakeRoot() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    dispatch: (type, event) => listeners.get(type)?.(event),
    listening: (type) => listeners.has(type),
  };
}

/** An event target that walks up to `tab` (or to the close button). */
function fakeTarget({ tab = null, closeButton = false } = {}) {
  return {
    closest: (selector) => {
      if (selector === '.dv-default-tab-action') return closeButton ? {} : null;
      if (selector === '.dv-tab') return tab;
      return null;
    },
  };
}

test('toggleMaximizeForTab - maximizes a grid group, then restores it', () => {
  const { group, calls, state } = fakeGroup('grid');
  const api = fakeApi('preview', group);

  assert.equal(toggleMaximizeForTab(fakeTab('preview'), api), true);
  assert.equal(calls.maximize, 1);
  assert.equal(state.maximized, true);

  assert.equal(toggleMaximizeForTab(fakeTab('preview'), api), true);
  assert.equal(calls.exitMaximized, 1);
  assert.equal(state.maximized, false);
});

test('toggleMaximizeForTab - a popped-out group toggles its own window instead', () => {
  const { group, calls } = fakeGroup('popout', 'group-7');
  const api = fakeApi('preview', group);

  // Nothing to maximize inside the grid, so the gesture is delegated to the
  // window (which is a no-op outside the desktop build, hence `true` for the
  // gesture itself).
  assert.equal(toggleMaximizeForTab(fakeTab('preview'), api), true);
  assert.equal(calls.maximize, 0);
  assert.equal(calls.exitMaximized, 0);
});

test('toggleMaximizeForTab - floating groups have nothing to maximize into', () => {
  const { group, calls } = fakeGroup('floating');
  const api = fakeApi('preview', group);

  assert.equal(toggleMaximizeForTab(fakeTab('preview'), api), false);
  assert.equal(calls.maximize, 0);
});

test('toggleMaximizeForTab - ignores tabs whose panel is gone', () => {
  const { group, calls } = fakeGroup('grid');
  const api = fakeApi('preview', group);

  assert.equal(toggleMaximizeForTab(fakeTab('closed-panel'), api), false);
  assert.equal(calls.maximize, 0);
});

test('toggleMaximizeForTab - tolerates a missing tab, api or group', () => {
  const { group } = fakeGroup('grid');
  const api = fakeApi('preview', group);

  assert.equal(toggleMaximizeForTab(undefined, api), false);
  assert.equal(toggleMaximizeForTab({}, api), false);
  assert.equal(toggleMaximizeForTab(fakeTab('preview'), null), false);
  assert.equal(toggleMaximizeForTab(fakeTab('preview'), { getPanel: () => ({}) }), false);
});

test('attachTabDoubleClickMaximize - maximizes the tab that was double-clicked', () => {
  const { group, calls } = fakeGroup('grid');
  const api = fakeApi('preview', group);
  const root = fakeRoot();

  const detach = attachTabDoubleClickMaximize(root, api);
  root.dispatch('dblclick', { target: fakeTarget({ tab: fakeTab('preview') }) });

  assert.equal(calls.maximize, 1);

  detach();
  assert.equal(root.listening('dblclick'), false);
  root.dispatch('dblclick', { target: fakeTarget({ tab: fakeTab('preview') }) });
  assert.equal(calls.maximize, 1, 'a detached listener should stop reacting');
});

test('attachTabDoubleClickMaximize - the tab close button is not a maximize', () => {
  const { group, calls } = fakeGroup('grid');
  const api = fakeApi('preview', group);
  const root = fakeRoot();

  attachTabDoubleClickMaximize(root, api);
  root.dispatch('dblclick', {
    target: fakeTarget({ tab: fakeTab('preview'), closeButton: true }),
  });

  assert.equal(calls.maximize, 0);
});

test('attachTabDoubleClickMaximize - ignores double-clicks outside tab elements', () => {
  const { group, calls } = fakeGroup('grid');
  const api = fakeApi('preview', group);
  const root = fakeRoot();

  attachTabDoubleClickMaximize(root, api);
  root.dispatch('dblclick', { target: fakeTarget({ tab: null }) });
  root.dispatch('dblclick', { target: undefined });

  assert.equal(calls.maximize, 0);
});

test('attachTabDoubleClickMaximize - works against a pop-out window, and no-ops without one', () => {
  const { group, calls } = fakeGroup('grid');
  const api = fakeApi('preview', group);

  // A pop-out's tabs live in another window, so the listener is attached to
  // that window rather than to the dock root.
  const popoutWindow = fakeRoot();
  attachTabDoubleClickMaximize(popoutWindow, api);
  popoutWindow.dispatch('dblclick', { target: fakeTarget({ tab: fakeTab('preview') }) });
  assert.equal(calls.maximize, 1);

  const detach = attachTabDoubleClickMaximize(null, api);
  assert.equal(typeof detach, 'function');
  assert.equal(attachTabDoubleClickMaximize(fakeRoot(), null)(), undefined);
});

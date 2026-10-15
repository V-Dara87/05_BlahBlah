import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_DOCK_WINDOWS,
  openOrAddWindowToGroup,
  addNewWindowInstanceToGroup,
} from './dockWindows.js';

test('AVAILABLE_DOCK_WINDOWS - contains all standard BlahBlah panels', () => {
  const ids = AVAILABLE_DOCK_WINDOWS.map((w) => w.id);
  const expected = [
    'project',
    'preview',
    'inspector',
    'timeline',
    'dopesheet',
    'curveEditor',
    'silenceRemover',
    'mixer',
    'console',
  ];
  assert.deepEqual(ids, expected);
  assert.equal(AVAILABLE_DOCK_WINDOWS.length, 9);
});

test('openOrAddWindowToGroup - focuses window if already present in target group', () => {
  let activeCalls = 0;
  const targetGroup = { id: 'group-bottom' };
  const mockPanel = {
    id: 'mixer',
    component: 'mixer',
    group: targetGroup,
    api: {
      setActive: () => {
        activeCalls += 1;
      },
    },
  };

  const containerApi = {
    panels: [mockPanel],
  };

  const result = openOrAddWindowToGroup({
    win: { id: 'mixer', component: 'mixer', title: 'Mixer' },
    containerApi,
    group: targetGroup,
  });

  assert.equal(activeCalls, 1);
  assert.equal(result, mockPanel);
});

test('openOrAddWindowToGroup - moves window to target group if open in another group', () => {
  let moveToTarget = null;
  let activeCalls = 0;
  const otherGroup = { id: 'group-left' };
  const targetGroup = { id: 'group-bottom' };

  const mockPanel = {
    id: 'console',
    component: 'console',
    group: otherGroup,
    api: {
      moveTo: ({ group }) => {
        moveToTarget = group;
      },
      setActive: () => {
        activeCalls += 1;
      },
    },
  };

  const containerApi = {
    panels: [mockPanel],
  };

  const result = openOrAddWindowToGroup({
    win: { id: 'console', component: 'console', title: 'Console' },
    containerApi,
    group: targetGroup,
  });

  assert.equal(moveToTarget, targetGroup);
  assert.equal(activeCalls, 1);
  assert.equal(result, mockPanel);
});

test('openOrAddWindowToGroup - adds window to target group if closed/not open anywhere', () => {
  let addedOptions = null;
  const targetGroup = { id: 'group-right' };

  const containerApi = {
    panels: [],
    getPanel: () => null,
    addPanel: (options) => {
      addedOptions = options;
      return { id: options.id };
    },
  };

  const result = openOrAddWindowToGroup({
    win: { id: 'inspector', component: 'inspector', title: 'Inspector' },
    containerApi,
    group: targetGroup,
  });

  assert.ok(result);
  assert.equal(addedOptions.id, 'inspector');
  assert.equal(addedOptions.component, 'inspector');
  assert.equal(addedOptions.title, 'Inspector');
  assert.deepEqual(addedOptions.position, {
    referenceGroup: targetGroup,
    direction: 'within',
  });
});

test('addNewWindowInstanceToGroup - adds a duplicated instance with incremented title', () => {
  let addedOptions = null;
  const targetGroup = { id: 'group-main' };

  const existingInspector = {
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
  };

  const containerApi = {
    panels: [existingInspector],
    addPanel: (options) => {
      addedOptions = options;
      return { id: options.id };
    },
  };

  addNewWindowInstanceToGroup({
    win: { id: 'inspector', component: 'inspector', title: 'Inspector' },
    containerApi,
    group: targetGroup,
  });

  assert.ok(addedOptions);
  assert.ok(addedOptions.id.startsWith('inspector-'));
  assert.equal(addedOptions.component, 'inspector');
  assert.equal(addedOptions.title, 'Inspector (2)');
  assert.deepEqual(addedOptions.position, {
    referenceGroup: targetGroup,
    direction: 'within',
  });
});

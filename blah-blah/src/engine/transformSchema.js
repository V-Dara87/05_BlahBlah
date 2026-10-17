/**
 * Static field schema for the Transform component.
 * Expressed in the same shape as extractScriptProps' output so it can flow through
 * the unified InspectorField renderer.
 */
export const TRANSFORM_FIELD_GROUPS = [
  {
    label: 'Position',
    fields: [
      { name: 'x', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 1, defaultVal: 0 },
      { name: 'y', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 1, defaultVal: 0 },
    ],
  },
  {
    label: 'Rotation',
    fields: [
      { name: 'rotation', type: 'number', dragLabel: '°', labelColor: '#60a5fa', step: 1, defaultVal: 0 },
    ],
  },
  {
    label: 'Scale',
    fields: [
      { name: 'scaleX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, defaultVal: 1 },
      { name: 'scaleY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, defaultVal: 1 },
    ],
  },
  {
    label: 'Pivot',
    fields: [
      // Normalized pivot: 0 = center, -0.5 = left/top edge, +0.5 = right/bottom edge.
      // Rotation and scale both happen around this point. Matches Unity convention.
      { name: 'pivotX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
      { name: 'pivotY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
    ],
  },
  {
    label: 'Opacity',
    fields: [
      { name: 'opacity', type: 'number', slider: true, dragLabel: 'α', labelColor: '#a78bfa', step: 0.01, min: 0, max: 1, defaultVal: 1 },
    ],
  },
  {
    label: 'Speed',
    fields: [
      { name: 'speed', type: 'number', slider: true, dragLabel: '×', labelColor: '#22d3ee', step: 0.1, min: 0.1, max: 4, defaultVal: 1 },
    ],
  },
];

/**
 * Returns the field group configuration for a Transform component.
 * When is3D is true, extends Position, Rotation, and Scale with 3D Z/X/Y axes (After Effects-style).
 */
export function getTransformFieldGroups(is3D = false) {
  if (!is3D) return TRANSFORM_FIELD_GROUPS;

  return [
    {
      label: 'Position',
      fields: [
        { name: 'x', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 1, defaultVal: 0 },
        { name: 'y', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 1, defaultVal: 0 },
        { name: 'z', type: 'number', dragLabel: 'Z', labelColor: '#60a5fa', step: 1, defaultVal: 0 },
      ],
    },
    {
      label: 'Rotation',
      fields: [
        { name: 'rotationX', type: 'number', dragLabel: 'X°', labelColor: '#f87171', step: 1, defaultVal: 0 },
        { name: 'rotationY', type: 'number', dragLabel: 'Y°', labelColor: '#4ade80', step: 1, defaultVal: 0 },
        { name: 'rotation', type: 'number', dragLabel: 'Z°', labelColor: '#60a5fa', step: 1, defaultVal: 0 },
      ],
    },
    {
      label: 'Scale',
      fields: [
        { name: 'scaleX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, defaultVal: 1 },
        { name: 'scaleY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, defaultVal: 1 },
        { name: 'scaleZ', type: 'number', dragLabel: 'Z', labelColor: '#60a5fa', step: 0.01, defaultVal: 1 },
      ],
    },
    {
      label: 'Pivot',
      fields: [
        { name: 'pivotX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
        { name: 'pivotY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
      ],
    },
    {
      label: 'Opacity',
      fields: [
        { name: 'opacity', type: 'number', slider: true, dragLabel: 'α', labelColor: '#a78bfa', step: 0.01, min: 0, max: 1, defaultVal: 1 },
      ],
    },
    {
      label: 'Speed',
      fields: [
        { name: 'speed', type: 'number', slider: true, dragLabel: '×', labelColor: '#22d3ee', step: 0.1, min: 0.1, max: 4, defaultVal: 1 },
      ],
    },
  ];
}

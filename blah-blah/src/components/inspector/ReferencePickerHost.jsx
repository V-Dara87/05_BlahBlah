import { useState } from 'react';
import { TransitionPickerModal } from '../TransitionPickerModal';
 
/**
 * Owns the picker-modal state (`showPickerModal`, `pickerSlot`,
 * `pickerCallback`, `pickerInitialParams`) and renders the
 * `TransitionPickerModal`. Pulled out of UnityInspector.jsx (Step 8).
 *
 * Usage in UnityInspector.jsx:
 *
 *   const { openPicker, pickerModal } = useReferencePicker({ transitionComp, updateComponent });
 *   ...
 *   <TransitionInspector onOpenPicker={openPicker} ... />
 *   ...
 *   {pickerModal}
 *
 * `openPicker(slot, onApply, currentParams)` is passed straight through as
 * `TransitionInspector`'s `onOpenPicker` prop, so the calling convention at
 * that call site is unchanged. When `onApply` is provided (the
 * TransitionInspector case) it's called directly on preset selection;
 * otherwise (no caller-supplied callback) this falls back to writing the
 * TransitionComponent's transitionIn/transitionOut directly, matching the
 * modal's original inline behavior.
 */
export function useReferencePicker({ selectedEntity, onUpdateEntity }) {
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerSlot, setPickerSlot] = useState('in');
  const [pickerCallback, setPickerCallback] = useState(null);
  const [pickerInitialParams, setPickerInitialParams] = useState(null);
 
  const transitionComp = selectedEntity?.components.find((c) => c.type === 'TransitionComponent');
 
  const openPicker = (slot, onApply, currentParams) => {
    setPickerSlot(slot);
    setPickerCallback(() => onApply);
    setPickerInitialParams(currentParams);
    setShowPickerModal(true);
  };
 
  const pickerModal = (
    <TransitionPickerModal
      isOpen={showPickerModal}
      onClose={() => setShowPickerModal(false)}
      targetSlot={pickerSlot}
      currentPresetId={pickerSlot === 'out' ? transitionComp?.transitionOut?.preset : transitionComp?.transitionIn?.preset}
      initialParams={pickerInitialParams || (pickerSlot === 'out' ? transitionComp?.transitionOut?.params : transitionComp?.transitionIn?.params)}
      onApplyPreset={(presetId, slot, params) => {
        if (pickerCallback) {
          pickerCallback(presetId, params);
        } else if (transitionComp && selectedEntity) {
          const updatedComponents = selectedEntity.components.map((c) => {
            if (c.type !== 'TransitionComponent') return c;
            return slot === 'out'
              ? { ...c, transitionOut: { ...c.transitionOut, preset: presetId, params, enabled: true } }
              : { ...c, transitionIn: { ...c.transitionIn, preset: presetId, params, enabled: true } };
          });
          onUpdateEntity(selectedEntity.id, { components: updatedComponents });
        }
      }}
    />
  );
 
  return { openPicker, pickerModal };
}
 
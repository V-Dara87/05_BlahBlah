 
import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pushRuntimeError } from '../../engine/scriptConsole.js';
import './entity-error-boundary.css';
 
/**
 * P0 #5 — Error boundary around per-entity rendering.
 *
 * Scripts run via `new Function(...)` (see engine/scriptRunner.js), and a
 * broken user script can throw during React's render phase (e.g. a
 * ReactRenderer component whose compiled function body throws). Without a
 * boundary, that crashes the whole EntityRenderer tree instead of just the
 * one bad clip. CanvasRenderer raises the odds of this happening further,
 * since raw WebGL/Three.js errors are easy to trigger from hand-written
 * scripts — this boundary is what makes shipping CanvasRenderer (P0 #2)
 * safe to do without also risking editor stability.
 *
 * Deliberately class-based: error boundaries have no hooks equivalent yet.
 */
export class EntityErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
 
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
 
  componentDidCatch(error, info) {
    // Also surface the crash in the Console panel (with the script name and
    // stack) — a render-phase throw is exactly the kind of real error a user
    // needs to see without opening devtools.
    const scriptName = this.props.scriptName || this.props.entityName || 'entity';
    const stack = error?.stack || String(error);
    pushRuntimeError(
      `"${this.props.entityName || scriptName}" crashed during render: ${error?.message || error}\n${stack}`,
      scriptName,
    );
    console.warn(`[EntityErrorBoundary] "${this.props.entityName || 'entity'}" crashed during render:`, error, info);
  }
 
  componentDidUpdate(prevProps) {
    // Reset once the underlying script/entity changes, so fixing the script
    // (hot-reload from disk, or editing in ScriptEditorModal) recovers the
    // clip on the next render instead of staying stuck red forever.
    // The resetKey guard means this only ever fires once per actual key
    // change (not on every update), so it doesn't loop.
    // eslint-disable-next-line react/no-did-update-set-state -- guarded by resetKey comparison, does not loop
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }
 
  render() {
    if (this.state.hasError) {
      return (
        <div className="entity-error-fallback" title={this.state.error?.message || 'Render error'}>
          <AlertTriangle size={16} />
          <span>{this.props.entityName || 'Clip'} failed to render</span>
        </div>
      );
    }
    return this.props.children;
  }
}
import * as d3 from 'd3';

/**
 * ParryOldVsNew — Canvas script using BlahBlah's stateless generic tween API.
 *
 * D3 owns only SVG creation. Every animated attribute is re-derived from
 * `time` in onUpdate(), so this script has no GSAP timeline, no accumulated
 * animation state, and no special seek logic to maintain.
 */
export default class ParryOldVsNew {
  static props = {
    oldLabel: { type: 'string', default: 'Old' },
    newLabel: { type: 'string', default: 'New' },
    staggerDelay: {
      type: 'number', default: 0.5, min: 0, max: 3, step: 0.1,
      label: 'New starts after old (s)',
    },
  };

  onMount({ container, props, canvasWidth, canvasHeight }) {
    this._svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`)
      .style('font-family', 'Inter, "Segoe UI", sans-serif')
      .style('background', 'transparent');

    const midX = canvasWidth / 2;
    this._divider = this._svg.append('line')
      .attr('x1', midX).attr('x2', midX)
      .attr('y1', canvasHeight * 0.08).attr('y2', canvasHeight * 0.92)
      .attr('stroke', '#555').attr('stroke-width', 1).node();

    this._oldHeader = this._svg.append('text')
      .attr('x', midX * 0.5).attr('y', canvasHeight * 0.12)
      .attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 600)
      .attr('fill', '#e8e8e8').text(props.oldLabel || 'Old').node();

    this._newHeader = this._svg.append('text')
      .attr('x', midX * 1.5).attr('y', canvasHeight * 0.12)
      .attr('text-anchor', 'middle').attr('font-size', 24).attr('font-weight', 600)
      .attr('fill', '#e8e8e8').text(props.newLabel || 'New').node();

    this._old = this._buildTree({
      className: 'old',
      rootX: midX * 0.5,
      rootY: canvasHeight * 0.28,
      leaves: [
        { x: midX * 0.22, label: 'Fail', kind: 'fail' },
        { x: midX * 0.78, label: 'Success', kind: 'success' },
      ],
      leafY: canvasHeight * 0.6,
      width: 136,
      fontSize: 15,
      curvedLinks: false,
    });

    const newCenter = midX * 1.5;
    const spread = midX * 0.42;
    this._new = this._buildTree({
      className: 'new',
      rootX: newCenter,
      rootY: canvasHeight * 0.28,
      leaves: [-1, -0.34, 0.34, 1].map((factor, index) => ({
        x: newCenter + factor * spread,
        label: ['Fail', 'Bad', 'Normal', 'Perfect'][index],
        kind: ['fail', 'bad', 'normal', 'perfect'][index],
      })),
      leafY: canvasHeight * 0.6,
      width: 116,
      fontSize: 14,
      curvedLinks: true,
    });
  }

  _buildTree({ className, rootX, rootY, leaves, leafY, width, fontSize, curvedLinks }) {
    const colors = {
      root: { fill: '#2a2a2a', stroke: '#888' },
      fail: { fill: '#4a2323', stroke: '#c85c5c' },
      success: { fill: '#1f3d2b', stroke: '#5cc88a' },
      bad: { fill: '#4a3820', stroke: '#d99a4a' },
      normal: { fill: '#233b4a', stroke: '#5c9ec8' },
      perfect: { fill: '#3d2a4a', stroke: '#b07ce0' },
    };
    const nodes = [
      { x: rootX, y: rootY, label: 'Parry attempt', kind: 'root' },
      ...leaves.map((leaf) => ({ ...leaf, y: leafY })),
    ];
    const group = this._svg.append('g').attr('class', `${className}-layer`);
    const links = leaves.map((leaf) => ({ source: nodes[0], target: { ...leaf, y: leafY } }));

    const linkNodes = group.selectAll(`.${className}-link`)
      .data(links).join('path')
      .attr('class', `${className}-link`).attr('fill', 'none')
      .attr('stroke', '#6b6b6b').attr('stroke-width', 2)
      .attr('d', (d) => this._linkPath(d, curvedLinks))
      .nodes();

    linkNodes.forEach((link) => {
      link._length = link.getTotalLength();
      d3.select(link).attr('stroke-dasharray', `${link._length} ${link._length}`);
    });

    const nodeNodes = group.selectAll(`.${className}-node`)
      .data(nodes).join('g').attr('class', (d) => `${className}-node ${className}-node-${d.kind}`)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .nodes();

    d3.selectAll(nodeNodes).append('rect')
      .attr('x', -width / 2).attr('y', -20).attr('width', width).attr('height', 40)
      .attr('rx', 10).attr('fill', (d) => colors[d.kind].fill)
      .attr('stroke', (d) => colors[d.kind].stroke).attr('stroke-width', 1.5);
    d3.selectAll(nodeNodes).append('text')
      .attr('text-anchor', 'middle').attr('dy', 5).attr('font-size', fontSize)
      .attr('font-weight', 500).attr('fill', '#f0f0f0').text((d) => d.label);

    return { nodes, nodeNodes, linkNodes, className };
  }

  _linkPath({ source, target }, curved) {
    if (!curved) return `M${source.x},${source.y + 20} L${target.x},${target.y - 22}`;
    const midY = (source.y + target.y) / 2 + 8;
    return `M${source.x},${source.y + 20} C${source.x},${midY} ${target.x},${midY} ${target.x},${target.y - 24}`;
  }

  _setHeader(node, label, opacity) {
    d3.select(node).text(label).attr('opacity', opacity);
  }

  _animateLinks(links, time, start, tween) {
    links.forEach((link, index) => {
      const reveal = tween.progress(time, {
        at: start + tween.stagger(index, 0.1), duration: 0.6, ease: 'outCubic',
      });
      d3.select(link)
        .attr('opacity', reveal)
        .attr('stroke-dashoffset', link._length * (1 - reveal));
    });
  }

  _animateNodes(tree, time, start, tween, { pop = false, pulsePerfect = false } = {}) {
    tree.nodeNodes.forEach((node, index) => {
      const reveal = tween.progress(time, {
        at: start + tween.stagger(index, pop ? 0.1 : 0.15),
        duration: pop ? 0.4 : 0.3,
        ease: pop ? 'outBack' : 'outCubic',
      });
      let scale = pop ? tween.lerp(0.6, 1, reveal) : 1;
      const kind = tree.nodes[index].kind;
      if (pulsePerfect && kind === 'perfect') {
        const pulseAt = start + tween.stagger(index, 0.1) + 0.6;
        if (time >= pulseAt) {
          scale *= tween.between(1, 1.08, tween.pingPong(time - pulseAt, 0.9), { ease: 'inOutSine' });
        }
      }
      const { x, y } = tree.nodes[index];
      d3.select(node)
        .attr('opacity', reveal)
        .attr('transform', `translate(${x},${y}) scale(${scale})`);
    });
  }

  onUpdate({ time, props, tween }) {
    const newStart = props.staggerDelay ?? 0.5;
    const headerReveal = tween.progress(time, { duration: 0.4, ease: 'outQuad' });

    d3.select(this._divider).attr('opacity', headerReveal);
    this._setHeader(this._oldHeader, props.oldLabel || 'Old', headerReveal);
    this._setHeader(
      this._newHeader,
      props.newLabel || 'New',
      tween.progress(time, { at: newStart, duration: 0.4, ease: 'outQuad' }),
    );

    this._animateLinks(this._old.linkNodes, time, 0.15, tween);
    this._animateNodes(this._old, time, 0.1, tween);
    this._animateLinks(this._new.linkNodes, time, newStart + 0.15, tween);
    this._animateNodes(this._new, time, newStart + 0.3, tween, { pop: true, pulsePerfect: true });
  }

  onUnmount({ container }) {
    d3.select(container).selectAll('*').remove();
  }
}

import * as d3 from 'd3';

export function createGraph(container) {
  container.innerHTML = '';
  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  container.appendChild(tooltip);

  const svg = d3.select(container).append('svg');
  const g = svg.append('g');

  // Zoom + pan
  const zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', e => {
      g.attr('transform', e.transform);
      svg.classed('panning', e.sourceEvent?.type === 'mousemove');
    });
  svg.call(zoom);
  svg.on('mousedown', () => svg.classed('panning', true));
  svg.on('mouseup', () => svg.classed('panning', false));

  const linkGroup = g.append('g').attr('class', 'links');
  const nodeGroup = g.append('g').attr('class', 'nodes');

  const simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(80).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide(30));

  let nodes = [];
  let links = [];
  let linkSel, nodeSel;
  let onNodeClick = null;

  function nodeRadius(d) {
    if (d.type === 'main') return 18;
    if (d.type === 'subagent') return 13;
    return 9;
  }

  function update() {
    linkSel = linkGroup.selectAll('.graph-link').data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
    linkSel.exit().remove();
    linkSel = linkSel.enter().append('line').attr('class', 'graph-link').merge(linkSel);

    nodeSel = nodeGroup.selectAll('.node').data(nodes, d => d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', d => `node node-${d.type}`)
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on('mouseover', (e, d) => {
        tooltip.className = 'graph-tooltip visible';
        tooltip.style.left = (e.offsetX + 12) + 'px';
        tooltip.style.top = (e.offsetY - 8) + 'px';
        tooltip.innerHTML = `<b>${d.label}</b><br>Type: ${d.type}${d.callCount ? `<br>Calls: ${d.callCount}` : ''}${d.totalMs ? `<br>Total: ${d.totalMs}ms` : ''}`;
      })
      .on('mousemove', e => {
        tooltip.style.left = (e.offsetX + 12) + 'px';
        tooltip.style.top = (e.offsetY - 8) + 'px';
      })
      .on('mouseout', () => { tooltip.className = 'graph-tooltip'; })
      .on('click', (e, d) => { onNodeClick?.(d); });

    nodeEnter.append('circle').attr('r', nodeRadius);
    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('dy', d => nodeRadius(d) + 12)
      .attr('text-anchor', 'middle')
      .text(d => d.label.length > 20 ? d.label.slice(0, 18) + '…' : d.label);

    nodeSel = nodeEnter.merge(nodeSel);

    simulation.nodes(nodes).on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simulation.force('link').links(links);
    simulation.alpha(0.5).restart();
  }

  function setData(graphData) {
    nodes = graphData.nodes.map(n => ({ ...n }));
    links = graphData.edges.map(e => ({ ...e }));
    centerSimulation();
    update();
  }

  function centerSimulation() {
    const rect = container.getBoundingClientRect();
    simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2));
  }

  function pulseNode(nodeId) {
    nodeSel?.filter(d => d.id === nodeId)
      .classed('node-pulse', false)
      .each(function() { this.offsetWidth; })
      .classed('node-pulse', true);
  }

  function addOrUpdateNode(nodeData, edgeData) {
    const existing = nodes.find(n => n.id === nodeData.id);
    if (existing) {
      Object.assign(existing, nodeData);
      pulseNode(nodeData.id);
    } else {
      nodes.push({ ...nodeData });
    }
    if (edgeData) {
      const existingEdge = links.find(l => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        return s === edgeData.source && t === edgeData.target;
      });
      if (!existingEdge) links.push({ ...edgeData });
    }
    update();
    pulseNode(nodeData.id);
  }

  function onNodeClickHandler(handler) { onNodeClick = handler; }

  function clear() { nodes = []; links = []; update(); }

  return { setData, addOrUpdateNode, clear, pulseNode, onNodeClick: onNodeClickHandler };
}

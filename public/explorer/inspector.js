// Adapted from TreeStruct3D Visual Validation Toolkit (Apache-2.0).

    import * as THREE from 'three';
    import { escapeHtml, assetUrl, validateSnapshot, displayName, snapshotCounts } from './data-utils.js';
    import { OrbitControls } from './vendor/OrbitControls.js';
    import { GLTFLoader } from './vendor/GLTFLoader.js';
    import { captureTransparentPng } from './export-utils.js';
    import { providerKey, providerLabel, savedVariant, stateLabel, hasPaperComparison, paperComparisonPair, paperPreset, invalidatePreviewChecks } from './edit-state.js';
    import { createContinuousEditor } from './continuous-edit.js';
    import { createNativeEditor } from './native-edit.js';
    import { validateNativeResponse } from './native-response-validation.js';
    import { displayAnchorPairs, isAnchorDisplayEdge, anchorDisplayVerified } from './anchor-display.js';
    import { createAnchorLayer } from './anchor-layer.js';

    const sourceSelect = document.getElementById('source-select');
    const modelSelect = document.getElementById('model-select');
    const selectionStorageKey = 'treestruct3d-explorer:last-selection:v1';
    const previousModelButton = document.getElementById('previous-model-button');
    const nextModelButton = document.getElementById('next-model-button');
    const copySelectionButton = document.getElementById('copy-selection-button');
    const controlsHost = document.getElementById('controls');
    const panelTitle = document.getElementById('panel-title');
    const statusEl = document.getElementById('viewer-status');
    const loadingEl = document.getElementById('loading');
    const resetButton = document.getElementById('reset-button');
    const fitButton = document.getElementById('fit-button');
    const rotateButton = document.getElementById('rotate-button');
    const previewSelection = document.getElementById('preview-selection');
    const previewSelectionLabel = document.getElementById('preview-selection-label');
    const previewSelectionClear = document.getElementById('preview-selection-clear');
    const canvas = document.getElementById('viewport');
    const graphStage = document.getElementById('graph-stage');
    const graphPanel = document.getElementById('graph-panel');
    const graphSvg = document.getElementById('graph-svg');
    const graphViewport = document.getElementById('graph-viewport');
    const graphEdges = document.getElementById('graph-edges');
    const graphNodes = document.getElementById('graph-nodes');
    const graphTabs = document.getElementById('graph-tabs');
    const graphSearch = document.getElementById('graph-search');
    const graphStatus = document.getElementById('graph-status');
    const graphDetail = document.getElementById('graph-detail');
    const graphLegend = document.getElementById('graph-legend');
    const anchorControls = document.getElementById('anchor-controls');
    const anchorRelations = document.getElementById('anchor-relations');
    const anchorClearFocusButton = document.getElementById('anchor-clear-focus');
    const graphFullscreenButton = document.getElementById('graph-fullscreen');
    const graphExpandButton = document.getElementById('graph-expand');
    const graphFitButton = document.getElementById('graph-fit');
    const tree3dControls = document.getElementById('tree3d-controls');
    const tree3dShowRealParts = document.getElementById('tree3d-show-real-parts');
    const tree3dShowShared = document.getElementById('tree3d-show-shared');
    const tree3dControlNote = document.getElementById('tree3d-control-note');
    const tree3dExportTransparentButton = document.getElementById('tree3d-export-transparent');
    const tree3dFullscreenButton = document.getElementById('tree3d-fullscreen');
    const tree3dStage = document.getElementById('tree3d-stage');
    const tree3dCanvas = document.getElementById('tree3d-canvas');
    const tree3dTooltip = document.getElementById('tree3d-tooltip');
    const editPanel = document.getElementById('edit-panel');
    const editParts = document.getElementById('edit-parts');
    const editState = document.getElementById('edit-state');
    const editResetAll = document.getElementById('edit-reset-all');
    const viewerPanel = canvas.parentElement;
    const comparisonToggle = document.getElementById('comparison-toggle');
    const comparisonPanel = document.getElementById('paper-comparison');
    const comparisonStatus = document.getElementById('comparison-status');
    const comparisonImages = document.getElementById('comparison-images');
    const comparisonPreset = document.getElementById('comparison-preset');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f9fa);
    scene.fog = null;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
    camera.up.set(0, 1, 0);
    camera.position.set(4.5, 3.3, 6.5);

    const orbit = new OrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.065;
    orbit.zoomSpeed = 0.35;
    orbit.autoRotateSpeed = 1.6;
    orbit.target.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x253040, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(5, 7, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8eb9ff, 1.7);
    fillLight.position.set(-5, 4, 3);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffd7a0, 1.2);
    rimLight.position.set(1, 5, 7);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(20, 40, 0xdadce0, 0xe8eaed);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    scene.add(grid);

    const loader = new GLTFLoader();
    let schema = null;
    const values = {};
    let currentModel = null;
    let previewHighlightRequest = null;
    const previewAnchorOverlay = new THREE.Group();
    previewAnchorOverlay.name = 'shared-anchor-overlay';
    scene.add(previewAnchorOverlay);
    const modelAnchors = createAnchorLayer(scene, runtimePointToPreview);

    const tree3dRenderer = new THREE.WebGLRenderer({
      canvas: tree3dCanvas,
      antialias: true,
      alpha: true,
    });
    tree3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    tree3dRenderer.outputColorSpace = THREE.SRGBColorSpace;
    tree3dRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    tree3dRenderer.toneMappingExposure = 1.1;
    tree3dRenderer.setClearColor(0x000000, 0);
    const tree3dScene = new THREE.Scene();
    const tree3dCamera = new THREE.PerspectiveCamera(46, 1, 0.01, 1000);
    tree3dCamera.position.set(8, 5.5, 10);
    const tree3dOrbit = new OrbitControls(tree3dCamera, tree3dCanvas);
    tree3dOrbit.enableDamping = true;
    tree3dOrbit.dampingFactor = 0.07;
    tree3dOrbit.zoomSpeed = 0.45;
    tree3dOrbit.target.set(0, -2, 0);
    tree3dScene.add(new THREE.HemisphereLight(0xddeaff, 0x142035, 2.1));
    const tree3dKeyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    tree3dKeyLight.position.set(5, 8, 6);
    tree3dScene.add(tree3dKeyLight);
    const tree3dRoot = new THREE.Group();
    tree3dRoot.name = 'pyramid-tree-root';
    tree3dScene.add(tree3dRoot);
    const tree3dRaycaster = new THREE.Raycaster();
    const tree3dPointer = new THREE.Vector2();
    const tree3dLevelGap = 3.75;
    const tree3dFitPadding = 0.82;
    let tree3dInteractiveObjects = [];
    let tree3dHoveredObject = null;
    let tree3dSelection = null;
    let tree3dContentBox = new THREE.Box3();
    let tree3dLastView = null;
    let tree3dLastLayout = null;
    let generationVersion = 0;
    let copySelectionTimer = null;
    let structureData = null;
    const partVisibilityByNode = new Map();
    const partVisibilityByRole = new Map();
    const graphState = {
      view: 'tree3d',
      collapsed: new Set(),
      selected: null,
      selectedEdge: null,
      anchorMode: 'confirmed',
      anchorFocusNode: null,
      tree3dShowShared: true,
      tree3dShowRealParts: false,
      query: '',
      scale: 1,
      tx: 20,
      ty: 20,
      dragging: false,
      dragX: 0,
      dragY: 0,
      startTx: 0,
      startTy: 0,
      positions: new Map(),
      content: { minX: 0, minY: 0, width: 1, height: 1 },
    };

    const svgNS = 'http://www.w3.org/2000/svg';
    const graphNodeWidth = 172;
    const graphNodeHeight = 56;
    const graphLeafGap = 214;
    const graphLevelGap = 132;

    function setStatus(message, kind = '') {
      statusEl.textContent = message;
      statusEl.className = `viewer-status ${kind}`.trim();
    }

    function setLoading(active) {
      loadingEl.classList.toggle('visible', active);
      loadingEl.setAttribute('aria-hidden', active ? 'false' : 'true');
    }

    function readRememberedSelection() {
      try {
        const selection = JSON.parse(localStorage.getItem(selectionStorageKey) || 'null');
        if (
          selection
          && typeof selection.source === 'string'
          && typeof selection.model === 'string'
        ) {
          return selection;
        }
      } catch (error) {
        console.warn('Unable to read the previous selection:', error);
      }
      return null;
    }

    function rememberSelection(sourceId, modelId) {
      if (!sourceId || !modelId) return;
      try {
        localStorage.setItem(
          selectionStorageKey,
          JSON.stringify({ source: sourceId, model: modelId }),
        );
      } catch (error) {
        console.warn('Unable to save the current selection:', error);
      }
    }

    function currentSelectionText() {
      const sourceLabel = sourceSelect.selectedOptions[0]?.textContent?.trim() || '';
      const modelOption = modelSelect.selectedOptions[0];
      const modelLabel = modelOption?.dataset.modelLabel || modelOption?.textContent?.trim() || '';
      const star = modelOption?.dataset.mustWatch === 'true' ? '★ ' : '';
      const failed = modelOption?.dataset.failed === 'true' ? '✗ ' : '';
      if (!sourceLabel || !modelLabel) return '';
      return `Code source: ${sourceLabel}\nModel: ${failed}${star}${modelLabel}`;
    }

    async function copyCurrentSelection() {
      const text = currentSelectionText();
      if (!text) {
        setStatus('There is no code source and model to copy.', 'error');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error('Clipboard access is unavailable in this browser.');
        }
        clearTimeout(copySelectionTimer);
        copySelectionButton.textContent = 'Copied';
        copySelectionButton.classList.add('copied');
        copySelectionTimer = setTimeout(() => {
          copySelectionButton.textContent = 'Copy model info';
          copySelectionButton.classList.remove('copied');
        }, 1600);
      } catch (error) {
        setStatus(`Copy failed: ${String(error.message || error)}`, 'error');
      }
    }

    function makeSvg(tag, attributes = {}) {
      const element = document.createElementNS(svgNS, tag);
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
      }
      return element;
    }

    function tree3dSourceView() {
      const anchors = structureData?.views?.anchors;
      if (anchors?.nodes?.length) return anchors;
      return structureData?.views?.parts || null;
    }

    function graphView() {
      if (graphState.view === 'tree3d') return tree3dSourceView();
      return structureData?.views?.[graphState.view] || null;
    }

    function truncateNodeLabel(value, length = 24) {
      const text = String(value);
      return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
    }

    function graphGroupColor(group) {
      const palette = ['#63a6ff', '#8f86ff', '#49c5ad', '#f0aa5d', '#dc7da1', '#7cbd69', '#d3bd59', '#58a9cb'];
      let hash = 0;
      for (const character of String(group || 'Other')) {
        hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
      }
      return palette[Math.abs(hash) % palette.length];
    }

    function computeLayeredGraphLayout(view) {
      const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
      const children = new Map(view.nodes.map((node) => [node.id, []]));
      const incoming = new Map(view.nodes.map((node) => [node.id, []]));
      for (const edge of view.edges) {
        if (!children.has(edge.parent)) children.set(edge.parent, []);
        if (!incoming.has(edge.child)) incoming.set(edge.child, []);
        children.get(edge.parent).push(edge);
        incoming.get(edge.child).push(edge);
      }
      for (const edges of children.values()) {
        edges.sort((a, b) => (a.line || 0) - (b.line || 0) || a.child.localeCompare(b.child));
      }

      const roots = (view.roots || []).filter((id) => nodeById.has(id));
      const inferred = view.nodes
        .filter((node) => !(incoming.get(node.id) || []).length)
        .sort((a, b) => (a.line || 0) - (b.line || 0))
        .map((node) => node.id);
      if (!roots.length) roots.push(...inferred);

      const structurallyReachable = new Set();
      function markReachable(id, path) {
        if (!nodeById.has(id) || path.has(id)) return;
        structurallyReachable.add(id);
        const nextPath = new Set(path);
        nextPath.add(id);
        for (const edge of children.get(id) || []) markReachable(edge.child, nextPath);
      }
      for (const root of roots) markReachable(root, new Set());
      for (const id of inferred) {
        if (!structurallyReachable.has(id)) {
          roots.push(id);
          markReachable(id, new Set());
        }
      }
      for (const node of [...view.nodes].sort((a, b) => (a.line || 0) - (b.line || 0))) {
        if (!structurallyReachable.has(node.id)) {
          roots.push(node.id);
          markReachable(node.id, new Set());
        }
      }

      const depthById = new Map();
      const queue = [];
      for (const root of roots) {
        if (!depthById.has(root)) {
          depthById.set(root, 0);
          queue.push(root);
        }
      }
      while (queue.length) {
        const id = queue.shift();
        if (graphState.collapsed.has(id)) continue;
        const depth = depthById.get(id) || 0;
        for (const edge of children.get(id) || []) {
          if (depthById.has(edge.child)) continue;
          depthById.set(edge.child, depth + 1);
          queue.push(edge.child);
        }
      }

      const columns = new Map();
      for (const [id, depth] of depthById) {
        if (!columns.has(depth)) columns.set(depth, []);
        columns.get(depth).push(id);
      }
      for (const ids of columns.values()) {
        ids.sort((left, right) => {
          const a = nodeById.get(left);
          const b = nodeById.get(right);
          return (a?.line || 0) - (b?.line || 0) || String(a?.label).localeCompare(String(b?.label));
        });
      }

      const positions = new Map();
      const columnGap = 224;
      const rowGap = 68;
      const groupInfo = new Map();
      for (const [id, depth] of depthById) {
        const node = nodeById.get(id);
        const group = String(node?.group || 'Other');
        if (!groupInfo.has(group)) {
          groupInfo.set(group, { label: group, minLine: node?.line || 0, byDepth: new Map() });
        }
        const info = groupInfo.get(group);
        info.minLine = Math.min(info.minLine, node?.line || 0);
        if (!info.byDepth.has(depth)) info.byDepth.set(depth, []);
        info.byDepth.get(depth).push(id);
      }
      const orderedGroups = [...groupInfo.values()].sort((a, b) => {
        if (a.label === 'Module') return -1;
        if (b.label === 'Module') return 1;
        return a.minLine - b.minLine || a.label.localeCompare(b.label);
      });
      const groupHeaders = [];
      let groupCursor = 0;
      for (const info of orderedGroups) {
        for (const ids of info.byDepth.values()) {
          ids.sort((left, right) => {
            const a = nodeById.get(left);
            const b = nodeById.get(right);
            return (a?.line || 0) - (b?.line || 0) || String(a?.label).localeCompare(String(b?.label));
          });
        }
        const rowCount = Math.max(1, ...[...info.byDepth.values()].map((ids) => ids.length));
        const nodeStartY = groupCursor + 25;
        for (const [depth, ids] of info.byDepth) {
          ids.forEach((id, index) => positions.set(id, { x: depth * columnGap, y: nodeStartY + index * rowGap }));
        }
        const groupHeight = 25 + rowCount * rowGap + 13;
        groupHeaders.push({ label: info.label, y: groupCursor, height: groupHeight });
        groupCursor += groupHeight + 10;
      }
      const visibleEdges = view.edges.filter(
        (edge) => positions.has(edge.parent) && positions.has(edge.child)
      );
      const points = [...positions.values()];
      const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 0;
      const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 0;
      return {
        orientation: 'lr',
        nodeById,
        children,
        incoming,
        positions,
        groupHeaders,
        visibleEdges,
        content: {
          minX: 0,
          minY: 0,
          width: Math.max(graphNodeWidth, maxX + graphNodeWidth),
          height: Math.max(graphNodeHeight, maxY + graphNodeHeight + 13),
        },
      };
    }

    function computeGraphLayout(view) {
      if (
        graphState.view === 'definitions'
        || graphState.view === 'calls'
        || graphState.view === 'parts'
        || graphState.view === 'anchors'
      ) {
        return computeLayeredGraphLayout(view);
      }
      const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
      const children = new Map(view.nodes.map((node) => [node.id, []]));
      const incoming = new Map(view.nodes.map((node) => [node.id, []]));
      for (const edge of view.edges) {
        if (!children.has(edge.parent)) children.set(edge.parent, []);
        if (!incoming.has(edge.child)) incoming.set(edge.child, []);
        children.get(edge.parent).push(edge);
        incoming.get(edge.child).push(edge);
      }
      for (const edges of children.values()) {
        edges.sort((a, b) => (a.line || 0) - (b.line || 0) || a.child.localeCompare(b.child));
      }

      const declaredRoots = (view.roots || []).filter((id) => nodeById.has(id));
      const inferredRoots = view.nodes
        .filter((node) => !(incoming.get(node.id) || []).length)
        .map((node) => node.id);
      const roots = declaredRoots.length ? declaredRoots : inferredRoots;
      const positions = new Map();
      const visible = new Set();
      const structurallyReachable = new Set();
      let leafCursor = 0;

      function markReachable(id, path) {
        if (!nodeById.has(id) || path.has(id)) return;
        structurallyReachable.add(id);
        const nextPath = new Set(path);
        nextPath.add(id);
        for (const edge of children.get(id) || []) markReachable(edge.child, nextPath);
      }

      for (const root of roots) markReachable(root, new Set());

      function place(id, depth, path) {
        if (!nodeById.has(id) || path.has(id)) return null;
        if (positions.has(id)) return positions.get(id).x;
        visible.add(id);
        const nextPath = new Set(path);
        nextPath.add(id);
        const outgoing = graphState.collapsed.has(id) ? [] : (children.get(id) || []);
        const childXs = [];
        for (const edge of outgoing) {
          const childX = place(edge.child, depth + 1, nextPath);
          if (childX !== null) childXs.push(childX);
        }
        const x = childXs.length
          ? (Math.min(...childXs) + Math.max(...childXs)) / 2
          : leafCursor++ * graphLeafGap;
        positions.set(id, { x, y: depth * graphLevelGap });
        return x;
      }

      for (const root of roots) place(root, 0, new Set());
      for (const node of view.nodes) {
        if (!positions.has(node.id) && !structurallyReachable.has(node.id)) {
          place(node.id, 0, new Set());
        }
      }

      const visibleEdges = view.edges.filter(
        (edge) => positions.has(edge.parent) && positions.has(edge.child)
      );
      const points = [...positions.values()];
      const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
      const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 0;
      const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 0;
      return {
        orientation: 'tb',
        nodeById,
        children,
        incoming,
        positions,
        visible,
        visibleEdges,
        content: {
          minX,
          minY: 0,
          width: Math.max(graphNodeWidth, maxX - minX + graphNodeWidth),
          height: Math.max(graphNodeHeight, maxY + graphNodeHeight),
        },
      };
    }

    function updateGraphTransform() {
      graphViewport.setAttribute(
        'transform',
        `translate(${graphState.tx} ${graphState.ty}) scale(${graphState.scale})`
      );
    }

    function formatGraphNumber(value) {
      if (value === null || value === undefined || value === '') return 'Unknown';
      const number = Number(value);
      if (!Number.isFinite(number)) return 'Unknown';
      if (Math.abs(number) >= 0.01) return number.toFixed(4);
      return number.toExponential(2);
    }

    function partNodeIsVisible(nodeOrId) {
      const node = typeof nodeOrId === 'string'
        ? structureData?.views?.parts?.nodes?.find((item) => item.id === nodeOrId)
        : nodeOrId;
      if (!node) return true;
      const nodeVisibilityId = partVisibilityByNode.get(node.id);
      if (nodeVisibilityId) return values[nodeVisibilityId] !== false;
      const partName = String(node.part_name || node.id || '');
      const role = partName.split('_', 1)[0];
      const roleVisibilityId = partVisibilityByRole.get(role);
      return roleVisibilityId ? values[roleVisibilityId] !== false : true;
    }

    function runtimeRelationLabel(edge) {
      if (edge.preview_only) return 'Browser preview · checks not rerun';
      if (edge.runtime_pending) return 'Code parent → child · Waiting for Blender 5.0 to compute anchors';
      if (edge.shared_anchor) {
        if (edge.parent_child_known) return 'Shared anchor · Confirmed parent → child';
        return 'Shared anchor · Direction unknown';
      }
      const labels = {
        DIRECTED: 'Runtime-confirmed parent → child · Estimated anchors (not shared)',
        DIRECTED_CODE: 'Code-confirmed parent → child · Estimated anchors (not shared)',
        COUPLED: 'Bidirectional coupling · Estimated anchors (not shared)',
        DECLARED_CONSTRUCTION: 'Declared connection · Estimated anchors (not shared)',
        UNDIRECTED_CONTACT: 'Contact only · Estimated anchors (not shared)',
        BROKEN_ATTACHMENT: 'Parent-child relation exists, but the connection is broken or anchors are misaligned',
        UNOBSERVABLE: 'Insufficient evidence · Estimated anchors (not shared)',
      };
      return labels[edge.relation] || edge.relation;
    }

    function isStrictAnchorEdge(edge) {
      return Boolean(
        !edge.preview_only && edge.directed_verified
        && edge.contact
        && edge.shared_anchor
        && (edge.relation === 'DIRECTED' || edge.relation === 'DIRECTED_CODE')
      );
    }

    function isDirectedAnchorEdge(edge) {
      return Boolean(edge.parent_child_known || edge.directed_verified);
    }

    function anchorEdgeKey(edge) {
      return [
        edge.parent,
        edge.child,
        edge.relation,
        Number(edge.anchor_gap ?? -1).toPrecision(9),
      ].join('|');
    }

    function anchorModeLabel(mode) {
      return {
        confirmed: 'Parent–Child',
        shared: 'Anchors',
        all: 'All Relations',
      }[mode] || mode;
    }

    function authoredAnchorStats(edge) {
      if (edge.preview_only) return null;
      const count = Number(edge.authored_anchor_count);
      if (!Number.isInteger(count) || count <= 0) return null;
      const validValue = Number(edge.authored_anchor_valid_count);
      const valid = Number.isInteger(validValue)
        ? Math.max(0, Math.min(count, validValue))
        : (edge.authored_anchor_valid ? count : 0);
      return { count, valid };
    }

    function authoredAnchorSummary(edge, compact = false) {
      const stats = authoredAnchorStats(edge);
      if (!stats) return '';
      return compact
        ? `Authored anchors ${stats.valid}/${stats.count}`
        : `Source-authored anchors: ${stats.valid}/${stats.count} pairs lie on the parent and child body meshes`;
    }

    function anchorEdgeMatches(edge, mode = graphState.anchorMode) {
      if (mode === 'confirmed') return isDirectedAnchorEdge(edge);
      if (mode === 'shared') return isAnchorDisplayEdge(edge);
      return true;
    }

    function anchorRelationListView(view) {
      if (graphState.view !== 'anchors') return view;
      let edges = view.edges.filter((edge) => anchorEdgeMatches(edge));
      if (graphState.anchorFocusNode) {
        edges = edges.filter(
          (edge) => edge.parent === graphState.anchorFocusNode || edge.child === graphState.anchorFocusNode
        );
      }
      const nodeIds = new Set(edges.flatMap((edge) => [edge.parent, edge.child]));
      if (graphState.anchorFocusNode) nodeIds.add(graphState.anchorFocusNode);
      if (!edges.length && view.nodes.length === 1) nodeIds.add(view.nodes[0].id);
      return {
        ...view,
        nodes: view.nodes.filter((node) => nodeIds.has(node.id)),
        edges,
        roots: (view.roots || []).filter((id) => nodeIds.has(id)),
      };
    }

    function anchorDisplayView(view) {
      return anchorRelationListView(view);
    }

    function staticAnchorFallback(partsView) {
      const sourceNodes = partsView?.nodes || [];
      const physicalRelations = new Set([
        'DIRECTED_CODE',
        'PARENT_ASSIGNMENT',
        'METHOD_DATAFLOW',
        'ATTACHMENT_CALL',
      ]);
      const sourceEdges = (partsView?.edges || []).filter(
        (edge) => physicalRelations.has(edge.relation)
      );
      const nodeIds = new Set(
        sourceEdges.flatMap((edge) => [edge.parent, edge.child])
      );
      const nodes = sourceNodes.filter((node) => nodeIds.has(node.id)).map((node) => ({
        ...node,
        kind: 'source_attachment_part',
        group: node.group || 'Source parent-child parts',
        origin: null,
        dimensions: null,
      }));
      const edges = sourceEdges
        .filter((edge) => nodeIds.has(edge.parent) && nodeIds.has(edge.child))
        .map((edge) => ({
          parent: edge.parent,
          child: edge.child,
          relation: 'DIRECTED_CODE',
          source_relation: edge.relation,
          line: edge.line || 0,
          evidence: `Source relation: ${edge.evidence || edge.relation || 'parent-child construction'}`,
          directed_verified: false,
          parent_child_known: true,
          direction_source: 'static_code',
          contact: null,
          shared_anchor: false,
          geometric_anchor_aligned: null,
          shared_anchor_evidence: null,
          anchor_estimated: false,
          anchor_method: 'static_source_attachment_pending_runtime',
          anchor_a: null,
          anchor_b: null,
          anchor_gap: null,
          anchor_tolerance: null,
          aabb_gap: null,
          declared_directions: [{
            parent: edge.parent,
            child: edge.child,
            source: edge.relation || 'static_code',
            line: edge.line || 0,
          }],
          runtime_pending: true,
        }));
      const incoming = new Set(edges.map((edge) => edge.child));
      const roots = (partsView?.roots || []).filter((id) => nodeIds.has(id));
      if (!roots.length) roots.push(...nodes.map((node) => node.id).filter((id) => !incoming.has(id)));
      return {
        label: 'Source parent-child anchor graph (Blender validation in progress)',
        roots,
        nodes,
        edges,
        summary: {
          nodes: nodes.length,
          edges: edges.length,
          directed_edges: edges.length,
          runtime_directed_edges: 0,
          shared_anchor_edges: 0,
          estimated_anchor_edges: 0,
        },
        runtime_pending: true,
        runtime_error: null,
      };
    }

    function edgeVisual(edge) {
      if (edge.preview_only) return {
        className: isDirectedAnchorEdge(edge) ? 'edge-directed-code' : 'edge-unknown',
        markerEnd: isDirectedAnchorEdge(edge) ? 'url(#graph-arrow-code)' : '',
        label: 'Browser preview · checks not rerun',
      };
      if (graphState.view === 'anchors') {
        const strictDirected = isStrictAnchorEdge(edge);
        if (strictDirected) {
          return {
            className: 'edge-confirmed',
            markerEnd: 'url(#graph-arrow-confirmed)',
            label: runtimeRelationLabel(edge),
          };
        }
        if (edge.relation === 'BROKEN_ATTACHMENT') {
          return { className: 'edge-broken', markerEnd: '', label: runtimeRelationLabel(edge) };
        }
        if (edge.shared_anchor) {
          return { className: 'edge-anchor', markerEnd: '', label: runtimeRelationLabel(edge) };
        }
        if (edge.relation === 'COUPLED') {
          return { className: 'edge-coupled', markerEnd: '', label: runtimeRelationLabel(edge) };
        }
        if (isDirectedAnchorEdge(edge)) {
          return {
            className: 'edge-directed-code',
            markerEnd: 'url(#graph-arrow-code)',
            label: runtimeRelationLabel(edge),
          };
        }
        if (edge.contact || edge.relation === 'UNDIRECTED_CONTACT' || edge.relation === 'DECLARED_CONSTRUCTION') {
          return { className: 'edge-contact', markerEnd: '', label: runtimeRelationLabel(edge) };
        }
        return { className: 'edge-unknown', markerEnd: '', label: runtimeRelationLabel(edge) };
      }
      if (graphState.view === 'parts') {
        const directedRelations = new Set([
          'DIRECTED_CODE',
          'PARENT_ASSIGNMENT',
          'METHOD_DATAFLOW',
          'ATTACHMENT_CALL',
        ]);
        if (directedRelations.has(edge.relation)) {
          return {
            className: 'edge-static-directed',
            markerEnd: 'url(#graph-arrow-code)',
            label: `${edge.relation} · Pending anchor validation`,
          };
        }
        return {
          className: 'edge-static-construction',
          markerEnd: 'url(#graph-arrow-code)',
          label: `${edge.relation} · Construction relation`,
        };
      }
      return { className: '', markerEnd: 'url(#graph-arrow-code)', label: edge.relation || '' };
    }

    function updateGraphLegend() {
      const anchorView = graphState.view === 'anchors';
      const tree3dView = graphState.view === 'tree3d';
      const preview = Boolean(structureData?.views?.anchors?.preview_only);
      graphPanel.classList.toggle('browser-preview', preview);
      tree3dShowShared.disabled = false;
      anchorControls.hidden = !anchorView;
      tree3dControls.hidden = !tree3dView;
      anchorRelations.hidden = !anchorView || tree3dView;
      anchorClearFocusButton.hidden = !graphState.anchorFocusNode;
      graphPanel.classList.toggle('anchor-view', anchorView || tree3dView);
      graphSearch.hidden = tree3dView;
      graphExpandButton.hidden = tree3dView;
      for (const button of anchorControls.querySelectorAll('[data-anchor-mode]')) {
        button.disabled = false;
        const active = button.dataset.anchorMode === graphState.anchorMode;
        const anchorViewData = structureData?.views?.anchors;
        const count = anchorViewData?.edges?.filter(
          (edge) => anchorEdgeMatches(edge, button.dataset.anchorMode)
        ).length || 0;
        button.textContent = `${anchorModeLabel(button.dataset.anchorMode)} ${button.disabled ? '—' : count}`;
        button.title = preview ? 'Browser preview: contact and shared-anchor checks have not been rerun.' : ({
          confirmed: 'Show parent → child directions. Use Anchors to inspect saved attachment coordinates.',
          shared: 'Display parent and child attachment coordinates. Showing an anchor does not mean its attachment has passed validation.',
          all: 'Show every relation found by runtime analysis',
        })[button.dataset.anchorMode] || '';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      if (preview && ['anchors', 'tree3d', 'parts'].includes(graphState.view)) {
        graphLegend.hidden = false;
        graphLegend.textContent = 'Browser preview · checks not rerun. Anchor points stay visible and follow the edited geometry.';
        return;
      }
      if (tree3dView) {
        graphLegend.hidden = false;
        graphLegend.innerHTML = `
          <span class="graph-legend-item"><i class="graph-legend-line" style="border-color:#f1c75b"></i>Gold: top-level root parents</span>
          <span class="graph-legend-item"><i class="graph-legend-line code"></i>Blue: intermediate parent/child nodes and parent-child directions</span>
          <span class="graph-legend-item"><i class="graph-legend-line unknown"></i>Gray-purple: bottom-level leaf-only children</span>
          <span class="graph-legend-item"><i class="graph-legend-line confirmed"></i>Green: verified shared anchors</span>
          <span class="graph-legend-item"><i class="graph-legend-line code"></i>Blue / gold: attachment coordinates</span>`;
        return;
      }
      if (graphState.view === 'anchors') {
        graphLegend.hidden = false;
        const anchorViewData = structureData?.views?.anchors;
        if (anchorViewData?.nodes?.length && !anchorViewData?.edges?.length) {
          graphLegend.innerHTML = `
            <span class="graph-legend-item"><i class="graph-legend-line unknown"></i>Analysis complete: the current model has ${anchorViewData.nodes.length} runtime meshes; no physical parent-child or shared-anchor relations were found</span>`;
          return;
        }
        graphLegend.innerHTML = `
          <span class="graph-legend-item"><i class="graph-legend-line confirmed"></i>Green: shared anchor; arrows indicate a known parent → child direction</span>
          <span class="graph-legend-item"><i class="graph-legend-line code"></i>Blue arrow: known parent → child direction; A/B are estimated, non-shared anchors</span>
          <span class="graph-legend-item"><i class="graph-legend-line contact"></i>Yellow dashed line: contact only; A/B are estimated, non-shared anchors</span>
          <span class="graph-legend-item"><i class="graph-legend-line broken"></i>Broken attachment / anchor misalignment</span>
          <span class="graph-legend-item"><i class="graph-legend-line unknown"></i>Gray dotted line: geometric proximity only; A/B are estimated, non-shared anchors</span>`;
        return;
      }
      if (graphState.view === 'parts') {
        graphLegend.hidden = false;
        graphLegend.innerHTML = `
          <span class="graph-legend-item"><i class="graph-legend-line static-code"></i>Observed parent–child relation</span>
          <span class="graph-legend-item"><i class="graph-legend-line static-construction"></i>Only green relations have verified shared anchors</span>`;
        return;
      }
      graphLegend.hidden = true;
      graphLegend.replaceChildren();
    }

    function showAnchorEdgeDetail(edge) {
      if (edge.preview_only) {
        graphDetail.textContent = `${edge.parent} → ${edge.child}\nBrowser preview · checks not rerun\nEndpoint A: ${anchorPointCoordinate(edge.anchor_a)}\nEndpoint B: ${anchorPointCoordinate(edge.anchor_b)}\nCurrent endpoint gap: ${formatGraphNumber(edge.anchor_gap)}\nContact and shared-anchor validity: not evaluated`;
        return;
      }
      const connector = isDirectedAnchorEdge(edge) ? ' → ' : ' — ';
      const contactLabel = edge.contact === null || edge.contact === undefined
        ? 'Waiting for Blender 5.0'
        : (edge.contact ? 'Yes' : 'No');
      const alignmentLabel = edge.geometric_anchor_aligned === null
        || edge.geometric_anchor_aligned === undefined
        ? 'Waiting for Blender 5.0'
        : (edge.geometric_anchor_aligned ? 'Yes' : 'No');
      const lines = [
        `${edge.parent}${connector}${edge.child}`,
        `Relation: ${runtimeRelationLabel(edge)}`,
        `Parent-child direction: ${isDirectedAnchorEdge(edge) ? 'Known' : 'Unknown'}; Contact: ${contactLabel}; Candidate within distance threshold: ${alignmentLabel}`,
        `Anchor type: ${edge.shared_anchor ? 'Shared anchor' : 'Separate, non-shared A/B anchor candidates'}`,
        `Anchor method: ${anchorMethodLabel(edge)}`,
        `Shared evidence: ${sharedAnchorEvidenceLabel(edge)}`,
        `Anchor gap: ${formatGraphNumber(edge.anchor_gap)}; Tolerance: ${formatGraphNumber(edge.anchor_tolerance)}`,
      ];
      const authoredSummary = authoredAnchorSummary(edge);
      if (authoredSummary) {
        lines.push(
          authoredSummary,
          `Parent anchor to body vertex: ${formatGraphNumber(edge.parent_anchor_vertex_gap)}; Child anchor to body vertex: ${formatGraphNumber(edge.child_anchor_vertex_gap)}`
        );
      }
      if (edge.parameter_invariance) {
        lines.push(
          `Parameter perturbation: enlarge parent only=${edge.parameter_invariance.parent_scale_passed ? 'Pass' : 'Fail'}; enlarge child only=${edge.parameter_invariance.child_scale_passed ? 'Pass' : 'Fail'}`
        );
      }
      if (edge.anchor_a?.length === 3 && edge.anchor_b?.length === 3) {
        lines.push(
          `A world coordinates: (${edge.anchor_a.map((value) => formatGraphNumber(value)).join(', ')})`,
          `B world coordinates: (${edge.anchor_b.map((value) => formatGraphNumber(value)).join(', ')})`
        );
      }
      graphDetail.textContent = lines.join('\n');
    }

    function sharedAnchorCoordinate(edge) {
      const pair = displayAnchorPairs(edge)[0];
      if (!pair) return 'Coordinates unavailable';
      return `Parent ${anchorPointCoordinate(pair.parent)}\nChild ${anchorPointCoordinate(pair.child)}`;
    }

    function compactSharedAnchorCoordinate(edge) {
      const pair = displayAnchorPairs(edge)[0];
      if (!pair) return 'Coordinates unavailable';
      return pair.parent.map((value) => {
        const normalized = Math.abs(value) < 0.005 ? 0 : value;
        return normalized.toFixed(2);
      }).join(', ');
    }

    function anchorPointCoordinate(values) {
      if (values?.length !== 3) return 'Coordinates unavailable';
      return `(${values.map((value) => formatGraphNumber(value)).join(', ')})`;
    }

    function anchorMethodLabel(edge) {
      if (edge.preview_only) return 'Current browser geometry transforms';
      if (edge.shared_anchor && edge.parameter_invariance?.passed) {
        return 'Explicit shared anchor in source; Blender 5.0 revalidated it after independently enlarging the parent and child';
      }
      if (edge.shared_anchor) return 'Explicit shared anchor in source, verified by Blender 5.0';
      if (edge.anchor_method === 'static_source_attachment_pending_runtime') {
        return 'Parent-child call found in source; Blender 5.0 is computing A/B world coordinates and contact state';
      }
      if (edge.anchor_method === 'authored_local_mesh_vertices') {
        const summary = authoredAnchorSummary(edge);
        return edge.authored_anchor_valid
          ? `${summary || 'Source-authored parent/child local anchors are valid'} and coincide in world space`
          : `${summary || 'Source provides local anchors, but at least one endpoint is invalid'}; detached patches do not count as body-mesh anchors`;
      }
      if (edge.anchor_method === 'nearest_evaluated_mesh_vertex_samples') {
        return 'Blender 5.0 samples up to 96 vertices from each mesh and selects the nearest A/B points; these are estimates, not source-authored anchors';
      }
      return edge.anchor_estimated ? 'Algorithm estimate, not source-authored' : 'Unknown';
    }

    function sharedAnchorEvidenceLabel(edge) {
      if (edge.preview_only) return 'Not evaluated for this browser preview';
      return ({
        runtime_direction: 'One-way runtime coupling',
        code_direction: 'One-way code data flow',
        runtime_or_code_coupling: 'Bidirectional runtime coupling or code connection',
        code_construction: 'Code connection/construction record',
        explicit_anchor_id: 'Parent and child declare the same anchor ID',
        declared_world_anchor: 'Source declares the same world-space anchor',
        authored_anchor_pair: 'Source declares a paired parent/child local anchor',
      })[edge.shared_anchor_evidence] || (edge.shared_anchor ? 'Proven (source not specified)' : 'No explicit shared evidence');
    }

    function renderSharedAnchorLanes(rawView, view) {
      anchorRelations.hidden = true;
      if (!view.edges.length) {
        const message = makeSvg('text', { class: 'graph-empty', x: 410, y: 120 });
        message.textContent = graphState.anchorFocusNode
          ? `${String(graphState.anchorFocusNode)} has no saved anchor coordinates`
          : 'The current model has no saved anchor coordinates';
        graphNodes.append(message);
        graphStatus.textContent = `Anchors · 0/${rawView.edges.length} relations`;
        graphState.positions = new Map();
        graphState.content = { minX: 0, minY: 0, width: 820, height: 240 };
        updateGraphTransform();
        return;
      }

      if (
        graphState.selectedEdge
        && !view.edges.some((edge) => anchorEdgeKey(edge) === graphState.selectedEdge)
      ) graphState.selectedEdge = null;

      const nodeById = new Map(rawView.nodes.map((node) => [node.id, node]));
      const positions = new Map();
      const laneWidth = 890;
      const laneHeight = 102;
      const laneGap = 10;
      const laneX = 8;
      const endpointWidth = 220;
      const endpointHeight = 64;
      const leftX = 42;
      const centerX = 326;
      const centerWidth = 248;
      const rightX = 638;
      const query = graphState.query.trim().toLowerCase();

      function endpointGroup(node, x, y, role, side) {
        const group = makeSvg('g', {
          class: `anchor-lane-node endpoint-${side}`,
          transform: `translate(${x} ${y})`,
          'data-graph-node': node.id,
          role: 'button',
          tabindex: '0',
          'aria-label': `${role} ${node.label}`,
        });
        if (graphState.selected === node.id) group.classList.add('selected');
        if (
          query
          && (
            String(node.label).toLowerCase().includes(query)
            || String(node.id).toLowerCase().includes(query)
            || String(node.part_name || '').toLowerCase().includes(query)
          )
        ) group.classList.add('selected');
        group.append(makeSvg('rect', {
          x: 0,
          y: 0,
          width: endpointWidth,
          height: endpointHeight,
          rx: 9,
        }));
        const roleText = makeSvg('text', { class: 'anchor-lane-role', x: 12, y: 16 });
        roleText.textContent = role;
        group.append(roleText);
        const label = makeSvg('text', { class: 'anchor-lane-label', x: 12, y: 36 });
        label.textContent = truncateNodeLabel(node.label, 30);
        group.append(label);
        const meta = makeSvg('text', { class: 'anchor-lane-meta', x: 12, y: 53 });
        meta.textContent = truncateNodeLabel(node.part_name || node.group || node.id, 34);
        group.append(meta);
        const title = makeSvg('title');
        title.textContent = `${role}: ${node.label}\nHover: highlight only this object; move away: clear all highlights`;
        group.append(title);
        group.addEventListener('pointerenter', () => {
          highlightPreviewGraphNodes([node], view, `${role}: ${node.label}`);
        });
        group.addEventListener('pointerleave', () => {
          restorePinnedPreviewSelection();
        });
        return group;
      }

      view.edges.forEach((edge, index) => {
        const key = anchorEdgeKey(edge);
        const selected = graphState.selectedEdge === key;
        const confirmed = isStrictAnchorEdge(edge);
        const verified = anchorDisplayVerified(edge);
        const directed = isDirectedAnchorEdge(edge);
        const rowY = index * (laneHeight + laneGap) + 8;
        const endpointY = rowY + 19;
        const lineY = endpointY + endpointHeight / 2;
        const parentNode = nodeById.get(edge.parent) || { id: edge.parent, label: edge.parent };
        const childNode = nodeById.get(edge.child) || { id: edge.child, label: edge.child };

        const background = makeSvg('rect', {
          class: `anchor-lane-bg${selected ? ' selected' : ''}`,
          x: laneX,
          y: rowY,
          width: laneWidth,
          height: laneHeight,
          rx: 10,
        });
        graphEdges.append(background);
        const number = makeSvg('text', {
          class: 'anchor-lane-number',
          x: 25,
          y: rowY + laneHeight / 2,
        });
        number.textContent = String(index + 1);
        graphEdges.append(number);

        for (const [x1, x2] of [
          [leftX + endpointWidth, centerX],
          [centerX + centerWidth, rightX],
        ]) {
          graphEdges.append(makeSvg('path', {
            class: 'anchor-lane-connector-halo',
            d: `M ${x1} ${lineY} L ${x2} ${lineY}`,
          }));
          const connector = makeSvg('path', {
            class: `anchor-lane-connector${confirmed ? ' confirmed' : ''}${verified ? '' : ' unverified'}`,
            d: `M ${x1} ${lineY} L ${x2} ${lineY}`,
          });
          if (confirmed && x2 === rightX) connector.setAttribute('marker-end', 'url(#graph-arrow-confirmed)');
          graphEdges.append(connector);
        }

        const center = makeSvg('g', {
          class: `anchor-lane-center${confirmed ? ' confirmed' : ''}${verified ? '' : ' unverified'}${selected ? ' selected' : ''}`,
          transform: `translate(${centerX} ${endpointY})`,
          'data-anchor-edge': key,
          role: 'button',
          tabindex: '0',
          'aria-label': `View attachment anchors between ${edge.parent} and ${edge.child}`,
        });
        center.append(makeSvg('rect', {
          x: 0,
          y: 0,
          width: centerWidth,
          height: endpointHeight,
          rx: 9,
        }));
        const centerTitle = makeSvg('text', {
          class: 'anchor-lane-center-title',
          x: centerWidth / 2,
          y: 16,
        });
        centerTitle.textContent = verified ? 'Verified shared anchor'
          : edge.preview_only ? 'Anchor pair · Preview' : 'Attachment anchor pair';
        center.append(centerTitle);
        const coordinate = makeSvg('text', {
          class: 'anchor-lane-center-coordinate',
          x: centerWidth / 2,
          y: 36,
        });
        const pair = displayAnchorPairs(edge)[0];
        coordinate.textContent = pair ? `Parent ${pair.parent.map((value) => value.toFixed(2)).join(', ')}` : 'Coordinates unavailable';
        center.append(coordinate);
        const centerMeta = makeSvg('text', {
          class: 'anchor-lane-center-meta',
          x: centerWidth / 2,
          y: 53,
        });
        const authored = authoredAnchorSummary(edge, true);
        centerMeta.textContent = edge.preview_only ? 'Checks not rerun' : verified
          ? `${authored ? `${authored} · ` : ''}Gap ${formatGraphNumber(edge.anchor_gap)}`
          : 'Coordinates shown · not verified as shared';
        center.append(centerMeta);
        const centerTooltip = makeSvg('title');
        centerTooltip.textContent = `${edge.parent} — ${edge.child}\n${runtimeRelationLabel(edge)}\nHover to highlight both parts and their attachment coordinates.`;
        center.append(centerTooltip);
        center.addEventListener('pointerenter', () => {
          const pairLabel = confirmed
            ? `Parent: ${edge.parent} + Child: ${edge.child}`
            : `Endpoint A: ${edge.parent} + Endpoint B: ${edge.child}`;
          highlightPreviewGraphNodes(
            [parentNode, childNode],
            view,
            pairLabel,
            edge
          );
        });
        center.addEventListener('pointerleave', () => {
          restorePinnedPreviewSelection();
        });

        graphNodes.append(
          endpointGroup(parentNode, leftX, endpointY, directed ? 'Parent' : 'Endpoint A', 'a'),
          center,
          endpointGroup(childNode, rightX, endpointY, directed ? 'Child' : 'Endpoint B', 'b')
        );
        if (!positions.has(parentNode.id)) positions.set(parentNode.id, { x: leftX, y: endpointY });
        if (!positions.has(childNode.id)) positions.set(childNode.id, { x: rightX, y: endpointY });
      });

      graphState.positions = positions;
      graphState.content = {
        minX: 0,
        minY: 0,
        width: laneWidth + 16,
        height: view.edges.length * (laneHeight + laneGap) + 6,
      };
      const focus = graphState.anchorFocusNode ? ` · Showing only ${String(graphState.anchorFocusNode)}` : '';
      graphStatus.textContent = `Anchors · ${view.edges.length} relations${focus} · Hover or click an anchor pair to inspect its attachment coordinates`;
      updateGraphTransform();
    }

    function renderAnchorRelations(view) {
      anchorRelations.replaceChildren();
      if (graphState.view !== 'anchors') return;
      if (graphState.anchorMode === 'shared') {
        anchorRelations.hidden = true;
        return;
      }
      anchorRelations.hidden = false;
      if (!view.edges.length) {
        const empty = document.createElement('div');
        empty.className = 'anchor-relation-meta';
        empty.textContent = `No relations in “${anchorModeLabel(graphState.anchorMode)}” mode. Choose another filter above.`;
        anchorRelations.append(empty);
        return;
      }
      view.edges.forEach((edge, index) => {
        const visual = edgeVisual(edge);
        const key = anchorEdgeKey(edge);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'anchor-relation-card';
        button.dataset.anchorEdge = key;
        button.classList.toggle('active', graphState.selectedEdge === key);
        button.setAttribute('aria-label', `View relation ${index + 1}: ${edge.parent} to ${edge.child}`);

        const swatch = document.createElement('span');
        swatch.className = `anchor-relation-swatch ${visual.className}`;
        const content = document.createElement('span');
        const main = document.createElement('span');
        main.className = 'anchor-relation-main';
        main.textContent = `${index + 1}. ${edge.parent}${isDirectedAnchorEdge(edge) ? ' → ' : ' — '}${edge.child}`;
        const meta = document.createElement('span');
        meta.className = 'anchor-relation-meta';
        const authored = authoredAnchorSummary(edge, true);
        meta.textContent = `${runtimeRelationLabel(edge)}${authored ? ` · ${authored}` : ''} · Gap ${formatGraphNumber(edge.anchor_gap)}`;
        content.append(main, meta);
        button.append(swatch, content);
        anchorRelations.append(button);
      });
    }

    function selectAnchorEdge(key) {
      const view = graphView();
      const edge = view?.edges.find((candidate) => anchorEdgeKey(candidate) === key);
      if (!edge) return;
      graphState.selectedEdge = key;
      graphState.selected = null;
      highlightAnchorEdge(edge, view);
      showAnchorEdgeDetail(edge);
      renderGraph();
    }

    function highlightAnchorEdge(edge, view) {
      const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
      const endpoints = [nodeById.get(edge.parent), nodeById.get(edge.child)].filter(Boolean);
      const pairLabel = isStrictAnchorEdge(edge)
        ? `Parent: ${edge.parent} + Child: ${edge.child}`
        : `Endpoint A: ${edge.parent} + Endpoint B: ${edge.child}`;
      highlightPreviewGraphNodes(endpoints, view, pairLabel, edge);
    }

    function clearTree3DScene() {
      tree3dInteractiveObjects = [];
      tree3dHoveredObject = null;
      tree3dSelection = null;
      tree3dTooltip.hidden = true;
      tree3dRoot.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (!object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.map) material.map.dispose();
          material.dispose();
        }
      });
      tree3dRoot.clear();
      tree3dContentBox = new THREE.Box3();
    }

    function tree3dDirectedEdges(view) {
      const isRuntimeView = view === structureData?.views?.anchors;
      const selected = new Map();
      for (const edge of view?.edges || []) {
        if (isRuntimeView && !isDirectedAnchorEdge(edge)) continue;
        const key = `${edge.parent}|${edge.child}`;
        const existing = selected.get(key);
        const priority = (edge.shared_anchor ? 4 : 0)
          + (edge.directed_verified ? 2 : 0)
          + (edge.parent_child_known ? 1 : 0);
        const existingPriority = existing
          ? (existing.shared_anchor ? 4 : 0)
            + (existing.directed_verified ? 2 : 0)
            + (existing.parent_child_known ? 1 : 0)
          : -1;
        if (!existing || priority > existingPriority) selected.set(key, edge);
      }
      return [...selected.values()];
    }

    function computeTree3DPyramidLayout(view) {
      const nodeById = new Map((view?.nodes || []).map((node) => [node.id, node]));
      const edges = tree3dDirectedEdges(view).filter(
        (edge) => nodeById.has(edge.parent) && nodeById.has(edge.child)
      );
      const outgoing = new Map([...nodeById.keys()].map((id) => [id, []]));
      const incoming = new Map([...nodeById.keys()].map((id) => [id, []]));
      for (const edge of edges) {
        outgoing.get(edge.parent).push(edge);
        incoming.get(edge.child).push(edge);
      }

      const indegree = new Map([...nodeById.keys()].map((id) => [id, incoming.get(id).length]));
      const roots = [...nodeById.keys()]
        .filter((id) => indegree.get(id) === 0 && outgoing.get(id).length > 0)
        .sort((a, b) => a.localeCompare(b));
      if (!roots.length && edges.length) {
        const largestParent = [...nodeById.keys()].sort(
          (a, b) => outgoing.get(b).length - outgoing.get(a).length || a.localeCompare(b)
        )[0];
        if (largestParent) roots.push(largestParent);
      }

      const depth = new Map(roots.map((id) => [id, 0]));
      const queue = [...roots];
      const processed = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (processed.has(id)) continue;
        processed.add(id);
        for (const edge of outgoing.get(id) || []) {
          depth.set(edge.child, Math.max(depth.get(edge.child) || 0, (depth.get(id) || 0) + 1));
          indegree.set(edge.child, Math.max(0, (indegree.get(edge.child) || 0) - 1));
          if (indegree.get(edge.child) === 0) queue.push(edge.child);
        }
      }

      // Cycles and disconnected nodes still receive deterministic positions.
      for (let pass = 0; pass < nodeById.size; pass += 1) {
        let changed = false;
        for (const edge of edges) {
          if (!depth.has(edge.parent)) continue;
          const candidate = Math.min(nodeById.size, depth.get(edge.parent) + 1);
          if (!depth.has(edge.child) || candidate > depth.get(edge.child)) {
            depth.set(edge.child, candidate);
            changed = true;
          }
        }
        if (!changed) break;
      }

      const internalDepths = [...nodeById.keys()]
        .filter((id) => outgoing.get(id).length > 0)
        .map((id) => depth.get(id) || 0);
      const deepestInternal = internalDepths.length ? Math.max(...internalDepths) : 0;
      const leafDepth = Math.max(1, deepestInternal + 1);
      const displayDepth = new Map();
      for (const id of nodeById.keys()) {
        displayDepth.set(id, outgoing.get(id).length ? (depth.get(id) || 0) : leafDepth);
      }

      const byLevel = new Map();
      for (const id of nodeById.keys()) {
        const level = displayDepth.get(id);
        if (!byLevel.has(level)) byLevel.set(level, []);
        byLevel.get(level).push(id);
      }

      const angleById = new Map();
      const positions = new Map();
      const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
      for (const level of sortedLevels) {
        const ids = byLevel.get(level);
        ids.sort((a, b) => {
          const parentAngle = (id) => {
            const parents = incoming.get(id) || [];
            const known = parents.map((edge) => angleById.get(edge.parent)).filter(Number.isFinite);
            return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 0;
          };
          return parentAngle(a) - parentAngle(b) || a.localeCompare(b);
        });
        const count = ids.length;
        const radius = level === 0
          ? (count > 1 ? Math.max(1.2, count * 0.38) : 0)
          : Math.max(1.9 + level * 1.35, count * 0.48);
        ids.forEach((id, index) => {
          const angle = count === 1
            ? (incoming.get(id)?.length
              ? (angleById.get(incoming.get(id)[0].parent) || -Math.PI / 2)
              : -Math.PI / 2)
            : -Math.PI / 2 + (2 * Math.PI * index / count);
          angleById.set(id, angle);
          const rootAtCenter = level === 0 && count === 1;
          positions.set(id, new THREE.Vector3(
            rootAtCenter ? 0 : Math.cos(angle) * radius,
            -level * tree3dLevelGap,
            rootAtCenter ? 0 : Math.sin(angle) * radius
          ));
        });
      }

      return {
        nodeById,
        edges,
        outgoing,
        incoming,
        roots: new Set(roots),
        leafDepth,
        levels: sortedLevels,
        positions,
      };
    }

    function isCoffeeTablePublicationTree() {
      return graphState.tree3dShowRealParts
        && String(modelSelect.value || '').includes('CoffeeTable_seed0');
    }

    function applyTree3DCompactLayout(view, layout) {
      const sourceCenters = new Map();
      const assemblyBox = new THREE.Box3();
      for (const node of view?.nodes || []) {
        const meshes = matchingPreviewMeshes(node, view);
        if (!meshes.length) continue;
        const partBox = new THREE.Box3();
        for (const mesh of meshes) {
          mesh.updateWorldMatrix(true, false);
          partBox.union(new THREE.Box3().setFromObject(mesh));
        }
        if (partBox.isEmpty()) continue;
        sourceCenters.set(node.id, partBox.getCenter(new THREE.Vector3()));
        assemblyBox.union(partBox);
      }
      if (sourceCenters.size < 2 || assemblyBox.isEmpty()) return layout;

      const sourceX = (id) => sourceCenters.get(id)?.x || 0;
      const bySourceX = (a, b) => sourceX(a) - sourceX(b) || a.localeCompare(b);
      const assigned = new Set();
      const levelGap = isCoffeeTablePublicationTree() ? 0.82 : 1.9;

      const roots = [...layout.roots].sort(bySourceX);
      roots.forEach((id, index) => {
        layout.positions.set(id, new THREE.Vector3((index - (roots.length - 1) / 2) * 2.4, 0, 0));
        assigned.add(id);
      });

      let parents = roots;
      for (let depth = 1; depth <= view.nodes.length && parents.length; depth += 1) {
        const nextParents = [];
        for (const parentId of parents) {
          const children = (layout.outgoing.get(parentId) || [])
            .map((edge) => edge.child)
            .filter((id, index, ids) => ids.indexOf(id) === index)
            .sort(bySourceX);
          const parentPosition = layout.positions.get(parentId) || new THREE.Vector3();
          const siblingGap = depth === 1 ? 1.75 : 1.15;
          children.forEach((id, index) => {
            const offset = (index - (children.length - 1) / 2) * siblingGap;
            layout.positions.set(id, new THREE.Vector3(parentPosition.x + offset, -depth * levelGap, 0));
            assigned.add(id);
            nextParents.push(id);
          });
        }
        parents = nextParents;
      }

      const unassigned = [...sourceCenters.keys()].filter((id) => !assigned.has(id)).sort(bySourceX);
      unassigned.forEach((id, index) => {
        layout.positions.set(id, new THREE.Vector3((index - (unassigned.length - 1) / 2) * 1.5, -levelGap, 0));
      });

      const findLobsterPartId = (...needles) => {
        for (const [id, node] of layout.nodeById) {
          const names = [id, node.label, node.part_name].map(normalizedPreviewName);
          if (needles.some((needle) => names.some((name) => name.includes(normalizedPreviewName(needle))))) return id;
        }
        return null;
      };
      const lobsterShell = findLobsterPartId('cephalothorax');
      const lobsterAbdomen = findLobsterPartId('abdomen_chain');
      const lobsterTail = findLobsterPartId('tail_fan');
      if (lobsterShell && lobsterAbdomen && lobsterTail) {
        const place = (id, x, y) => {
          if (id) layout.positions.set(id, new THREE.Vector3(x, y, 0));
        };
        place(findLobsterPartId('long_antenna'), -2.75, 0);
        // The top-view projection maps Blender X to screen Y.  The generated
        // lobster attaches crusher_chela at X < 0 and cutter_chela at X > 0.
        place(findLobsterPartId('crusher_chela'), -0.75, -2.15);
        place(findLobsterPartId('cutter_chela'), -0.75, 2.15);
        place(lobsterShell, 0, 0);
        place(findLobsterPartId('walking_leg_array', 'walking_leg_bank'), 0.75, -1.15);
        place(lobsterAbdomen, 2.55, 0);
        place(lobsterTail, 4.85, 0);
      }
      layout.compactTree = true;
      return layout;
    }

    function addTree3DLine(points, color, options = {}) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = options.dashed
        ? new THREE.LineDashedMaterial({
          color,
          dashSize: options.dashSize || 0.24,
          gapSize: options.gapSize || 0.15,
          transparent: true,
          opacity: options.opacity ?? 0.88,
          depthWrite: false,
        })
        : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: options.opacity ?? 0.78,
          depthWrite: false,
        });
      const line = new THREE.Line(geometry, material);
      if (options.dashed) line.computeLineDistances();
      line.userData.tree3dFocusType = options.focusPair ? 'edge' : 'guide';
      line.userData.tree3dFocusPair = options.focusPair || null;
      tree3dRoot.add(line);
      return line;
    }

    function addTree3DArrow(start, end, color, scale = 1, focusPair = null) {
      const direction = end.clone().sub(start);
      if (direction.lengthSq() < 1e-8) return null;
      direction.normalize();
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.072 * scale, 0.23 * scale, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.82,
          toneMapped: false,
        })
      );
      arrow.position.copy(end).addScaledVector(direction, -0.21 * scale);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      arrow.userData.tree3dFocusType = focusPair ? 'edge' : 'guide';
      arrow.userData.tree3dFocusPair = focusPair;
      tree3dRoot.add(arrow);
      return arrow;
    }

    function addTree3DExportShaft(start, end, color, radius = 0.032, focusPair = null) {
      const direction = end.clone().sub(start);
      const length = direction.length();
      if (length < 1e-8) return null;
      direction.normalize();
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 12, 1, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: false,
          depthWrite: false,
          toneMapped: false,
        })
      );
      shaft.position.copy(start).lerp(end, 0.5);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      shaft.visible = false;
      shaft.userData.tree3dExportOnly = true;
      shaft.userData.tree3dFocusType = focusPair ? 'edge' : 'guide';
      shaft.userData.tree3dFocusPair = focusPair;
      tree3dRoot.add(shaft);
      return shaft;
    }

    function addTree3DLabel(text, position, options = {}) {
      const lines = String(text).split('\n');
      const labelCanvas = document.createElement('canvas');
      const context = labelCanvas.getContext('2d');
      const fontSize = options.fontSize || 21;
      context.font = `500 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
      const paddingX = options.paddingX || 12;
      const paddingY = options.paddingY || 7;
      const lineHeight = fontSize + 4;
      const minWidth = options.minWidth || 92;
      const width = Math.min(760, Math.max(minWidth, ...lines.map((line) => context.measureText(line).width + paddingX * 2)));
      const height = lines.length * lineHeight + paddingY * 2;
      labelCanvas.width = Math.ceil(width);
      labelCanvas.height = Math.ceil(height);
      context.font = `500 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
      context.fillStyle = options.background || 'rgba(255, 255, 255, 0.96)';
      context.strokeStyle = options.border || 'rgba(92, 116, 148, 0.58)';
      context.lineWidth = 1.4;
      context.beginPath();
      context.roundRect(1, 1, labelCanvas.width - 2, labelCanvas.height - 2, 8);
      context.fill();
      context.stroke();
      context.fillStyle = options.color || '#202124';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      lines.forEach((line, index) => {
        context.fillText(line, labelCanvas.width / 2, paddingY + lineHeight * (index + 0.5));
      });
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }));
      const labelScale = options.scale || 0.0055;
      sprite.scale.set(labelCanvas.width * labelScale, labelCanvas.height * labelScale, 1);
      sprite.position.copy(position);
      sprite.renderOrder = 30;
      sprite.userData.tree3dFocusType = options.focusPartId
        ? 'part'
        : (options.focusPair ? 'edge' : 'guide');
      sprite.userData.tree3dFocusPartId = options.focusPartId || null;
      sprite.userData.tree3dFocusPair = options.focusPair || null;
      tree3dRoot.add(sprite);
      return sprite;
    }

    function addTree3DLevelGuide(level, radius) {
      if (level <= 0 || radius <= 0) return;
      const points = [];
      for (let i = 0; i < 72; i += 1) {
        const angle = 2 * Math.PI * i / 72;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          -level * tree3dLevelGap,
          Math.sin(angle) * radius
        ));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x34465f,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
      });
      const loop = new THREE.LineLoop(geometry, material);
      loop.userData.tree3dFocusType = 'guide';
      tree3dRoot.add(loop);
    }

    function tree3dNodeRole(id, layout) {
      if (layout.roots.has(id)) return 'Root Parent';
      if (!(layout.outgoing.get(id) || []).length) return 'Leaf Child';
      return 'Child / Parent';
    }

    function tree3dPairKey(parent, child) {
      return `${parent}|${child}`;
    }

    function tree3dAuthoredAnchorPairs(edge) {
      return displayAnchorPairs(edge).map((pair) => pair.parentId === edge.parent
        ? { parent: pair.parent, child: pair.child }
        : { parent: pair.child, child: pair.parent });
    }

    function buildTree3DLineageSelection(hit, hitKey) {
      const layout = tree3dLastLayout;
      if (!layout || !hit) return null;
      const partIds = new Set();
      const visitAncestors = (startId) => {
        const stack = [startId];
        while (stack.length) {
          const id = stack.pop();
          if (partIds.has(id)) continue;
          partIds.add(id);
          for (const edge of layout.incoming.get(id) || []) stack.push(edge.parent);
        }
      };
      const visitDescendants = (startId) => {
        const stack = [startId];
        while (stack.length) {
          const id = stack.pop();
          if (partIds.has(id) && id !== startId) {
            // The node may already have been reached through its ancestor path;
            // its descendants still need to be traversed.
          } else {
            partIds.add(id);
          }
          for (const edge of layout.outgoing.get(id) || []) {
            if (!partIds.has(edge.child)) stack.push(edge.child);
          }
        }
      };

      if (hit.kind === 'part') {
        visitAncestors(hit.node.id);
        visitDescendants(hit.node.id);
      } else if (isDirectedAnchorEdge(hit.edge)) {
        visitAncestors(hit.edge.parent);
        partIds.add(hit.edge.child);
        visitDescendants(hit.edge.child);
      } else {
        for (const id of [hit.edge.parent, hit.edge.child]) {
          visitAncestors(id);
          visitDescendants(id);
        }
      }

      const edgePairs = new Set();
      for (const edge of tree3dLastView?.edges || []) {
        if (partIds.has(edge.parent) && partIds.has(edge.child)) {
          edgePairs.add(tree3dPairKey(edge.parent, edge.child));
        }
      }
      if (hit.edge) edgePairs.add(tree3dPairKey(hit.edge.parent, hit.edge.child));
      return { key: hitKey, partIds, edgePairs };
    }

    function applyTree3DSelectionAppearance() {
      const selection = tree3dSelection;
      tree3dRoot.traverse((object) => {
        const type = object.userData.tree3dFocusType;
        const focused = !selection
          || (type === 'part' && selection.partIds.has(object.userData.tree3dFocusPartId))
          || (type === 'edge' && selection.edgePairs.has(object.userData.tree3dFocusPair));
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material.userData.tree3dBaseOpacity === undefined) {
              material.userData.tree3dBaseOpacity = material.opacity ?? 1;
              material.userData.tree3dBaseTransparent = Boolean(material.transparent);
              material.userData.tree3dBaseDepthWrite = material.depthWrite !== false;
              material.userData.tree3dBaseEmissiveIntensity = material.emissiveIntensity;
              material.userData.tree3dBaseColor = material.color?.clone?.() || null;
            }
            const baseOpacity = material.userData.tree3dBaseOpacity;
            const dimFactor = type === 'guide' ? 0.08 : 0.045;
            material.opacity = baseOpacity * (focused ? 1 : dimFactor);
            material.transparent = material.userData.tree3dBaseTransparent || !focused;
            material.depthWrite = focused ? material.userData.tree3dBaseDepthWrite : false;
            if (material.color && material.userData.tree3dBaseColor) {
              material.color.copy(
                focused
                  ? material.userData.tree3dBaseColor
                  : new THREE.Color(type === 'guide' ? 0x1b2634 : 0x263140)
              );
            }
            if (material.userData.tree3dBaseEmissiveIntensity !== undefined) {
              const baseEmissive = material.userData.tree3dBaseEmissiveIntensity;
              material.emissiveIntensity = focused ? baseEmissive : baseEmissive * 0.08;
            }
            material.needsUpdate = true;
          }
        }
        if (object.userData.tree3dHit) {
          if (!object.userData.tree3dBaseScale) {
            object.userData.tree3dBaseScale = object.scale.toArray();
          }
          const baseScale = object.userData.tree3dBaseScale;
          const exactSelection = Boolean(selection && object.userData.tree3dHitKey === selection.key);
          const factor = exactSelection ? (object.isSprite ? 1.08 : 1.18) : 1;
          object.scale.set(
            baseScale[0] * factor,
            baseScale[1] * factor,
            baseScale[2] * factor
          );
        }
      });
    }

    function updateTree3DSelectionStatus() {
      const baseStatus = tree3dRoot.userData.baseStatus || '3D Hierarchy';
      if (!tree3dSelection) {
        graphStatus.textContent = baseStatus;
        return;
      }
      const visibleCount = tree3dSelection.partIds.size;
      const totalCount = tree3dLastView?.nodes?.length || visibleCount;
      graphStatus.textContent = visibleCount >= totalCount
        ? `${baseStatus} · The current node path covers the entire tree; there are no branches to dim`
        : `${baseStatus} · Focused full path: ${visibleCount}/${totalCount} nodes · Other branches dimmed`;
    }

    function buildTree3DRealPart(node, position, role, view) {
      const sourceMeshes = matchingPreviewMeshes(node, view);
      if (!sourceMeshes.length) return null;
      const group = new THREE.Group();
      for (const sourceMesh of sourceMeshes) {
        sourceMesh.updateWorldMatrix(true, false);
        const geometry = sourceMesh.geometry.clone();
        geometry.applyMatrix4(sourceMesh.matrixWorld);
        const originalMaterial = sourceMesh.userData.playgroundOriginalMaterial || sourceMesh.material;
        const materials = (Array.isArray(originalMaterial)
          ? originalMaterial
          : [originalMaterial]
        ).map((material) => {
          const clone = material.clone();
          clone.visible = true;
          clone.wireframe = false;
          clone.transparent = true;
          clone.opacity = 0.75;
          clone.depthWrite = true;
          clone.side = THREE.FrontSide;
          clone.needsUpdate = true;
          return clone;
        });
        const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.tree3dPublicationSurface = true;
        group.add(mesh);
      }
      const sourceBox = new THREE.Box3().setFromObject(group);
      if (sourceBox.isEmpty()) return null;
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const longest = Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 1e-5);
      const nodeName = normalizedPreviewName(node.part_id || node.id || node.label);
      const targetSize = isCoffeeTablePublicationTree()
        ? (nodeName.includes('topslab')
          ? 3.6
          : (nodeName.includes('bottomshelf') ? 3.25 : 2.2))
        : (role === 'Root Parent' ? 1.8 : (role === 'Leaf Child' ? 1.25 : 1.5));
      const displayScale = targetSize / longest;
      const surfaceMeshes = [...group.children];
      for (const child of surfaceMeshes) {
        child.geometry.translate(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z);
        child.userData.tree3dHit = { kind: 'part', node, view, role };
        child.userData.tree3dHitKey = `part:${node.id}`;
        child.userData.tree3dFocusType = 'part';
        child.userData.tree3dFocusPartId = node.id;
        tree3dInteractiveObjects.push(child);

        // Export-only silhouette shell: it emphasizes only the outside contour
        // and does not reveal triangulation or other internal mesh edges.
        const outline = new THREE.Mesh(
          child.geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: 0x3b130d,
            side: THREE.BackSide,
            transparent: false,
            depthWrite: false,
            toneMapped: false,
          })
        );
        outline.scale.setScalar(1.055);
        outline.visible = false;
        outline.userData.tree3dExportOnly = true;
        outline.userData.tree3dFocusType = 'part';
        outline.userData.tree3dFocusPartId = node.id;
        group.add(outline);
      }
      group.scale.setScalar(displayScale);
      if (isCoffeeTablePublicationTree()) {
        // The glTF preview is already Y-up: X is table length, Y is height,
        // and Z is depth.  Keeping that orientation gives the publication
        // export a true side elevation with a wide, thin tabletop.
        group.quaternion.identity();
      } else {
        const topViewRotation = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), Math.PI / 2
        );
        const screenPlaneRotation = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1), Math.PI / 2
        );
        group.quaternion.copy(screenPlaneRotation).multiply(topViewRotation);
      }
      group.position.copy(position);
      group.userData.tree3dRealPart = {
        sourceCenter,
        displayScale,
      };
      group.userData.tree3dFocusType = 'part';
      group.userData.tree3dFocusPartId = node.id;
      tree3dRoot.add(group);
      return group;
    }

    function tree3dDisplayedAnchor(partGroup, worldCoordinate, fallback) {
      if (!partGroup?.userData?.tree3dRealPart || !Array.isArray(worldCoordinate)) {
        return fallback.clone();
      }
      const { sourceCenter, displayScale } = partGroup.userData.tree3dRealPart;
      const previewCoordinate = runtimePointToPreview(worldCoordinate);
      if (!previewCoordinate) return fallback.clone();
      return previewCoordinate
        .sub(sourceCenter)
        .multiplyScalar(displayScale)
        .applyQuaternion(partGroup.quaternion)
        .add(partGroup.position);
    }

    function renderTree3D() {
      clearTree3DScene();
      const view = tree3dSourceView();
      tree3dLastView = view;
      if (!view?.nodes?.length) {
        graphStatus.textContent = '3D Hierarchy: no part nodes are available to display';
        tree3dControlNote.textContent = 'Waiting for parent-child relation data';
        return;
      }

      const layout = graphState.tree3dShowRealParts
        ? applyTree3DCompactLayout(view, computeTree3DPyramidLayout(view))
        : computeTree3DPyramidLayout(view);
      tree3dLastLayout = layout;
      const levelRadius = new Map();
      for (const position of layout.positions.values()) {
        const level = Math.round(Math.abs(position.y) / tree3dLevelGap);
        levelRadius.set(level, Math.max(levelRadius.get(level) || 0, Math.hypot(position.x, position.z)) + 0.75);
      }
      if (!layout.compactTree) {
        for (const [level, radius] of levelRadius) addTree3DLevelGuide(level, radius);
      }

      const partPositions = new THREE.Box3();
      const displayedPartGroups = new Map();
      for (const node of view.nodes) {
        const position = layout.positions.get(node.id);
        if (!position) continue;
        const role = tree3dNodeRole(node.id, layout);
        const color = role === 'Root Parent'
          ? 0xf1c75b
          : (role === 'Leaf Child' ? 0x98a2b7 : 0x68a7eb);
        const radius = role === 'Root Parent' ? 0.32 : (role === 'Leaf Child' ? 0.19 : 0.26);
        let mesh = graphState.tree3dShowRealParts
          ? buildTree3DRealPart(node, position, role, view)
          : null;
        if (!mesh) {
          mesh = new THREE.Mesh(
            role === 'Leaf Child'
              ? new THREE.SphereGeometry(radius, 24, 16)
              : new THREE.IcosahedronGeometry(radius, 3),
            new THREE.MeshStandardMaterial({
              color,
              roughness: 0.46,
              metalness: 0.04,
              emissive: color,
              emissiveIntensity: role === 'Root Parent' ? 0.16 : 0.07,
            })
          );
          mesh.position.copy(position);
          mesh.userData.tree3dHit = { kind: 'part', node, view, role };
          mesh.userData.tree3dHitKey = `part:${node.id}`;
          mesh.userData.tree3dFocusType = 'part';
          mesh.userData.tree3dFocusPartId = node.id;
          tree3dInteractiveObjects.push(mesh);
          tree3dRoot.add(mesh);
        } else {
          displayedPartGroups.set(node.id, mesh);
        }
        const labelSprite = addTree3DLabel(
          `${role === 'Root Parent' ? 'ROOT · ' : ''}${truncateNodeLabel(node.label || node.id, 28)}`,
          position.clone().add(new THREE.Vector3(0, role === 'Root Parent' ? 0.53 : 0.42, 0)),
          {
            border: role === 'Root Parent'
              ? 'rgba(241, 199, 91, 0.76)'
              : (role === 'Leaf Child' ? 'rgba(152, 162, 183, 0.48)' : 'rgba(104, 167, 235, 0.62)'),
            background: role === 'Root Parent'
              ? 'rgba(255, 248, 225, 0.96)'
              : 'rgba(255, 255, 255, 0.96)',
            focusPartId: node.id,
          }
        );
        labelSprite.userData.tree3dHit = { kind: 'part', node, view, role };
        labelSprite.userData.tree3dHitKey = `part:${node.id}`;
        labelSprite.userData.tree3dExportHide = true;
        tree3dInteractiveObjects.push(labelSprite);
        if (role === 'Root Parent') {
          const exportRootLabel = addTree3DLabel(
            'ROOT',
            position.clone().add(new THREE.Vector3(
              0,
              isCoffeeTablePublicationTree() ? 0.35 : 0.82,
              0
            )),
            {
              border: 'rgba(23, 50, 74, 0.95)',
              background: 'rgba(255, 255, 255, 0.94)',
              color: '#17324a',
              minWidth: 64,
            }
          );
          exportRootLabel.visible = false;
          exportRootLabel.userData.tree3dExportOnly = true;
        }
        partPositions.expandByPoint(position);
      }

      const sharedEdges = [...new Map(
        (view.edges || [])
          .filter(isAnchorDisplayEdge)
          .map((edge) => [[edge.parent, edge.child].sort((a, b) => String(a).localeCompare(String(b))).join('|'), edge])
      ).values()];
      const displayedSharedPairs = new Set();
      let sharedCount = 0;
      const addSharedTreeNode = (edge, parent, child, directed) => {
        if (!isAnchorDisplayEdge(edge)) return;
        const verified = anchorDisplayVerified(edge);
        const anchorColor = verified ? 0x188038 : 0x607d9b;
        const pairKey = [edge.parent, edge.child].sort((a, b) => String(a).localeCompare(String(b))).join('|');
        if (displayedSharedPairs.has(pairKey)) return;
        displayedSharedPairs.add(pairKey);
        sharedCount += 1;
        const focusPair = tree3dPairKey(edge.parent, edge.child);
        const anchorPosition = parent.clone().lerp(child, 0.5);
        const realPartMode = graphState.tree3dShowRealParts;
        const publicationArrowScale = isCoffeeTablePublicationTree() ? 1.1 : 1.48;
        const authoredPairs = realPartMode ? tree3dAuthoredAnchorPairs(edge) : [];
        const primaryPair = authoredPairs[0];
        const parentAnchor = realPartMode
          ? tree3dDisplayedAnchor(
            displayedPartGroups.get(edge.parent),
            primaryPair?.parent || edge.anchor_a,
            parent
          )
          : anchorPosition;
        const childAnchor = realPartMode
          ? tree3dDisplayedAnchor(
            displayedPartGroups.get(edge.child),
            primaryPair?.child || edge.anchor_b,
            child
          )
          : anchorPosition;
        if (realPartMode) {
          addTree3DLine([parentAnchor, childAnchor], 0xffc107, { opacity: 0.82, focusPair });
          addTree3DExportShaft(parentAnchor, childAnchor, 0xffc107, 0.032, focusPair);
          if (directed) {
            addTree3DArrow(
              parentAnchor, childAnchor, 0xffc107, publicationArrowScale, focusPair
            );
          }
        } else {
          addTree3DLine([parent, anchorPosition], anchorColor, { opacity: 0.82, focusPair });
          addTree3DLine([anchorPosition, child], anchorColor, { opacity: 0.82, focusPair });
          if (directed) addTree3DArrow(anchorPosition, child, anchorColor, 0.78, focusPair);
        }
        const anchorNode = new THREE.Mesh(
          new THREE.SphereGeometry(0.135, 20, 14),
          new THREE.MeshStandardMaterial({
            color: verified ? 0x39d98a : 0xffc107,
            roughness: 0.38,
            metalness: 0.02,
            emissive: verified ? 0x1fa568 : 0x5c4400,
            emissiveIntensity: 0.45,
          })
        );
        anchorNode.position.copy(realPartMode ? parentAnchor : anchorPosition);
        anchorNode.userData.tree3dHit = {
          kind: 'anchor',
          edge,
          view,
          parentNode: layout.nodeById.get(edge.parent),
          childNode: layout.nodeById.get(edge.child),
        };
        anchorNode.userData.tree3dHitKey = `anchor:${focusPair}`;
        anchorNode.userData.tree3dFocusType = 'edge';
        anchorNode.userData.tree3dFocusPair = focusPair;
        if (!realPartMode) {
          tree3dInteractiveObjects.push(anchorNode);
          tree3dRoot.add(anchorNode);
        } else {
          const makeSurfaceAnchor = (position, endpoint) => {
            const surfaceAnchor = new THREE.Mesh(
              new THREE.SphereGeometry(0.095, 24, 18),
              new THREE.MeshBasicMaterial({
                color: 0xffc107,
                transparent: false,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
              })
            );
            surfaceAnchor.position.copy(position);
            surfaceAnchor.renderOrder = 40;
            surfaceAnchor.userData.tree3dHit = anchorNode.userData.tree3dHit;
            surfaceAnchor.userData.tree3dHitKey = `anchor:${focusPair}:${endpoint}`;
            surfaceAnchor.userData.tree3dFocusType = 'edge';
            surfaceAnchor.userData.tree3dFocusPair = focusPair;
            tree3dInteractiveObjects.push(surfaceAnchor);
            tree3dRoot.add(surfaceAnchor);
          };
          makeSurfaceAnchor(parentAnchor, 'parent');
          makeSurfaceAnchor(childAnchor, 'child');
          authoredPairs.slice(1).forEach((pair, index) => {
            const extraParentAnchor = tree3dDisplayedAnchor(
              displayedPartGroups.get(edge.parent), pair.parent, parent
            );
            const extraChildAnchor = tree3dDisplayedAnchor(
              displayedPartGroups.get(edge.child), pair.child, child
            );
            addTree3DLine([extraParentAnchor, extraChildAnchor], 0xffc107, {
              opacity: 0.82,
              focusPair,
            });
            addTree3DExportShaft(
              extraParentAnchor, extraChildAnchor, 0xffc107, 0.032, focusPair
            );
            if (directed) {
              addTree3DArrow(
                extraParentAnchor,
                extraChildAnchor,
                0xffc107,
                publicationArrowScale,
                focusPair
              );
            }
            makeSurfaceAnchor(extraParentAnchor, `parent-${index + 2}`);
            makeSurfaceAnchor(extraChildAnchor, `child-${index + 2}`);
          });
        }
        const outward = child.clone().sub(parent);
        outward.y = 0;
        if (outward.lengthSq() > 1e-8) outward.normalize().multiplyScalar(0.24);
        outward.y = -0.34;
        if (!realPartMode) {
          const anchorLabelSprite = addTree3DLabel(
            `A${sharedCount} · ${compactSharedAnchorCoordinate(edge)}`,
            anchorPosition.clone().add(outward),
            {
              fontSize: 16,
              scale: 0.0042,
              minWidth: 72,
              paddingX: 9,
              paddingY: 5,
              color: verified ? '#137333' : '#455a70',
              background: verified ? 'rgba(230, 244, 234, 0.96)' : 'rgba(237, 241, 245, 0.96)',
              border: verified ? 'rgba(57, 217, 138, 0.52)' : 'rgba(96, 125, 155, 0.52)',
              focusPair,
            }
          );
          anchorLabelSprite.userData.tree3dHit = anchorNode.userData.tree3dHit;
          anchorLabelSprite.userData.tree3dHitKey = anchorNode.userData.tree3dHitKey;
          tree3dInteractiveObjects.push(anchorLabelSprite);
        }
      };
      for (const edge of layout.edges) {
        const parent = layout.positions.get(edge.parent);
        const child = layout.positions.get(edge.child);
        if (!parent || !child) continue;
        const focusPair = tree3dPairKey(edge.parent, edge.child);
        const showAnchor = graphState.tree3dShowShared && isAnchorDisplayEdge(edge);
        if (showAnchor) {
          addSharedTreeNode(edge, parent, child, true);
        } else {
          const color = edge.shared_anchor ? 0x188038 : 0x1a73e8;
          addTree3DLine([parent, child], color, {
            opacity: 0.82,
            focusPair,
          });
          addTree3DArrow(parent, child, color, 0.72, focusPair);
        }
      }
      if (graphState.tree3dShowShared) {
        for (const edge of sharedEdges) {
          const pairKey = [edge.parent, edge.child].sort((a, b) => String(a).localeCompare(String(b))).join('|');
          if (displayedSharedPairs.has(pairKey)) continue;
          const endpointA = layout.positions.get(edge.parent);
          const endpointB = layout.positions.get(edge.child);
          if (!endpointA || !endpointB) continue;
          addSharedTreeNode(edge, endpointA, endpointB, isDirectedAnchorEdge(edge));
        }
      }

      if (isCoffeeTablePublicationTree() && displayedPartGroups.size) {
        tree3dRoot.updateMatrixWorld(true);
        tree3dContentBox = new THREE.Box3();
        for (const group of displayedPartGroups.values()) {
          tree3dContentBox.expandByObject(group, true);
        }
        tree3dContentBox.expandByScalar(0.18);
        tree3dContentBox.expandByPoint(new THREE.Vector3(0, 0.52, 0));
      } else {
        tree3dContentBox = partPositions.isEmpty()
          ? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
          : partPositions.expandByScalar(1.2);
      }
      const rootCount = layout.roots.size;
      const leafCount = view.nodes.filter((node) => !(layout.outgoing.get(node.id) || []).length).length;
      const middleCount = Math.max(0, view.nodes.length - rootCount - leafCount);
      tree3dRoot.userData.baseStatus = `${graphState.tree3dShowRealParts ? 'Real-Part Pyramid' : '3D Hierarchy'} · Top-level root parents ${rootCount} · Intermediate parent/child nodes ${middleCount} · Bottom-level leaf children ${leafCount}`;
      updateTree3DSelectionStatus();
      const authoredTotals = (view.edges || []).reduce(
        (totals, edge) => {
          const authored = authoredAnchorStats(edge);
          if (authored) {
            totals.valid += authored.valid;
            totals.count += authored.count;
          }
          return totals;
        },
        { valid: 0, count: 0 }
      );
      const authoredNote = authoredTotals.count
        ? ` · Authored anchors ${authoredTotals.valid}/${authoredTotals.count}`
        : '';
      tree3dControlNote.textContent = view.preview_only
        ? `Anchors ${sharedCount}/${sharedEdges.length} · Preview · checks not rerun`
        : `Anchors ${sharedCount}/${sharedEdges.length}${authoredNote}`;
      applyTree3DSelectionAppearance();
      resizeTree3D();
      fitTree3D();
    }

    function resizeTree3D() {
      const width = tree3dStage.clientWidth;
      const height = tree3dStage.clientHeight;
      if (width <= 0 || height <= 0) return;
      tree3dRenderer.setSize(width, height, false);
      tree3dCamera.aspect = width / height;
      tree3dCamera.updateProjectionMatrix();
    }

    function fitTree3D() {
      if (tree3dContentBox.isEmpty()) return;
      if (isCoffeeTablePublicationTree()) {
        tree3dCamera.fov = 18;
        const center = tree3dContentBox.getCenter(new THREE.Vector3());
        const size = tree3dContentBox.getSize(new THREE.Vector3());
        const verticalHalfFov = THREE.MathUtils.degToRad(tree3dCamera.fov * 0.5);
        const horizontalHalfFov = Math.atan(
          Math.tan(verticalHalfFov) * Math.max(tree3dCamera.aspect, 0.1)
        );
        const distance = Math.max(
          1.5,
          1.15 * Math.max(
            size.y * 0.5 / Math.tan(verticalHalfFov),
            size.x * 0.5 / Math.tan(horizontalHalfFov)
          )
        );
        tree3dCamera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
        tree3dCamera.near = Math.max(0.01, distance / 1500);
        tree3dCamera.far = Math.max(100, distance * 30);
        tree3dCamera.updateProjectionMatrix();
        tree3dOrbit.target.copy(center);
        tree3dOrbit.minDistance = Math.max(0.5, distance * 0.3);
        tree3dOrbit.maxDistance = Math.max(20, distance * 12);
        tree3dOrbit.update();
        return;
      }
      tree3dCamera.fov = 46;
      const sphere = tree3dContentBox.getBoundingSphere(new THREE.Sphere());
      const verticalHalfFov = THREE.MathUtils.degToRad(tree3dCamera.fov * 0.5);
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(tree3dCamera.aspect, 0.1));
      const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
      const distance = Math.max(4, sphere.radius / Math.sin(limitingHalfFov) * tree3dFitPadding);
      const direction = new THREE.Vector3(0, 0, 1);
      tree3dCamera.position.copy(sphere.center).addScaledVector(direction, distance);
      tree3dCamera.near = Math.max(0.01, distance / 1500);
      tree3dCamera.far = Math.max(100, distance * 30);
      tree3dCamera.updateProjectionMatrix();
      tree3dOrbit.target.copy(sphere.center);
      tree3dOrbit.minDistance = Math.max(0.8, sphere.radius * 0.25);
      tree3dOrbit.maxDistance = Math.max(20, sphere.radius * 14);
      tree3dOrbit.update();
    }

    function positionTree3DTooltip(event) {
      const rect = tree3dStage.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width - 24, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height - 24, event.clientY - rect.top));
      tree3dTooltip.style.left = `${x}px`;
      tree3dTooltip.style.top = `${y}px`;
    }

    function applyTree3DHover(object, event) {
      positionTree3DTooltip(event);
      if (tree3dHoveredObject === object) return;
      tree3dHoveredObject = object;
      clearPreviewPartHighlight();
      if (!object?.userData?.tree3dHit) {
        tree3dSelection = null;
        applyTree3DSelectionAppearance();
        updateTree3DSelectionStatus();
        tree3dTooltip.hidden = true;
        restorePinnedTreeSelection(true);
        return;
      }
      const hit = object.userData.tree3dHit;
      const hitKey = object.userData.tree3dHitKey;
      tree3dSelection = hitKey ? buildTree3DLineageSelection(hit, hitKey) : null;
      applyTree3DSelectionAppearance();
      updateTree3DSelectionStatus();
      tree3dTooltip.hidden = false;
      if (hit.kind === 'part') {
        const parentCount = tree3dDirectedEdges(hit.view).filter((edge) => edge.child === hit.node.id).length;
        const childCount = tree3dDirectedEdges(hit.view).filter((edge) => edge.parent === hit.node.id).length;
        tree3dTooltip.textContent = `${hit.node.label || hit.node.id}\n${hit.role}\nParents ${parentCount} · Children ${childCount}`;
        highlightPreviewGraphNodes([hit.node], hit.view, `${hit.role}: ${hit.node.label || hit.node.id}`);
        return;
      }
      const endpoints = [hit.parentNode, hit.childNode].filter(Boolean);
      if (hit.kind === 'anchor') {
        const authored = authoredAnchorSummary(hit.edge, true);
        tree3dTooltip.textContent = `${anchorDisplayVerified(hit.edge) ? 'Verified shared anchor' : 'Attachment coordinates'}\n${sharedAnchorCoordinate(hit.edge)}\n${hit.edge.parent} → ${hit.edge.child}${authored ? `\n${authored}` : ''}`;
        highlightPreviewGraphNodes(
          endpoints,
          hit.view,
          `Parent: ${hit.edge.parent} + Child: ${hit.edge.child}`,
          hit.edge
        );
        return;
      }
      tree3dTooltip.hidden = true;
    }

    function pickTree3DObject(event) {
      if (graphState.view !== 'tree3d' || tree3dStage.hidden) return;
      const rect = tree3dCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      tree3dPointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      tree3dRaycaster.setFromCamera(tree3dPointer, tree3dCamera);
      return tree3dRaycaster.intersectObjects(tree3dInteractiveObjects, false)[0]?.object || null;
    }

    function updateTree3DPointer(event) {
      if (event.buttons) return;
      applyTree3DHover(pickTree3DObject(event), event);
    }

    function clearTree3DHover() {
      tree3dHoveredObject = null;
      tree3dSelection = null;
      applyTree3DSelectionAppearance();
      updateTree3DSelectionStatus();
      tree3dTooltip.hidden = true;
      restorePinnedTreeSelection();
      restorePinnedPreviewSelection();
    }

    function renderGraph() {
      const tree3dView = graphState.view === 'tree3d';
      // SVGElement does not reflect a `.hidden` property to the HTML attribute.
      graphSvg.toggleAttribute('hidden', tree3dView);
      tree3dStage.hidden = !tree3dView;
      if (tree3dView) {
        updateGraphLegend();
        anchorRelations.hidden = true;
        const preserveView = tree3dLastView === tree3dSourceView();
        const position = tree3dCamera.position.clone();
        const target = tree3dOrbit.target.clone();
        const near = tree3dCamera.near;
        const far = tree3dCamera.far;
        renderTree3D();
        if (preserveView) {
          tree3dCamera.position.copy(position);
          tree3dOrbit.target.copy(target);
          tree3dCamera.near = near;
          tree3dCamera.far = far;
          tree3dCamera.updateProjectionMatrix();
          tree3dOrbit.update();
        }
        restorePinnedTreeSelection();
        return;
      }
      const rawView = graphView();
      const relationView = rawView ? anchorRelationListView(rawView) : null;
      const view = rawView ? anchorDisplayView(rawView) : null;
      updateGraphLegend();
      graphEdges.replaceChildren();
      graphNodes.replaceChildren();
      if (relationView) renderAnchorRelations(relationView);
      if (rawView && relationView && graphState.view === 'anchors' && graphState.anchorMode === 'shared') {
        renderSharedAnchorLanes(rawView, relationView);
        return;
      }
      if (!view || !view.nodes.length) {
        const message = makeSvg('text', { class: 'graph-empty', x: 210, y: 120 });
        message.textContent = graphState.view === 'anchors' && rawView?.nodes?.length
          ? `No relations in “${anchorModeLabel(graphState.anchorMode)}” mode. Choose another filter above`
          : 'The current code contains no recognized node relations of this type';
        graphNodes.append(message);
        graphStatus.textContent = graphState.view === 'anchors' && rawView
          ? `${anchorModeLabel(graphState.anchorMode)} · 0/${rawView.nodes.length} nodes · 0/${rawView.edges.length} relations`
          : '0 nodes · 0 parent-child relations';
        graphState.content = { minX: 0, minY: 0, width: 420, height: 240 };
        updateGraphTransform();
        return;
      }

      if (
        graphState.view === 'anchors'
        && graphState.selectedEdge
        && !view.edges.some((edge) => anchorEdgeKey(edge) === graphState.selectedEdge)
      ) {
        graphState.selectedEdge = null;
      }

      const layout = computeGraphLayout(view);
      graphState.content = layout.content;
      graphState.positions = layout.positions;
      const query = graphState.query.trim().toLowerCase();

      for (const header of graphState.view === 'anchors' ? [] : (layout.groupHeaders || [])) {
        const color = graphGroupColor(header.label);
        graphEdges.append(makeSvg('rect', {
          class: 'graph-group-band',
          x: -8,
          y: header.y,
          width: layout.content.width + 16,
          height: header.height,
          rx: 8,
          fill: color,
          'fill-opacity': 0.055,
        }));
        const title = makeSvg('text', {
          class: 'graph-group-title',
          x: 2,
          y: header.y + 15,
          fill: color,
        });
        title.textContent = truncateNodeLabel(header.label, 42);
        graphEdges.append(title);
      }

      for (const edge of layout.visibleEdges) {
        const from = layout.positions.get(edge.parent);
        const to = layout.positions.get(edge.child);
        const horizontal = layout.orientation === 'lr';
        const x1 = horizontal ? from.x + graphNodeWidth : from.x + graphNodeWidth / 2;
        const y1 = horizontal ? from.y + graphNodeHeight / 2 : from.y + graphNodeHeight;
        const x2 = horizontal ? to.x : to.x + graphNodeWidth / 2;
        const y2 = horizontal ? to.y + graphNodeHeight / 2 : to.y;
        const middleX = (x1 + x2) / 2;
        const middleY = (y1 + y2) / 2;
        let edgeClass = 'graph-edge';
        const visual = edgeVisual(edge);
        const edgeKey = graphState.view === 'anchors' ? anchorEdgeKey(edge) : '';
        if (visual.className) edgeClass += ` ${visual.className}`;
        if (graphState.view === 'anchors' && graphState.selectedEdge) {
          edgeClass += edgeKey === graphState.selectedEdge
            ? ' anchor-selected'
            : ' anchor-subdued';
        }
        if (
          graphState.view === 'parts'
          && (!partNodeIsVisible(edge.parent) || !partNodeIsVisible(edge.child))
        ) {
          edgeClass += ' hidden-part';
        }
        if (graphState.view === 'calls') {
          if (!graphState.selected) edgeClass += ' call-edge';
          else if (edge.parent === graphState.selected || edge.child === graphState.selected) edgeClass += ' related';
          else edgeClass += ' subdued';
        }
        const pathData = horizontal
          ? `M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${middleY}, ${x2} ${middleY}, ${x2} ${y2}`;
        const edgePath = makeSvg('path', {
          class: edgeClass,
          d: pathData,
        });
        if (visual.markerEnd) edgePath.setAttribute('marker-end', visual.markerEnd);
        const edgeTitle = makeSvg('title');
        const anchorDetail = graphState.view === 'anchors'
          ? `\nAnchor gap: ${formatGraphNumber(edge.anchor_gap)}\nTolerance: ${formatGraphNumber(edge.anchor_tolerance)}`
          : '';
        const titleConnector = graphState.view === 'anchors' && !isStrictAnchorEdge(edge)
          ? ' — '
          : ' → ';
        edgeTitle.textContent = `${edge.parent}${titleConnector}${edge.child}\n${visual.label}${anchorDetail}`;
        edgePath.append(edgeTitle);
        graphEdges.append(edgePath);
        if (graphState.view === 'anchors') {
          graphEdges.append(makeSvg('path', {
            class: 'graph-edge-hit',
            d: pathData,
            'data-anchor-edge': edgeKey,
          }));
        }
        if (graphState.view === 'parts') {
          const label = makeSvg('text', {
            class: 'graph-edge-label',
            x: (x1 + x2) / 2,
            y: middleY - 4,
          });
          label.textContent = `${visual.label} · L${edge.line || 0}`;
          graphEdges.append(label);
        }
      }

      for (const node of view.nodes) {
        const position = layout.positions.get(node.id);
        if (!position) continue;
        const outgoing = layout.children.get(node.id) || [];
        const group = makeSvg('g', {
          class: 'graph-node',
          transform: `translate(${position.x} ${position.y})`,
          'data-graph-node': node.id,
          role: 'button',
          tabindex: '0',
          'aria-label': node.label,
        });
        if (graphState.view === 'parts' && !partNodeIsVisible(node)) {
          group.classList.add('hidden-part');
        }
        if (node.id === graphState.selected) group.classList.add('selected');
        if (graphState.view === 'anchors' && graphState.selectedEdge) {
          const selectedEdge = view.edges.find(
            (edge) => anchorEdgeKey(edge) === graphState.selectedEdge
          );
          if (selectedEdge && (selectedEdge.parent === node.id || selectedEdge.child === node.id)) {
            group.classList.add('edge-endpoint');
          }
        }
        if (query && String(node.label).toLowerCase().includes(query)) group.classList.add('match');
        group.append(makeSvg('rect', {
          x: 0,
          y: 0,
          width: graphNodeWidth,
          height: graphNodeHeight,
          rx: 8,
        }));
        group.append(makeSvg('rect', {
          class: 'graph-group-accent',
          x: 0,
          y: 7,
          width: 4,
          height: graphNodeHeight - 14,
          rx: 2,
          fill: graphGroupColor(node.group),
        }));
        const label = makeSvg('text', { class: 'graph-node-label', x: 11, y: 20 });
        label.textContent = truncateNodeLabel(node.label);
        group.append(label);
        const meta = makeSvg('text', { class: 'graph-node-meta', x: 11, y: 39 });
        const line = node.line ? ` · L${node.line}` : '';
        const instance = node.part_name ? `${node.part_name} · ` : '';
        const category = node.group && !node.part_name ? `${truncateNodeLabel(node.group, 16)} · ` : '';
        const relationCount = graphState.view === 'anchors'
          ? view.edges.filter((edge) => edge.parent === node.id || edge.child === node.id).length
          : outgoing.length;
        meta.textContent = graphState.view === 'anchors'
          ? `${relationCount} visible relations`
          : `${instance}${category}${outgoing.length} children${line}`;
        group.append(meta);
        const title = makeSvg('title');
        title.textContent = node.label;
        group.append(title);
        if (outgoing.length && graphState.view !== 'anchors') {
          group.append(makeSvg('circle', {
            class: 'graph-collapse',
            cx: graphNodeWidth - 12,
            cy: 12,
            r: 8,
            'data-graph-collapse': node.id,
          }));
          const mark = makeSvg('text', {
            class: 'graph-collapse-mark',
            x: graphNodeWidth - 12,
            y: 12,
          });
          mark.textContent = graphState.collapsed.has(node.id) ? '+' : '−';
          group.append(mark);
        }
        graphNodes.append(group);
      }

      const navigationHint = graphState.view === 'parts' || graphState.view === 'anchors'
        ? 'Scroll to zoom'
        : 'Scroll vertically · Ctrl/⌘ + scroll to zoom';
      if (graphState.view === 'anchors') {
        const focus = graphState.anchorFocusNode ? ` · Focused on ${String(graphState.anchorFocusNode)}` : '';
        const runtimeNote = rawView.runtime_pending
          ? ' · Showing source parent-child relations while Blender 5.0 computes contact and A/B coordinates'
          : (rawView.runtime_error ? ` · Blender validation failed: ${rawView.runtime_error}` : '');
        graphStatus.textContent = rawView.edges.length
          ? `${anchorModeLabel(graphState.anchorMode)} · Showing ${layout.positions.size}/${rawView.nodes.length} nodes · ${layout.visibleEdges.length}/${relationView.edges.length} relations${focus}${runtimeNote} · Click a node to show one-hop relations; click a relation card below to inspect endpoints and coordinates`
          : `Anchor analysis complete · ${rawView.nodes.length} runtime meshes · 0 physical parent-child relations · 0 shared anchors · Click a node to highlight its entire mesh on the right`;
      } else {
        graphStatus.textContent = `${view.label} · ${layout.positions.size}/${view.nodes.length} nodes · ${layout.visibleEdges.length} relations · ${navigationHint}`;
      }
      if (rawView.preview_only) graphStatus.textContent = `Browser preview · checks not rerun · ${layout.positions.size}/${view.nodes.length} nodes · ${layout.visibleEdges.length} topology relations`;
      updateGraphTransform();
    }

    function fitGraph() {
      const rect = graphStage.getBoundingClientRect();
      const content = graphState.content;
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = (rect.width - 36) / Math.max(content.width, 1);
      const scaleY = (rect.height - 36) / Math.max(content.height, 1);
      const laneView = graphState.view === 'anchors'
        && (graphState.anchorMode === 'shared');
      if (laneView) {
        graphState.scale = Math.max(0.58, Math.min(1.0, scaleX));
        graphState.tx = (rect.width - content.width * graphState.scale) / 2 - content.minX * graphState.scale;
        graphState.ty = 18 - content.minY * graphState.scale;
      } else if (graphState.view === 'definitions' || graphState.view === 'calls') {
        graphState.scale = Math.max(0.9, Math.min(1.0, scaleX));
        graphState.tx = 18 - content.minX * graphState.scale;
        graphState.ty = 18 - content.minY * graphState.scale;
      } else {
        graphState.scale = Math.max(0.18, Math.min(1.25, scaleX, scaleY));
        graphState.tx = (rect.width - content.width * graphState.scale) / 2 - content.minX * graphState.scale;
        graphState.ty = 18 - content.minY * graphState.scale;
      }
      updateGraphTransform();
    }

    function focusGraphNode(id) {
      const position = graphState.positions.get(id);
      if (!position) return;
      const rect = graphStage.getBoundingClientRect();
      graphState.tx = rect.width / 2 - (position.x + graphNodeWidth / 2) * graphState.scale;
      graphState.ty = rect.height / 2 - (position.y + graphNodeHeight / 2) * graphState.scale;
      updateGraphTransform();
    }

    function resetGraphPosition() {
      if (graphState.view === 'tree3d') {
        resizeTree3D();
        fitTree3D();
        return;
      }
      fitGraph();
      if (graphState.view === 'calls') {
        const root = graphView()?.roots?.[0];
        if (root) focusGraphNode(root);
      }
    }

    function selectGraphNode(id) {
      const view = graphView();
      if (!view) return;
      const node = view.nodes.find((item) => item.id === id);
      if (!node) return;
      const nodeById = new Map(view.nodes.map((item) => [item.id, item]));
      const relationLabel = (nodeId) => {
        const relatedNode = nodeById.get(nodeId);
        if (!relatedNode) return nodeId;
        return relatedNode.part_name
          ? `${relatedNode.label} [${relatedNode.part_name}]`
          : relatedNode.label;
      };
      graphState.selected = id;
      if (typeof setEditTarget === 'function') setEditTarget(id);
      graphState.selectedEdge = null;
      if (graphState.view === 'anchors') {
        graphState.anchorFocusNode = id;
      }
      const parents = view.edges.filter((edge) => edge.child === id);
      const children = view.edges.filter((edge) => edge.parent === id);
      const lines = [
        `${node.label}${node.line ? ` · Source L${node.line}-${node.end_line || node.line}` : ''}`,
        ...(node.part_name ? [`Part instance: ${node.part_name}`] : []),
        ...(node.group ? [`Category: ${node.group}`] : []),
        ...(graphState.view === 'parts'
          ? [`Render state: ${partNodeIsVisible(node) ? 'Visible' : 'Hidden'} (saved geometry)`]
          : []),
      ];
      const relationLaneView = graphState.view === 'anchors'
        && (graphState.anchorMode === 'shared');
      if (relationLaneView) {
        const relatedEdges = view.edges.filter(
          (edge) => (edge.parent === id || edge.child === id) && anchorEdgeMatches(edge)
        );
        const partners = relatedEdges.map((edge) => relationLabel(
          edge.parent === id ? edge.child : edge.parent
        ));
        const partnerTitle = 'Shared-anchor objects';
        lines.push(`${partnerTitle} (${partners.length}): ${partners.length ? partners.join(', ') : 'None'}`);
      } else {
        lines.push(
          `Parents: ${parents.length ? parents.map((edge) => relationLabel(edge.parent)).join(', ') : 'None (root node)'}`,
          `Direct children (${children.length}): ${children.length ? children.map((edge) => relationLabel(edge.child)).join(', ') : 'None'}`
        );
      }
      if (graphState.view === 'anchors') {
        if (node.origin?.length === 3) {
          lines.push(`World origin: (${node.origin.map((value) => formatGraphNumber(value)).join(', ')})`);
        }
        const relatedEdges = view.edges.filter(
          (edge) => (edge.parent === id || edge.child === id) && anchorEdgeMatches(edge)
        );
        lines.push(
          `${anchorModeLabel(graphState.anchorMode)}: ${relatedEdges.length} one-hop relations`,
          relationLaneView
            ? `Only relation rows involving this object are shown; click “Back to Overview” to restore all shared anchors.`
            : 'Unrelated nodes are hidden; click any relation card below to inspect both endpoints and exact world coordinates.'
        );
      }
      if (node.parameters?.length) lines.push(`Parameters: ${node.parameters.join(', ')}`);
      if (node.evidence?.length) lines.push(...node.evidence);
      graphDetail.textContent = lines.join('\n');
      if (graphState.view === 'tree3d' || graphState.view === 'parts' || graphState.view === 'anchors') {
        highlightPreviewGraphNode(node, view);
      } else {
        clearPreviewPartHighlight();
      }
      renderGraph();
      if (graphState.view === 'anchors') requestAnimationFrame(resetGraphPosition);
    }

    function updateGraphTabs() {
      for (const button of graphTabs.querySelectorAll('[data-graph-view]')) {
        const viewName = button.dataset.graphView;
        const view = viewName === 'tree3d'
          ? tree3dSourceView()
          : structureData?.views?.[viewName];
        const available = Boolean(view?.nodes?.length);
        button.disabled = !available;
        button.title = viewName === 'tree3d'
          ? (available
            ? 'Open the rotatable 3D parent-child hierarchy pyramid'
            : 'Waiting for part parent-child relation data')
          : (viewName === 'anchors'
          ? (!available
            ? 'Waiting for Blender 5.0 runtime anchor analysis'
            : (!view.edges?.length
              ? 'Open to inspect: runtime objects exist, but there are no physical parent-child or shared-anchor relations'
              : 'Open the anchor-relation graph'))
          : '');
        button.classList.toggle('active', viewName === graphState.view);
        button.setAttribute('aria-pressed', String(viewName === graphState.view));
      }
    }

    function setGraphView(viewName) {
      const view = viewName === 'tree3d'
        ? tree3dSourceView()
        : structureData?.views?.[viewName];
      const available = Boolean(view?.nodes?.length);
      if (!available) return;
      clearPreviewPartHighlight();
      graphState.view = viewName;
      graphState.collapsed.clear();
      graphState.selected = null;
      graphState.selectedEdge = null;
      graphState.anchorFocusNode = null;
      if (viewName !== 'anchors' && viewName !== 'tree3d' && graphPanel.classList.contains('graph-expanded')) {
        graphPanel.classList.remove('graph-expanded');
        graphFullscreenButton.textContent = 'Enlarge Graph';
        graphFullscreenButton.setAttribute('aria-pressed', 'false');
        tree3dFullscreenButton.textContent = 'Enlarge Graph';
        tree3dFullscreenButton.setAttribute('aria-pressed', 'false');
      }
      graphDetail.textContent = viewName === 'tree3d'
        ? '3D Hierarchy: root parents are at the top; parts that are both children and parents are in the middle; leaf-only children are at the bottom. Enable Anchors to display attachment coordinates, including unverified pairs.'
        : (viewName === 'anchors'
        ? (!view.edges?.length
          ? `Blender 5.0 runtime analysis complete: ${view.nodes.length} meshes, 0 physical parent-child relations, and 0 shared anchors. Click the only node to highlight its entire mesh on the right.`
          : (graphState.anchorMode === 'shared'
          ? 'Each row displays a pair of attachment coordinates. Hover a part or anchor pair to inspect it in the model.'
          : 'By default, only parent-child directions are shown. Blue means the parent → child direction is known but A/B are only estimated anchors; only green denotes a shared anchor. Click a relation card to inspect its estimation method and coordinates.'))
        : 'Click a node to view its parents, all direct children, and source line numbers.');
      if (view.preview_only) graphDetail.textContent = 'Browser preview · checks not rerun. Select a part to resize it or a relation to inspect its current endpoint coordinates.';
      updateGraphTabs();
      renderGraph();
      requestAnimationFrame(resetGraphPosition);
    }

    function initializeGraph(data) {
      const preferredView = graphState.view;
      clearPreviewPartHighlight();
      tree3dSelection = null;
      tree3dLastLayout = null;
      structureData = data;
      const fallback = data.views.anchors || staticAnchorFallback(data.views.parts);
      if (fallback.nodes.length) {
        structureData.views.anchors = fallback;
      }
      graphState.query = '';
      graphSearch.value = '';
      graphState.collapsed.clear();
      graphState.selected = null;
      graphState.selectedEdge = null;
      graphState.anchorFocusNode = null;
      graphState.anchorMode = fallback.edges.length ? 'confirmed' : 'all';
      const nextView = [preferredView, 'parts', 'tree3d', 'anchors', 'definitions', 'calls'].find((name) => {
        const view = name === 'tree3d' ? tree3dSourceView() : data.views[name];
        return view?.nodes?.length;
      });
      if (nextView) {
        setGraphView(nextView);
        return;
      }
      updateGraphTabs();
      renderGraph();
      requestAnimationFrame(resetGraphPosition);
    }

    function normalizedPreviewName(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/\.\d{3}$/u, '')
        .replace(/[^a-z0-9]+/gu, '');
    }

    function previewNodeAliases(node) {
      const rawValues = [
        node.id,
        node.label,
        node.part_name,
        node.runtime_variable,
        node.creator_function,
      ].filter(Boolean).map(String);
      const aliases = new Set(rawValues);
      for (const raw of rawValues) {
        const tail = raw.split(/[.:]/u).at(-1) || raw;
        aliases.add(tail);
        aliases.add(tail.replace(/^(create|build|make|add|new)_?/iu, ''));
        aliases.add(tail.replace(/(_part|_object|_obj|factory|_factory|_asset)$/iu, ''));
      }
      if (schema?.adapter === 'bird') {
        const role = String(node.part_name || node.id || '').split('_', 1)[0];
        if (['body', 'head', 'beak', 'eye', 'wing', 'tail', 'leg', 'foot'].includes(role)) {
          aliases.add(role);
        }
      }
      return [...aliases].filter((value) => normalizedPreviewName(value).length >= 2);
    }

    function previewMeshNames(mesh) {
      // A Mesh's scene-graph ancestors describe attachment/transform
      // inheritance, not the Mesh's semantic identity.  Including ancestor
      // names here makes a root part match every child Mesh below it.
      // Blender custom properties are exported as glTF extras and restored by
      // GLTFLoader in userData, so prefer those alongside the Mesh's own names.
      return [...new Set([
        mesh.name,
        mesh.geometry?.name,
        mesh.userData?.treestruct3d_part_id,
        mesh.userData?.stage7_part_id,
        mesh.userData?.codex_semantic_node_id,
        mesh.userData?.codex_attachment_helper,
        ...(mesh.userData?.explorerPartAliases || []),
      ].filter(Boolean).map(String))];
    }

    function previewMeshMatchScore(mesh, node) {
      const aliases = previewNodeAliases(node);
      const names = previewMeshNames(mesh);
      let score = 0;
      for (const alias of aliases) {
        const aliasLower = alias.toLowerCase();
        const aliasNormalized = normalizedPreviewName(alias);
        const templateIndex = alias.indexOf('{');
        const templatePrefix = templateIndex >= 0
          ? normalizedPreviewName(alias.slice(0, templateIndex))
          : '';
        const templateSuffix = templateIndex >= 0
          ? normalizedPreviewName(alias.slice(alias.indexOf('}', templateIndex) + 1))
          : '';
        for (const name of names) {
          const nameLower = name.toLowerCase();
          const nameNormalized = normalizedPreviewName(name);
          const nameWithoutDuplicate = normalizedPreviewName(name.replace(/\.\d{3}$/u, ''));
          if (nameLower === aliasLower) score = Math.max(score, 120);
          else if (nameNormalized === aliasNormalized) score = Math.max(score, 112);
          else if (
            templatePrefix
            && nameNormalized.startsWith(templatePrefix)
            && (!templateSuffix || nameNormalized.endsWith(templateSuffix))
          ) score = Math.max(score, 104);
          else if (nameWithoutDuplicate === aliasNormalized) score = Math.max(score, 92);
          else if (
            aliasNormalized.length >= 3
            && (nameNormalized.startsWith(aliasNormalized) || aliasNormalized.startsWith(nameNormalized))
          ) score = Math.max(score, 72);
        }
      }
      return score;
    }

    function matchingPreviewMeshes(node, _view) {
      if (!currentModel) return [];
      const meshes = [];
      currentModel.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });

      const birdSide = schema?.adapter === 'bird' && node.kind !== 'runtime_part'
        ? String(node.part_name || node.id || '').match(/^eye_(-?1)$/u)
        : null;
      if (birdSide) {
        const eyes = meshes
          .filter((mesh) => previewMeshNames(mesh).some((name) => /^eye(?:\.\d{3})?$/iu.test(name)))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const index = birdSide[1] === '-1' ? 0 : 1;
        if (eyes[index]) return [eyes[index]];
      }
      const birdRole = schema?.adapter === 'bird' && node.kind !== 'runtime_part'
        ? String(node.part_name || node.id || '').match(/^(body|head|beak|eye|wing|tail|leg|foot)(?:_state)?$/u)
        : null;
      if (birdRole) {
        const pattern = new RegExp(`^${birdRole[1]}(?:[_.-]|$)`, 'iu');
        const roleMeshes = meshes.filter((mesh) =>
          previewMeshNames(mesh).some((name) => pattern.test(name))
        );
        if (roleMeshes.length) return roleMeshes;
      }

      const scored = meshes.map((mesh) => ({ mesh, score: previewMeshMatchScore(mesh, node) }));
      const best = Math.max(0, ...scored.map((item) => item.score));
      if (best > 0) {
        const threshold = best >= 110 ? best : best >= 100 ? 100 : best;
        return scored.filter((item) => item.score >= threshold).map((item) => item.mesh);
      }
      // A graph parent without an independently identifiable Mesh is not a
      // license to select its whole subtree.  Report it as missing instead of
      // turning a single-part highlight into a whole-model highlight.
      return [];
    }

    function previewMaterialClone(material, highlighted) {
      const clone = material.clone();
      const highlightColor = new THREE.Color(0xffc857);
      if (clone.color) {
        if (highlighted) clone.color.lerp(highlightColor, 0.7);
        else clone.color.multiplyScalar(0.24);
      }
      if (clone.emissive) {
        clone.emissive.set(highlighted ? highlightColor : 0x000000);
        clone.emissiveIntensity = highlighted ? 0.35 : 0;
      }
      if (highlighted) {
        clone.transparent = false;
        clone.opacity = 1;
        clone.depthWrite = true;
      } else {
        clone.transparent = true;
        clone.opacity = 0.18;
        clone.depthWrite = false;
      }
      clone.needsUpdate = true;
      return clone;
    }

    function clearPreviewAnchorOverlay() {
      for (const child of previewAnchorOverlay.children.slice()) {
        previewAnchorOverlay.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      }
    }

    function runtimePointToPreview(values) {
      if (!currentModel || values?.length !== 3) return null;
      if (typeof continuousEditor !== 'undefined' && continuousEditor) return continuousEditor.runtimePointToWorld(values);
      const bounds = structureData?.views?.anchors?.source_bounds;
      if (bounds?.min?.length !== 3 || bounds?.max?.length !== 3) return null;
      const box = new THREE.Box3().setFromObject(currentModel);
      if (box.isEmpty()) return null;
      const fraction = (value, minimum, maximum) => {
        const span = maximum - minimum;
        return Math.abs(span) > 1e-9 ? (value - minimum) / span : 0.5;
      };
      const x = fraction(Number(values[0]), Number(bounds.min[0]), Number(bounds.max[0]));
      const y = fraction(Number(values[2]), Number(bounds.min[2]), Number(bounds.max[2]));
      const z = fraction(Number(values[1]), Number(bounds.min[1]), Number(bounds.max[1]));
      // Blender is Z-up; glTF is Y-up and maps Blender +Y to glTF -Z.
      return new THREE.Vector3(
        THREE.MathUtils.lerp(box.min.x, box.max.x, x),
        THREE.MathUtils.lerp(box.min.y, box.max.y, y),
        THREE.MathUtils.lerp(box.max.z, box.min.z, z)
      );
    }

    function addPreviewAnchorSphere(position, radius, color, options = {}) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: options.opacity !== undefined && options.opacity < 1,
        opacity: options.opacity ?? 1,
        depthTest: false,
        depthWrite: false,
      });
      material.toneMapped = false;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 28, 20),
        material
      );
      marker.position.copy(position);
      marker.renderOrder = options.renderOrder ?? 20;
      if (options.pulse) marker.userData.anchorPulse = true;
      previewAnchorOverlay.add(marker);
      return marker;
    }

    function addPreviewAnchorLine(start, end, color) {
      if (!start || !end) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 18;
      previewAnchorOverlay.add(line);
    }

    function showPreviewAnchorOverlay(edge) {
      clearPreviewAnchorOverlay();
      if (!currentModel || !displayOptions.anchors) return false;
      const pairs = displayAnchorPairs(edge);
      if (!pairs.length) return false;
      const modelBox = new THREE.Box3().setFromObject(currentModel);
      const radius = Math.max(modelBox.getSize(new THREE.Vector3()).length() * 0.01, 0.008);
      for (const pair of pairs) {
        const parent = runtimePointToPreview(pair.parent);
        const child = runtimePointToPreview(pair.child);
        if (!parent || !child) continue;
        addPreviewAnchorSphere(parent, radius, 0xffc107, { renderOrder: 22 });
        if (parent.distanceTo(child) > radius * 0.05) {
          addPreviewAnchorSphere(child, radius * 0.85, 0x48d8ff, { renderOrder: 23 });
          addPreviewAnchorLine(parent, child, 0x607d9b);
        }
      }
      return true;
    }

    function updateModelAnchors() {
      const runtime = currentModel && structureData?.views?.anchors;
      const partIds = new Set((previewHighlightRequest?.nodes || [])
        .filter((node) => matchingPreviewMeshes(node, previewHighlightRequest.view)
          .some((mesh) => mesh.userData.playgroundHighlighted === true))
        .map((node) => node.id));
      previewAnchorOverlay.visible = Boolean(displayOptions.anchors && partIds.size && previewHighlightRequest?.edge);
      if (!runtime) { modelAnchors.setVisible(false); return; }
      const visible = displayOptions.anchors && partIds.size > 0 && !previewHighlightRequest?.edge;
      modelAnchors.update(runtime, { visible, partIds });
    }

    function clearPreviewPartHighlight(resetRequest = true) {
      clearPreviewAnchorOverlay();
      if (currentModel) {
        currentModel.traverse((child) => {
          if (!child.isMesh || !child.userData.playgroundOriginalMaterial) return;
          const styled = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of styled) material.dispose();
          child.material = child.userData.playgroundOriginalMaterial;
          child.renderOrder = child.userData.playgroundOriginalRenderOrder || 0;
          delete child.userData.playgroundOriginalMaterial;
          delete child.userData.playgroundOriginalRenderOrder;
          delete child.userData.playgroundHighlighted;
        });
      }
      if (resetRequest) previewHighlightRequest = null;
      previewSelection.hidden = true;
      previewSelection.classList.remove('missing');
      previewSelection.classList.remove('anchor-visible');
      previewSelectionLabel.textContent = '';
      applyDisplayOptions();
    }

    function applyPreviewPartHighlight() {
      clearPreviewPartHighlight(false);
      if (!previewHighlightRequest || !currentModel) return;
      const { nodes, view, label, edge } = previewHighlightRequest;
      const matched = new Set();
      for (const node of nodes) {
        for (const mesh of matchingPreviewMeshes(node, view)) matched.add(mesh);
      }
      const anchorVisible = matched.size && edge ? showPreviewAnchorOverlay(edge, view) : false;
      previewSelection.classList.toggle('anchor-visible', anchorVisible);
      if (!matched.size) {
        previewSelection.hidden = false;
        previewSelection.classList.toggle('missing', !anchorVisible);
        previewSelectionLabel.textContent = anchorVisible
          ? (edge.preview_only
            ? `Browser preview: ${label} · Yellow = parent, cyan = child · checks not rerun`
            : edge.shared_anchor
            ? `Shared anchor: ${label} · Yellow = parent, cyan = child`
            : `Anchor pair: ${label} · Yellow = parent, cyan = child`)
          : `No separate mesh found for “${label}”`;
        return;
      }
      let meshCount = 0;
      currentModel.traverse((child) => {
        if (!child.isMesh) return;
        const highlighted = matched.has(child);
        const semanticOverlay = Boolean(child.userData?.codex_semantic_overlay);
        if (semanticOverlay && !highlighted) {
          child.renderOrder = 0;
          return;
        }
        const original = child.material;
        child.userData.playgroundOriginalMaterial = original;
        child.userData.playgroundOriginalRenderOrder = child.renderOrder;
        child.userData.playgroundHighlighted = highlighted;
        child.material = Array.isArray(original)
          ? original.map((material) => previewMaterialClone(material, highlighted))
          : previewMaterialClone(original, highlighted);
        child.renderOrder = highlighted ? 2 : 0;
        if (highlighted) meshCount += 1;
      });
      applyDisplayOptions();
      previewSelection.hidden = false;
      previewSelection.classList.remove('missing');
      previewSelectionLabel.textContent = anchorVisible
        ? (edge.preview_only
          ? `Highlighted: ${label} · ${meshCount} meshes · Browser preview · checks not rerun`
          : edge.shared_anchor
          ? `Highlighted: ${label} · ${meshCount} meshes · Yellow = parent anchor, cyan = child anchor`
          : `Highlighted: ${label} · ${meshCount} meshes · Yellow = parent anchor, cyan = child anchor`)
        : `Highlighted: ${label} · ${meshCount} meshes`;
    }

    function highlightPreviewGraphNode(node, view) {
      highlightPreviewGraphNodes([node], view, node.label);
    }

    function highlightPreviewGraphNodes(nodes, view, label = '', edge = null) {
      const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
      if (!uniqueNodes.length) {
        clearPreviewPartHighlight();
        return;
      }
      previewHighlightRequest = {
        nodes: uniqueNodes,
        view,
        label: label || uniqueNodes.map((node) => node.label).join(' + '),
        edge,
      };
      applyPreviewPartHighlight();
    }

    function disposeObject(object) {
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            for (const value of Object.values(material)) {
              if (value && value.isTexture) value.dispose();
            }
            material.dispose();
          }
        }
      });
    }

    function fitCamera(preserveDirection = false) {
      if (!currentModel) return;
      const box = new THREE.Box3().setFromObject(currentModel);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.1);
      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.01)
      );
      const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
      const distance = radius / Math.sin(limitingHalfFov) * 1.18;
      const currentDirection = camera.position.clone().sub(orbit.target);
      const direction = preserveDirection && currentDirection.lengthSq() > 1e-8
        ? currentDirection.normalize()
        : new THREE.Vector3(1.25, 0.82, 1.55).normalize();
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.near = Math.max(distance / 1000, 0.005);
      camera.far = Math.max(distance * 50, 100);
      camera.updateProjectionMatrix();
      orbit.target.copy(sphere.center);
      orbit.minDistance = radius * 0.3;
      orbit.maxDistance = radius * 15;
      orbit.update();
    }

    function installGLB(gltf, meshMap = []) {
      currentModel = gltf.scene;
      currentModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          const meshIndex = gltf.parser?.associations.get(child)?.meshes;
          const rows = meshMap.filter((row) => row.mesh_index === meshIndex);
          const row = meshMap.find((item) => item.id === child.name)
            || (rows.length === 1 ? rows[0] : null);
          if (row) child.userData.explorerPartAliases = [row.id, row.part_id].filter(Boolean);
        }
      });
      scene.add(currentModel);
    }


    function restorePinnedPreviewSelection() {
      const view = graphView();
      const edge = view?.edges.find((candidate) => anchorEdgeKey(candidate) === graphState.selectedEdge);
      if (edge) {
        highlightAnchorEdge(edge, view);
        return;
      }
      const node = view?.nodes.find((candidate) => candidate.id === graphState.selected);
      if (node && ['tree3d', 'parts', 'anchors'].includes(graphState.view)) {
        highlightPreviewGraphNode(node, view);
      } else {
        clearPreviewPartHighlight();
      }
    }

    function restorePinnedTreeSelection(highlight = false) {
      if (graphState.view !== 'tree3d') return;
      const object = tree3dInteractiveObjects.find((candidate) => {
        const hit = candidate.userData.tree3dHit;
        return hit?.kind === 'part'
          ? hit.node.id === graphState.selected
          : hit?.edge && anchorEdgeKey(hit.edge) === graphState.selectedEdge;
      });
      tree3dSelection = object
        ? buildTree3DLineageSelection(object.userData.tree3dHit, object.userData.tree3dHitKey)
        : null;
      applyTree3DSelectionAppearance();
      updateTree3DSelectionStatus();
      if (highlight) restorePinnedPreviewSelection();
    }

    function clearSelection() {
      graphState.selected = null;
      graphState.selectedEdge = null;
      graphState.anchorFocusNode = null;
      tree3dSelection = null;
      tree3dHoveredObject = null;
      clearPreviewPartHighlight();
      if (structureData) renderGraph();
      graphDetail.textContent = 'Select a part or relation to inspect its saved structure.';
    }

    function bindSelectionClick(element, onClick) {
      let gesture = null;
      element.addEventListener('pointerdown', (event) => {
        if (gesture) {
          gesture.cancelled = true;
          return;
        }
        if (event.button !== 0 || event.isPrimary === false) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false };
      });
      element.addEventListener('pointermove', (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.cancelled = true;
      });
      element.addEventListener('pointerup', (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const completed = gesture;
        gesture = null;
        if (completed.cancelled || event.button !== 0 || event.isPrimary === false) return;
        if (Math.hypot(event.clientX - completed.x, event.clientY - completed.y) <= 5) onClick(event);
      });
      element.addEventListener('pointercancel', () => { gesture = null; });
    }

    tree3dCanvas.addEventListener('pointerdown', clearTree3DHover);
    bindSelectionClick(tree3dCanvas, (event) => {
      const object = pickTree3DObject(event);
      const hit = object?.userData.tree3dHit;
      if (hit?.kind === 'part') selectObservedPart(hit.node.id);
      else if (hit?.edge) selectAnchorEdge(anchorEdgeKey(hit.edge));
      else clearSelection();
    });
    graphSvg.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const element = event.target.closest('[data-graph-node], [data-anchor-edge], [data-graph-collapse]');
      if (!element) return;
      event.preventDefault();
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dataRoot = new URL('./data/', import.meta.url);
    const explorerRoot = new URL('./', import.meta.url);
    const displayOptions = { wireframe: false, isolate: false, grid: true, anchors: true };
    let catalog = null;
    let activeExample = null;
    let activeSnapshot = null;
    let pendingExample = null;
    let pendingViewState = null;
    let continuousEditor = null;
    let editTargetId = null;
    const editRows = new Map();
    let previewFrame = null;
    const queuedScales = new Map();
    let comparisonVisible = false;
    let comparisonVersion = 0;
    const snapshotCache = new Map();
    const nativeResponseCache = new Map();

    async function readExampleJson(relative) {
      const response = await fetch(assetUrl(relative, dataRoot));
      if (!response.ok) throw new Error(`Example data could not be loaded (${response.status}). Please reload to try again.`);
      return response.json();
    }

    async function readNativeResponse(example) {
      if (!example.native_edit) return null;
      const paths = example.native_edit;
      const key = paths.response;
      if (nativeResponseCache.has(key)) return nativeResponseCache.get(key);
      const request = (async () => {
        const results = await Promise.all([
          readExampleJson(paths.response),
          fetch(assetUrl(paths.buffer, dataRoot)).then((response) => {
            if (!response.ok) throw new Error('Native edit geometry could not be loaded. Please retry.');
            return response.arrayBuffer();
          }),
        ]);
        let buffer = results[1];
        // Vite and some static hosts send .gz files with Content-Encoding;
        // fetch has already decompressed those responses. Other hosts serve
        // the gzip file as raw bytes. Decode only the latter.
        const signature = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
        if (results[0].compression === 'gzip' && signature[0] === 0x1f && signature[1] === 0x8b) {
          const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
          buffer = await new Response(stream).arrayBuffer();
        }
        validateNativeResponse(results[0], new Float32Array(buffer));
        return { response: results[0], buffer };
      })();
      nativeResponseCache.set(key, request);
      // Response fields are larger than snapshots; retain only recent models.
      while (nativeResponseCache.size > 2) nativeResponseCache.delete(nativeResponseCache.keys().next().value);
      try { return await request; }
      catch (error) {
        if (nativeResponseCache.get(key) === request) nativeResponseCache.delete(key);
        throw error;
      }
    }

    function updateEditControls(example = pendingExample || activeExample, status = 'ready') {
      editPanel.hidden = !example;
      if (editPanel.hidden) return;
      const ready = Boolean(continuousEditor && activeExample && !pendingExample);
      const parts = ready ? continuousEditor.parts : [];
      editResetAll.disabled = !ready;
      editParts.setAttribute('aria-busy', String(!ready));
      const targetIds = [...editRows.keys()].join('|');
      if (targetIds !== parts.map((part) => part.id).join('|')) {
        editRows.clear();
        editParts.replaceChildren(...parts.map((part) => {
          const label = displayName(part.label || part.id);
          const row = document.createElement('li');
          row.className = 'edit-part';
          row.dataset.partId = part.id;
          const heading = document.createElement('div');
          heading.className = 'edit-part-heading';
          const select = document.createElement('button');
          select.type = 'button'; select.className = 'edit-part-name';
          select.dataset.editSelect = '';
          select.textContent = label;
          select.setAttribute('aria-label', `Select ${label}`);
          if (part.parameter_id) {
            const linked = parts.filter((item) => item.parameter_id === part.parameter_id).length;
            if (linked > 1) select.title = `This parameter changes ${linked} parts together.`;
          }
          const numberWrap = document.createElement('span');
          numberWrap.className = 'edit-number-wrap';
          const number = document.createElement('input');
          number.type = 'number'; number.min = '0.4'; number.max = '1.6'; number.step = '0.01';
          number.className = 'edit-part-number'; number.dataset.editNumber = '';
          number.setAttribute('aria-label', `${label} exact scale`);
          const unit = document.createElement('span'); unit.textContent = '×';
          numberWrap.append(number, unit);
          heading.append(select, numberWrap);
          const track = document.createElement('div'); track.className = 'edit-part-track';
          const range = document.createElement('input');
          range.type = 'range'; range.min = '0.4'; range.max = '1.6'; range.step = '0.01';
          range.className = 'edit-part-range'; range.dataset.editScale = '';
          range.setAttribute('aria-label', `${label} scale`);
          const reset = document.createElement('button');
          reset.type = 'button'; reset.className = 'edit-part-reset'; reset.dataset.editReset = '';
          reset.textContent = 'Reset'; reset.setAttribute('aria-label', `Reset ${label}`);
          track.append(range, reset);
          row.append(heading, track);
          editRows.set(part.id, { row, select, number, range, reset });
          return row;
        }));
      }
      for (const [id, controls] of editRows) {
        const scale = queuedScales.get(id) ?? continuousEditor.getScale(id);
        controls.select.disabled = controls.range.disabled = controls.number.disabled = !ready;
        controls.reset.disabled = !ready || Math.abs(scale - 1) < 1e-9;
        controls.select.setAttribute('aria-pressed', String(id === editTargetId));
        controls.row.classList.toggle('selected', id === editTargetId);
        controls.row.classList.toggle('edited', Math.abs(scale - 1) > 1e-9);
        controls.range.value = String(scale);
        controls.range.setAttribute('aria-valuetext', `${scale.toFixed(2)} times`);
        if (document.activeElement !== controls.number) controls.number.value = scale.toFixed(2);
      }
      editState.dataset.state = status;
      const preview = ready && continuousEditor.hasEdits();
      editState.textContent = status === 'loading' ? 'Loading model…'
        : status === 'error' ? 'Model unavailable · retry below'
        : preview ? continuousEditor.native ? 'Native geometry preview · checks not rerun' : 'Browser preview · checks not rerun'
        : ready && activeSnapshot?.runtime?.validation_status === 'not_run' ? 'Original geometry · checks not rerun'
        : 'Original geometry · saved checks';
    }


    function setComparisonMode(visible) {
      const example = pendingExample || activeExample;
      comparisonVisible = Boolean(visible && hasPaperComparison(example));
      viewerPanel.classList.toggle('comparison-mode', comparisonVisible);
      comparisonPanel.hidden = !comparisonVisible;
      comparisonToggle.setAttribute('aria-pressed', String(comparisonVisible));
      comparisonToggle.textContent = comparisonVisible ? 'Back to 3D' : 'Paper comparison';
      if (comparisonVisible && activeExample && !pendingExample) void updatePaperComparison();
    }

    function resetPaperComparison(example, _variant, loading = false) {
      comparisonVersion += 1;
      comparisonImages.replaceChildren();
      comparisonStatus.className = '';
      comparisonStatus.textContent = loading ? 'Loading the matching saved edit…' : '';
      const variant = paperPreset(comparisonPreset.value) || paperPreset('default');
      document.getElementById('comparison-state').textContent = example
        ? `${example.title} · ${stateLabel(variant)}` : '';
      document.getElementById('comparison-note').textContent = example?.comparison?.note
        || example?.metadata?.comparison?.note || 'Published renders at the same edit state.';
      comparisonToggle.hidden = !hasPaperComparison(example);
      if (comparisonToggle.hidden) setComparisonMode(false);
    }

    async function updatePaperComparison() {
      const example = activeExample;
      const variant = paperPreset(comparisonPreset.value);
      if (!comparisonVisible || !example || !variant || pendingExample) return;
      const version = ++comparisonVersion;
      comparisonImages.replaceChildren();
      comparisonStatus.className = '';
      const pair = paperComparisonPair(example, variant.id);
      if (!pair) {
        comparisonStatus.textContent = 'No paper comparison was saved for this exact edit state.';
        return;
      }
      comparisonStatus.textContent = 'Loading both paper renders…';
      try {
        const prepareImage = (relative, label) => new Promise((resolve, reject) => {
          const image = new Image();
          image.alt = `${example.title} — ${label} — ${stateLabel(variant)}`;
          image.decoding = 'async';
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('The paper images for this edit could not be loaded.'));
          image.src = assetUrl(relative, explorerRoot);
        });
        const images = await Promise.all([
          prepareImage(pair.baseline, pair.baselineLabel),
          prepareImage(pair.method, 'TreeStruct3D'),
        ]);
        if (version !== comparisonVersion || example !== activeExample || variant.id !== comparisonPreset.value) return;
        const figures = images.map((image, index) => {
          const figure = document.createElement('figure');
          const caption = document.createElement('figcaption');
          caption.textContent = index === 0 ? pair.baselineLabel : 'TreeStruct3D';
          figure.append(caption, image);
          return figure;
        });
        comparisonImages.replaceChildren(...figures);
        comparisonStatus.textContent = '';
      } catch (error) {
        if (version !== comparisonVersion) return;
        comparisonStatus.className = 'error';
        comparisonStatus.textContent = String(error.message || error);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry images';
        retry.addEventListener('click', () => { void updatePaperComparison(); });
        comparisonStatus.append(' ', retry);
      }
    }

    function captureEditView() {
      const captureCamera = (viewCamera, controls) => ({
        position: viewCamera.position.clone(), target: controls.target.clone(),
        near: viewCamera.near, far: viewCamera.far, fov: viewCamera.fov, zoom: viewCamera.zoom,
      });
      const edge = graphView()?.edges.find((item) => anchorEdgeKey(item) === graphState.selectedEdge);
      return {
        view: graphState.view, selected: graphState.selected, edge,
        focus: graphState.anchorFocusNode, anchorMode: graphState.anchorMode,
        query: graphState.query, collapsed: new Set(graphState.collapsed),
        graphScale: graphState.scale, tx: graphState.tx, ty: graphState.ty,
        modelCamera: captureCamera(camera, orbit), treeCamera: captureCamera(tree3dCamera, tree3dOrbit),
      };
    }

    function restoreEditView(saved) {
      const view = graphView();
      const ids = new Set(view?.nodes.map((node) => node.id));
      graphState.selected = ids.has(saved.selected) ? saved.selected : null;
      graphState.anchorFocusNode = ids.has(saved.focus) ? saved.focus : null;
      const matchingEdges = saved.edge ? view?.edges.filter((item) => item.parent === saved.edge.parent
        && item.child === saved.edge.child) || [] : [];
      const edge = matchingEdges.find((item) => item.relation === saved.edge.relation) || matchingEdges[0];
      graphState.selectedEdge = edge ? anchorEdgeKey(edge) : null;
      graphState.anchorMode = saved.anchorMode;
      graphState.query = saved.query;
      graphSearch.value = saved.query;
      graphState.collapsed = new Set([...saved.collapsed].filter((id) => ids.has(id)));
      renderGraph();
      graphState.scale = saved.graphScale; graphState.tx = saved.tx; graphState.ty = saved.ty;
      updateGraphTransform();
      const restoreCamera = (viewCamera, controls, previous) => {
        viewCamera.position.copy(previous.position);
        controls.target.copy(previous.target);
        viewCamera.near = previous.near; viewCamera.far = previous.far;
        viewCamera.fov = previous.fov; viewCamera.zoom = previous.zoom;
        viewCamera.updateProjectionMatrix();
        controls.update();
      };
      restoreCamera(camera, orbit, saved.modelCamera);
      restoreCamera(tree3dCamera, tree3dOrbit, saved.treeCamera);
      restorePinnedTreeSelection();
      restorePinnedPreviewSelection();
    }

    function setEditTarget(id) {
      if (!continuousEditor?.parts.some((part) => part.id === id)) return;
      editTargetId = id;
      updateEditControls();
    }

    function queueContinuousScale(raw, id = editTargetId) {
      const scale = Number(raw);
      const part = continuousEditor?.parts.find((item) => item.id === id);
      if (!part || !Number.isFinite(scale) || scale < 0.4 || scale > 1.6) return;
      // Several observed instances can expose the same native PART_PARAMS
      // control. The last input/reset wins for that parameter in this frame.
      for (const queuedId of queuedScales.keys()) {
        const queued = continuousEditor.parts.find((item) => item.id === queuedId);
        if (queuedId === id || (part.parameter_id && queued?.parameter_id === part.parameter_id)) queuedScales.delete(queuedId);
      }
      queuedScales.set(id, Math.round(scale * 100) / 100);
      if (previewFrame === null) previewFrame = requestAnimationFrame(() => {
        previewFrame = null;
        applyContinuousPreview(false);
      });
    }

    function applyContinuousPreview(commit = false) {
      if (!continuousEditor || !structureData || !activeExample) return;
      if (previewFrame !== null) { cancelAnimationFrame(previewFrame); previewFrame = null; }
      try {
        const previous = structureData.views.anchors;
        const selectedEdge = previous.edges.find((edge) => anchorEdgeKey(edge) === graphState.selectedEdge);
        if (continuousEditor.setScales) continuousEditor.setScales(Object.fromEntries(queuedScales));
        else for (const [id, scale] of queuedScales) continuousEditor.setScale(id, scale);
        queuedScales.clear();
        const edited = continuousEditor.hasEdits();
        const refreshGraph = commit || Boolean(previous.preview_only) !== edited;
        const saved = refreshGraph ? captureEditView() : null;
        const runtime = continuousEditor.getRuntime();
        if (edited) invalidatePreviewChecks(runtime);
        for (const node of runtime.nodes) node.group = 'Observed part';
        structureData.views.anchors = runtime;
        structureData.views.parts = { ...runtime, label: edited ? 'Browser preview part hierarchy' : 'Observed part hierarchy', edges: runtime.edges.filter(isDirectedAnchorEdge) };
        const currentEdge = selectedEdge && runtime.edges.find((edge) => edge.parent === selectedEdge.parent && edge.child === selectedEdge.child);
        graphState.selectedEdge = currentEdge ? anchorEdgeKey(currentEdge) : null;
        if (previewHighlightRequest) {
          const request = previewHighlightRequest;
          request.nodes = request.nodes.map((node) => runtime.nodes.find((item) => item.id === node.id)).filter(Boolean);
          request.view = runtime;
          if (request.edge) request.edge = runtime.edges.find((edge) => edge.parent === request.edge.parent && edge.child === request.edge.child) || null;
          if (request.edge) showPreviewAnchorOverlay(request.edge, runtime);
        }
        if (saved) {
          saved.anchorMode = graphState.anchorMode;
          restoreEditView(saved);
          buildControls();
        } else {
          updateGraphLegend();
        }
        updateModelAnchors();
        updateEditControls();
        const editedCount = continuousEditor.parts.filter((part) => Math.abs(continuousEditor.getScale(part.id) - 1) > 1e-9).length;
        const savedChecks = runtime.validation_status !== 'not_run';
        setStatus(edited
          ? `${activeExample.title} · ${editedCount} edited ${editedCount === 1 ? 'part' : 'parts'} · Browser preview · checks not rerun`
          : `${activeExample.title} · Original geometry · ${savedChecks ? 'saved checks' : 'checks not rerun'}`, edited || !savedChecks ? '' : 'success');
        if (edited) {
          graphStatus.textContent = 'Browser preview · checks not rerun';
          graphDetail.textContent = 'Part sizes and attachment coordinates follow the browser preview. Contact and shared-anchor validity have not been evaluated.';
        } else {
          graphDetail.textContent = savedChecks
            ? 'Original geometry and saved checks restored. Select a part or relation to inspect it.'
            : 'Original geometry restored. Select a part or relation to inspect it. Attachment checks have not been rerun.';
        }
      } catch (error) {
        queuedScales.clear();
        setStatus(String(error.message || error), 'error');
        editState.dataset.state = 'error';
        editState.textContent = 'Preview edit could not be applied';
      }
    }

    function resetAllEdits() {
      if (!continuousEditor) return;
      queuedScales.clear();
      continuousEditor.resetAll();
      applyContinuousPreview(true);
    }

    function applyDisplayOptions() {
      grid.visible = displayOptions.grid;
      updateModelAnchors();
      if (!currentModel) return;
      const selected = new Set();
      if (previewHighlightRequest) {
        for (const node of previewHighlightRequest.nodes) {
          for (const mesh of matchingPreviewMeshes(node, previewHighlightRequest.view)) selected.add(mesh);
        }
      }
      currentModel.traverse((mesh) => {
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.wireframe = displayOptions.wireframe;
          material.visible = !displayOptions.isolate || !selected.size || selected.has(mesh);
        }
      });
    }

    function buildControls() {
      if (!activeExample || !activeSnapshot) return;
      const example = activeExample;
      const runtime = structureData?.views?.anchors || activeSnapshot.runtime;
      const counts = snapshotCounts(runtime);
      const preview = Boolean(runtime.preview_only);
      const baseline = example.source === 'stage1';
      panelTitle.textContent = example.title;
      controlsHost.innerHTML = `
        <section class="control-group">
          <span class="source-tag ${baseline ? 'baseline' : ''}">${escapeHtml(providerLabel(example))}</span>
          <dl class="model-stats"><div><dt>Parts</dt><dd>${counts.parts}</dd></div>${preview ? '<div><dt>Validation</dt><dd class="preview-check-label">Not rerun</dd></div>' : `<div><dt>Shared anchors</dt><dd>${counts.shared}</dd></div><div><dt>Broken</dt><dd>${counts.broken}</dd></div>`}</dl>
          <label class="display-toggle"><input type="checkbox" data-display="anchors" ${displayOptions.anchors ? 'checked' : ''}>Anchors on highlight</label>
          <label class="display-toggle"><input type="checkbox" data-display="wireframe" ${displayOptions.wireframe ? 'checked' : ''}>Wireframe</label>
          <label class="display-toggle"><input type="checkbox" data-display="isolate" ${displayOptions.isolate ? 'checked' : ''}>Isolate selected part</label>
          <label class="display-toggle"><input type="checkbox" data-display="grid" ${displayOptions.grid ? 'checked' : ''}>Ground grid</label>
        </section>`;
      applyDisplayOptions();
    }

    function updateModelNavigationButtons() {
      const options = [...modelSelect.options];
      const index = options.findIndex((option) => option.value === modelSelect.value);
      previousModelButton.disabled = modelSelect.disabled || index <= 0;
      nextModelButton.disabled = modelSelect.disabled || index < 0 || index >= options.length - 1;
      document.getElementById('model-position').textContent = index < 0 ? '' : `${index + 1} / ${options.length}`;
    }

    function showExampleError(error, retryAction = null) {
      setLoading(false);
      setStatus(String(error.message || error), 'error');
      graphStatus.textContent = 'This example could not be loaded. Select another model or reload to retry.';
      controlsHost.replaceChildren();
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry loading';
      retry.addEventListener('click', retryAction || (() => catalog ? selectModel(modelSelect.value, sourceSelect.value) : initialize()));
      controlsHost.append(retry);
    }

    async function loadSavedState(example, variant, preserve = false) {
      if (variant?.id === 'default' && example.native_edit?.baseline) variant = { ...variant, ...example.native_edit.baseline };
      const savedView = preserve ? pendingViewState || captureEditView() : null;
      const version = ++generationVersion;
      pendingExample = example;
      pendingViewState = savedView;
      sourceSelect.disabled = modelSelect.disabled = true;
      updateModelNavigationButtons();
      if (previewFrame !== null) { cancelAnimationFrame(previewFrame); previewFrame = null; }
      queuedScales.clear();
      clearPreviewPartHighlight();
      continuousEditor?.dispose(); continuousEditor = null; editTargetId = null;
      if (currentModel) { scene.remove(currentModel); disposeObject(currentModel); currentModel = null; }
      clearTree3DScene();
      graphEdges.replaceChildren(); graphNodes.replaceChildren();
      anchorRelations.replaceChildren(); graphDetail.textContent = '';
      structureData = null;
      schema = null;
      activeExample = null;
      activeSnapshot = null;
      controlsHost.replaceChildren();
      panelTitle.textContent = example.title;
      updateEditControls(example, 'loading');
      resetPaperComparison(example, variant, true);
      setLoading(true);
      modelAnchors.setVisible(false);
      setStatus(`Loading ${example.title} · ${stateLabel(variant)}…`);
      graphStatus.textContent = 'Loading matching geometry and saved attachment checks…';
      try {
        if (!variant?.glb || !variant.snapshot) throw new Error('This edit state has not been saved. Choose another scale.');
        const snapshotRequest = async () => {
          let snapshot = snapshotCache.get(variant.snapshot);
          if (!snapshot) {
            snapshot = validateSnapshot(await readExampleJson(variant.snapshot));
            snapshotCache.set(variant.snapshot, snapshot);
          }
          return snapshot;
        };
        const results = await Promise.allSettled([
          snapshotRequest(),
          loader.loadAsync(assetUrl(variant.glb, dataRoot)),
          variant.mesh_map ? readExampleJson(variant.mesh_map) : Promise.resolve([]),
          readNativeResponse(example),
        ]);
        const failure = results.find((result) => result.status === 'rejected');
        if (version !== generationVersion || failure) {
          if (results[1].status === 'fulfilled') disposeObject(results[1].value.scene);
          if (version !== generationVersion) return;
          throw failure.reason;
        }
        const snapshot = results[0].value;
        const gltf = results[1].value;
        const meshMap = results[2].value;
        if (!Array.isArray(meshMap)) { disposeObject(gltf.scene); throw new Error('This edit has an invalid saved mesh map.'); }
        activeExample = example;
        activeSnapshot = snapshot;
        pendingExample = null;
        pendingViewState = null;
        schema = { ...snapshot.schema };
        if (!preserve) displayOptions.isolate = false;
        const runtime = structuredClone(snapshot.runtime);
        for (const node of runtime.nodes) node.group = 'Observed part';
        const structure = structuredClone(snapshot.structure);
        structure.views.anchors = runtime;
        // The public part tree uses the same observed mesh identities as the model.
        // Definition and call views still show the original static source analysis.
        structure.views.parts = { ...runtime, label: 'Observed part hierarchy', edges: runtime.edges.filter((edge) => edge.parent_child_known || edge.directed_verified) };
        installGLB(gltf, meshMap);
        continuousEditor = results[3].value
          ? createNativeEditor({ model: currentModel, runtime: snapshot.runtime, provenance: snapshot.provenance, ...results[3].value })
          : createContinuousEditor({ model: currentModel, runtime: snapshot.runtime, provenance: snapshot.provenance });
        editTargetId = continuousEditor.parts.find((part) => runtime.roots?.includes(part.id))?.id
          || continuousEditor.parts[0]?.id || null;
        if (savedView) {
          structureData = structure;
          const preferred = savedView.view === 'tree3d' ? runtime : structure.views[savedView.view];
          graphState.view = preferred?.nodes?.length ? savedView.view : 'parts';
          updateGraphTabs();
          restoreEditView(savedView);
        } else {
          initializeGraph(structure);
          fitCamera(false);
        }
        buildControls();
        updateEditControls(example);
        applyDisplayOptions();
        rememberSelection(providerKey(example), example.id);
        const counts = snapshotCounts(runtime);
        setStatus(`${example.title} · ${stateLabel(variant)} · ${counts.parts} parts · ${counts.shared} shared anchors`, 'success');
        graphDetail.textContent = runtime.validation_status === 'not_run'
          ? 'Select a part or relation to inspect it. Attachment checks have not been rerun for this geometry.'
          : `Saved checks for ${stateLabel(variant).toLowerCase()}. Select a part or relation to inspect it.`;
        resetPaperComparison(example, variant);
        if (comparisonVisible) void updatePaperComparison();
      } catch (error) {
        if (version === generationVersion) {
          clearPreviewPartHighlight();
          continuousEditor?.dispose(); continuousEditor = null; editTargetId = null;
          if (currentModel) { scene.remove(currentModel); disposeObject(currentModel); currentModel = null; }
          clearTree3DScene();
          graphEdges.replaceChildren(); graphNodes.replaceChildren(); anchorRelations.replaceChildren();
          structureData = null; schema = null; activeExample = null; activeSnapshot = null;
          pendingExample = example; pendingViewState = savedView;
          showExampleError(error, () => loadSavedState(example, variant, preserve));
          updateEditControls(example, 'error');
          comparisonStatus.textContent = 'This saved edit could not be loaded. Retry using the controls on the left.';
          comparisonStatus.className = 'error';
        }
      } finally {
        if (version === generationVersion) {
          sourceSelect.disabled = modelSelect.disabled = false;
          updateModelNavigationButtons();
          setLoading(false);
        }
      }
    }

    async function selectModel(modelId, sourceId = sourceSelect.value) {
      const example = catalog.models.find((model) => model.id === modelId && providerKey(model) === sourceId);
      if (!example) return;
      comparisonPreset.value = 'default';
      pendingViewState = null;
      const variant = savedVariant(example) || { id: 'default', side: 'default', scale: 1 };
      await loadSavedState(example, variant);
    }

    async function loadModelsForSource(sourceId, preferredLabel = '', preferredModelId = '') {
      const models = catalog.models.filter((model) => providerKey(model) === sourceId);
      modelSelect.replaceChildren();
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.title;
        option.dataset.modelLabel = model.label;
        modelSelect.append(option);
      }
      const preferred = models.find((model) => model.id === preferredModelId || model.label === preferredLabel);
      modelSelect.value = preferred?.id || models[0]?.id || '';
      if (!modelSelect.value) throw new Error('No saved examples are available in this collection.');
      await selectModel(modelSelect.value, sourceId);
    }

    function selectAdjacentModel(offset) {
      if (modelSelect.disabled) return;
      const index = modelSelect.selectedIndex + offset;
      if (index < 0 || index >= modelSelect.options.length) return;
      modelSelect.selectedIndex = index;
      void selectModel(modelSelect.value, sourceSelect.value);
    }

    function resetDisplay() {
      displayOptions.wireframe = false; displayOptions.isolate = false; displayOptions.grid = true;
      orbit.autoRotate = false;
      rotateButton.classList.remove('active'); rotateButton.setAttribute('aria-pressed', 'false');
      clearPreviewPartHighlight();
      graphState.selected = null; graphState.selectedEdge = null; graphState.anchorFocusNode = null;
      graphState.query = ''; graphSearch.value = ''; graphState.collapsed.clear();
      graphState.tree3dShowRealParts = false; tree3dShowRealParts.checked = false;
      graphState.tree3dShowShared = true; tree3dShowShared.checked = true;
      pendingViewState = null;
      resetAllEdits();
      updateEditControls(pendingExample || activeExample, pendingExample ? 'loading' : 'ready');
      if (structureData) setGraphView(tree3dSourceView()?.nodes?.length ? 'tree3d' : 'parts');
      fitCamera(false); buildControls(); applyDisplayOptions();
    }

    function selectObservedPart(id) {
      if (!structureData) return;
      if (!['tree3d', 'parts', 'anchors'].includes(graphState.view)) setGraphView('parts');
      selectGraphNode(id);
      applyDisplayOptions();
    }

    controlsHost.addEventListener('change', (event) => {
      const key = event.target.dataset.display;
      if (Object.hasOwn(displayOptions, key)) {
        displayOptions[key] = event.target.checked;
        applyDisplayOptions();
        if (key === 'anchors' && previewHighlightRequest?.edge) applyPreviewPartHighlight();
      }
    });
    editParts.addEventListener('focusin', (event) => {
      const id = event.target.closest('[data-part-id]')?.dataset.partId;
      if (id && id !== editTargetId) selectObservedPart(id);
    });
    editParts.addEventListener('input', (event) => {
      const control = event.target;
      if (!('editScale' in control.dataset || 'editNumber' in control.dataset)) return;
      const id = control.closest('[data-part-id]')?.dataset.partId;
      if (!id) return;
      const value = control.valueAsNumber;
      if (id !== editTargetId) selectObservedPart(id);
      queueContinuousScale(value, id);
    });
    editParts.addEventListener('change', (event) => {
      const control = event.target;
      if (!('editScale' in control.dataset || 'editNumber' in control.dataset)) return;
      const id = control.closest('[data-part-id]')?.dataset.partId;
      if (!id || !continuousEditor) return;
      const value = control.valueAsNumber;
      if (Number.isFinite(value)) queueContinuousScale(Math.max(0.4, Math.min(1.6, value)), id);
      applyContinuousPreview(true);
      const number = editRows.get(id)?.number;
      if (number) number.value = continuousEditor.getScale(id).toFixed(2);
    });
    editParts.addEventListener('click', (event) => {
      const control = event.target.closest('[data-edit-select], [data-edit-reset]');
      const id = control?.closest('[data-part-id]')?.dataset.partId;
      if (!id || control.disabled) return;
      selectObservedPart(id);
      if ('editReset' in control.dataset) {
        queueContinuousScale(1, id);
        applyContinuousPreview(true);
      }
    });
    editResetAll.addEventListener('click', resetAllEdits);
    comparisonToggle.addEventListener('click', () => setComparisonMode(!comparisonVisible));
    comparisonPreset.addEventListener('change', () => {
      resetPaperComparison(activeExample, null);
      void updatePaperComparison();
    });

    const previewRaycaster = new THREE.Raycaster();
    bindSelectionClick(canvas, (event) => {
      if (!currentModel || !structureData) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      previewRaycaster.setFromCamera(pointer, camera);
      const hit = previewRaycaster.intersectObject(currentModel, true).find(({object}) => object.isMesh && (Array.isArray(object.material) ? object.material : [object.material]).some((m) => m.visible));
      if (!hit) { clearSelection(); return; }
      const nodes = structureData.views.anchors.nodes;
      const scored = nodes.map((node) => ({node,score:previewMeshMatchScore(hit.object,node)})).sort((a,b) => b.score-a.score);
      if (scored[0]?.score > 0) selectObservedPart(scored[0].node.id);
    });

    async function initialize() {
      setLoading(true);
      catalog = null;
      try {
        const manifest = await readExampleJson('manifest.json');
        if (!Array.isArray(manifest?.models) || !manifest.models.length) throw new Error('No saved examples are available.');
        if (manifest.models.some((model) => !model || typeof model.id !== 'string' || !model.id || typeof model.source !== 'string' || !model.source)) {
          throw new Error('The saved example catalog is incomplete. Please reload to try again.');
        }
        catalog = manifest;
        sourceSelect.replaceChildren();
        const sourceIds = [...new Set(catalog.models.map((model) => model.provider_id || model.source || model.provider))];
        for (const source of sourceIds) {
          const option = document.createElement('option');
          option.value = source;
          const examples = catalog.models.filter((model) => (model.provider_id || model.source || model.provider) === source);
          const first = examples[0];
          option.textContent = `${first.provider_label || first.provider || first.source_label || source} (${examples.length})`;
          sourceSelect.append(option);
        }
        const remembered = readRememberedSelection();
        sourceSelect.value = sourceIds.includes(remembered?.source) ? remembered.source : sourceIds[0];
        await loadModelsForSource(sourceSelect.value, '', remembered?.model || '');
      } catch (error) { showExampleError(error); }
    }

    graphTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-graph-view]');
      if (button && !button.disabled) setGraphView(button.dataset.graphView);
    });
    tree3dShowRealParts.addEventListener('change', () => {
      graphState.tree3dShowRealParts = tree3dShowRealParts.checked;
      clearTree3DHover();
      if (graphState.view === 'tree3d') renderGraph();
    });
    tree3dShowShared.addEventListener('change', () => {
      graphState.tree3dShowShared = tree3dShowShared.checked;
      clearTree3DHover();
      if (graphState.view === 'tree3d') renderGraph();
    });
    anchorControls.addEventListener('click', (event) => {
      const modeButton = event.target.closest('[data-anchor-mode]');
      if (!modeButton) return;
      const nextMode = modeButton.dataset.anchorMode;
      const rawView = structureData?.views?.anchors;
      const selectedEdge = rawView?.edges?.find(
        (edge) => anchorEdgeKey(edge) === graphState.selectedEdge
      );
      const selectedRemainsVisible = Boolean(
        selectedEdge && anchorEdgeMatches(selectedEdge, nextMode)
      );
      const focusedNode = graphState.anchorFocusNode;
      const focusRemainsVisible = Boolean(
        !selectedEdge
        && focusedNode
        && rawView?.edges?.some(
          (edge) => anchorEdgeMatches(edge, nextMode)
            && (edge.parent === focusedNode || edge.child === focusedNode)
        )
      );

      graphState.anchorMode = nextMode;
      graphState.selected = null;
      if (selectedRemainsVisible) {
        graphState.anchorFocusNode = null;
        showAnchorEdgeDetail(selectedEdge);
      } else if (focusRemainsVisible) {
        graphState.selectedEdge = null;
      } else {
        clearPreviewPartHighlight();
        graphState.anchorFocusNode = null;
        graphState.selectedEdge = null;
      }

      if (!selectedRemainsVisible && selectedEdge && nextMode === 'shared') {
        graphDetail.textContent = `${selectedEdge.parent} → ${selectedEdge.child}\nNo saved attachment coordinates are available for this relation.`;
      } else if (!selectedRemainsVisible && !focusRemainsVisible) {
        graphDetail.textContent = graphState.anchorMode === 'shared'
          ? 'Attachment coordinates remain visible during edits. A visible anchor is not a validation result.'
          : `${anchorModeLabel(graphState.anchorMode)} mode: click a node to focus its one-hop relations, or click a relation card to inspect endpoints and anchor coordinates.`;
      }
      renderGraph();
      requestAnimationFrame(resetGraphPosition);
    });
    anchorClearFocusButton.addEventListener('click', () => {
      clearPreviewPartHighlight();
      graphState.anchorFocusNode = null;
      graphState.selected = null;
      graphState.selectedEdge = null;
      graphDetail.textContent = graphState.anchorMode === 'shared'
        ? 'Anchor overview: each attachment pair is displayed in a separate row.'
        : `${anchorModeLabel(graphState.anchorMode)} overview: click any node to show only its directly connected relations.`;
      renderGraph();
      requestAnimationFrame(resetGraphPosition);
    });
    function setGraphFullscreen(expanded) {
      graphPanel.classList.toggle('graph-expanded', expanded);
      graphFullscreenButton.textContent = expanded ? 'Exit Expanded View' : 'Enlarge Graph';
      graphFullscreenButton.setAttribute('aria-pressed', String(expanded));
      tree3dFullscreenButton.textContent = expanded ? 'Exit Fullscreen' : 'Fullscreen';
      tree3dFullscreenButton.setAttribute('aria-pressed', String(expanded));
      requestAnimationFrame(resetGraphPosition);
    }
    graphFullscreenButton.addEventListener('click', () => {
      setGraphFullscreen(!graphPanel.classList.contains('graph-expanded'));
    });
    tree3dFullscreenButton.addEventListener('click', () => {
      setGraphFullscreen(!graphPanel.classList.contains('graph-expanded'));
    });

    tree3dExportTransparentButton.addEventListener('click', async () => {
      if (!currentModel || tree3dExportTransparentButton.disabled) return;
      const filename = `${modelSelect.value || 'model'}_structure.png`;
      tree3dExportTransparentButton.disabled = true;
      tree3dExportTransparentButton.textContent = 'Saving…';
      try {
        const blob = await captureTransparentPng(tree3dRenderer, tree3dScene, tree3dCamera, tree3dCanvas);
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        setStatus(`Image export failed: ${String(error.message || error)}`, 'error');
      } finally {
        tree3dExportTransparentButton.disabled = false;
        tree3dExportTransparentButton.textContent = 'Save PNG';
      }
    });
    anchorRelations.addEventListener('click', (event) => {
      const card = event.target.closest('[data-anchor-edge]');
      if (card) selectAnchorEdge(card.dataset.anchorEdge);
    });
    graphSearch.addEventListener('input', () => {
      graphState.query = graphSearch.value.trim().toLowerCase();
      if (graphState.query) graphState.collapsed.clear();
      renderGraph();
      if (graphState.query) {
        const match = graphView()?.nodes.find((node) =>
          String(node.label).toLowerCase().includes(graphState.query)
          || String(node.id).toLowerCase().includes(graphState.query)
          || String(node.part_name || '').toLowerCase().includes(graphState.query)
        );
        if (match) {
          if (graphState.view === 'tree3d') selectObservedPart(match.id);
          else focusGraphNode(match.id);
        } else {
          graphStatus.textContent = `No parts match “${graphSearch.value}”.`;
        }
      }
    });
    graphExpandButton.addEventListener('click', () => {
      graphState.collapsed.clear();
      renderGraph();
      resetGraphPosition();
    });
    graphFitButton.addEventListener('click', resetGraphPosition);

    graphSvg.addEventListener('click', (event) => {
      const anchorEdge = event.target.closest('[data-anchor-edge]');
      if (anchorEdge) {
        selectAnchorEdge(anchorEdge.getAttribute('data-anchor-edge'));
        return;
      }
      const collapse = event.target.closest('[data-graph-collapse]');
      if (collapse) {
        const id = collapse.getAttribute('data-graph-collapse');
        if (graphState.collapsed.has(id)) graphState.collapsed.delete(id);
        else graphState.collapsed.add(id);
        renderGraph();
        resetGraphPosition();
        return;
      }
      const node = event.target.closest('[data-graph-node]');
      if (node) selectGraphNode(node.getAttribute('data-graph-node'));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && graphPanel.classList.contains('graph-expanded')) {
        setGraphFullscreen(false);
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectAdjacentModel(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectAdjacentModel(1);
      }
    });

    tree3dCanvas.addEventListener('pointermove', updateTree3DPointer);
    tree3dCanvas.addEventListener('pointerleave', clearTree3DHover);

    graphSvg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const readableView = graphState.view === 'definitions'
        || graphState.view === 'calls'
        || (
          graphState.view === 'anchors'
          && (graphState.anchorMode === 'shared')
        );
      if (readableView && !event.ctrlKey && !event.metaKey) {
        graphState.tx -= event.deltaX * 0.7;
        graphState.ty -= event.deltaY * 0.7;
        updateGraphTransform();
        return;
      }
      const rect = graphSvg.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const oldScale = graphState.scale;
      const normalizedDelta = Math.max(-100, Math.min(100, event.deltaY));
      const zoomFactor = Math.exp(-normalizedDelta * 0.00045);
      const nextScale = Math.max(0.04, Math.min(4, oldScale * zoomFactor));
      const worldX = (pointerX - graphState.tx) / oldScale;
      const worldY = (pointerY - graphState.ty) / oldScale;
      graphState.scale = nextScale;
      graphState.tx = pointerX - worldX * nextScale;
      graphState.ty = pointerY - worldY * nextScale;
      updateGraphTransform();
    }, { passive: false });

    graphSvg.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-graph-node], [data-anchor-edge]')) return;
      graphState.dragging = true;
      graphState.dragX = event.clientX;
      graphState.dragY = event.clientY;
      graphState.startTx = graphState.tx;
      graphState.startTy = graphState.ty;
      graphSvg.setPointerCapture(event.pointerId);
    });
    graphSvg.addEventListener('pointermove', (event) => {
      if (!graphState.dragging) return;
      graphState.tx = graphState.startTx + event.clientX - graphState.dragX;
      graphState.ty = graphState.startTy + event.clientY - graphState.dragY;
      updateGraphTransform();
    });
    graphSvg.addEventListener('pointerup', (event) => {
      graphState.dragging = false;
      if (graphSvg.hasPointerCapture(event.pointerId)) graphSvg.releasePointerCapture(event.pointerId);
    });
    graphSvg.addEventListener('pointercancel', () => {
      graphState.dragging = false;
    });

    sourceSelect.addEventListener('change', () => {
      const preferredLabel = modelSelect.selectedOptions[0]?.dataset.modelLabel || '';
      loadModelsForSource(sourceSelect.value, preferredLabel).catch((error) => {
        setStatus(String(error.message || error), 'error');
      });
    });
    modelSelect.addEventListener('change', () => {
      updateModelNavigationButtons();
      selectModel(modelSelect.value, sourceSelect.value).catch((error) => {
        setStatus(String(error.message || error), 'error');
      });
    });
    previousModelButton.addEventListener('click', () => selectAdjacentModel(-1));
    nextModelButton.addEventListener('click', () => selectAdjacentModel(1));
    copySelectionButton.addEventListener('click', copyCurrentSelection);
    resetButton.addEventListener('click', resetDisplay);
    fitButton.addEventListener('click', () => fitCamera(true));
    rotateButton.addEventListener('click', () => {
      orbit.autoRotate = !orbit.autoRotate;
      rotateButton.classList.toggle('active', orbit.autoRotate);
      rotateButton.setAttribute('aria-pressed', String(orbit.autoRotate));
    });
    previewSelectionClear.addEventListener('click', clearSelection);

    const resizeObserver = new ResizeObserver(() => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(canvas.parentElement);
    const graphResizeObserver = new ResizeObserver(() => {
      if (graphState.view === 'tree3d') {
        resizeTree3D();
        return;
      }
      resetGraphPosition();
    });
    graphResizeObserver.observe(graphStage);

    function animate() {
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.14;
      for (const marker of previewAnchorOverlay.children) {
        if (marker.userData.anchorPulse) marker.scale.setScalar(pulse);
      }
      if (!comparisonVisible) {
        orbit.update();
        renderer.render(scene, camera);
      }
      if (!tree3dStage.hidden) {
        tree3dOrbit.update();
        tree3dRenderer.render(tree3dScene, tree3dCamera);
      }
      requestAnimationFrame(animate);
    }
    void initialize().then(() => animate());

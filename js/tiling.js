/**
 * BSP Tiling Manager with Dynamic Tree Structure and Lerping
 * 
 * This engine manages windows as leaves in a binary tree.
 * Dragging a window allows you to re-insert it into the tree, 
 * splitting any existing window horizontally or vertically.
 */

const workspace = document.getElementById('workspace');
const windowElements = Array.from(document.querySelectorAll('.generic-window-window'));

const LERP_FACTOR = 0.25;
const DRAG_LERP_FACTOR = 0.6;
const GAPS = 10;

// --- Tree Structure ---

class TilingNode {
    constructor(data = null) {
        this.window = data; // If not null, this contains { el, target, current }
        this.split = 'h';   // 'h' (horizontal split) or 'v' (vertical split)
        this.ratio = 0.5;
        this.children = []; // [Left/Top, Right/Bottom]
        this.parent = null;
        
        // Internal target rect for recursive layout
        this.target = { x: 0, y: 0, w: 0, h: 0 };
    }

    isLeaf() {
        return this.window !== null;
    }

    setChildren(a, b) {
        this.children = [a, b];
        a.parent = this;
        b.parent = this;
        this.window = null;
    }
}

// Global state tracking for windows
let windowStates = windowElements.map(el => {
    const node = new TilingNode({
        el,
        target: { x: 0, y: 0, w: 0, h: 0 },
        current: { x: 0, y: 0, w: 0, h: 0 }
    });
    return { el, node, isDragging: false };
});

let root = null;

/**
 * Initializes the tree as a classic Dwindle spiral.
 */
function initTree() {
    const nodes = windowStates.map(s => s.node);
    
    // Level 3: W3 and W4 (Horizontal split)
    const n34 = new TilingNode();
    n34.split = 'h';
    n34.setChildren(nodes[2], nodes[3]);
    
    // Level 2: W2 and (W3, W4) (Vertical split)
    const n234 = new TilingNode();
    n234.split = 'v';
    n234.setChildren(nodes[1], n34);
    
    // Level 1: W1 and (W2, W3, W4) (Horizontal split)
    root = new TilingNode();
    root.split = 'h';
    root.setChildren(nodes[0], n234);
}

// --- Layout Calculation ---

/**
 * Recursively calculates target rectangles for all nodes in the tree.
 */
function calculateLayout(node, rect) {
    node.target = { ...rect };
    
    if (node.isLeaf()) {
        node.window.target = { ...rect };
        return;
    }

    const [a, b] = node.children;
    if (node.split === 'h') {
        const wA = (rect.w - GAPS) * node.ratio;
        calculateLayout(a, { x: rect.x, y: rect.y, w: wA, h: rect.h });
        calculateLayout(b, { x: rect.x + wA + GAPS, y: rect.y, w: rect.w - wA - GAPS, h: rect.h });
    } else {
        const hA = (rect.h - GAPS) * node.ratio;
        calculateLayout(a, { x: rect.x, y: rect.y, w: rect.w, h: hA });
        calculateLayout(b, { x: rect.x, y: rect.y + hA + GAPS, w: rect.w, h: rect.h - hA - GAPS });
    }
}

function updateTargets() {
    const wsRect = workspace.getBoundingClientRect();
    calculateLayout(root, {
        x: GAPS,
        y: GAPS,
        w: wsRect.width - GAPS * 2,
        h: wsRect.height - GAPS * 2
    });
}

// --- Interaction Logic ---

let draggedState = null;
let currentMouse = { x: 0, y: 0 };
let mouseOffset = { x: 0, y: 0 };
let previewNode = null;
let previewSide = 'left';

/**
 * Finds the leaf node containing the given coordinates.
 */
function findLeafAt(node, x, y) {
    if (node.isLeaf()) return node;
    for (const child of node.children) {
        const t = child.target;
        if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
            return findLeafAt(child, x, y);
        }
    }
    return null;
}

/**
 * Removes a node from the tree and handles the parent cleanup.
 */
function uprootNode(node) {
    if (node === root) return;
    
    const p = node.parent;
    const sibling = p.children.find(c => c !== node);
    const gp = p.parent;
    
    if (!gp) {
        root = sibling;
        root.parent = null;
    } else {
        const idx = gp.children.indexOf(p);
        gp.children[idx] = sibling;
        sibling.parent = gp;
    }
}

/**
 * Inserts a node into the tree at the target leaf, splitting it in the given direction.
 */
function insertNode(nodeToInsert, targetLeaf, side) {
    const p = targetLeaf.parent;
    const newNode = new TilingNode();
    newNode.split = (side === 'left' || side === 'right') ? 'h' : 'v';
    
    if (!p) {
        root = newNode;
        newNode.parent = null;
    } else {
        const idx = p.children.indexOf(targetLeaf);
        p.children[idx] = newNode;
        newNode.parent = p;
    }
    
    if (side === 'left' || side === 'top') {
        newNode.setChildren(nodeToInsert, targetLeaf);
    } else {
        newNode.setChildren(targetLeaf, nodeToInsert);
    }
}

// --- Animation Loop ---

function animate() {
    windowStates.forEach(state => {
        const win = state.node.window;
        if (state.isDragging) {
            win.current.x += (currentMouse.x - mouseOffset.x - win.current.x) * DRAG_LERP_FACTOR;
            win.current.y += (currentMouse.y - mouseOffset.y - win.current.y) * DRAG_LERP_FACTOR;
        } else {
            win.current.x += (win.target.x - win.current.x) * LERP_FACTOR;
            win.current.y += (win.target.y - win.current.y) * LERP_FACTOR;
            win.current.w += (win.target.w - win.current.w) * LERP_FACTOR;
            win.current.h += (win.target.h - win.current.h) * LERP_FACTOR;
        }

        state.el.style.left = `${win.current.x}px`;
        state.el.style.top = `${win.current.y}px`;
        state.el.style.width = `${win.current.w}px`;
        state.el.style.height = `${win.current.h}px`;
    });

    requestAnimationFrame(animate);
}

// --- Events ---

windowElements.forEach(el => {
    el.addEventListener('mousedown', (e) => {
        const state = windowStates.find(s => s.el === el);
        draggedState = state;
        state.isDragging = true;
        el.classList.add('dragging');
        
        const rect = el.getBoundingClientRect();
        const wsRect = workspace.getBoundingClientRect();
        mouseOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        
        uprootNode(state.node);
        updateTargets();
    });
});

window.addEventListener('mousemove', (e) => {
    const wsRect = workspace.getBoundingClientRect();
    currentMouse = { x: e.clientX - wsRect.left, y: e.clientY - wsRect.top };
    
    if (draggedState) {
        const leaf = findLeafAt(root, currentMouse.x, currentMouse.y);
        if (leaf && leaf !== draggedState.node) {
            previewNode = leaf;
            const t = leaf.target;
            const relX = (currentMouse.x - t.x) / t.w;
            const relY = (currentMouse.y - t.y) / t.h;
            
            // Determine side based on which quadrant the mouse is in
            const dists = {
                left: relX,
                right: 1 - relX,
                top: relY,
                bottom: 1 - relY
            };
            previewSide = Object.keys(dists).reduce((a, b) => dists[a] < dists[b] ? a : b);
        } else {
            previewNode = null;
        }
    }
});

window.addEventListener('mouseup', () => {
    if (draggedState) {
        if (previewNode) {
            insertNode(draggedState.node, previewNode, previewSide);
        } else {
            // Re-insertion fallback
            let leaf = root;
            while(!leaf.isLeaf()) leaf = leaf.children[0];
            insertNode(draggedState.node, leaf, 'left');
        }
        
        draggedState.el.classList.remove('dragging');
        draggedState.isDragging = false;
        draggedState = null;
        previewNode = null;
        updateTargets();
    }
});

window.addEventListener('resize', updateTargets);

// Start
initTree();
updateTargets();
windowStates.forEach(s => s.node.window.current = { ...s.node.window.target });
animate();

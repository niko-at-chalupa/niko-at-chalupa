/**
 * BSP Tiling Manager with Dynamic Tree Structure and Lerping
 * 
 * This engine manages windows as leaves in a binary tree (Binary Space Partitioning).
 * Dragging a window allows you to re-insert it into the tree, 
 * splitting any existing window horizontally or vertically.
 * 
 * The layout is calculated recursively, and window positions are smoothly
 * animated using a Linear Interpolation (Lerp) approach.
 */

const workspace = document.getElementById('workspace');
const windowElements = Array.from(document.querySelectorAll('.generic-window-window'));

// Animation constants for smoothness
const LERP_FACTOR = 0.25;        // Speed for normal tiling transitions
const DRAG_LERP_FACTOR = 0.6;   // Speed for following the mouse during drag
const GAPS = 10;                // Gap between windows in pixels

// --- Tree Structure ---

/**
 * Represents a node in the BSP tree.
 * A node can either be a leaf (containing a window) or an internal node (containing two children).
 */
class TilingNode {
    constructor(data = null) {
        this.window = data; // If not null, this contains { el, target, current }
        this.split = 'h';   // 'h' (horizontal split) or 'v' (vertical split)
        this.ratio = 0.5;   // The split ratio (50/50 by default)
        this.children = []; // Array containing exactly two TilingNode children if not a leaf
        this.parent = null; // Pointer to parent for easy tree traversal
        
        // Internal target rect for recursive layout calculation
        this.target = { x: 0, y: 0, w: 0, h: 0 };
    }

    /**
     * Checks if the node is a leaf (contains a window).
     */
    isLeaf() {
        return this.window !== null;
    }

    /**
     * Sets children for this node and updates their parent pointers.
     * This effectively turns a leaf node into an internal node.
     */
    setChildren(a, b) {
        this.children = [a, b];
        a.parent = this;
        b.parent = this;
        this.window = null; // Clear window data as it's no longer a leaf
    }
}

// Global state tracking for windows and their associated tree nodes
let windowStates = windowElements.map(el => {
    const node = new TilingNode({
        el,
        target: { x: 0, y: 0, w: 0, h: 0 },
        current: { x: 0, y: 0, w: 0, h: 0 }
    });
    return { el, node, isDragging: false };
});

let root = null; // The root of our BSP tree

/**
 * Initializes the tree as a classic Dwindle spiral.
 * This sets up the initial layout for the 4 windows.
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
 * @param {TilingNode} node - The node to calculate layout for.
 * @param {Object} rect - The bounding box assigned to this node.
 */
function calculateLayout(node, rect) {
    node.target = { ...rect };
    
    if (node.isLeaf()) {
        // Apply the calculated rectangle to the window's target state
        node.window.target = { ...rect };
        return;
    }

    // Split the current rectangle between two children
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

/**
 * Triggers a full layout recalculation based on the current workspace size.
 */
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

let draggedState = null;      // State of the window currently being dragged
let currentMouse = { x: 0, y: 0 };
let mouseOffset = { x: 0, y: 0 }; // Offset from window top-left to mouse cursor
let previewNode = null;       // The node we're currently hovering over during drag
let previewSide = 'left';      // The side of the previewNode we're hovering on

/**
 * Finds the leaf node containing the given coordinates.
 * Used to identify where to drop a dragged window.
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
 * When a leaf is removed, its sibling takes the place of their parent.
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

/**
 * The main animation loop using requestAnimationFrame.
 * This applies the LERP (Linear Interpolation) to smoothly move windows.
 */
function animate() {
    windowStates.forEach(state => {
        const win = state.node.window;
        if (state.isDragging) {
            // Faster follow-the-mouse lerping when dragging
            win.current.x += (currentMouse.x - mouseOffset.x - win.current.x) * DRAG_LERP_FACTOR;
            win.current.y += (currentMouse.y - mouseOffset.y - win.current.y) * DRAG_LERP_FACTOR;
        } else {
            // Standard lerping towards target coordinates and dimensions
            win.current.x += (win.target.x - win.current.x) * LERP_FACTOR;
            win.current.y += (win.target.y - win.current.y) * LERP_FACTOR;
            win.current.w += (win.target.w - win.current.w) * LERP_FACTOR;
            win.current.h += (win.target.h - win.current.h) * LERP_FACTOR;
        }

        // Apply calculated current state to DOM elements
        state.el.style.left = `${win.current.x}px`;
        state.el.style.top = `${win.current.y}px`;
        state.el.style.width = `${win.current.w}px`;
        state.el.style.height = `${win.current.h}px`;
    });

    requestAnimationFrame(animate);
}

// --- Event Listeners ---

windowElements.forEach(el => {
    el.addEventListener('mousedown', (e) => {
        const state = windowStates.find(s => s.el === el);
        draggedState = state;
        state.isDragging = true;
        el.classList.add('dragging');
        
        const rect = el.getBoundingClientRect();
        const wsRect = workspace.getBoundingClientRect();
        // Calculate where the mouse is relative to the window's top-left corner
        mouseOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        
        uprootNode(state.node); // Temporarily remove from tree layout
        updateTargets();        // Reflow remaining windows
    });
});

window.addEventListener('mousemove', (e) => {
    const wsRect = workspace.getBoundingClientRect();
    currentMouse = { x: e.clientX - wsRect.left, y: e.clientY - wsRect.top };
    
    if (draggedState) {
        // Identify which window we are hovering over to show potential drop targets
        const leaf = findLeafAt(root, currentMouse.x, currentMouse.y);
        if (leaf && leaf !== draggedState.node) {
            previewNode = leaf;
            const t = leaf.target;
            const relX = (currentMouse.x - t.x) / t.w;
            const relY = (currentMouse.y - t.y) / t.h;
            
            // Determine side (top/bottom/left/right) based on cursor position within the target leaf
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
            // Insert window into the tree at the hovered location
            insertNode(draggedState.node, previewNode, previewSide);
        } else {
            // Fallback: If dropped outside, re-insert at the start of the tree
            let leaf = root;
            while(!leaf.isLeaf()) leaf = leaf.children[0];
            insertNode(draggedState.node, leaf, 'left');
        }
        
        draggedState.el.classList.remove('dragging');
        draggedState.isDragging = false;
        draggedState = null;
        previewNode = null;
        updateTargets(); // Reflow the layout with the newly inserted node
    }
});

// Handle window resizing to keep the tiling layout consistent
window.addEventListener('resize', updateTargets);

// --- Boot ---
initTree();
updateTargets();
// Snap initial positions to targets so they don't slide in on first load
windowStates.forEach(s => s.node.window.current = { ...s.node.window.target });
animate(); // Start the animation frame loop

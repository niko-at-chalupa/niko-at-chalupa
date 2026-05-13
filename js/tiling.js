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

// Select all window elements. This includes generic editor windows and the new terminal window.
const windowElements = Array.from(document.querySelectorAll('.generic-window-window'));

// Animation constants for smoothness
const LERP_FACTOR = 0.25;        // Speed for normal tiling transitions (0.0 to 1.0)
const DRAG_LERP_FACTOR = 0.6;   // Faster speed for following the mouse during a drag operation
const GAPS = 10;                // Uniform gap between windows in pixels

// --- Tree Structure ---

/**
 * Represents a node in the BSP (Binary Space Partitioning) tree.
 * A node can either be a leaf (containing a window) or an internal node (containing two children).
 */
class TilingNode {
    constructor(data = null) {
        this.window = data; // If not null, this contains { el, target, current } state
        this.split = 'h';   // 'h' (horizontal split) or 'v' (vertical split)
        this.ratio = 0.5;   // The split ratio (50/50 by default, determining child sizes)
        this.children = []; // Array containing exactly two TilingNode children if this is an internal node
        this.parent = null; // Pointer to parent for easy tree traversal and removal
        
        // Internal target rect for recursive layout calculation
        this.target = { x: 0, y: 0, w: 0, h: 0 };
    }

    /**
     * Checks if the node is a leaf (contains a window).
     * Leaf nodes are the actual visible windows on the screen.
     */
    isLeaf() {
        return this.window !== null;
    }

    /**
     * Sets children for this node and updates their parent pointers.
     * This effectively turns a leaf node into an internal node (a split container).
     */
    setChildren(a, b) {
        this.children = [a, b];
        a.parent = this;
        b.parent = this;
        this.window = null; // Clear window data as it's no longer a leaf
    }
}

/**
 * Global state tracking for windows and their associated tree nodes.
 * We map each DOM element to a TilingNode and track its dragging state.
 */
let windowStates = windowElements.map(el => {
    const node = new TilingNode({
        el,
        target: { x: 0, y: 0, w: 0, h: 0 },
        current: { x: 0, y: 0, w: 0, h: 0 }
    });
    return { el, node, isDragging: false };
});

let root = null; // The root of our BSP tree structure

/**
 * Initializes the tree as a classic Dwindle spiral.
 * This sets up the initial layout for the windows by nesting splits.
 * Now dynamically handles any number of windows present in the DOM.
 */
function initTree() {
    const nodes = windowStates.map(s => s.node);
    if (nodes.length === 0) return;

    // Start with the first window as the root
    root = nodes[0];
    let leafToSplit = root;

    // Iterate through the remaining windows, nesting them into the tree
    for (let i = 1; i < nodes.length; i++) {
        const newNode = new TilingNode();
        // Alternate between horizontal and vertical splits for the spiral effect
        newNode.split = (i % 2 !== 0) ? 'h' : 'v';
        
        const p = leafToSplit.parent;
        if (!p) {
            // We are splitting the root
            root = newNode;
        } else {
            // Replace the leafToSplit in its parent with the new internal node
            const idx = p.children.indexOf(leafToSplit);
            p.children[idx] = newNode;
            newNode.parent = p;
        }
        
        // Split: the previous leaf goes on one side, the new window on the other
        newNode.setChildren(leafToSplit, nodes[i]);
        
        // The next window will split the window we just added
        leafToSplit = nodes[i];
    }
}

// --- Layout Calculation ---

/**
 * Recursively calculates target rectangles for all nodes in the tree based on split ratios and gaps.
 * @param {TilingNode} node - The node to calculate layout for.
 * @param {Object} rect - The bounding box assigned to this node by its parent.
 */
function calculateLayout(node, rect) {
    node.target = { ...rect };
    
    if (node.isLeaf()) {
        // Apply the calculated rectangle to the window's target state for interpolation
        node.window.target = { ...rect };
        return;
    }

    // Split the current rectangle between two children based on the split direction ('h' or 'v')
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
 * Triggers a full layout recalculation based on the current workspace dimensions.
 * This is called during initialization, after drags, and on window resize.
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

let draggedState = null;      // State of the window currently being dragged by the user
let currentMouse = { x: 0, y: 0 };
let mouseOffset = { x: 0, y: 0 }; // Offset from window top-left to mouse cursor to maintain relative position
let previewNode = null;       // The node we're currently hovering over during a drag operation
let previewSide = 'left';      // The side of the previewNode where the dragged window would be inserted

/**
 * Finds the leaf node containing the given screen coordinates.
 * Used to identify which window the user is currently hovering over during a drag.
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
 * Removes a node from the tree and handles the parent/sibling cleanup.
 * When a leaf is removed, its sibling "collapses" up to take the place of their shared parent.
 */
function uprootNode(node) {
    if (node === root) return;
    
    const p = node.parent;
    const sibling = p.children.find(c => c !== node);
    const gp = p.parent;
    
    if (!gp) {
        // We are removing one of the two top-level nodes
        root = sibling;
        root.parent = null;
    } else {
        // Replace the parent node in the grandparent's children array with the sibling
        const idx = gp.children.indexOf(p);
        gp.children[idx] = sibling;
        sibling.parent = gp;
    }
}

/**
 * Inserts a node into the tree at the target leaf, splitting it in the given direction.
 * This effectively creates a new split node where the target leaf once was.
 */
function insertNode(nodeToInsert, targetLeaf, side) {
    const p = targetLeaf.parent;
    const newNode = new TilingNode();
    // Determine split direction based on which side of the target we dropped on
    newNode.split = (side === 'left' || side === 'right') ? 'h' : 'v';
    
    if (!p) {
        // Target was the root node (only one window existed)
        root = newNode;
        newNode.parent = null;
    } else {
        // Replace the target leaf in its parent with our new split node
        const idx = p.children.indexOf(targetLeaf);
        p.children[idx] = newNode;
        newNode.parent = p;
    }
    
    // Order the children based on the drop side
    if (side === 'left' || side === 'top') {
        newNode.setChildren(nodeToInsert, targetLeaf);
    } else {
        newNode.setChildren(targetLeaf, nodeToInsert);
    }
}

// --- Animation Loop ---

/**
 * The main animation loop using requestAnimationFrame.
 * This applies the LERP (Linear Interpolation) to smoothly transition windows
 * between their current state and their target tiling coordinates.
 */
function animate() {
    windowStates.forEach(state => {
        const win = state.node.window;
        if (state.isDragging) {
            // Use a higher lerp factor for dragging to make the window feel responsive
            win.current.x += (currentMouse.x - mouseOffset.x - win.current.x) * DRAG_LERP_FACTOR;
            win.current.y += (currentMouse.y - mouseOffset.y - win.current.y) * DRAG_LERP_FACTOR;
        } else {
            // Standard smooth lerping towards calculated target coordinates and dimensions
            win.current.x += (win.target.x - win.current.x) * LERP_FACTOR;
            win.current.y += (win.target.y - win.current.y) * LERP_FACTOR;
            win.current.w += (win.target.w - win.current.w) * LERP_FACTOR;
            win.current.h += (win.target.h - win.current.h) * LERP_FACTOR;
        }

        // Apply calculated current state to the actual DOM elements via inline styles
        state.el.style.left = `${win.current.x}px`;
        state.el.style.top = `${win.current.y}px`;
        state.el.style.width = `${win.current.w}px`;
        state.el.style.height = `${win.current.h}px`;
    });

    // Continue the loop in the next animation frame
    requestAnimationFrame(animate);
}

// --- Event Listeners ---

// Setup mousedown listeners for each window to initiate dragging
windowElements.forEach(el => {
    el.addEventListener('mousedown', (e) => {
        // If the user is clicking an anchor tag (link) or something inside it, 
        // we don't want to start a drag operation. This allows links to be clickable.
        if (e.target.closest('a')) {
            return;
        }

        const state = windowStates.find(s => s.el === el);
        draggedState = state;
        state.isDragging = true;
        el.classList.add('dragging'); // Apply dragging styles (z-index, etc.)
        
        const rect = el.getBoundingClientRect();
        const wsRect = workspace.getBoundingClientRect();
        // Calculate where the mouse is relative to the window's top-left corner
        mouseOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        
        uprootNode(state.node); // Temporarily remove the node from the tree layout logic
        updateTargets();        // Reflow the remaining windows immediately
    });
});

// Track mouse movement across the entire window for drag positioning and preview logic
window.addEventListener('mousemove', (e) => {
    const wsRect = workspace.getBoundingClientRect();
    currentMouse = { x: e.clientX - wsRect.left, y: e.clientY - wsRect.top };
    
    if (draggedState) {
        // Identify which window we are currently hovering over to show potential drop targets
        const leaf = findLeafAt(root, currentMouse.x, currentMouse.y);
        if (leaf && leaf !== draggedState.node) {
            previewNode = leaf;
            const t = leaf.target;
            const relX = (currentMouse.x - t.x) / t.w;
            const relY = (currentMouse.y - t.y) / t.h;
            
            // Determine the nearest side (top/bottom/left/right) to decide split direction
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

// Handle the mouseup event to complete the drag and drop operation
window.addEventListener('mouseup', () => {
    if (draggedState) {
        if (previewNode) {
            // Re-insert the window into the tree at the identified hovered location
            insertNode(draggedState.node, previewNode, previewSide);
        } else {
            // Fallback: If dropped outside any window, re-insert at the "start" of the tree
            let leaf = root;
            while(!leaf.isLeaf()) leaf = leaf.children[0];
            insertNode(draggedState.node, leaf, 'left');
        }
        
        draggedState.el.classList.remove('dragging');
        draggedState.isDragging = false;
        draggedState = null;
        previewNode = null;
        updateTargets(); // Reflow the layout to incorporate the newly inserted node
    }
});

// Handle window resizing to keep the tiling layout consistent with the viewport size
window.addEventListener('resize', updateTargets);

// --- Page Transition Logic ---

/**
 * Adds the exit animation class to all windows.
 */
function triggerExitAnimation() {
    windowStates.forEach(state => {
        state.el.classList.remove('window-entry');
        state.el.classList.add('window-exit');
    });
}

/**
 * Intercepts link clicks to play the exit animation before navigating.
 * This provides a smooth transition when moving between pages in the site.
 */
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && 
        link.href && 
        link.getAttribute('target') !== '_blank' && 
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        
        // Only intercept internal links to avoid delaying external navigation
        const url = new URL(link.href);
        if (url.origin === window.location.origin) {
            e.preventDefault();
            triggerExitAnimation();
            
            // Navigate after the animation duration (matched with CSS: 0.3s)
            setTimeout(() => {
                window.location.href = link.href;
            }, 300);
        }
    }
});

/**
 * Fallback for other ways of leaving the page (refresh, browser buttons).
 * While we can't delay these, adding the class immediately can sometimes
 * show the start of the animation before the page unloads.
 */
window.addEventListener('beforeunload', () => {
    triggerExitAnimation();
});

// --- Boot ---
initTree();
updateTargets();

// Snap initial positions to targets so they don't slide in from (0,0) on first load
windowStates.forEach(s => s.node.window.current = { ...s.node.window.target });

// Kick off the animation frame loop
animate();

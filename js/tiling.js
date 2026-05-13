/**
 * Tiling Manager for "Dwindle" Layout with Lerping
 * 
 * This script handles the dynamic positioning of windows in a binary tree (dwindle) layout.
 * It supports drag-and-drop swapping and uses linear interpolation (lerping) for smooth animations.
 */

const workspace = document.getElementById('workspace');
const windows = Array.from(document.querySelectorAll('.generic-window-window'));

// Configuration constants
const LERP_FACTOR = 0.25; 
const DRAG_LERP_FACTOR = 0.6; 
const GAPS = 10; 

// State management
let windowStates = windows.map((el, index) => ({
    el,
    id: el.id,
    order: index,
    current: { x: 0, y: 0, w: 0, h: 0 },
    target: { x: 0, y: 0, w: 0, h: 0 },
    isDragging: false
}));

let draggedWindow = null;
let mouseOffset = { x: 0, y: 0 };
let currentMouse = { x: 0, y: 0 };

/**
 * Binary tree dwindle algorithm
 * Recursively splits the available space for each window in the list.
 */
function calculateDwindle(rect, count, startIdx = 0, sortedStates) {
    if (count === 0) return;
    
    const state = sortedStates[startIdx];
    
    if (count === 1) {
        state.target = { ...rect };
        return;
    }

    const splitHorizontal = rect.w > rect.h;
    
    if (splitHorizontal) {
        const halfW = (rect.w - GAPS) / 2;
        state.target = { x: rect.x, y: rect.y, w: halfW, h: rect.h };
        calculateDwindle(
            { x: rect.x + halfW + GAPS, y: rect.y, w: halfW, h: rect.h },
            count - 1,
            startIdx + 1,
            sortedStates
        );
    } else {
        const halfH = (rect.h - GAPS) / 2;
        state.target = { x: rect.x, y: rect.y, w: rect.w, h: halfH };
        calculateDwindle(
            { x: rect.x, y: rect.y + halfH + GAPS, w: rect.w, h: halfH },
            count - 1,
            startIdx + 1,
            sortedStates
        );
    }
}

/**
 * Updates the target positions based on the current window order.
 */
function updateTargets() {
    const workspaceRect = workspace.getBoundingClientRect();
    const availableRect = {
        x: GAPS,
        y: GAPS,
        w: workspaceRect.width - (GAPS * 2),
        h: workspaceRect.height - (GAPS * 2)
    };
    
    const sortedStates = [...windowStates].sort((a, b) => a.order - b.order);
    calculateDwindle(availableRect, windowStates.length, 0, sortedStates);
}

/**
 * Main animation loop
 * Lerps current positions towards target positions.
 */
function animate() {
    windowStates.forEach(state => {
        if (state.isDragging) {
            state.current.x += (currentMouse.x - mouseOffset.x - state.current.x) * DRAG_LERP_FACTOR;
            state.current.y += (currentMouse.y - mouseOffset.y - state.current.y) * DRAG_LERP_FACTOR;
        } else {
            state.current.x += (state.target.x - state.current.x) * LERP_FACTOR;
            state.current.y += (state.target.y - state.current.y) * LERP_FACTOR;
            state.current.w += (state.target.w - state.current.w) * LERP_FACTOR;
            state.current.h += (state.target.h - state.current.h) * LERP_FACTOR;
        }

        state.el.style.left = `${state.current.x}px`;
        state.el.style.top = `${state.current.y}px`;
        state.el.style.width = `${state.current.w}px`;
        state.el.style.height = `${state.current.h}px`;
    });

    requestAnimationFrame(animate);
}

// Event Listeners for Dragging
windows.forEach(el => {
    el.addEventListener('mousedown', (e) => {
        const state = windowStates.find(s => s.el === el);
        draggedWindow = state;
        state.isDragging = true;
        el.classList.add('dragging');

        const rect = el.getBoundingClientRect();
        const wsRect = workspace.getBoundingClientRect();
        
        mouseOffset.x = e.clientX - rect.left;
        mouseOffset.y = e.clientY - rect.top;
        
        currentMouse.x = e.clientX - wsRect.left;
        currentMouse.y = e.clientY - wsRect.top;
    });
});

window.addEventListener('mousemove', (e) => {
    if (!draggedWindow) return;

    const wsRect = workspace.getBoundingClientRect();
    currentMouse.x = e.clientX - wsRect.left;
    currentMouse.y = e.clientY - wsRect.top;

    // Detect if mouse is over a DIFFERENT window's target area
    for (const state of windowStates) {
        if (state === draggedWindow) continue;

        const target = state.target;
        
        // Use TARGET bounds for stable hit detection
        if (currentMouse.x > target.x && currentMouse.x < target.x + target.w &&
            currentMouse.y > target.y && currentMouse.y < target.y + target.h) {
            
            // Swap orders
            const oldOrder = draggedWindow.order;
            draggedWindow.order = state.order;
            state.order = oldOrder;
            
            updateTargets();
            break; 
        }
    }
});

window.addEventListener('mouseup', () => {
    if (draggedWindow) {
        draggedWindow.el.classList.remove('dragging');
        draggedWindow.isDragging = false;
        draggedWindow = null;
        updateTargets();
    }
});

// Initial setup
window.addEventListener('resize', updateTargets);
updateTargets();

windowStates.forEach(state => {
    state.current = { ...state.target };
});

animate();

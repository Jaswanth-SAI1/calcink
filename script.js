import { evaluateExpression } from "./expressionParser.js";

import {
    preprocessStrokes,
    isStrokeMeaningful,
} from "ink-on/core";

const canvas = document.getElementById("canvas");
const output = document.getElementById("output");
const recognizeButton = document.getElementById("recognizeButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const eraserButton = document.getElementById("eraserButton");
const clearButton = document.getElementById("clearButton");
const pixelEraserButton =
    document.getElementById("pixelEraserButton");

const strokeWidthSlider =
    document.getElementById("strokeWidthSlider");

strokeWidthSlider.addEventListener("input", () => {
    currentStrokeWidth = Number(strokeWidthSlider.value);
});

const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});

const recognitionWorker = new Worker(
    new URL("./recognitionWorker.js", import.meta.url),
    { type: "module" }
);


let nextRequestId = 0;
let modelReady = false;
let recognitionPending = false;

// Stores the answers to render beside the handwritten expressions.
let inlineResults = [];
let currentStrokeWidth = 3;
let expressionSubmitted = false;
let autoRecognitionTimer = null;

let currentStroke = [];
let isPointerDown = false;
const strokes = [];
const undoStack = [];
const redoStack = [];

let isErasing = false;
let isPixelErasing = false;
let pixelEraseBefore = null;
let pixelEraseChanged = false;

canvas.addEventListener("pointerdown", startStroke);
canvas.addEventListener("pointermove", continueStroke);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", cancelStroke);



undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
const drawButton = document.getElementById("drawButton");

drawButton.addEventListener("click", () => setMode('draw'));
eraserButton.addEventListener("click", () => setMode('erase-stroke'));
pixelEraserButton.addEventListener("click", () => setMode('erase-pixel'));
clearButton.addEventListener("click", clearCanvas);
recognizeButton.addEventListener("click", requestRecognition);

let currentMode = 'draw';

function setMode(mode) {
    currentMode = mode;
    isErasing = (mode === 'erase-stroke');
    isPixelErasing = (mode === 'erase-pixel');

    drawButton.classList.toggle("active", mode === 'draw');
    drawButton.setAttribute("aria-pressed", mode === 'draw');

    eraserButton.classList.toggle("active", mode === 'erase-stroke');
    eraserButton.setAttribute("aria-pressed", mode === 'erase-stroke');

    pixelEraserButton.classList.toggle("active", mode === 'erase-pixel');
    pixelEraserButton.setAttribute("aria-pressed", mode === 'erase-pixel');

    if (mode === 'draw') {
        canvas.classList.remove("eraser-mode");
    } else {
        canvas.classList.add("eraser-mode");
    }

    strokeWidthSlider.disabled = (mode === 'erase-stroke');
}


function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
}

function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (dx === 0 && dy === 0) {
        return Math.hypot(
            point.x - start.x,
            point.y - start.y
        );
    }

    const t =
        ((point.x - start.x) * dx +
         (point.y - start.y) * dy) /
        (dx * dx + dy * dy);

    const clampedT = Math.max(0, Math.min(1, t));

    const closestX = start.x + clampedT * dx;
    const closestY = start.y + clampedT * dy;

    return Math.hypot(
        point.x - closestX,
        point.y - closestY
    );
}

function isPointNearSegment(point, start, end, radius) {
    return distanceToSegment(point, start, end) <= radius;
}


function erasePixelsAtPoint(point) {
    // Make pixel eraser proportionally much larger so it's obvious to the user
    const eraserRadius = Math.max(10, currentStrokeWidth * 3);
    const updatedStrokes = [];
    let changed = false;

    for (const stroke of strokes) {
        let currentFragment = [];
        let strokeChanged = false;

        if (stroke.length === 1) {
            const distance = Math.hypot(point.x - stroke[0].x, point.y - stroke[0].y);
            if (distance <= eraserRadius) {
                changed = true;
            } else {
                updatedStrokes.push(stroke);
            }
            continue;
        }

        for (let i = 0; i < stroke.length - 1; i++) {
            const start = stroke[i];
            const end = stroke[i + 1];

            const segmentErased = isPointNearSegment(
                point,
                start,
                end,
                eraserRadius
            );

            if (segmentErased) {
                strokeChanged = true;

                if (currentFragment.length >= 2) {
                    currentFragment.lineWidth = stroke.lineWidth ?? 3;
                    updatedStrokes.push(currentFragment);
                }

                currentFragment = [];
            } else {
                if (currentFragment.length === 0) {
                    currentFragment.push(start);
                }

                currentFragment.push(end);
            }
        }

        if (strokeChanged) {
            changed = true;
            if (currentFragment.length >= 2) {
                currentFragment.lineWidth = stroke.lineWidth ?? 3;
                updatedStrokes.push(currentFragment);
            }
        } else {
            updatedStrokes.push(stroke);
        }
    }

    if (changed) {
        strokes.length = 0;
        strokes.push(...updatedStrokes);
        redraw();
    }

    return changed;
}

function eraseStrokeAtPoint(point) {
    const strokeIndex = findStrokeAtPoint(point);

    if (strokeIndex === -1) {
        return;
    }
    invalidateRecognition();
    const stroke=strokes.splice(strokeIndex, 1)[0];

    undoStack.push({
    type: "erase",
    stroke,
    index: strokeIndex
    });
    redoStack.length = 0;
    redraw();
    output.textContent =
        `Total strokes: ${strokes.length}`;

    updateUndoRedoButtons();
    scheduleAutoRecognition();

    if (expressionSubmitted) {
        clearTimeout(autoRecognitionTimer);

        const activeEq = getActiveEquation(strokes);
        if (activeEq) {
            scheduleAutoRecognition();
        } else {
            expressionSubmitted = false;
        }
    }
}

function findStrokeAtPoint(point) {
    const eraserRadius = 6;

    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
            if (stroke.length === 1) {
                const distance = Math.hypot(
                point.x - stroke[0].x,
                point.y - stroke[0].y
            );

            if (distance <= eraserRadius) {
                return i;
            }

            continue;
        }

        for (let j = 1; j < stroke.length; j++) {
            const start = stroke[j - 1];
            const end = stroke[j];

            const distance = distanceToSegment(
                point,
                start,
                end
            );

            if (distance <= eraserRadius) {
                return i;
            }
        }
    }

    return -1;
}

function startStroke(event) {
    console.log("startStroke fired");
    const point = getCanvasPoint(event);

    isPointerDown = true;
    currentStrokeWidth = Number(strokeWidthSlider.value);

    if (isErasing) {
        eraseStrokeAtPoint(point);
        return;
    }

    if (isPixelErasing) {
        pixelEraseBefore = strokes.slice();

        pixelEraseChanged = false;

        pixelEraseChanged =
            erasePixelsAtPoint(point) || pixelEraseChanged;

        canvas.setPointerCapture(event.pointerId);
        return;
    }

    currentStroke = [];

    ctx.lineWidth = currentStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    canvas.setPointerCapture(event.pointerId);
    currentStroke.push(point);
}
function continueStroke(event) {
    const point = getCanvasPoint(event);

    if (isPixelErasing) {
        if (!isPointerDown) return;

        pixelEraseChanged =
        erasePixelsAtPoint(point) || pixelEraseChanged;
        return;
    }

    if (currentStroke.length === 0) return;

        currentStroke.push(point);
    drawCurrentStroke();
}

function endStroke(event) {
    isPointerDown = false;
    if (isPixelErasing) {
        if (pixelEraseBefore !== null && pixelEraseChanged) {
            undoStack.push({
                type: "pixelErase",
                before: pixelEraseBefore,
                after: strokes.slice()
            });

            redoStack.length = 0;

            const activeEq = getActiveEquation(strokes);
            if (activeEq) {
                expressionSubmitted = true;
                scheduleAutoRecognition();
            } else {
                expressionSubmitted = false;
            }
        }

        pixelEraseBefore = null;
        pixelEraseChanged = false;

        if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }

        updateUndoRedoButtons();
        return;
    }

    if (currentStroke.length === 0) return;
    invalidateRecognition();
    currentStroke.push(getCanvasPoint(event));

    currentStroke.lineWidth = currentStrokeWidth;
    strokes.push(currentStroke);

    undoStack.push({
        type: "add",
        stroke: currentStroke
    });

    redoStack.length = 0;

    currentStroke = [];

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }

    updateUndoRedoButtons();

    const activeEq = getActiveEquation(strokes);
    if (activeEq) {
        const lastStroke = strokes[strokes.length - 1];
        const lastBounds = getStrokeBounds(lastStroke);
        const dist = lastBounds ? Math.abs(lastBounds.centerY - activeEq.equalsPosition.y) : -1;
        const thresh = Math.max(50, activeEq.gap * 4);
        if (lastBounds && dist <= thresh) {
            expressionSubmitted = true;
        } else {
            expressionSubmitted = false;
        }
    } else {
        expressionSubmitted = false;
    }

    if (expressionSubmitted) {
    scheduleAutoRecognition();
    } else {
        output.textContent = `Total strokes: ${strokes.length}`;
    }
}




function getStrokeBounds(stroke) {
    if (stroke.length === 0) return null;
    let minX = stroke[0].x, maxX = stroke[0].x, minY = stroke[0].y, maxY = stroke[0].y;
    for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY, centerY: (minY + maxY) / 2 };
}

function getAllEqualsSigns(strokes) {
    const horizontalLines = [];
    for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];
        if (stroke.length < 2) continue;
        const bounds = getStrokeBounds(stroke);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        if (width >= 10 && height <= Math.max(10, width * 0.5)) {
            horizontalLines.push({ ...bounds, index: i, width, height });
        }
    }

    const equalsPairs = [];
    for (let i = 0; i < horizontalLines.length; i++) {
        for (let j = i + 1; j < horizontalLines.length; j++) {
            const a = horizontalLines[i];
            const b = horizontalLines[j];
            const verticalGap = Math.abs(a.centerY - b.centerY);
            const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
            
            if (verticalGap >= 3 && verticalGap <= 80 && overlap >= Math.min(a.width, b.width) * 0.4) {
                equalsPairs.push({
                    rightEdge: Math.max(a.maxX, b.maxX),
                    centerY: (a.centerY + b.centerY) / 2,
                    gap: verticalGap,
                    indices: [a.index, b.index]
                });
            }
        }
    }

    return equalsPairs;
}

function getActiveEqualsSign(strokes) {
    const equalsPairs = getAllEqualsSigns(strokes);

    if (equalsPairs.length === 0) return null;

    const lastStroke = strokes[strokes.length - 1];
    if (lastStroke) {
        const lastBounds = getStrokeBounds(lastStroke);
        if (lastBounds) {
            equalsPairs.sort((a, b) => {
                const distA = Math.abs(a.centerY - lastBounds.centerY);
                const distB = Math.abs(b.centerY - lastBounds.centerY);
                return distA - distB;
            });
        }
    }
    return equalsPairs[0];
}

function getActiveEquation(strokes) {
    const eq = getActiveEqualsSign(strokes);
    if (!eq) return null;
    
    const verticalTolerance = Math.max(30, eq.gap * 2.5);
    
    const equationStrokes = [];
    for (const stroke of strokes) {
        const bounds = getStrokeBounds(stroke);
        if (!bounds) continue;
        
        const strokeTop = bounds.minY;
        const strokeBottom = bounds.maxY;
        const eqTop = eq.centerY - verticalTolerance;
        const eqBottom = eq.centerY + verticalTolerance;
        
        if (strokeBottom >= eqTop && strokeTop <= eqBottom) {
            equationStrokes.push(stroke);
        }
    }
    
    return {
        strokes: equationStrokes,
        gap: eq.gap,
        equalsPosition: { x: eq.rightEdge + 14, y: eq.centerY }
    };
}

function drawCurrentStroke() {
    if (currentStroke.length < 2) return;

    const previousPoint = currentStroke[currentStroke.length - 2];
    const currentPoint = currentStroke[currentStroke.length - 1];

    ctx.save();
    ctx.lineWidth = currentStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(previousPoint.x, previousPoint.y);
    ctx.lineTo(currentPoint.x, currentPoint.y);
    ctx.stroke();

    ctx.restore();
}

function drawStroke(stroke) {
    if (stroke.length < 2) return;

    ctx.save();
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = stroke.lineWidth ?? 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);

    for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
    }

    ctx.stroke();
    ctx.restore();
}



function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
        drawStroke(stroke);
    }

    const allEqs = getAllEqualsSigns(strokes);
    const validResults = [];

    for (const res of inlineResults) {
        // Check if there is still an equals sign near this result's position
        const matchesEq = allEqs.some(eq => {
            const eqX = eq.rightEdge + 14;
            const eqY = eq.centerY;
            return Math.abs(res.x - eqX) < 40 && Math.abs(res.y - eqY) < 40;
        });

        if (matchesEq) {
            validResults.push(res);
            ctx.save();
            ctx.fillStyle = "#333333";
            ctx.font = "400 36px sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText(String(res.value), res.x, res.y);
            ctx.restore();
        }
    }
    inlineResults = validResults;
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    redraw();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
function invalidateRecognition() {
    nextRequestId++;
    recognitionPending = false;
    recognizeButton.disabled = false;
}
function clearCanvas() {
    invalidateRecognition();
    expressionSubmitted = false;
    clearTimeout(autoRecognitionTimer);
    strokes.length = 0;
    currentStroke = [];
    undoStack.length = 0;
    redoStack.length = 0;

    inlineResults = [];

    isPointerDown = false;
    pixelEraseBefore = null;
    pixelEraseChanged = false;

    redraw();

    output.textContent = "";
    updateUndoRedoButtons();
}

function undo() {
    invalidateRecognition();
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    if (action.type === "add") {
        const index = strokes.lastIndexOf(action.stroke);

        if (index !== -1) {
            strokes.splice(index, 1);
        }
    }

    if (action.type === "erase") {
        strokes.splice(action.index, 0, action.stroke);
    }

    if (action.type === "pixelErase") {
    strokes.length = 0;
    strokes.push(...action.before);
    }


    redoStack.push(action);

    redraw();

    output.textContent = `Total strokes: ${strokes.length}`;
    updateUndoRedoButtons();
}

function redo() {
    invalidateRecognition();
    if (redoStack.length === 0) return;

    const action = redoStack.pop();

    if (action.type === "add") {
        strokes.push(action.stroke);
    }

    if (action.type === "erase") {
        strokes.splice(action.index, 1);
    }
    if (action.type === "pixelErase") {
        strokes.length = 0;
        strokes.push(...action.after);
    }


    undoStack.push(action);
    redraw();
    output.textContent = `Total strokes: ${strokes.length}`;
    updateUndoRedoButtons();
}

canvas.addEventListener("pointercancel", cancelStroke);

function cancelStroke(event) {
    currentStroke = [];

    isPointerDown = false;
    pixelEraseBefore = null;
    pixelEraseChanged = false;

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

function updateUndoRedoButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
}

updateUndoRedoButtons();


async function requestRecognition() {
    if (currentStroke.length > 0) return;

    if (!modelReady) {
        output.textContent = "Please wait for the model to load.";
        return;
    }

    if (recognitionPending) {
        output.textContent = "Recognition is already in progress.";
        return;
    }

    if (strokes.length === 0) {
        output.textContent = "Please draw an expression first.";
        return;
    }

    const activeEq = getActiveEquation(strokes);
    if (!activeEq) {
        output.textContent = "Please draw a valid equals sign (=).";
        return;
    }

    const inkOnStrokes = activeEq.strokes.map((stroke) => ({
        points: stroke,
        lineWidth: stroke.lineWidth ?? 3,
    }));

    if (!isStrokeMeaningful(inkOnStrokes)) {
        output.textContent = "Please draw a larger expression.";
        return;
    }

    try {
        const requestId = ++nextRequestId;
        recognitionPending = true;
        recognizeButton.disabled = true;
        output.textContent = "Recognizing expression...";

        // Yield to allow the browser to paint the stroke before the heavy preprocess operation
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        const input = preprocessStrokes(inkOnStrokes);

        recognitionWorker.postMessage({
            type: "RECOGNIZE",
            requestId,
            input,
        });
    } catch (error) {
        console.error("Preprocessing failed:", error);

        recognitionPending = false;
        recognizeButton.disabled = false;
        output.textContent = `Preprocessing error: ${error.message}`;
    }
}


recognitionWorker.onmessage = (event) => {
    const result = event.data;

    if (result.type === "MODEL_LOADING") {
        output.textContent = "Loading handwriting model...";
        return;
    }

    if (result.type === "MODEL_READY") {
        modelReady = true;
        output.textContent =
            "Model ready. Draw an expression and click Recognize.";
        return;
    }

    if (result.type === "MODEL_INIT_ERROR") {
        modelReady = false;
        output.textContent = `Model loading failed: ${result.error}`;
        console.error("Model initialization failed:", result.error);
        return;
    }

    if (result.type === "WORKER_ERROR") {
        if (result.requestId === nextRequestId) {
            recognitionPending = false;
            recognizeButton.disabled = false;
            output.textContent = `Recognition error: ${result.error}`;
        }

        console.error("Worker error:", result.error);
        return;
    }

    if (result.type === "RECOGNITION_RESULT") {
        if (result.requestId !== nextRequestId) return;

        recognitionPending = false;
        recognizeButton.disabled = false;

        const inferenceMs = Number(result.totalMs).toFixed(1);

        try {
            const expression = result.expression.trim().replace(/=+$/, "").trim();
            const evaluation = evaluateExpression(expression);
            
            const activeEq = getActiveEquation(strokes);
            if (activeEq) {
                const eqPos = activeEq.equalsPosition;
                // Remove old result for this equation
                inlineResults = inlineResults.filter(r => 
                    !(Math.abs(r.x - eqPos.x) < 40 && Math.abs(r.y - eqPos.y) < 40)
                );
                
                // Add new result
                inlineResults.push({
                    x: eqPos.x,
                    y: eqPos.y,
                    value: evaluation.result
                });
            }
            
            redraw();
            output.textContent =
                `Recognized: ${evaluation.normalized} = ${evaluation.result} | ` +
                `Inference: ${inferenceMs} ms`;
        } catch (error) {
            const activeEq = getActiveEquation(strokes);
            if (activeEq) {
                const eqPos = activeEq.equalsPosition;
                inlineResults = inlineResults.filter(r => 
                    !(Math.abs(r.x - eqPos.x) < 40 && Math.abs(r.y - eqPos.y) < 40)
                );
            }
            redraw();
            output.textContent =
                `Recognized: ${result.expression} | ` +
                `Could not calculate: ${error.message} | ` +
                `Inference: ${inferenceMs} ms`;
        }
    }
};

recognitionWorker.onerror = (event) => {
    console.error("Worker error:", event.message);

    modelReady = false;
    recognitionPending = false;
    recognizeButton.disabled = false;
    output.textContent = "Worker failed. Check the browser console.";
};

recognitionWorker.onmessageerror = (event) => {
    console.error("Worker message error:", event);

    recognitionPending = false;
    recognizeButton.disabled = false;
    output.textContent = "Could not read the Worker response.";
};

output.textContent = "Loading handwriting model...";
recognitionWorker.postMessage({ type: "INIT" });

function scheduleAutoRecognition() {
    if (!expressionSubmitted) return;

    clearTimeout(autoRecognitionTimer);

    autoRecognitionTimer = setTimeout(() => {
        requestRecognition();
    }, 600);
}
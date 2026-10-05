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

const strokeWidthValue =
    document.getElementById("strokeWidthValue");

strokeWidthSlider.addEventListener("input", () => {
    strokeWidthValue.textContent = `${strokeWidthSlider.value} px`;
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

// Stores the answer to render beside the handwritten expression.
let inlineResult = null;
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
eraserButton.addEventListener("click", toggleEraser);
clearButton.addEventListener("click",clearCanvas);
pixelEraserButton.addEventListener(
    "click",
    togglePixelEraser
);

function toggleEraser() {
    isErasing = !isErasing;

    if (isErasing) {
        isPixelErasing = false;

        eraserButton.textContent = "Drawing";
        pixelEraserButton.textContent = "Pixel Eraser";
    } else {
        eraserButton.textContent = "Eraser";
    }
}
recognizeButton.addEventListener("click", requestRecognition);

function togglePixelEraser() {
    isPixelErasing = !isPixelErasing;

    if (isPixelErasing) {
        isErasing = false;
        pixelEraserButton.textContent = "Drawing";
        eraserButton.textContent = "Eraser";
    } else {
        pixelEraserButton.textContent = "Pixel Eraser";
    }
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
    const eraserRadius = 6;
    const updatedStrokes = [];
    let changed = false;

    for (const stroke of strokes) {
        let currentFragment = [];

        for (let i = 0; i < stroke.length - 1; i++) {
            const start = stroke[i];
            const end = stroke[i + 1];

            const segmentErased =
                isPointNearSegment(
                    point,
                    start,
                    end,
                    eraserRadius
                );

            if (segmentErased) {
                changed = true;

                if (currentFragment.length >= 2) {
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

        if (currentFragment.length >= 2) {
            updatedStrokes.push(currentFragment);
        }
    }

    strokes.length = 0;
    strokes.push(...updatedStrokes);

    redraw();

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

        if (looksLikeEqualsAtEnd()) {
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
    const point = getCanvasPoint(event);

    isPointerDown = true;
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

    inlineResult = null;
    currentStroke = [];
    currentStrokeWidth = Number(strokeWidthSlider.value);

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

    if (looksLikeEqualsAtEnd()) {
        expressionSubmitted = true;
    }

    if (expressionSubmitted) {
    scheduleAutoRecognition();
    } else {
        output.textContent = `Total strokes: ${strokes.length}`;
    }
}


function looksLikeEqualsAtEnd() {
    if (strokes.length < 2) return false;

    const lastTwo = strokes.slice(-2);

    function getHorizontalLine(stroke) {
        if (stroke.length < 2) return null;

        const xs = stroke.map((point) => point.x);
        const ys = stroke.map((point) => point.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const width = maxX - minX;
        const height = maxY - minY;

        if (width < 12 || height > Math.max(8, width * 0.25)) {
            return null;
        }

        return {
            minX,
            maxX,
            centerY: (minY + maxY) / 2,
            width,
        };
    }

    const first = getHorizontalLine(lastTwo[0]);
    const second = getHorizontalLine(lastTwo[1]);

    if (!first || !second) return false;

    const verticalGap = Math.abs(first.centerY - second.centerY);
    const overlap = Math.min(first.maxX, second.maxX)
        - Math.max(first.minX, second.minX);

    return (
        verticalGap >= 3 &&
        verticalGap <= 40 &&
        overlap >= Math.min(first.width, second.width) * 0.5
    );
}


function cancelStroke(event) {
    currentStroke = [];

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
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

function findEqualsPosition() {
    const horizontalLines = [];

    for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];
        if (stroke.length < 2) continue;

        const xs = stroke.map((p) => p.x);
        const ys = stroke.map((p) => p.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const width = maxX - minX;
        const height = maxY - minY;

        if (width >= 12 && height <= Math.max(8, width * 0.25)) {
            horizontalLines.push({
                minX,
                maxX,
                centerY: (minY + maxY) / 2,
                width,
            });
        }
    }

    let bestPair = null;

    for (let i = 0; i < horizontalLines.length; i++) {
        for (let j = i + 1; j < horizontalLines.length; j++) {
            const a = horizontalLines[i];
            const b = horizontalLines[j];

            const verticalGap = Math.abs(a.centerY - b.centerY);
            const overlap =
                Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);

            if (
                verticalGap < 3 ||
                verticalGap > 40 ||
                overlap < Math.min(a.width, b.width) * 0.5
            ) {
                continue;
            }

            const rightEdge = Math.max(a.maxX, b.maxX);

            if (!bestPair || rightEdge > bestPair.rightEdge) {
                bestPair = {
                    rightEdge,
                    centerY: (a.centerY + b.centerY) / 2,
                };
            }
        }
    }

    if (!bestPair) return null;

    return {
        x: bestPair.rightEdge + 14,
        y: bestPair.centerY,
    };
}

function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
        drawStroke(stroke);
    }

    if (inlineResult !== null) {
        const position = findEqualsPosition();

        if (position) {
            ctx.save();
            ctx.fillStyle = "#333333";
            ctx.font = "400 36px sans-serif";
            ctx.textBaseline = "middle";

            ctx.fillText(
                String(inlineResult),
                position.x,
                position.y
            );

            ctx.restore();
        }
    }
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

    inlineResult = null;

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

function requestRecognition() {
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

    const inkOnStrokes = strokes.map((stroke) => ({
        points: stroke,
        lineWidth: stroke.lineWidth ?? 3,
    }));

    if (!isStrokeMeaningful(inkOnStrokes)) {
        output.textContent = "Please draw a larger expression.";
        return;
    }

    try {
        const input = preprocessStrokes(inkOnStrokes);
        const requestId = ++nextRequestId;

        recognitionPending = true;
        recognizeButton.disabled = true;
        output.textContent = "Recognizing expression...";

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
            inlineResult = evaluation.result;
            redraw();
            output.textContent =
                `Recognized: ${evaluation.normalized} = ${evaluation.result} | ` +
                `Inference: ${inferenceMs} ms`;
        } catch (error) {
            inlineResult = null;
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
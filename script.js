import { evaluateExpression } from "./expressionParser.js";

import {
    preprocessStrokes,
    isStrokeMeaningful,
} from "ink-on/core";

const canvas = document.getElementById("canvas");
const output = document.getElementById("output");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const eraserButton = document.getElementById("eraserButton");
const clearButton = document.getElementById("clearButton");
const recognizeButton = document.getElementById("recognizeButton");

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

let expressionSubmitted = false;
let autoRecognitionTimer = null;

let currentStroke = [];
const strokes = [];
const undoStack = [];
const redoStack = [];

let isErasing = false;

canvas.addEventListener("pointerdown", startStroke);
canvas.addEventListener("pointermove", continueStroke);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", cancelStroke);

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
eraserButton.addEventListener("click", toggleEraser);
clearButton.addEventListener("click",clearCanvas);

function toggleEraser() {
    isErasing = !isErasing;

    if (isErasing) {
        eraserButton.textContent = "Drawing";
    } else {
        eraserButton.textContent = "Eraser";
    }
}
recognizeButton.addEventListener("click", requestRecognition);

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
    const eraserRadius = 12;

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

    if (isErasing) {
        eraseStrokeAtPoint(point);
        return;
    }
    inlineResult = null;
    redraw();
    currentStroke = [];
    canvas.setPointerCapture(event.pointerId);
    currentStroke.push(point);
}

function continueStroke(event) {
    if (currentStroke.length === 0) return;

    currentStroke.push(getCanvasPoint(event));
    drawCurrentStroke();
}

function endStroke(event) {
    if (currentStroke.length === 0) return;
    invalidateRecognition();
    currentStroke.push(getCanvasPoint(event));

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

    ctx.beginPath();
    ctx.moveTo(previousPoint.x, previousPoint.y);
    ctx.lineTo(currentPoint.x, currentPoint.y);
    ctx.stroke();
}

function drawStroke(stroke) {
    if (stroke.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);

    for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
    }

    ctx.stroke();
}


function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
        drawStroke(stroke);
    }

    // Redraw the answer after the handwriting.
    if (inlineResult !== null) {
    ctx.save();
    ctx.fillStyle = "#4f46e5";
    ctx.font = "600 24px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(`= ${inlineResult}`, 24, 60);
    ctx.restore();
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
    undoStack.push(action);
    redraw();
    output.textContent = `Total strokes: ${strokes.length}`;
    updateUndoRedoButtons();
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
        lineWidth: 3,
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
import {
    preprocessStrokes,
    isStrokeMeaningful
} from "ink-on/core";

const canvas = document.getElementById("canvas");
const output = document.getElementById("output");

const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");

const ctx = canvas.getContext("2d");


const recognitionWorker = new Worker(
    "./recognitionWorker.js",
    { type: "module" }
);

let nextRequestId = 0;


let currentStroke = [];
const strokes = [];
const redoStack = [];

canvas.addEventListener("pointerdown", startStroke);
canvas.addEventListener("pointermove", continueStroke);
canvas.addEventListener("pointerup", endStroke);

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function startStroke(event) {
    currentStroke = [];

    canvas.setPointerCapture(event.pointerId);

    const point = getCanvasPoint(event);
    currentStroke.push(point);
}

function continueStroke(event) {
    if (currentStroke.length === 0) return;

    const point = getCanvasPoint(event);
    currentStroke.push(point);

    drawCurrentStroke();
}

function endStroke(event) {
    if (currentStroke.length === 0) return;

    const point = getCanvasPoint(event);
    currentStroke.push(point);

    strokes.push(currentStroke);

    redoStack.length = 0;

    console.log("Completed stroke:", currentStroke);
    console.log("All strokes:", strokes);

    output.textContent =
        `Total strokes: ${strokes.length}`;

    currentStroke = [];

    canvas.releasePointerCapture(event.pointerId);

    updateUndoRedoButtons();
}

function drawCurrentStroke() {
    if (currentStroke.length < 2) return;

    const previousPoint =
        currentStroke[currentStroke.length - 2];

    const currentPoint =
        currentStroke[currentStroke.length - 1];

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


function undo() {
    if (strokes.length === 0) return;

    const stroke = strokes.pop();

    redoStack.push(stroke);

    redraw();

    output.textContent =
        `Total strokes: ${strokes.length}`;

    updateUndoRedoButtons();
}

function redo() {
    if (redoStack.length === 0) return;

    const stroke = redoStack.pop();

    strokes.push(stroke);

    redraw();

    output.textContent =
        `Total strokes: ${strokes.length}`;

    updateUndoRedoButtons();
}

canvas.addEventListener("pointercancel", cancelStroke);

function cancelStroke(event) {
    currentStroke = [];

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

function updateUndoRedoButtons() {
    undoButton.disabled = strokes.length === 0;
    redoButton.disabled = redoStack.length === 0;
}
updateUndoRedoButtons();

function requestRecognition() {
    const requestId = ++nextRequestId;

    // Convert CalcInk's stroke format to ink-on's expected format.
    const inkOnStrokes = strokes.map(stroke => ({
        points: stroke,
        lineWidth: 3
    }));

    if (!isStrokeMeaningful(inkOnStrokes)) {
        output.textContent = "Please draw a larger expression.";
        return;
    }

    // Convert strokes into model-ready image data.
    const input = preprocessStrokes(inkOnStrokes);

    console.log("ink-on preprocessing:", {
        width: input.width,
        height: input.height,
        tensorLength: input.tensor.length,
        maskWidth: input.maskWidth,
        maskHeight: input.maskHeight,
        maskLength: input.mask.length
    });

    recognitionWorker.postMessage({
        type: "PREPROCESSED_INPUT",
        requestId,
        input
    });
}

recognitionWorker.onmessage = (event) => {
    const result = event.data;

    if (result.requestId !== nextRequestId) {
        return;
    }

    if (result.error) {
        console.error("Preprocessing failed:", result.error);
        output.textContent = `Error: ${result.error}`;
        return;
    }

    if (result.type === "PREPROCESSING_COMPLETE") {
        console.log("Preprocessing succeeded:", result);
        output.textContent =
    `Preprocessing complete. Image: ${result.width} × ${result.height}`;
    
        return;
    }

    if (result.type === "RECOGNITION_RESULT") {
        console.log("Recognition result:", result);
        output.textContent = `Recognized: ${result.expression}`;
    }
};

const recognizeButton =
    document.getElementById("recognizeButton");

recognizeButton.addEventListener("click", requestRecognition);

recognitionWorker.onerror = (event) => {
    console.error("Worker error:", event.message);
};

recognitionWorker.onmessageerror = (event) => {
    console.error("Worker message error:", event);
};



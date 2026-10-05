import {
    preprocessStrokes,
    isStrokeMeaningful
} from "ink-on/core";

const canvas = document.getElementById("canvas");
const output = document.getElementById("output");

const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const eraserButton = document.getElementById("eraserButton");
const clearButton = document.getElementById("clearButton");
const pixelEraserButton=document.getElementById("pixelEraserButton");

const ctx = canvas.getContext("2d");


const recognitionWorker = new Worker(
    "./recognitionWorker.js",
    { type: "module" }
);

let nextRequestId = 0;


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
        y: event.clientY - rect.top
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

    const stroke=strokes.splice(strokeIndex, 1)[0];

    undoStack.push({
    type: "erase",
    stroke,
    index: strokeIndex
    });

    console.log("ERASE ACTION:", undoStack);

    redoStack.length = 0;

    redraw();

    output.textContent =
        `Total strokes: ${strokes.length}`;

    updateUndoRedoButtons();
}

function findStrokeAtPoint(point) {
    const eraserRadius = 6;

    for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];

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


    currentStroke = [];

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

    const point = getCanvasPoint(event);
    currentStroke.push(point);

    strokes.push(currentStroke);

    undoStack.push({
    type: "add",
    stroke: currentStroke
    });

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

function clearCanvas() {
    strokes.length = 0;
    undoStack.length = 0;
    redoStack.length = 0;

    currentStroke = [];

    isPointerDown = false;
    pixelEraseBefore = null;
    pixelEraseChanged = false;

    redraw();

    output.textContent = "";

    updateUndoRedoButtons();
}



function undo() {
    if (undoStack.length === 0) return;

    const action = undoStack.pop();

    console.log("UNDO ACTION:", action);

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

    output.textContent =
        `Total strokes: ${strokes.length}`;

    updateUndoRedoButtons();
}

function redo() {
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

    output.textContent =
        `Total strokes: ${strokes.length}`;

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



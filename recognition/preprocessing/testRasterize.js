import {
    rasterizeStrokes,
    imageDataToGrayscale,
    createImageTensor
} from "./rasterize.js";

const strokes = [
    [
        { x: 20, y: 20 },
        { x: 40, y: 40 },
        { x: 60, y: 20 }
    ]
];

const result = rasterizeStrokes(
    strokes,
    100,
    100
);

const bitmap = result.canvas.transferToImageBitmap();

const displayCanvas = document.createElement("canvas");

displayCanvas.width = 100;
displayCanvas.height = 100;

const displayContext = displayCanvas.getContext("2d");

displayContext.drawImage(bitmap, 0, 0);

document.body.appendChild(displayCanvas);

bitmap.close();

const grayscale = imageDataToGrayscale(
    result.imageData
);

const tensor = createImageTensor(grayscale);

console.log("Tensor:", tensor);
console.log("Tensor shape:", tensor.shape);
console.log("Tensor data length:", tensor.data.length);


console.log("Grayscale:", grayscale);
console.log("Grayscale length:", grayscale.data.length);
console.log("First 20 values:", grayscale.data.slice(0, 20));


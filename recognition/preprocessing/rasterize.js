export function rasterizeStrokes(strokes, width, height) {
    const canvas = new OffscreenCanvas(width, height);

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokes) {
        if (stroke.length < 2) {
            continue;
        }

        ctx.beginPath();

        ctx.moveTo(
            stroke[0].x,
            stroke[0].y
        );

        for (let i = 1; i < stroke.length; i++) {
            ctx.lineTo(
                stroke[i].x,
                stroke[i].y
            );
        }

        ctx.stroke();
    }

    const imageData = ctx.getImageData(
        0,
        0,
        width,
        height
    );

    return {
        canvas,
        imageData
    };
}
export function imageDataToGrayscale(imageData) {
    const { data, width, height } = imageData;

    const grayscale = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        const red = data[i * 4];

        grayscale[i] = red / 255;
    }

    return {
        data: grayscale,
        width,
        height
    };
}

export function createImageTensor(grayscale) {
    return {
        data: grayscale.data,
        shape: [
            1,
            1,
            grayscale.height,
            grayscale.width
        ]
    };
}

export function resizeImageForModel(
    imageData,
    targetHeight = 256,
    widthMultiple = 64
) {
    const scale = targetHeight / imageData.height;

    const resizedWidth = Math.max(
        1,
        Math.round(imageData.width * scale)
    );

    const targetWidth = Math.max(
        widthMultiple,
        Math.ceil(resizedWidth / widthMultiple) * widthMultiple
    );

    // Reconstruct the source image from ImageData.
    const sourceCanvas = new OffscreenCanvas(
        imageData.width,
        imageData.height
    );

    const sourceCtx = sourceCanvas.getContext("2d");
    sourceCtx.putImageData(imageData, 0, 0);

    // Create the model-sized image.
    const targetCanvas = new OffscreenCanvas(
        targetWidth,
        targetHeight
    );

    const targetCtx = targetCanvas.getContext("2d");

    // Keep unused width black.
    targetCtx.fillStyle = "black";
    targetCtx.fillRect(0, 0, targetWidth, targetHeight);

    // Resize while preserving the original aspect ratio.
    targetCtx.drawImage(
        sourceCanvas,
        0,
        0,
        resizedWidth,
        targetHeight
    );

    const resizedImageData = targetCtx.getImageData(
        0,
        0,
        targetWidth,
        targetHeight
    );

    // 1 = image content; 0 = padded area.
    const mask = new Uint8Array(targetHeight * targetWidth);

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < resizedWidth; x++) {
            mask[y * targetWidth + x] = 1;
        }
    }

    return {
        canvas: targetCanvas,
        imageData: resizedImageData,
        width: targetWidth,
        height: targetHeight,
        resizedWidth,
        mask,
        maskShape: [1, targetHeight, targetWidth]
    };
}

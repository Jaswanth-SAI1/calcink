import { resampleStroke } from "./recognition/preprocessing/resample.js";

import {
    rasterizeStrokes,
    imageDataToGrayscale,
    createImageTensor,
    resizeImageForModel
} from "./recognition/preprocessing/rasterize.js";

self.onmessage = (event) => {
    const { type, requestId, input } = event.data;

    if (type !== "PREPROCESSED_INPUT") return;

    self.postMessage({
        type: "PREPROCESSING_COMPLETE",
        requestId,
        width: input.width,
        height: input.height,
        tensorLength: input.tensor.length,
        maskWidth: input.maskWidth,
        maskHeight: input.maskHeight,
        maskLength: input.mask.length
    });
};

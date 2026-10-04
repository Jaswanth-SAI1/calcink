
import { InferenceEngine, loadVocab } from "ink-on/core";

let engine;
let vocab;
let isReady = false;
let initializationPromise;

async function initializeModel() {
    if (isReady) return;

    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async () => {
        vocab = await loadVocab("/models/comer/vocab.json");

        engine = new InferenceEngine({
            encoderUrl: "/models/comer/encoder_int8.onnx",
            decoderUrl: "/models/comer/decoder_int8.onnx",
            beamWidth: 1,
            executionProvider: "wasm",
        });

        await engine.init();
        isReady = true;
    })();

    try {
        await initializationPromise;
    } catch (error) {
        initializationPromise = undefined;
        throw error;
    }
}

self.onmessage = async (event) => {
    const { type, requestId, input } = event.data;

    if (type === "INIT") {
        self.postMessage({ type: "MODEL_LOADING" });

        try {
            await initializeModel();

            self.postMessage({ type: "MODEL_READY" });
        } catch (error) {
            self.postMessage({
                type: "MODEL_INIT_ERROR",
                error: error.message || String(error),
            });
        }

        return;
    }

    if (type !== "RECOGNIZE") return;

    try {
        if (!isReady) {
            throw new Error("Model is not ready yet.");
        }

        if (
            !input ||
            !(input.tensor instanceof Float32Array) ||
            !(input.mask instanceof Uint8Array)
        ) {
            throw new Error("Invalid preprocessed model input.");
        }

        if (
            input.tensor.length !== input.width * input.height ||
            input.mask.length !== input.maskWidth * input.maskHeight
        ) {
            throw new Error("Input tensor or mask dimensions do not match.");
        }

        const result = await engine.recognize(
            input,
            vocab,
            "auto"
        );

        self.postMessage({
            type: "RECOGNITION_RESULT",
            requestId,
            expression: result.latex,
            totalMs: result.totalMs,
            encoderMs: result.encoderMs,
            decoderMs: result.decoderMs,
        });
    } catch (error) {
        self.postMessage({
            type: "WORKER_ERROR",
            requestId,
            error: error.message || String(error),
        });
    }
};

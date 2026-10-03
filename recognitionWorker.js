self.onmessage = (event) => {
    const { type, requestId, strokes } = event.data;

    if (type !== "RECOGNIZE") {
        return;
    }

    console.log("Worker received request:", requestId);
    console.log("Worker received strokes:", strokes);

    const result = {
        type: "RECOGNITION_RESULT",
        requestId: requestId,
        expression: "5 + 8 * 4"
    };

    self.postMessage(result);
};
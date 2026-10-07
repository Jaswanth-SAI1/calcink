# CalcInk — On-Device Handwritten Math Calculator

CalcInk is a browser-based application for recognizing handwritten mathematical expressions and calculating their results. It uses a pretrained handwriting-recognition model and performs inference locally in the browser after the required model assets have loaded.


## Live Demo

https://calcink-bitraiders.vercel.app/


## Features

- **Handwriting input:** Draw mathematical expressions using a mouse or a supported touch/stylus input device.
- **Handwriting recognition:** Recognize handwritten mathematical expressions using a pretrained CoMER model.
- **Expression evaluation:** Evaluate recognized arithmetic expressions with operator precedence.
- **Inline results:** Display calculated results alongside handwritten expressions.
- **Automatic recognition:** Re-evaluate submitted expressions when supported edits are made.
- **Undo and redo:** Undo or restore drawing operations.
- **Erasing:** Remove strokes using the stroke eraser.
- **Adjustable stroke width:** Change the drawing thickness.
- **Clear canvas:** Clear the writing area and start again.
- **Responsive interface:** Use the application in desktop and narrow/mobile browser layouts.
- **Client-side inference:** Run recognition locally in the browser without requiring a remote inference server.

Recognition accuracy depends on handwriting quality and the model's supported vocabulary.

## Technology Stack

- HTML, CSS and JavaScript
- Vite for development and production builds
- ONNX Runtime Web for browser-based model inference
- CoMER pretrained handwriting-recognition model
- Web Workers for recognition processing
- Canvas API and Pointer Events for drawing

## Prerequisites

Install a current version of Node.js and npm.

## Getting Started

Clone the repository:

```bash
git clone https://github.com/Jaswanth-SAI1/calcink.git
cd calcink
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed in the terminal by Vite.

## Using CalcInk

1. Wait for the recognition model to finish loading.
2. Write an arithmetic expression in the canvas.
3. Submit the expression using the equals sign or the Recognize button, as supported by the current interface.
4. View the recognized expression and its calculated result.
5. Use Undo, Redo, Eraser, Clear, or the stroke-width slider to edit your work.

Recognition may take a short time depending on the device and browser.

## Model Assets

The application uses local ONNX model assets and a vocabulary file. The expected model directory is:

```text
public/
└── models/
    └── comer/
        ├── encoder_int8.onnx
        ├── decoder_int8.onnx
        └── vocab.json
```

Keep these assets in their expected locations when running or building the application. Ensure that the required model files are present before testing recognition.

## Project Structure

```text
calcink/
├── public/
│   └── models/
│       └── comer/
├── recognition/
├── expressionParser.js
├── index.html
├── recognitionWorker.js
├── resample.js
├── script.js
├── testExpressionParser.html
├── package.json
└── package-lock.json
```

- `index.html` — application interface.
- `script.js` — drawing interactions and application behavior.
- `recognitionWorker.js` — model initialization and recognition requests.
- `expressionParser.js` — arithmetic expression parsing and evaluation.
- `resample.js` — stroke resampling utilities.
- `testExpressionParser.html` — parser testing page.
- `public/models/comer/` — local model assets.

## Testing and Production Build

Run the production build:

```bash
npm run build
```

Vite generates the production output in the `dist/` directory.

To test the arithmetic evaluation parser and edge cases, simply run:

```bash
npm run test
```

For manual testing, verify that the model loads, drawing and stroke-width adjustment work, recognition produces results, editing controls work (like pixel eraser width scaling), and the layout remains crisp (High-DPI scaling) and usable at all viewport sizes.

## Limitations

- Recognition depends on handwriting clarity and the model's supported symbols.
- Recognition latency varies with the device and browser.
- Browser and WebAssembly capabilities can affect inference performance.
- The application requires the model assets to be available before recognition can run.

## Repository

GitHub: [https://github.com/Jaswanth-SAI1/calcink](https://github.com/Jaswanth-SAI1/calcink)

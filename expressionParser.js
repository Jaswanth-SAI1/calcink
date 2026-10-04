
const LATEX_REPLACEMENTS = [
    [/\\(?:times|cdot)\b/g, "*"],
    [/\\div\b/g, "/"],
    [/\\(?:,|;|:|!|quad|qquad)\b/g, " "],
    [/−/g, "-"],
    [/×/g, "*"],
    [/÷/g, "/"],
    [/＋/g, "+"],
    [/／/g, "/"],
    [/\\left|\\right/g, ""],
];

export function normalizeExpression(rawExpression) {
    if (typeof rawExpression !== "string") {
        throw new Error("Expression must be text.");
    }

    let expression = rawExpression.trim();
    const equalsCount = (expression.match(/=/g) || []).length;

    if (equalsCount > 1) {
        throw new Error("Multiple equals signs detected. Please redraw '='.");
    }

    if (equalsCount === 1) {
        if (!expression.endsWith("=")) {
            throw new Error("Equals sign must be at the end.");
        }

        expression = expression.slice(0, -1).trim();
    }
    
    for (const [pattern, replacement] of LATEX_REPLACEMENTS) {
        expression = expression.replace(pattern, replacement);
    }

    // Accept common LaTeX decimal formatting.
    expression = expression.replace(/\\text\s*\{\s*([+\-*/().])\s*\}/g, "$1");

    // This first version supports inline arithmetic, not LaTeX fractions.
    if (/[{}\\]/.test(expression)) {
        throw new Error("Unsupported mathematical notation.");
    }
    // A trailing equals sign marks the end of an expression, not an operator.
    expression = expression.replace(/=\s*$/, "").trim();

    if (expression.includes("=")) {
        throw new Error("Equals sign is only allowed at the end.");
    }
    // Join digits separated only by spaces, e.g. "1 2 + 7" -> "12 + 7".
    expression = expression.replace(/(?<=\d)\s+(?=\d)/g, "");

    // Normalize whitespace and remove spaces around operators.
    expression = expression.replace(/\s+/g, " ").trim();
    expression = expression.replace(/\s*([+\-*/().])\s*/g, "$1");

    if (!expression) {
        throw new Error("Expression is empty.");
    }

    return expression;
}

function tokenize(expression) {
    const tokens = [];
    let position = 0;

    while (position < expression.length) {
        const remaining = expression.slice(position);

        if (/\s/.test(expression[position])) {
            position++;
            continue;
        }

        const numberMatch = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);

        if (numberMatch) {
            const value = Number(numberMatch[0]);

            if (!Number.isFinite(value)) {
                throw new Error("Invalid number.");
            }

            tokens.push({ type: "number", value });
            position += numberMatch[0].length;
            continue;
        }

        const character = expression[position];

        if ("+-*/()".includes(character)) {
            tokens.push({ type: character, value: character });
            position++;
            continue;
        }

        throw new Error(`Invalid character: "${character}".`);
    }

    return tokens;
}

export function evaluateExpression(rawExpression) {
    const expression = normalizeExpression(rawExpression);
    const tokens = tokenize(expression);

    let position = 0;

    function peek() {
        return tokens[position];
    }

    function consume(type) {
        const token = peek();

        if (!token || token.type !== type) {
            throw new Error(`Expected "${type}".`);
        }

        position++;
        return token;
    }

    function parsePrimary() {
        const token = peek();

        if (!token) {
            throw new Error("Unexpected end of expression.");
        }

        if (token.type === "number") {
            position++;
            return token.value;
        }

        if (token.type === "(") {
            position++;
            const value = parseAddition();
            consume(")");
            return value;
        }

        if (token.type === "+" || token.type === "-") {
            position++;
            const value = parsePrimary();
            return token.type === "-" ? -value : value;
        }

        throw new Error("Expected a number or parenthesized expression.");
    }

    function parseMultiplication() {
        let value = parsePrimary();

        while (peek()?.type === "*" || peek()?.type === "/") {
            const operator = tokens[position++].type;
            const right = parsePrimary();

            if (operator === "/") {
                if (right === 0) {
                    throw new Error("Division by zero is undefined.");
                }

                value /= right;
            } else {
                value *= right;
            }
        }

        return value;
    }

    function parseAddition() {
        let value = parseMultiplication();

        while (peek()?.type === "+" || peek()?.type === "-") {
            const operator = tokens[position++].type;
            const right = parseMultiplication();

            value = operator === "+" ? value + right : value - right;
        }

        return value;
    }

    const result = parseAddition();

    if (position !== tokens.length) {
        throw new Error("Invalid expression.");
    }

    if (!Number.isFinite(result)) {
        throw new Error("The result is outside the supported numeric range.");
    }

    return {
        normalized: expression,
        result: Object.is(result, -0) ? 0 : result,
    };
}

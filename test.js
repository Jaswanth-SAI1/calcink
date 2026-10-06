import assert from 'assert';
import { evaluateExpression } from './expressionParser.js';

function runTests() {
    console.log("Running expression parser unit tests...");

    // Test basic arithmetic
    assert.strictEqual(evaluateExpression("2+3=").result, 5);
    assert.strictEqual(evaluateExpression("10-4=").result, 6);
    assert.strictEqual(evaluateExpression("4\\times 5=").result, 20);
    assert.strictEqual(evaluateExpression("20\\div 4=").result, 5);

    // Test BODMAS / PEMDAS
    assert.strictEqual(evaluateExpression("2+3\\times 4=").result, 14);
    assert.strictEqual(evaluateExpression("(2+3)\\times 4=").result, 20);
    assert.strictEqual(evaluateExpression("10-2\\times (3+1)=").result, 2);

    // Test decimal handling
    assert.strictEqual(evaluateExpression("2.5+1.5=").result, 4);
    assert.strictEqual(evaluateExpression("0.1+0.2=").result, 0.30000000000000004); // Standard float precision

    // Test edge cases: Division by zero
    assert.throws(
        () => evaluateExpression("10/0="),
        { message: "Division by zero is undefined." }
    );

    // Test edge cases: Negative numbers
    assert.strictEqual(evaluateExpression("-5+10=").result, 5);
    assert.strictEqual(evaluateExpression("5+-3=").result, 2);

    // Test parsing messy latex
    assert.strictEqual(evaluateExpression(" 2 \\times   3 = ").result, 6);
    assert.strictEqual(evaluateExpression("4 \\div 2=").result, 2);
    
    // Multiple equals
    assert.throws(
        () => evaluateExpression("2+3=5="),
        { message: "Multiple equals signs detected. Please redraw '='." }
    );

    console.log("✅ All tests passed successfully!");
}

runTests();

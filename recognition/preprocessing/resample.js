function distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    return Math.sqrt(dx * dx + dy * dy);
}

export function resampleStroke(points, spacing) {
    if (points.length === 0) {
        return [];
    }

    if (points.length === 1) {
        return [points[0]];
    }

    const resampled = [points[0]];

    let previousPoint = points[0];
    let distanceSinceLastSample = 0;

    for (let i = 1; i < points.length; i++) {
        const currentPoint = points[i];

        let segmentLength = distance(previousPoint, currentPoint);

        if (segmentLength === 0) {
            continue;
        }

        while (distanceSinceLastSample + segmentLength >= spacing) {
            const distanceNeeded = spacing - distanceSinceLastSample;

            const t = distanceNeeded / segmentLength;

            const samplePoint = {
                x: previousPoint.x +
                   t * (currentPoint.x - previousPoint.x),

                y: previousPoint.y +
                   t * (currentPoint.y - previousPoint.y)
            };

            resampled.push(samplePoint);

            previousPoint = samplePoint;

            segmentLength = distance(previousPoint, currentPoint);

            distanceSinceLastSample = 0;
        }

        distanceSinceLastSample += segmentLength;
        previousPoint = currentPoint;
    }

    return resampled;
}
/**
 * Converts an SVG path `d` attribute string to PDF content stream path operators.
 *
 * Coordinate system mapping:
 *   SVG: origin top-left, Y increases downward
 *   PDF: origin bottom-left, Y increases upward
 *
 * Transformation: pdf_y = pageHeight - svg_y
 *
 * Supported SVG commands (potrace outputs only these absolute variants):
 *   M x y   → x y m  (moveto)
 *   C x1 y1 x2 y2 x y → x1 y1 x2 y2 x y c  (cubic bezier)
 *   Z / z   → h  (closepath)
 */
export function svgPathToPdfOperators(svgPath: string, pageHeight: number): string {
  const tokens = svgPath.trim().split(/[\s,]+/);
  const ops: string[] = [];
  let i = 0;

  // PDF uses fixed-point numbers; 4 decimal places is sufficient
  const f = (n: number) => n.toFixed(4);
  // Flip Y coordinate from SVG space to PDF space
  const fy = (y: number) => f(pageHeight - y);

  while (i < tokens.length) {
    const cmd = tokens[i++];

    switch (cmd) {
      case 'M': {
        const x = parseFloat(tokens[i++]);
        const y = parseFloat(tokens[i++]);
        ops.push(`${f(x)} ${fy(y)} m`);
        break;
      }
      case 'C': {
        const x1 = parseFloat(tokens[i++]);
        const y1 = parseFloat(tokens[i++]);
        const x2 = parseFloat(tokens[i++]);
        const y2 = parseFloat(tokens[i++]);
        const x = parseFloat(tokens[i++]);
        const y = parseFloat(tokens[i++]);
        ops.push(`${f(x1)} ${fy(y1)} ${f(x2)} ${fy(y2)} ${f(x)} ${fy(y)} c`);
        break;
      }
      case 'Z':
      case 'z': {
        ops.push('h');
        break;
      }
      default: {
        // Unknown command — skip token (should not happen with potrace output)
        break;
      }
    }
  }

  return ops.join('\n');
}

/**
 * Translates all coordinates in an SVG path `d` string by (dx, dy).
 * Used to strip the padding offset added before tracing.
 */
export function translateSvgPath(svgPath: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return svgPath;
  const tokens = svgPath.trim().split(/\s+/);
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': {
        const x = parseFloat(tokens[i++]) + dx;
        const y = parseFloat(tokens[i++]) + dy;
        out.push(`M ${x.toFixed(4)} ${y.toFixed(4)}`);
        break;
      }
      case 'C': {
        const coords = [
          parseFloat(tokens[i++]) + dx, parseFloat(tokens[i++]) + dy,
          parseFloat(tokens[i++]) + dx, parseFloat(tokens[i++]) + dy,
          parseFloat(tokens[i++]) + dx, parseFloat(tokens[i++]) + dy,
        ];
        out.push(`C ${coords.map(n => n.toFixed(4)).join(' ')}`);
        break;
      }
      case 'Z': case 'z': out.push('Z'); break;
      default: break;
    }
  }
  return out.join(' ');
}

/**
 * Applies translate then scale to all coordinates in an SVG path `d` string.
 * Equivalent to translateSvgPath then scaleSvgPath but in one pass.
 * Used to bake PDF layout transforms directly into path coordinates so no
 * PDF `cm` matrix operators are needed in the content stream.
 */
export function transformSvgPath(
  svgPath: string,
  dx: number, dy: number,
  scaleX: number, scaleY: number
): string {
  const tokens = svgPath.trim().split(/[\s,]+/);
  const out: string[] = [];
  let i = 0;
  const tx = (x: number) => ((x + dx) * scaleX).toFixed(4);
  const ty = (y: number) => ((y + dy) * scaleY).toFixed(4);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': {
        const x = parseFloat(tokens[i++]);
        const y = parseFloat(tokens[i++]);
        out.push(`M ${tx(x)} ${ty(y)}`);
        break;
      }
      case 'C': {
        const coords: string[] = [];
        for (let j = 0; j < 3; j++) {
          coords.push(tx(parseFloat(tokens[i++])));
          coords.push(ty(parseFloat(tokens[i++])));
        }
        out.push(`C ${coords.join(' ')}`);
        break;
      }
      case 'Z': case 'z': out.push('Z'); break;
      default: break;
    }
  }
  return out.join(' ');
}

/**
 * Scales all coordinates in an SVG path `d` string by scaleX and scaleY.
 * Used to map from image pixel space to PDF point space.
 */
export function scaleSvgPath(svgPath: string, scaleX: number, scaleY: number): string {
  const tokens = svgPath.trim().split(/[\s,]+/);
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];

    switch (cmd) {
      case 'M': {
        const x = parseFloat(tokens[i++]) * scaleX;
        const y = parseFloat(tokens[i++]) * scaleY;
        out.push(`M ${x.toFixed(4)} ${y.toFixed(4)}`);
        break;
      }
      case 'C': {
        const coords = [
          parseFloat(tokens[i++]) * scaleX,
          parseFloat(tokens[i++]) * scaleY,
          parseFloat(tokens[i++]) * scaleX,
          parseFloat(tokens[i++]) * scaleY,
          parseFloat(tokens[i++]) * scaleX,
          parseFloat(tokens[i++]) * scaleY,
        ];
        out.push(`C ${coords.map(n => n.toFixed(4)).join(' ')}`);
        break;
      }
      case 'Z':
      case 'z': {
        out.push('Z');
        break;
      }
      default: {
        break;
      }
    }
  }

  return out.join(' ');
}

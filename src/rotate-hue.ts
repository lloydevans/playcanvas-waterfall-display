/**
 * Rotate a colors hue by given amount in degrees.
 *
 * @param color - Target pc.Color instance to modify.
 * @param amount - Amount to rotate by in degrees.
 */
export function rotateHue(color: pc.Color, amount: number) {
  let cos = Math.cos((amount * Math.PI) / 180);
  let sin = Math.sin((amount * Math.PI) / 180);
  let mR = cos + (1 - cos) / 3;
  let mG = (1 - cos) / 3 - Math.sqrt(1 / 3) * sin;
  let mB = (1 - cos) / 3 + Math.sqrt(1 / 3) * sin;
  color.r = color.r * mR + color.g * mG + color.b * mB;
  color.g = color.r * mB + color.g * mR + color.b * mG;
  color.b = color.r * mG + color.g * mB + color.b * mR;
}

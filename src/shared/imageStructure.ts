const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Uint8Array(128);
for (let index = 0; index < BASE64_VALUES.length; index += 1) BASE64_VALUES[index] = 0xff;
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index;

/** Strict base64 -> bytes. Empty, malformed, and non-canonical input returns undefined. */
export function decodeStrictBase64(data: string): Uint8Array | undefined {
  if (data === "" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return undefined;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((data.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < data.length; index += 4) {
    const first = base64Value(data[index]);
    const second = base64Value(data[index + 1]);
    if (first === undefined || second === undefined) return undefined;
    const thirdCharacter = data[index + 2];
    const fourthCharacter = data[index + 3];
    const third = thirdCharacter === "=" ? 0 : base64Value(thirdCharacter);
    const fourth = fourthCharacter === "=" ? 0 : base64Value(fourthCharacter);
    if (third === undefined || fourth === undefined) return undefined;
    const isLast = index + 4 === data.length;
    if (!isLast && (thirdCharacter === "=" || fourthCharacter === "=")) return undefined;
    if (thirdCharacter === "=" && (fourthCharacter !== "=" || (second & 0x0f) !== 0)) return undefined;
    if (fourthCharacter === "=" && thirdCharacter !== "=" && (third & 0x03) !== 0) return undefined;
    if (fourthCharacter !== "=" && thirdCharacter === "=") return undefined;
    if (outputIndex < output.length) output[outputIndex++] = (first << 2) | (second >>> 4);
    if (thirdCharacter !== "=" && outputIndex < output.length) output[outputIndex++] = ((second & 0x0f) << 4) | (third >>> 2);
    if (fourthCharacter !== "=" && outputIndex < output.length) output[outputIndex++] = ((third & 0x03) << 6) | fourth;
  }
  return output;
}

function base64Value(character: string | undefined): number | undefined {
  if (character?.length !== 1) return undefined;
  const code = character.charCodeAt(0);
  if (code >= BASE64_VALUES.length) return undefined;
  const value = BASE64_VALUES[code];
  return value === 0xff ? undefined : value;
}

/** True when bytes form a structurally complete supported image container. */
export function isStructurallyCompleteImage(bytes: Uint8Array, mimeType: string): boolean {
  try {
    switch (mimeType) {
      case "image/png": return isCompletePng(bytes);
      case "image/jpeg": return isCompleteJpeg(bytes);
      case "image/gif": return isCompleteGif(bytes);
      case "image/webp": return isCompleteWebp(bytes);
      default: return false;
    }
  } catch {
    return false;
  }
}

function isCompletePng(bytes: Uint8Array): boolean {
  if (!matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let offset = 8;
  let chunkCount = 0;
  let hasImageHeader = false;
  let hasImageData = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return false;
    const length = readUint32BigEndian(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;
    const type = textAt(bytes, offset + 4, 4);
    if (chunkCount === 0) {
      if (type !== "IHDR" || length !== 13) return false;
      hasImageHeader = readUint32BigEndian(bytes, offset + 16) > 0 && readUint32BigEndian(bytes, offset + 20) > 0;
      if (!hasImageHeader) return false;
    }
    if (type === "IDAT" && length > 0) hasImageData = true;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) return false;
      return hasImageHeader && hasImageData;
    }
    offset = chunkEnd;
    chunkCount += 1;
  }
  return false;
}

function isCompleteJpeg(bytes: Uint8Array): boolean {
  if (!matches(bytes, 0, [0xff, 0xd8]) || bytes.length < 4) return false;
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = byteAt(bytes, offset);
    offset += 1;
    if (marker === 0x00) return false;
    if (marker === 0xd9) return offset === bytes.length && hasFrame && hasScan;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (marker === 0x01) continue;
    if (bytes.length - offset < 2) return false;
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if (isFrameMarker(marker)) {
      if (segmentLength < 8) return false;
      const componentCount = byteAt(bytes, offset + 7);
      const height = readUint16BigEndian(bytes, offset + 3);
      const width = readUint16BigEndian(bytes, offset + 5);
      if (componentCount === 0 || height === 0 || width === 0 || segmentLength < 8 + componentCount * 3) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!isValidScanHeader(bytes, offset, segmentLength)) return false;
      offset += segmentLength;
      const scan = consumeJpegEntropy(bytes, offset);
      if (scan?.hasEntropyByte !== true) return false;
      hasScan = true;
      offset = scan.markerOffset;
      continue;
    }
    offset += segmentLength;
    if (offset <= markerStart) return false;
  }
  return false;
}

function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function isValidScanHeader(bytes: Uint8Array, offset: number, segmentLength: number): boolean {
  if (segmentLength < 6) return false;
  const componentCount = byteAt(bytes, offset + 2);
  return componentCount > 0 && segmentLength >= 6 + componentCount * 2;
}

function consumeJpegEntropy(bytes: Uint8Array, start: number): { markerOffset: number; hasEntropyByte: boolean } | undefined {
  let offset = start;
  let hasEntropyByte = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      hasEntropyByte = true;
      offset += 1;
      continue;
    }
    const markerOffset = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = byteAt(bytes, offset);
    if (marker === 0x00) {
      hasEntropyByte = true;
      offset += 1;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 1;
      continue;
    }
    return { markerOffset, hasEntropyByte };
  }
  return undefined;
}

function isCompleteGif(bytes: Uint8Array): boolean {
  if (!(matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return false;
  if (bytes.length < 13) return false;
  const screenWidth = readUint16LittleEndian(bytes, 6);
  const screenHeight = readUint16LittleEndian(bytes, 8);
  if (screenWidth === 0 || screenHeight === 0) return false;
  let offset = 13;
  const screenPacked = byteAt(bytes, 10);
  if ((screenPacked & 0x80) !== 0) {
    const colorTableLength = 3 * (1 << ((screenPacked & 0x07) + 1));
    if (offset + colorTableLength > bytes.length) return false;
    offset += colorTableLength;
  }
  let hasImage = false;
  while (offset < bytes.length) {
    const block = byteAt(bytes, offset);
    offset += 1;
    if (block === 0x3b) return offset === bytes.length && hasImage;
    if (block === 0x21) {
      if (offset >= bytes.length) return false;
      offset += 1; // extension label
      const subBlocks = consumeGifSubBlocks(bytes, offset);
      if (!subBlocks.valid) return false;
      offset = subBlocks.nextOffset;
      continue;
    }
    if (block !== 0x2c || offset + 9 > bytes.length) return false;
    const width = readUint16LittleEndian(bytes, offset + 4);
    const height = readUint16LittleEndian(bytes, offset + 6);
    const packed = byteAt(bytes, offset + 8);
    if (width === 0 || height === 0) return false;
    offset += 9;
    if ((packed & 0x80) !== 0) {
      const colorTableLength = 3 * (1 << ((packed & 0x07) + 1));
      if (offset + colorTableLength > bytes.length) return false;
      offset += colorTableLength;
    }
    if (offset >= bytes.length) return false;
    const lzwMinimumCodeSize = byteAt(bytes, offset);
    if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) return false;
    offset += 1;
    const subBlocks = consumeGifSubBlocks(bytes, offset);
    if (!subBlocks.valid || !subBlocks.hasNonemptyBlock) return false;
    offset = subBlocks.nextOffset;
    hasImage = true;
  }
  return false;
}

function consumeGifSubBlocks(bytes: Uint8Array, start: number): { valid: boolean; nextOffset: number; hasNonemptyBlock: boolean } {
  let offset = start;
  let hasNonemptyBlock = false;
  while (offset < bytes.length) {
    const length = byteAt(bytes, offset);
    offset += 1;
    if (length === 0) return { valid: true, nextOffset: offset, hasNonemptyBlock };
    if (offset + length > bytes.length) return { valid: false, nextOffset: offset, hasNonemptyBlock };
    if (length > 0) hasNonemptyBlock = true;
    offset += length;
  }
  return { valid: false, nextOffset: offset, hasNonemptyBlock };
}

function isCompleteWebp(bytes: Uint8Array): boolean {
  if (!matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || bytes.length < 12 || !matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return false;
  if (readUint32LittleEndian(bytes, 4) !== bytes.length - 8) return false;
  const topLevel = walkWebpChunks(bytes, 12, bytes.length);
  return topLevel.valid && topLevel.hasImage;
}

function walkWebpChunks(bytes: Uint8Array, start: number, end: number): { valid: boolean; hasImage: boolean } {
  let offset = start;
  let hasImage = false;
  while (offset < end) {
    if (end - offset < 8) return { valid: false, hasImage };
    const type = textAt(bytes, offset, 4);
    const length = readUint32LittleEndian(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    const chunkEnd = payloadEnd + (length % 2);
    if (payloadEnd > end || chunkEnd > end) return { valid: false, hasImage };
    if ((type === "VP8 " || type === "VP8L") && length > 0) hasImage = true;
    if (type === "ANMF" && length >= 16) {
      const nested = walkWebpChunks(bytes, payloadStart + 16, payloadEnd);
      if (!nested.valid) return { valid: false, hasImage };
      hasImage ||= nested.hasImage;
    }
    offset = chunkEnd;
  }
  return { valid: offset === end, hasImage };
}

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function textAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function byteAt(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) throw new Error("image structure read exceeded payload");
  return value;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) * 0x1000000 + (byteAt(bytes, offset + 1) << 16) + (byteAt(bytes, offset + 2) << 8) + byteAt(bytes, offset + 3);
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) + byteAt(bytes, offset + 1) * 0x100 + byteAt(bytes, offset + 2) * 0x10000 + byteAt(bytes, offset + 3) * 0x1000000;
}

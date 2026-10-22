import { describe, expect, it } from "vitest";
import { decodeStrictBase64, isStructurallyCompleteImage } from "./imageStructure.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const ZERO_WIDTH_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAAAAAAFCAIAAADkJHr2AAAAFElEQVR4nGPkEpFjwABMmEJUEQUAG9AARjs4PkcAAAAASUVORK5CYII=";
const ZERO_HEIGHT_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAACAIAAABWNfA8AAAAFElEQVR4nGPkEpFjwABMmEJUEQUAG9AARjs4PkcAAAAASUVORK5CYII=";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z";
const PROGRESSIVE_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABigy4/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
const GIF = "R0lGODdhAQABAIEAAP8AAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==";
const GIF_WITH_EXTENSION = "R0lGODlhAQABAIEAAP8AAAAAAAAAAAAAACH+BHRlc3QALAAAAAABAAEAAAgEAAEEBAA7";
const WEBP = "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=";
const ANIMATED_WEBP = "UklGRsoAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAAAAAAAAGQAAAJWUDggMgAAADABAJ0BKgEAAQABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkwAAAAAAAAAAAAAAAAAAABkAAAAVlA4IDQAAAA0AQCdASoBAAEAAAAmJaAAA3AA/ukiH//3nz//ufP/+58/6M///yn7//I4//8jj/5QIAAA";
const ODD_RIFF_WEBP = "UklGRkYAAABXRUJQSlVOSwEAAABYAFZQOCAwAAAA0AEAnQEqAQABAAFAJiWgAnS6AfgAA7AA/vLrf/zYFc1z7/f/0uD9Lg/S4P/SkAAA";

function bytes(data: string): Uint8Array {
  const decoded = decodeStrictBase64(data);
  if (decoded === undefined) throw new Error("fixture did not decode");
  return decoded;
}

function concat(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function riffChunk(type: string, payload: number[]): number[] {
  const typeBytes = Array.from(type).map((character) => character.charCodeAt(0));
  return [...typeBytes, payload.length & 0xff, (payload.length >>> 8) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 24) & 0xff, ...payload, ...(payload.length % 2 === 0 ? [] : [0])];
}

function riffWebp(...chunks: number[]): Uint8Array {
  const size = chunks.length + 4;
  return concat(
    [0x52, 0x49, 0x46, 0x46, size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff, 0x57, 0x45, 0x42, 0x50],
    chunks,
  );
}

describe("decodeStrictBase64", () => {
  it.each(["", "A", "AAA", "AAAA=", "AA=A", "AAAA====", "!!!!"]) ("rejects malformed input %s", (data) => {
    expect(decodeStrictBase64(data)).toBeUndefined();
  });

  it("decodes canonical padded and unpadded groups only when four-aligned", () => {
    expect(Array.from(decodeStrictBase64("AQID") ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(decodeStrictBase64("AQI=") ?? [])).toEqual([1, 2]);
    expect(Array.from(decodeStrictBase64("AQ==") ?? [])).toEqual([1]);
  });
});

describe("isStructurallyCompleteImage", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/jpeg", PROGRESSIVE_JPEG],
    ["image/gif", GIF],
    ["image/gif", GIF_WITH_EXTENSION],
    ["image/webp", WEBP],
    ["image/webp", ANIMATED_WEBP],
    ["image/webp", ODD_RIFF_WEBP],
  ] as const)("accepts a complete %s container", (mimeType, data) => {
    expect(isStructurallyCompleteImage(bytes(data), mimeType)).toBe(true);
  });

  it("rejects truncation, malformed boundaries, marker shells, and MIME mismatches without throwing", () => {
    const png = bytes(PNG);
    const malformedPng = png.slice();
    malformedPng[8] = 0xff;
    malformedPng[9] = 0xff;
    const truncatedPng = png.slice(0, -1);
    const jpegShell = concat(
      [0xff, 0xd8],
      [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x11, 0x00, 0x00],
      [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
      [0xff, 0xd9],
    );
    const gifShell = concat(
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
      [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x00, 0x3b],
    );
    const anmfWithoutImage = riffWebp(...riffChunk("ANMF", Array.from({ length: 16 }, () => 0)));
    const inconsistentWebp = bytes(WEBP).slice();
    inconsistentWebp[4] = 0;

    expect(isStructurallyCompleteImage(truncatedPng, "image/png")).toBe(false);
    expect(isStructurallyCompleteImage(malformedPng, "image/png")).toBe(false);
    expect(isStructurallyCompleteImage(concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]), "image/png")).toBe(false);
    expect(isStructurallyCompleteImage(jpegShell, "image/jpeg")).toBe(false);
    expect(isStructurallyCompleteImage(concat([0xff, 0xd8, 0xff, 0xd9], []), "image/jpeg")).toBe(false);
    expect(isStructurallyCompleteImage(gifShell, "image/gif")).toBe(false);
    expect(isStructurallyCompleteImage(anmfWithoutImage, "image/webp")).toBe(false);
    expect(isStructurallyCompleteImage(inconsistentWebp, "image/webp")).toBe(false);
    expect(isStructurallyCompleteImage(png, "image/jpeg")).toBe(false);
    expect(() => isStructurallyCompleteImage(new Uint8Array([1, 2, 3]), "image/png")).not.toThrow();
  });

  it("rejects PNGs whose valid IHDR declares a zero width or height", () => {
    expect(isStructurallyCompleteImage(bytes(ZERO_WIDTH_PNG), "image/png")).toBe(false);
    expect(isStructurallyCompleteImage(bytes(ZERO_HEIGHT_PNG), "image/png")).toBe(false);
  });
});

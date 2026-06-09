#!/usr/bin/env python3
import math
import struct
import zlib
from pathlib import Path

BG = (37, 99, 235)
FG = (255, 255, 255)


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)


def write_png(path: Path, size: int, pixels: list[tuple[int, int, int]]) -> None:
    raw = bytearray()
    row_len = size * 3
    for y in range(size):
        raw.append(0)
        start = y * size
        for x in range(size):
            r, g, b = pixels[start + x]
            raw.extend((r, g, b))

    compressed = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", ihdr)
    png += png_chunk(b"IDAT", compressed)
    png += png_chunk(b"IEND", b"")
    path.write_bytes(png)


def inside_round_rect(x: float, y: float, size: int, radius: float) -> bool:
    left, right = radius, size - radius
    top, bottom = radius, size - radius
    if left <= x <= right or top <= y <= bottom:
        return True
    corners = (
        (radius, radius),
        (size - radius, radius),
        (radius, size - radius),
        (size - radius, size - radius),
    )
    for cx, cy in corners:
        if (x - cx) ** 2 + (y - cy) ** 2 <= radius**2:
            return True
    return False


def inside_circle(x: float, y: float, cx: float, cy: float, radius: float) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def inside_capsule(
    x: float,
    y: float,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    thickness: float,
) -> bool:
    dx = x2 - x1
    dy = y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return inside_circle(x, y, x1, y1, thickness / 2)

    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length_sq))
    px = x1 + t * dx
    py = y1 + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= (thickness / 2) ** 2


def build_pixels(size: int) -> list[tuple[int, int, int]]:
    pixels: list[tuple[int, int, int]] = []
    radius = size * 0.22
    center = size / 2
    dot_r = size * 0.075
    line_thickness = max(2, size * 0.09)
    top_dot_y = center - size * 0.18
    bottom_dot_y = center + size * 0.18

    for y in range(size):
        for x in range(size):
            fx = x + 0.5
            fy = y + 0.5
            if not inside_round_rect(fx, fy, size, radius):
                pixels.append(BG)
                continue

            is_fg = (
                inside_circle(fx, fy, center, top_dot_y, dot_r)
                or inside_circle(fx, fy, center, bottom_dot_y, dot_r)
                or inside_capsule(
                    fx,
                    fy,
                    center - size * 0.18,
                    center,
                    center + size * 0.18,
                    center,
                    line_thickness,
                )
            )
            pixels.append(FG if is_fg else BG)

    return pixels


def main() -> None:
    icons_dir = Path(__file__).resolve().parent.parent / "icons"
    icons_dir.mkdir(exist_ok=True)

    for size in (16, 48, 128):
        write_png(icons_dir / f"icon{size}.png", size, build_pixels(size))
        print(f"generated icon{size}.png")


if __name__ == "__main__":
    main()

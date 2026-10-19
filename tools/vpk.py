"""Small, deterministic VPK v1 writer. No external dependencies."""
from pathlib import Path, PurePosixPath
import struct
import zlib


def pack(files: dict[str, bytes], output: Path) -> None:
    """Write a single inline-data archive readable by Source 2."""
    groups: dict[str, dict[str, list[tuple[str, bytes]]]] = {}
    for filename, data in sorted(files.items()):
        path = PurePosixPath(filename)
        if ('\0' in filename or '\\' in filename or filename != path.as_posix()
                or path.is_absolute() or '..' in path.parts or not path.suffix):
            raise ValueError(f'Unsafe or extensionless VPK entry: {filename}')
        extension = path.suffix[1:]
        directory = str(path.parent) if str(path.parent) != '.' else ' '
        groups.setdefault(extension, {}).setdefault(directory, []).append((path.stem, data))
    tree = bytearray()
    payload = bytearray()
    for extension, directories in sorted(groups.items()):
        tree.extend(extension.encode() + b'\0')
        for directory, entries in sorted(directories.items()):
            tree.extend(directory.encode() + b'\0')
            for name, data in entries:
                tree.extend(name.encode() + b'\0')
                tree.extend(struct.pack('<IHHIIH', zlib.crc32(data), 0, 0x7FFF,
                                        len(payload), len(data), 0xFFFF))
                payload.extend(data)
            tree.extend(b'\0')
        tree.extend(b'\0')
    tree.extend(b'\0')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack('<III', 0x55AA1234, 1, len(tree)) + tree + payload)

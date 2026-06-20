# Scene 1: c1s1

## Sub-location: room_a {#room_a}
- **Status:** unlocked

[場景：c1 room_a]

### Hotspot: desk {#desk}
- **Description:** a desk

**A**：looking.

## Sub-location: room_b {#room_b}
- **Status:** unlocked

[場景：c1 room_b]

### Hotspot: shelf {#shelf}
- **Description:** a shelf
- **Reveals:** [evidence:foo]

**A**：found something.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.
- **Source Sublocation:** room_a

#### On Collect

**A**：got it.

## Outro


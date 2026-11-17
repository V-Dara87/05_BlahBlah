---
format_version: 3
id: project-file
title: Editing the project without clobbering it
chapter: C1
goal: Explain the revision guard and the lock, and choose the right helper for a safe edit.
prerequisites: [overview]
code_refs:
  - blah-blah/packages/blahblah-core/src/project.js#L145-L203
est_minutes: 9
language: en
---
## Overview

Every edit ends in the same file. This lesson follows the three helpers that stand between a caller and project.json, and shows what each one protects against.

Questions this lesson answers:
- What does loadProject return besides the project?
- What happens when the file changed after it was read?
- When should code use updateProject instead of saveProject?

## Vocabulary

- revision: a hash of the exact bytes of project.json that were read.
- lock: a marker that lets one process edit a project at a time.

## Steps

### Step 1: Load returns a fingerprint

`loadProject` reads the file and returns a `revision`, a hash of the raw text (blah-blah/packages/blahblah-core/src/project.js#L145-L150). The hash is not stored in the file; it describes the version the caller is holding.

:::why
q: Why hash the raw text instead of using lastModified?
answer: Two writes can land in the same millisecond, and a hand edit can preserve a timestamp. Hashing the bytes is the only way to know the content is the same one that was read.
:::

### Step 2: Save refuses a stale write

When `expectedRevision` is passed, a save re-reads the file and compares `hashText`; a mismatch throws `ProjectConflictError` and nothing is written (blah-blah/packages/blahblah-core/src/project.js#L161-L173). Without the option the save overwrites, which is intentional for a fresh project.

:::why
q: The guard already throws on a conflict. Why does the caller still need to redo the edit?
answer: The in-memory project is based on the old text. The caller has to load again and reapply its change, otherwise it would write the old content back with the new timestamp.
:::

### Step 3: updateProject wraps the whole cycle

`updateProject` holds `withLock`, loads inside the lock, runs the mutator, and retries when another process won the race (blah-blah/packages/blahblah-core/src/project.js#L186-L203). If the mutator throws, nothing is written.

:::why
q: Why is the read inside the lock rather than before it?
answer: Reading first would leave a window where another process saves between the read and the write. Reading inside the lock means the revision belongs to the same window as the write.
:::

## Teach-back

:::teach-back
In 3 to 5 sentences: what a revision is, why saveProject can refuse a write, and why updateProject is the safer choice for a read-modify-write.
:::

## Summary

- Loading returns a hash of the bytes that were read.
- saveProject refuses a write when that hash no longer matches.
- updateProject locks, reads and writes in one cycle, and retries a conflict.
- A mutator that throws leaves the file untouched.

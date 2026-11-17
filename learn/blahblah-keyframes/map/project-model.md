---
type: system
title: What project.json holds, and how a save avoids clobbering
links:
  - to: lessons/project-file
    rel: depends-on
code_refs:
  - blah-blah/packages/blahblah-core/src/project.js#L10-L25
  - blah-blah/packages/blahblah-core/src/project.js#L157-L178
---
## What it does

One folder is one project: project.json next to the `scripts`, `prefabs` and `media` folders (blah-blah/packages/blahblah-core/src/project.js#L47-L50). The file is one object with a name, a resolution, tracks, entities and a schema version that is checked before anything is edited (blah-blah/packages/blahblah-core/src/project.js#L10-L25).

## Why it is built this way

The default tracks are copied for every new project instead of being shared (blah-blah/packages/blahblah-core/src/project.js#L61), so editing one project can never change the defaults of the next. Loading also returns a `revision`: a hash of the exact bytes that were read (blah-blah/packages/blahblah-core/src/project.js#L145-L150).

## How a save avoids clobbering

`saveProject` writes the file through a temporary copy and keeps the previous version as a backup (blah-blah/packages/blahblah-core/src/project.js#L157-L178). When `expectedRevision` is passed, it reads the file again and refuses the write if `hashText` no longer matches (blah-blah/packages/blahblah-core/src/project.js#L161-L173). `updateProject` goes one step further: it holds a lock, reads inside it, and retries when another process won (blah-blah/packages/blahblah-core/src/project.js#L186-L203).

## What it relates to

[[lessons/project-file]] walks through these three layers with one concrete edit.

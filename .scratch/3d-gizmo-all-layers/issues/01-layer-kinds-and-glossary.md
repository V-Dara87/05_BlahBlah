# 01: Define 3D Layer, Flat Layer and Mesh Layer in one place

**What to build:** One shared definition of which drawn entities are a 3D Layer, a Flat Layer (Video, Text, Script, 2D Shape) and a Mesh Layer (3D primitive Shape), used by the existing 3D Shape gizmo. Nothing changes for the author: the 3D Shape gizmo looks and behaves exactly as before. A new `CONTEXT.md` at the repo root holds the agreed glossary: 3D Layer, Flat Layer, Mesh Layer, Layer Box (glossary only, no implementation detail).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Classification covers Video, Text, 2D Shape, Canvas / React / MonoBehaviour Script, 3D Shape, Camera, Audio, and an empty parent (Transform only)
- [x] Camera, Audio, Subtitle, Transition and empty parents are classified as not eligible for the 3D gizmo
- [x] The existing 3D Shape gizmo uses the shared classification and behaves identically (move, rotate, scale, W / E / R)
- [x] Classification is tested at the gizmo engine seam
- [x] `CONTEXT.md` exists with the four terms and no implementation details